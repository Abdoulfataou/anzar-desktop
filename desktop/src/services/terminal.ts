/**
 * TerminalService — Exécution de commandes, gestion de processus, logs
 *
 * Utilise l'API Shell de Tauri pour :
 * - Exécuter des commandes shell (npm, pip, git, cargo, etc.)
 * - Streamer stdout/stderr en temps réel
 * - Installer des dépendances automatiquement
 * - Tuer des processus en cours
 * - Détecter l'OS et adapter les commandes
 */

import { exists, readTextFile } from '@tauri-apps/api/fs'
import { Command } from '@tauri-apps/api/shell'

// ============================================================================
// TYPES
// ============================================================================

export interface ProcessOutput {
  id: string;
  type: 'stdout' | 'stderr' | 'system' | 'error' | 'success';
  content: string;
  timestamp: number;
}

export interface RunningProcess {
  id: string;
  command: string;
  args: string[];
  cwd?: string;
  startedAt: number;
  status: 'running' | 'completed' | 'failed' | 'killed';
  exitCode?: number;
  pid?: number;
  childProcess?: any; // Tauri Child reference
}

export interface CommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface DependencyInfo {
  name: string;
  version?: string;
  type: 'npm' | 'pip' | 'cargo';
}

export type TerminalEvent =
  | { type: 'output'; processId: string; data: ProcessOutput }
  | { type: 'process-start'; process: RunningProcess }
  | { type: 'process-end'; processId: string; exitCode: number }
  | { type: 'process-error'; processId: string; error: string };

// ============================================================================
// EVENT EMITTER (lightweight)
// ============================================================================

type Listener<T> = (event: T) => void;

class SimpleEventEmitter<T> {
  private listeners: Listener<T>[] = [];

  on(listener: Listener<T>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: T): void {
    this.listeners.forEach((l) => l(event));
  }
}

/** Separate event bus for dev server URL detection */
type DevServerUrlListener = (url: string) => void;
const devServerUrlListeners: DevServerUrlListener[] = [];

/** Subscribe to dev server URL detection events */
export function onDevServerUrl(listener: DevServerUrlListener): () => void {
  devServerUrlListeners.push(listener);
  return () => {
    const idx = devServerUrlListeners.indexOf(listener);
    if (idx >= 0) devServerUrlListeners.splice(idx, 1);
  };
}

function emitDevServerUrl(url: string): void {
  devServerUrlListeners.forEach(l => l(url));
}


/** Subscribe to terminal error events for auto-fix */

// ============================================================================
// SECURITY — Command & Path Validation
// ============================================================================

/** Dangerous patterns that must NEVER be executed */
const BLOCKED_PATTERNS = [
  /sudo\s/i,
  /su\s+-/i,
  /\brm\s+-rf\b/i,               // rm -rf (trop destructif pour grand public)
  /\bgit\s+reset\s+--hard\b/i,   // git reset --hard
  /\bgit\s+clean\s+-fd\b/i,      // git clean -fd
  /rm\s+-rf\s+[/~]/i,            // rm -rf / or ~
  /rm\s+-rf\s+\.\./i,            // rm -rf ..
  />\s*\/dev\//i,                 // redirect to /dev/
  /\|/i,                          // pipes (avoid chaining)
  />/i,                           // redirections (avoid writing files)
  /</i,                           // redirections (avoid reading sensitive files)
  /;\s*/i,                        // command chaining
  /&&/i,                          // command chaining
  /\|\|/i,                        // command chaining
  /curl\s/i,                      // downloads
  /wget\s/i,                      // downloads
  /eval\s*\(/i,
  /\$\(.*\)/,                    // command substitution $(...)
  /`[^`]+`/,                     // backtick substitution
  />\s*\/etc\//i,                // write to /etc
  />\s*~\/\./i,                  // write to dotfiles
  /export\s+(PATH|LD_PRELOAD|LD_LIBRARY_PATH)\s*=/i,  // env hijack
  /nc\s+-/i,                      // netcat
  /python3?\s+-c\s/i,             // inline python execution
  /node\s+-e\s/i,                 // inline node execution
  /(^|\s)(\/|~\/|[A-Za-z]:\\)/,  // absolute paths (limit to project-relative usage)
];

/** Validate a command is safe before execution */
import { isPathWithin } from '@/lib/pathGuard';
import { ensureNode, manualNodeHelp, needsNode } from '@/services/nodeRuntime';
import { checkPython, ensureGit, isPython } from '@/services/programs';

/** Message clair et actionnable pour une commande bloquée. */
function blockedReason(command: string, pattern: RegExp): string {
  if (/node\s+-e|deno eval|bun -e/i.test(command)) {
    return "node -e est refusé (guillemets et échappements cassés selon le système). Écris ton code dans un fichier script (.mjs) avec write_file, puis lance `node script.mjs`.";
  }
  if (/python3?\s+-c/i.test(command)) {
    return "python -c est refusé. Écris ton code dans un fichier .py avec write_file, puis lance `python script.py`.";
  }
  if (/\|\s*sh|curl[^|]*\|/i.test(command)) {
    return 'Les pipes vers un shell sont refusés. Télécharge avec curl, écris un script avec write_file, puis exécute-le séparément.';
  }
  return `Commande bloquée (motif: ${pattern.source}). Utilise une seule commande simple de la liste autorisée.`;
}

function validateCommand(command: string): { safe: boolean; reason?: string } {
  // Block empty commands
  if (!command.trim()) {
    return { safe: false, reason: 'Commande vide' };
  }

  // Block overly long commands (potential injection)
  if (command.length > 2000) {
    return { safe: false, reason: 'Commande trop longue (max 2000 caractères)' };
  }

  // Check against blocked patterns — message ACTIONNABLE pour l'agent
  // (avant : le motif regex brut était renvoyé, l'agent réessayait sans comprendre)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: blockedReason(command, pattern) };
    }
  }

  return { safe: true };
}

/** Minimal command tokenizer (supports quotes) */
function tokenize(command: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch as any;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) out.push(current);
  return out;
}

/**
 * Map "typed command" -> tauri allowlisted command name.
 * (No shell wrapper: no `sh -c`, no `cmd /C`.)
 */
const COMMAND_NAME_MAP: Record<string, string> = {
  npm: 'npm',
  npx: 'npx',
  node: 'node',
  git: 'git',
  cargo: 'cargo',
  python3: 'python3',
  python: 'python',
  pip3: 'pip3',
  pip: 'pip',
  // Outils curés ANZAR (installés via install_tool) : ffmpeg + rg
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  rg: 'rg',
};

/** Nombre maximal d'arguments par commande (voir les entrées <cmd>-N de tauri.conf.json). */
const MAX_ARGS = 8;

function parseExecutable(command: string): { cmdName: string; args: string[] } | null {
  const parts = tokenize(command);
  if (parts.length === 0) return null;
  const raw = parts[0].toLowerCase();
  const base = COMMAND_NAME_MAP[raw];
  if (!base) return null;
  const args = parts.slice(1);
  // Tauri 1 valide les arguments par position et ignore EN SILENCE ceux qui dépassent
  // la liste déclarée : avec un seul validateur, « npm run build » devenait « npm run ».
  // tauri.conf.json déclare donc une entrée par nombre d'arguments (npm-0 … npm-8).
  if (args.length > MAX_ARGS) return null;
  return { cmdName: `${base}-${args.length}`, args };
}

/** Validate and normalize a file path (prevent traversal) */
function validatePath(basePath: string, targetPath: string): boolean {
  // Resolve both paths to absolute
  const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedTarget = targetPath.replace(/\\/g, '/');

  // Block obvious traversal
  if (normalizedTarget.includes('..')) return false;

  // Must start with base path
  if (!normalizedTarget.startsWith(normalizedBase)) return false;

  return true;
}

/** Programme introuvable : message clair, pour que l'agent ne conclue pas qu'il est absent du projet. */
/** Programme manquant (Node, Git, Python) : installation proposée ou explication. null si tout va bien. */
async function programGate(program: string, interactive = true): Promise<string | null> {
  const p = program.trim().split(/[\s/\\]+/).pop()?.toLowerCase().replace(/\.(exe|cmd)$/, '') || '';
  if (needsNode(p)) {
    const node = await ensureNode({ reason: `lancer « ${p} »`, interactive });
    return node.ok ? null : node.message || 'Node.js est nécessaire.';
  }
  if (p === 'git') {
    const git = await ensureGit('cette action', interactive);
    return git.ok ? null : git.message || 'Git est nécessaire.';
  }
  if (isPython(p)) {
    const py = await checkPython(p);
    return py.ok ? null : py.message || 'Python est nécessaire.';
  }
  return null;
}

function explainSpawnError(error: any, command: string): string {
  const raw = String(error?.message || error || '');
  const program = command.trim().split(/\s+/)[0] || 'programme';
  if (/os error 2|No such file or directory|program not found|cannot find the file/i.test(raw) && needsNode(program)) {
    return manualNodeHelp(`lancer « ${program} »`);
  }
  if (/os error 2|No such file or directory|program not found|cannot find the file/i.test(raw)) {
    return `Programme « ${program} » introuvable (${raw}). Soit il n'est pas installé sur l'ordinateur, soit ANZAR ne le trouve pas : `
      + `explique-le simplement à l'utilisateur, donne-lui la commande d'installation adaptée à son système, et précise qu'il faudra ensuite redémarrer ANZAR.`;
  }
  return raw;
}

// ============================================================================
// TERMINAL SERVICE
// ============================================================================

class TerminalService {
  private processes: Map<string, RunningProcess> = new Map();
  private outputHistory: Map<string, ProcessOutput[]> = new Map();
  private eventBus = new SimpleEventEmitter<TerminalEvent>();
  private processCounter = 0;
  private platform: 'darwin' | 'linux' | 'win32' = 'darwin';
  private allowedProjectPaths: Set<string> = new Set();

  constructor() {
    this.detectPlatform();
  }

  /** Register a project path as allowed for command execution */
  registerProjectPath(path: string): void {
    this.allowedProjectPaths.add(path.replace(/\\/g, '/').replace(/\/+$/, ''));
  }

  /** Remove a project path from allowed list */
  unregisterProjectPath(path: string): void {
    this.allowedProjectPaths.delete(path.replace(/\\/g, '/').replace(/\/+$/, ''));
  }

  // ─── Platform Detection ───
  private async detectPlatform() {
    try {
      const { platform } = await import('@tauri-apps/api/os');
      const os = await platform();
      this.platform = os as any;
    } catch {
      // Fallback: guess from navigator
      if (typeof navigator !== 'undefined') {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('win')) this.platform = 'win32';
        else if (ua.includes('linux')) this.platform = 'linux';
        else this.platform = 'darwin';
      }
    }
  }

  /** Whether we're on Windows */
  private get isWindows(): boolean {
    return this.platform === 'win32';
  }

  // ─── Event System ───
  /** Subscribe to terminal events */
  onEvent(listener: (event: TerminalEvent) => void): () => void {
    return this.eventBus.on(listener);
  }

  // ─── Core: Run Command ───

  /**
   * Execute a shell command with real-time streaming output
   * Returns the process ID immediately; use onEvent to get output
   */
  async runCommand(
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      silent?: boolean;
      /** Called immediately once the process id is allocated (before spawn/output). */
      onProcessId?: (processId: string) => void;
    } = {}
  ): Promise<string> {
    const processId = `proc-${++this.processCounter}-${Date.now()}`;
    const startTime = Date.now();
    options.onProcessId?.(processId);

    // Programme manquant (Node, Git, Python) : installation proposée, sinon explication et commande à copier
    const missing = await programGate(command.trim().split(/\s+/)[0] || '');
    if (missing) {
      this.emitOutput(processId, 'error', missing);
      this.eventBus.emit({ type: 'process-error', processId, error: missing });
      return processId;
    }

    // ─── SECURITY: Validate command before execution ───
    const validation = validateCommand(command);
    if (!validation.safe) {
      this.emitOutput(processId, 'error', `⛔ ${validation.reason}`);
      this.eventBus.emit({ type: 'process-error', processId, error: validation.reason || 'Commande bloquée' });
      return processId;
    }

    // ─── SECURITY: No shell wrapper (sh -c). Only allow allowlisted executables. ───
    const parsed = parseExecutable(command);
    if (!parsed) {
      const msg = `Commande non autorisée. Autorisées: ${Object.keys(COMMAND_NAME_MAP).join(', ')}`;
      this.emitOutput(processId, 'error', `⛔ ${msg}`);
      this.eventBus.emit({ type: 'process-error', processId, error: msg });
      return processId;
    }

    // ─── SECURITY: Always require a project cwd (no global execution) ───
    if (!options.cwd) {
      this.emitOutput(processId, 'error', '⛔ Commande bloquée: sélectionne un projet (dossier) d’abord.');
      this.eventBus.emit({ type: 'process-error', processId, error: 'cwd manquant' });
      return processId;
    }

    // ─── SECURITY: Validate cwd is within allowed project paths ───
    const normalizedCwd = options.cwd.replace(/\\/g, '/').replace(/\/+$/, '');

    if (this.allowedProjectPaths.size === 0) {
      this.emitOutput(processId, 'error', '⛔ Dossier non autorisé. Ajoute/ouvre un projet d’abord.');
      this.eventBus.emit({ type: 'process-error', processId, error: 'Aucun projet autorisé' });
      return processId;
    }

    // S1 : comparaison par segments — startsWith acceptait /Users/x/pro-evil
    // comme étant « dans » /Users/x/pro
    const isAllowed = Array.from(this.allowedProjectPaths).some((p) => isPathWithin(normalizedCwd, p));
    if (!isAllowed) {
      this.emitOutput(processId, 'error', '⛔ Dossier non autorisé. Cette commande est limitée au dossier projet.');
      this.eventBus.emit({ type: 'process-error', processId, error: 'Répertoire non autorisé' });
      return processId;
    }

    // ─── SECURITY: Block env overrides that could hijack execution ───
    if (options.env) {
      const dangerousKeys = ['PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'NODE_OPTIONS'];
      for (const key of dangerousKeys) {
        delete options.env[key];
      }
    }

    const process: RunningProcess = {
      id: processId,
      command: parsed.cmdName,
      args: parsed.args,
      cwd: options.cwd,
      startedAt: startTime,
      status: 'running',
    };

    this.processes.set(processId, process);
    this.outputHistory.set(processId, []);

    // Emit start event
    if (!options.silent) {
      this.emitOutput(processId, 'system', `$ ${parsed.cmdName} ${parsed.args.join(' ')}`.trim());
    }
    this.eventBus.emit({ type: 'process-start', process });
    // Aperçu live : guette une URL localhost dans la sortie de CHAQUE process
    // (lancé depuis l'onglet Terminal OU par l'agent via run_command) et
    // l'émet aux listeners de preview (onDevServerUrl → onglet Aperçu).
    this.watchForUrl(processId);

    try {
      // Direct allowlisted command (no sh -c)
      const cmd = new Command(parsed.cmdName, parsed.args, {
        cwd: options.cwd,
        env: options.env,
      });

      // Collect stderr for auto-fix error detection
      const stderrLines: string[] = [];
      const stdoutLines: string[] = [];

      // Stream stdout
      cmd.stdout.on('data', (line: string) => {
        this.emitOutput(processId, 'stdout', line);
        stdoutLines.push(line);
        // Keep last 50 lines only
        if (stdoutLines.length > 50) stdoutLines.shift();
      });

      // Stream stderr
      cmd.stderr.on('data', (line: string) => {
        this.emitOutput(processId, 'stderr', line);
        stderrLines.push(line);
        // Keep last 80 lines only
        if (stderrLines.length > 80) stderrLines.shift();
      });

      // Spawn the process
      const child = await cmd.spawn();
      process.pid = child.pid;
      process.childProcess = child;

      // Attach completion handlers (do not await — keep UI responsive)
      cmd.on('close', (data: { code: number }) => {
        process.exitCode = data.code;
        process.status = data.code === 0 ? 'completed' : 'failed';

        const durationMs = Date.now() - startTime;
        if (!options.silent) {
          const statusEmoji = data.code === 0 ? '✓' : '✗';
          this.emitOutput(
            processId,
            data.code === 0 ? 'success' : 'error',
            `${statusEmoji} Terminé (code ${data.code}) en ${this.formatDuration(durationMs)}`
          );
        }

        this.eventBus.emit({ type: 'process-end', processId, exitCode: data.code });

        // ── Auto-fix: emit error event when process fails ──
        if (data.code !== 0 && stderrLines.length > 0) {
          // Combine stderr + last relevant stdout lines for context

        }
      });

      cmd.on('error', (error: string) => {
        process.exitCode = 1;
        process.status = 'failed';
        this.emitOutput(processId, 'error', error);
        this.eventBus.emit({ type: 'process-error', processId, error });
      });

      return processId;
    } catch (error: any) {
      process.status = 'failed';
      process.exitCode = 1;

      const errorMsg = error.message || String(error);
      this.emitOutput(processId, 'error', `Erreur d'exécution: ${errorMsg}`);
      this.eventBus.emit({
        type: 'process-error',
        processId,
        error: errorMsg,
      });

      return processId;
    }
  }

  /**
   * Internal exec — skips command validation. Used ONLY by internal git methods
   * that build safe commands programmatically. NEVER expose to user input.
   */
  private async _internalExec(
    command: string,
    options: { cwd?: string; timeout?: number; silent?: boolean } = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();
    try {
      const parsed = parseExecutable(command);
      if (!parsed) {
        return { success: false, exitCode: 1, stdout: '', stderr: 'Commande non autorisée', durationMs: 0 };
      }

      const cmd = new Command(parsed.cmdName, parsed.args, { cwd: options.cwd });
      let stdout = '';
      let stderr = '';

      cmd.stdout.on('data', (line: string) => { stdout += line + '\n'; });
      cmd.stderr.on('data', (line: string) => { stderr += line + '\n'; });

      const child = await cmd.spawn();

      let timeoutId: NodeJS.Timeout | undefined;
      if (options.timeout) {
        timeoutId = setTimeout(() => { child.kill(); }, options.timeout);
      }

      const result = await new Promise<{ code: number }>((resolve) => {
        cmd.on('close', (data: { code: number }) => resolve(data));
        cmd.on('error', () => resolve({ code: 1 }));
      });

      if (timeoutId) clearTimeout(timeoutId);

      return {
        success: result.code === 0,
        exitCode: result.code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return { success: false, exitCode: 1, stdout: '', stderr: error.message || String(error), durationMs: Date.now() - startTime };
    }
  }

  /**
   * Execute a command and wait for the full result (no streaming)
   */
  async exec(
    command: string,
    options: { cwd?: string; timeout?: number; silent?: boolean } = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();
    const missing = await programGate(command.trim().split(/\s+/)[0] || '');
    if (missing) return { success: false, exitCode: 1, stdout: '', stderr: missing, durationMs: 0 };

    // ─── SECURITY: Validate command ───
    const validation = validateCommand(command);
    if (!validation.safe) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: `⛔ ${validation.reason}`,
        durationMs: 0,
      };
    }

    try {
      const parsed = parseExecutable(command);
      if (!parsed) {
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: '⛔ Commande non autorisée (exécutable non allowlisté)',
          durationMs: 0,
        };
      }

      const cmd = new Command(parsed.cmdName, parsed.args, {
        cwd: options.cwd,
      });

      let stdout = '';
      let stderr = '';

      const execProcId = `exec-${++this.processCounter}-${Date.now()}`;
      cmd.stdout.on('data', (line: string) => {
        stdout += line + '\n';
        if (!options.silent) this.emitOutput(execProcId, 'stdout', line);
      });
      cmd.stderr.on('data', (line: string) => {
        stderr += line + '\n';
        if (!options.silent) this.emitOutput(execProcId, 'stderr', line);
      });

      const child = await cmd.spawn();

      // Timeout handling
      let timeoutId: NodeJS.Timeout | undefined;
      if (options.timeout) {
        timeoutId = setTimeout(() => {
          child.kill();
        }, options.timeout);
      }

      const result = await new Promise<{ code: number }>((resolve) => {
        cmd.on('close', (data: { code: number }) => resolve(data));
        cmd.on('error', () => resolve({ code: 1 }));
      });

      if (timeoutId) clearTimeout(timeoutId);

      return {
        success: result.code === 0,
        exitCode: result.code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: explainSpawnError(error, command),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Exécute un programme autorisé avec ses arguments tels quels (pas de découpage d'une
   * chaîne : un message de commit avec guillemets ou apostrophes passe intact).
   * La sortie n'est pas « trim » au début : les espaces de `git status --porcelain` comptent.
   */
  async execArgs(
    program: keyof typeof COMMAND_NAME_MAP | string,
    args: string[],
    options: { cwd?: string; timeout?: number } = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();
    // Appelé par l'app elle-même (panneau Git, tickets) : jamais de fenêtre d'installation ici
    const missing = await programGate(program, false);
    if (missing) return { success: false, exitCode: 1, stdout: '', stderr: missing, durationMs: 0 };
    const base = COMMAND_NAME_MAP[program.toLowerCase()];
    const fail = (stderr: string): CommandResult => ({ success: false, exitCode: 1, stdout: '', stderr, durationMs: Date.now() - startTime });
    if (!base) return fail('⛔ Commande non autorisée (exécutable non allowlisté)');
    if (args.length > MAX_ARGS) return fail(`⛔ Trop d'arguments (max ${MAX_ARGS})`);
    if (args.some((a) => /[\r\n]/.test(a) || a.length > 400)) return fail('⛔ Argument invalide (retour à la ligne ou plus de 400 caractères)');
    try {
      const cmd = new Command(`${base}-${args.length}`, args, { cwd: options.cwd });
      const out: string[] = [];
      const err: string[] = [];
      cmd.stdout.on('data', (line: string) => { out.push(line); });
      cmd.stderr.on('data', (line: string) => { err.push(line); });
      const child = await cmd.spawn();
      const timeoutId = options.timeout ? setTimeout(() => { void child.kill(); }, options.timeout) : undefined;
      const result = await new Promise<{ code: number }>((resolve) => {
        cmd.on('close', (data: { code: number }) => resolve(data));
        cmd.on('error', () => resolve({ code: 1 }));
      });
      if (timeoutId) clearTimeout(timeoutId);
      return {
        success: result.code === 0,
        exitCode: result.code,
        stdout: out.join('\n'),
        stderr: err.join('\n').trim(),
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return fail(error?.message || String(error));
    }
  }

  // ─── Dependency Installation ───

  // ─── Project Execution ───

  /**
   * Watch stdout for localhost URLs and auto-open the first one in the browser.
   */
  private watchForUrl(processId: string): void {
    let opened = false;
    const urlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/;

    const unsub = this.eventBus.on((event) => {
      if (opened) { unsub(); return; }
      if (event.type !== 'output' || event.processId !== processId) return;

      const match = urlPattern.exec(event.data.content);
      if (match) {
        opened = true;
        unsub();
        const url = match[0].replace('0.0.0.0', 'localhost');
        this.emitOutput(processId, 'success', `Serveur lancé: ${url}`);
        // Emit URL to preview listeners (VibeCodingStudio) instead of opening browser
        emitDevServerUrl(url);
      }
    });

    // Stop watching after 30s if no URL found
    setTimeout(() => { if (!opened) unsub(); }, 30_000);
  }

  // ─── Git Operations ───
  // Uses exec() for sequential git commands (no shell chaining needed)

  /** Check if the project has a git repo initialized */
  async gitIsRepo(projectPath: string): Promise<boolean> {
    const result = await this.exec('git rev-parse --is-inside-work-tree', { cwd: projectPath, silent: true });
    return result.success;
  }

  async gitInit(projectPath: string): Promise<CommandResult> {
    return this.exec('git init', { cwd: projectPath });
  }

  /** Stage all files and commit with the given message. Returns success. */
  async gitCommit(projectPath: string, message: string): Promise<{ success: boolean; error?: string }> {
    // Sanitize commit message
    const safeMessage = message
      .replace(/[`$\\!;"'|&<>(){}]/g, '')
      .slice(0, 200)
      .trim();
    if (!safeMessage) {
      return { success: false, error: 'Message de commit invalide' };
    }

    // Step 1: git add -A (uses _internalExec to bypass && block)
    const addResult = await this._internalExec('git add -A', { cwd: projectPath, silent: true });
    if (!addResult.success) {
      return { success: false, error: `git add échoué: ${addResult.stderr}` };
    }

    // Step 2: git commit -m "message"
    const commitResult = await this._internalExec(`git commit -m "${safeMessage}"`, { cwd: projectPath, silent: true });
    // "nothing to commit" is not an error in our context
    if (!commitResult.success && !commitResult.stdout.includes('nothing to commit')) {
      return { success: false, error: `git commit échoué: ${commitResult.stderr}` };
    }

    return { success: true };
  }

  // ─── Process Management ───

  /**
   * Kill a running process
   */
  async killProcess(processId: string): Promise<boolean> {
    const process = this.processes.get(processId);
    if (!process || process.status !== 'running') return false;

    try {
      if (process.childProcess) {
        await process.childProcess.kill();
      }
      process.status = 'killed';
      this.emitOutput(processId, 'system', '⊘ Processus arrêté');
      return true;
    } catch (error) {
      console.error('Failed to kill process:', error);
      return false;
    }
  }

  // ─── System Info ───

  // ─── Private Helpers ───

  private emitOutput(
    processId: string,
    type: ProcessOutput['type'],
    content: string
  ): void {
    const output: ProcessOutput = {
      id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      content,
      timestamp: Date.now(),
    };

    // Store in history
    if (!this.outputHistory.has(processId)) {
      this.outputHistory.set(processId, []);
    }
    this.outputHistory.get(processId)!.push(output);

    // Emit to listeners
    this.eventBus.emit({ type: 'output', processId, data: output });
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
}

// Singleton
export const terminalService = new TerminalService();
