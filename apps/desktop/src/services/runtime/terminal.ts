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

import { exists, readTextFile } from '@/lib/tauri/fs'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { parseExecutable } from '@/services/agent/policy/commandPolicy';
import { isPathWithin } from '@/lib/pathGuard';
import { ensureNode, manualNodeHelp, needsNode } from '@/services/runtime/nodeRuntime';
import { checkPython, ensureGit, isPython } from '@/services/runtime/programs';

/** Isolation des commandes (macOS) : activée sauf si coupée dans les Paramètres. */
export const sandboxEnabled = (): boolean => useSettingsStore.getState().settings.sandboxCommands !== false;

/** Marqueur ajouté à la sortie quand l'isolation a coupé une connexion. */
/** Sortie d'une commande arrêtée par le bouton Stop. */
export const STOPPED_MESSAGE = '[ANZAR] Commande arrêtée par l’utilisateur.';

const SANDBOX_DENIED = /operation not permitted|EPERM|sandbox.*deny|deny.*file-write/i;

/** Indication d'escalade ajoutée après un refus d'isolation (une seule relance, approuvée). */
export const ESCALATION_HINT =
  "[sandbox: escalation available — retry this exact command once with sandbox_permissions (\"danger-full-access\") + justification; the approval prompt asks the user]";

/** Ajoute le marqueur de refus de l'isolation, comme Harness, sans règle propre à ANZAR. */
export function isSandboxDenial(stderr: string): boolean {
  return SANDBOX_DENIED.test(stderr);
}

export function withSandboxHint(code: number, stderr: string): string {
  if (code === 0 || !sandboxEnabled()) return stderr;
  if (!SANDBOX_DENIED.test(stderr)) return stderr;
  return `${stderr}\n[sandbox: file access denied under workspace-write mode]\n${ESCALATION_HINT}`;
}

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
  childProcess?: never; // plus de Child webview : le processus vit dans Rust
}

export interface CommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /**
   * La commande a-t-elle réellement été lancée ? `false` = refus de politique, outil
   * introuvable, dossier invalide, lancement impossible. Un code de sortie non nul avec
   * `ran: true` signifie que la commande a tourné et a échoué : ce n'est pas une panne
   * de l'outil, et l'agent doit lire sa sortie au lieu de réessayer à l'aveugle.
   */
  ran?: boolean;
  /** L'isolation a bloqué une écriture, une lecture ou une connexion : l'action a échoué. */
  denied?: boolean;
  /** La commande a été arrêtée parce qu'elle a dépassé son délai. */
  timedOut?: boolean;
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
  private toolEventsReady: Promise<void> | null = null;
  private toolUnlisten: UnlistenFn[] = [];

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
      const { platform } = await import('@/lib/tauri/os');
      const os = platform();
      this.platform = os === 'windows' ? 'win32' : os === 'linux' ? 'linux' : 'darwin';
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

  /** Branche les événements du runner Rust une seule fois. */
  private ensureToolEvents(): Promise<void> {
    if (this.toolEventsReady) return this.toolEventsReady;
    this.toolEventsReady = (async () => {
      if (!isTauri()) return;
      this.toolUnlisten.push(await listen<{ id: string; stream: string; line: string }>('tool://output', (e) => {
        const p = this.processes.get(e.payload.id);
        if (!p) return;
        this.emitOutput(p.id, e.payload.stream === 'stderr' ? 'stderr' : 'stdout', e.payload.line);
      }));
      this.toolUnlisten.push(await listen<{ id: string; code: number }>('tool://exit', (e) => {
        const p = this.processes.get(e.payload.id);
        if (!p || p.status !== 'running') return;
        p.exitCode = e.payload.code;
        p.status = e.payload.code === 0 ? 'completed' : 'failed';
        this.eventBus.emit({ type: 'process-end', processId: p.id, exitCode: e.payload.code });
        this.emitOutput(p.id, e.payload.code === 0 ? 'success' : 'error',
          `${e.payload.code === 0 ? '✓' : '✗'} Terminé (code ${e.payload.code})`);
      }));
    })().catch(() => { /* hors Tauri : les methodes appelantes echouent proprement */ });
    return this.toolEventsReady;
  }

  private rootFor(cwd: string): string {
    const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
    const root = Array.from(this.allowedProjectPaths).find((p) => isPathWithin(normalized, p));
    if (!root) throw new Error('Dossier non autorisé. Ouvre un projet avant de lancer une commande.');
    return root;
  }

  private async runTool(
    id: string,
    program: string,
    args: string[],
    cwd: string,
    timeout?: number,
    signal?: AbortSignal,
    shellCommand?: string,
    escalated = false,
    escalationReason?: string,
  ): Promise<{ code: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean }> {
    const start = Date.now();
    if (signal?.aborted) return { code: 130, stdout: '', stderr: STOPPED_MESSAGE, durationMs: 0, timedOut: false };
    await this.ensureToolEvents();
    await invoke('tool_spawn', {
      id, program, args, cwd, root: this.rootFor(cwd), sandbox: sandboxEnabled(),
      shell: shellCommand !== undefined, shellCommand: shellCommand ?? null,
      escalated, escalationReason: escalationReason ?? null,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    if (timeout) {
      timer = setTimeout(() => {
        timedOut = true;
        void invoke('tool_kill', { id }).catch(() => {});
      }, timeout);
    }
    // Bouton Stop : la commande (et tout ce qu'elle a lancé) est arrêtée tout de suite,
    // sinon la tâche attendait sa fin, jusqu'à 2 minutes.
    const onAbort = () => { void invoke('tool_kill', { id }).catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await invoke<{ code: number; stdout: string; stderr: string }>('tool_wait', { id });
      if (signal?.aborted) {
        return { ...result, code: 130, stderr: `${result.stderr}\n${STOPPED_MESSAGE}`.trim(), durationMs: Date.now() - start, timedOut };
      }
      return { ...result, stderr: withSandboxHint(result.code, result.stderr), durationMs: Date.now() - start, timedOut };
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
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

    const missing = await programGate(command.trim().split(/\s+/)[0] || '');
    if (missing) {
      this.emitOutput(processId, 'error', missing);
      this.eventBus.emit({ type: 'process-error', processId, error: missing });
      return processId;
    }

    const parsed = parseExecutable(command);
    if (!parsed) {
      const msg = 'Commande non autorisée (programme interdit ou nom invalide).';
      this.emitOutput(processId, 'error', `⛔ ${msg}`);
      this.eventBus.emit({ type: 'process-error', processId, error: msg });
      return processId;
    }

    if (!options.cwd) {
      this.emitOutput(processId, 'error', '⛔ Commande bloquée: sélectionne un projet (dossier) d’abord.');
      this.eventBus.emit({ type: 'process-error', processId, error: 'cwd manquant' });
      return processId;
    }

    const normalizedCwd = options.cwd.replace(/\\/g, '/').replace(/\/+$/, '');
    if (this.allowedProjectPaths.size === 0
      || !Array.from(this.allowedProjectPaths).some((p) => isPathWithin(normalizedCwd, p))) {
      this.emitOutput(processId, 'error', '⛔ Dossier non autorisé. Cette commande est limitée au dossier projet.');
      this.eventBus.emit({ type: 'process-error', processId, error: 'Répertoire non autorisé' });
      return processId;
    }

    const displayName = parsed.cmdName.replace(/-\d+$/, '');
    const process: RunningProcess = {
      id: processId,
      command: displayName,
      args: parsed.args,
      cwd: options.cwd,
      startedAt: startTime,
      status: 'running',
    };
    this.processes.set(processId, process);
    this.outputHistory.set(processId, []);
    if (!options.silent) {
      this.emitOutput(processId, 'system', `$ ${displayName} ${parsed.args.join(' ')}`.trim());
    }
    this.eventBus.emit({ type: 'process-start', process });
    this.watchForUrl(processId);

    try {
      await this.ensureToolEvents();
      const pid = await invoke<number>('tool_spawn', {
        id: processId,
        program: displayName,
        args: parsed.args,
        cwd: options.cwd,
        root: this.rootFor(options.cwd),
        sandbox: sandboxEnabled(),
        shell: false, shellCommand: null, escalated: false, escalationReason: null,
      });
      process.pid = pid;
      return processId;
    } catch (error: any) {
      process.status = 'failed';
      process.exitCode = 1;
      const errorMsg = explainSpawnError(error, command);
      this.emitOutput(processId, 'error', `Erreur d'exécution: ${errorMsg}`);
      this.eventBus.emit({ type: 'process-error', processId, error: errorMsg });
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
    const parsed = parseExecutable(command);
    if (!parsed) {
      return { success: false, exitCode: 1, stdout: '', stderr: 'Commande non autorisée', durationMs: 0 };
    }
    if (!options.cwd) {
      return { success: false, exitCode: 1, stdout: '', stderr: 'Dossier de travail manquant', durationMs: 0, ran: false };
    }
    const id = `exec-${++this.processCounter}-${Date.now()}`;
    const base = parsed.cmdName.replace(/-\d+$/, '');
    try {
      const r = await this.runTool(id, base, parsed.args, options.cwd, options.timeout);
      return {
        success: r.code === 0,
        exitCode: r.code,
        stdout: r.stdout.trim(),
        stderr: r.stderr.trim(),
        durationMs: r.durationMs,
        ran: true,
        timedOut: r.timedOut || undefined,
      };
    } catch (error: any) {
      return { success: false, exitCode: 1, stdout: '', stderr: error?.message || String(error), durationMs: 0, ran: false };
    }
  }

  /**
   * Execute a command and wait for the full result (no streaming)
   */
  async exec(
    command: string,
    options: { cwd?: string; timeout?: number; silent?: boolean; signal?: AbortSignal; escalated?: boolean; escalationReason?: string } = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();
    const missing = await programGate(command.trim().split(/\s+/)[0] || '');
    if (missing) return { success: false, exitCode: 1, stdout: '', stderr: missing, durationMs: 0, ran: false };

    const parsed = parseExecutable(command);
    if (!parsed) {
      return { success: false, exitCode: 1, stdout: '', stderr: '⛔ Commande non autorisée (exécutable non allowlisté)', durationMs: 0, ran: false };
    }
    if (!options.cwd) {
      return { success: false, exitCode: 1, stdout: '', stderr: '⛔ Dossier de travail manquant', durationMs: 0, ran: false };
    }
    const id = `exec-${++this.processCounter}-${Date.now()}`;
    const base = parsed.cmdName.replace(/-\d+$/, '');
    try {
      const r = await this.runTool(id, base, parsed.args, options.cwd, options.timeout, options.signal, undefined, options.escalated === true, options.escalationReason);
      const stderr = r.stderr.trim();
      return {
        success: r.code === 0,
        exitCode: r.code,
        stdout: r.stdout.trim(),
        stderr,
        durationMs: Date.now() - startTime,
        ran: true,
        denied: isSandboxDenial(stderr) || undefined,
        timedOut: r.timedOut || undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: explainSpawnError(error, command),
        durationMs: Date.now() - startTime,
        ran: false,
      };
    }
  }

  /**
   * Exécute une ligne de shell confinée (macOS). La frontière est l'isolation Seatbelt,
   * pas une liste blanche : pipes, redirections, `&&` et `cd` fonctionnent. Refusé par
   * Rust si l'isolation n'est pas disponible sur la machine.
   */
  async execShell(
    command: string,
    options: { cwd?: string; timeout?: number; signal?: AbortSignal; escalated?: boolean; escalationReason?: string } = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();
    const trimmed = String(command || '').trim();
    if (!trimmed) {
      return { success: false, exitCode: 1, stdout: '', stderr: '⛔ Commande vide', durationMs: 0, ran: false };
    }
    if (!options.cwd) {
      return { success: false, exitCode: 1, stdout: '', stderr: '⛔ Dossier de travail manquant', durationMs: 0, ran: false };
    }
    const id = `shell-${++this.processCounter}-${Date.now()}`;
    try {
      const r = await this.runTool(id, 'bash', [], options.cwd, options.timeout, options.signal, trimmed, options.escalated === true, options.escalationReason);
      const stderr = r.stderr.trim();
      return {
        success: r.code === 0,
        exitCode: r.code,
        stdout: r.stdout.trim(),
        stderr,
        durationMs: Date.now() - startTime,
        ran: true,
        denied: isSandboxDenial(stderr) || undefined,
        timedOut: r.timedOut || undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: explainSpawnError(error, trimmed),
        durationMs: Date.now() - startTime,
        ran: false,
      };
    }
  }

  /**
   * Lance une ligne de shell en arrière-plan et rend son identifiant tout de suite.
   * La sortie est lue par `jobOutput` / attendue par `waitForJob` ; `killProcess` l'arrête.
   */
  async runShell(
    command: string,
    options: { cwd?: string; silent?: boolean; onProcessId?: (id: string) => void; escalated?: boolean; escalationReason?: string } = {}
  ): Promise<string> {
    const processId = `job-${++this.processCounter}-${Date.now()}`;
    options.onProcessId?.(processId);
    const trimmed = String(command || '').trim();
    if (!trimmed || !options.cwd) {
      this.emitOutput(processId, 'error', '⛔ Commande ou dossier manquant');
      return processId;
    }
    const process: RunningProcess = {
      id: processId,
      command: 'bash',
      args: [trimmed],
      cwd: options.cwd,
      startedAt: Date.now(),
      status: 'running',
    };
    this.processes.set(processId, process);
    this.outputHistory.set(processId, []);
    if (!options.silent) this.emitOutput(processId, 'system', `$ ${trimmed}`);
    this.eventBus.emit({ type: 'process-start', process });
    try {
      await this.ensureToolEvents();
      const pid = await invoke<number>('tool_spawn', {
        id: processId,
        program: 'bash',
        args: [],
        cwd: options.cwd,
        root: this.rootFor(options.cwd),
        sandbox: sandboxEnabled(),
        shell: true,
        shellCommand: trimmed,
        escalated: options.escalated === true,
        escalationReason: options.escalationReason ?? null,
      });
      process.pid = pid;
    } catch (error: any) {
      process.status = 'failed';
      process.exitCode = 1;
      this.emitOutput(processId, 'error', explainSpawnError(error, trimmed));
    }
    return processId;
  }

  /** État et sortie cumulée d'un travail lancé par `runShell`. */
  getJob(id: string): { status: RunningProcess['status']; exitCode?: number; output: string; command: string } | null {
    const process = this.processes.get(id);
    if (!process) return null;
    const output = (this.outputHistory.get(id) || [])
      .filter((o) => o.type === 'stdout' || o.type === 'stderr')
      .map((o) => o.content)
      .join('\n');
    return { status: process.status, exitCode: process.exitCode, output, command: process.args.join(' ') };
  }

  /**
   * Attend la fin d'un travail, ou le délai demandé. Ne bloque jamais indéfiniment :
   * au-delà du délai, rend l'état courant et la sortie déjà produite.
   */
  async waitForJob(id: string, timeoutMs: number, signal?: AbortSignal): Promise<ReturnType<TerminalService['getJob']>> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    for (;;) {
      const job = this.getJob(id);
      if (!job || job.status !== 'running' || Date.now() >= deadline || signal?.aborted) return job;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 150);
        signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
  }

  /** Exécute un programme autorisé avec ses arguments tels quels (pas de découpage d'une
   * chaîne : un message de commit avec guillemets ou apostrophes passe intact).
   * La sortie n'est pas « trim » au début : les espaces de `git status --porcelain` comptent.
   */
  async execArgs(
    program: string,
    args: string[],
    options: { cwd?: string; timeout?: number; signal?: AbortSignal } = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();
    const missing = await programGate(program, false);
    if (missing) return { success: false, exitCode: 1, stdout: '', stderr: missing, durationMs: 0 };
    const base = program;
    const fail = (stderr: string): CommandResult => ({ success: false, exitCode: 1, stdout: '', stderr, durationMs: Date.now() - startTime });
    if (args.some((a) => /[\r\n]/.test(a))) return fail('⛔ Argument invalide (retour à la ligne)');
    if (!options.cwd) return fail('⛔ Dossier de travail manquant');
    const id = `exec-${++this.processCounter}-${Date.now()}`;
    try {
      const r = await this.runTool(id, base, args, options.cwd, options.timeout, options.signal);
      return {
        success: r.code === 0,
        exitCode: r.code,
        stdout: r.stdout.replace(/\n$/, ''),
        stderr: r.stderr.trim(),
        durationMs: Date.now() - startTime,
        timedOut: r.timedOut || undefined,
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
      await invoke('tool_kill', { id: processId });
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
