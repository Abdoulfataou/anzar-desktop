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

// ============================================================================
// SECURITY — Command & Path Validation
// ============================================================================

/** Dangerous patterns that must NEVER be executed */
const BLOCKED_PATTERNS = [
  /sudo\s/i,
  /su\s+-/i,
  /rm\s+-rf\s+[/~]/i,            // rm -rf / or ~
  /rm\s+-rf\s+\.\./i,            // rm -rf ..
  />\s*\/dev\//i,                 // redirect to /dev/
  /\|\s*(bash|sh|zsh|fish)\b/i,  // pipe to shell
  /curl\s.*\|\s*(bash|sh)/i,     // curl | bash
  /wget\s.*\|\s*(bash|sh)/i,     // wget | bash
  /eval\s*\(/i,
  /\$\(.*\)/,                    // command substitution $(...)
  /`[^`]+`/,                     // backtick substitution
  /;\s*(sudo|su|chmod\s+777|rm\s+-rf)\b/i,  // chained dangerous commands
  /&&\s*(sudo|su|chmod\s+777|rm\s+-rf)\b/i,
  /\|\|\s*(sudo|su|chmod\s+777|rm\s+-rf)\b/i,
  />\s*\/etc\//i,                // write to /etc
  />\s*~\/\./i,                  // write to dotfiles
  /export\s+(PATH|LD_PRELOAD|LD_LIBRARY_PATH)\s*=/i,  // env hijack
  /curl\s+.*(-o|--output)\s/i,   // download files
  /wget\s/i,                      // download files
  /nc\s+-/i,                      // netcat
  /python3?\s+-c\s/i,             // inline python execution
  /node\s+-e\s/i,                 // inline node execution
];

/** Validate a command is safe before execution */
function validateCommand(command: string): { safe: boolean; reason?: string } {
  // Block empty commands
  if (!command.trim()) {
    return { safe: false, reason: 'Commande vide' };
  }

  // Block overly long commands (potential injection)
  if (command.length > 2000) {
    return { safe: false, reason: 'Commande trop longue (max 2000 caractères)' };
  }

  // Check against blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Commande bloquée pour raison de sécurité: ${pattern.source}` };
    }
  }

  return { safe: true };
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

  /** Get shell command name for current OS */
  private get shellName(): string {
    return this.isWindows ? 'cmd' : 'sh';
  }

  /** Get shell args prefix for current OS */
  private get shellArgPrefix(): string {
    return this.isWindows ? '/C' : '-c';
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
    } = {}
  ): Promise<string> {
    const processId = `proc-${++this.processCounter}-${Date.now()}`;
    const startTime = Date.now();

    // ─── SECURITY: Validate command before execution ───
    const validation = validateCommand(command);
    if (!validation.safe) {
      this.emitOutput(processId, 'error', `⛔ ${validation.reason}`);
      this.eventBus.emit({ type: 'process-error', processId, error: validation.reason || 'Commande bloquée' });
      return processId;
    }

    // ─── SECURITY: Validate cwd is within allowed project paths ───
    if (options.cwd) {
      const normalizedCwd = options.cwd.replace(/\\/g, '/').replace(/\/+$/, '');
      const isAllowed = this.allowedProjectPaths.size === 0 ||
        Array.from(this.allowedProjectPaths).some((p) => normalizedCwd.startsWith(p));

      if (!isAllowed) {
        this.emitOutput(processId, 'error', '⛔ Dossier non autorisé. Ouvre un projet d\'abord.');
        this.eventBus.emit({ type: 'process-error', processId, error: 'Répertoire non autorisé' });
        return processId;
      }
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
      command: this.shellName,
      args: [this.shellArgPrefix, command],
      cwd: options.cwd,
      startedAt: startTime,
      status: 'running',
    };

    this.processes.set(processId, process);
    this.outputHistory.set(processId, []);

    // Emit start event
    if (!options.silent) {
      this.emitOutput(processId, 'system', `$ ${command}`);
    }
    this.eventBus.emit({ type: 'process-start', process });

    try {
      const { Command } = await import('@tauri-apps/api/shell');

      // Create the sidecar command via Tauri Shell
      const cmd = new Command(this.shellName, [this.shellArgPrefix, command], {
        cwd: options.cwd,
        env: options.env,
      });

      // Stream stdout
      cmd.stdout.on('data', (line: string) => {
        this.emitOutput(processId, 'stdout', line);
      });

      // Stream stderr
      cmd.stderr.on('data', (line: string) => {
        this.emitOutput(processId, 'stderr', line);
      });

      // Spawn the process
      const child = await cmd.spawn();
      process.pid = child.pid;
      process.childProcess = child;

      // Wait for completion
      const result = await new Promise<{ code: number }>((resolve) => {
        cmd.on('close', (data: { code: number }) => {
          resolve(data);
        });
        cmd.on('error', (error: string) => {
          this.emitOutput(processId, 'error', error);
          resolve({ code: 1 });
        });
      });

      // Update process
      process.exitCode = result.code;
      process.status = result.code === 0 ? 'completed' : 'failed';

      const durationMs = Date.now() - startTime;
      if (!options.silent) {
        const statusEmoji = result.code === 0 ? '✓' : '✗';
        this.emitOutput(
          processId,
          result.code === 0 ? 'success' : 'error',
          `${statusEmoji} Terminé (code ${result.code}) en ${this.formatDuration(durationMs)}`
        );
      }

      this.eventBus.emit({
        type: 'process-end',
        processId,
        exitCode: result.code,
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
   * Execute a command and wait for the full result (no streaming)
   */
  async exec(
    command: string,
    options: { cwd?: string; timeout?: number } = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();

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
      const { Command } = await import('@tauri-apps/api/shell');

      const cmd = new Command(this.shellName, [this.shellArgPrefix, command], {
        cwd: options.cwd,
      });

      let stdout = '';
      let stderr = '';

      cmd.stdout.on('data', (line: string) => { stdout += line + '\n'; });
      cmd.stderr.on('data', (line: string) => { stderr += line + '\n'; });

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
        stderr: error.message || String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ─── Dependency Installation ───

  /**
   * Detect the project type and install dependencies
   */
  async installDependencies(
    projectPath: string,
    options: { force?: boolean } = {}
  ): Promise<string> {
    // Detect project type by checking for lockfiles/configs
    const { exists } = await import('@tauri-apps/api/fs');

    const checks = [
      { file: 'package.json', type: 'npm' as const },
      { file: 'requirements.txt', type: 'pip' as const },
      { file: 'Cargo.toml', type: 'cargo' as const },
      { file: 'pyproject.toml', type: 'pip' as const },
      { file: 'pnpm-lock.yaml', type: 'pnpm' as const },
      { file: 'yarn.lock', type: 'yarn' as const },
    ];

    let detectedType: string | null = null;
    for (const check of checks) {
      try {
        const fileExists = await exists(`${projectPath}/${check.file}`);
        if (fileExists) {
          detectedType = check.type;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!detectedType) {
      const processId = `proc-${++this.processCounter}-${Date.now()}`;
      this.emitOutput(processId, 'error', 'Aucun fichier de dépendances trouvé (package.json, requirements.txt, Cargo.toml)');
      return processId;
    }

    const commands: Record<string, string> = {
      npm: options.force ? 'npm install --force' : 'npm install',
      pnpm: options.force ? 'pnpm install --force' : 'pnpm install',
      yarn: 'yarn install',
      pip: 'pip3 install -r requirements.txt',
      cargo: 'cargo build',
    };

    const cmd = commands[detectedType];
    this.emitOutput('system', 'system', `Détection: projet ${detectedType.toUpperCase()} — lancement de "${cmd}"`);
    return this.runCommand(cmd, { cwd: projectPath });
  }

  /**
   * Install a specific package
   */
  async installPackage(
    packageName: string,
    type: 'npm' | 'pip' | 'cargo' = 'npm',
    options: { cwd?: string; dev?: boolean } = {}
  ): Promise<string> {
    const commands: Record<string, string> = {
      npm: `npm install ${options.dev ? '--save-dev ' : ''}${packageName}`,
      pip: `pip3 install ${packageName}`,
      cargo: `cargo add ${packageName}`,
    };

    return this.runCommand(commands[type], { cwd: options.cwd });
  }

  /**
   * Uninstall a specific package
   */
  async uninstallPackage(
    packageName: string,
    type: 'npm' | 'pip' | 'cargo' = 'npm',
    options: { cwd?: string } = {}
  ): Promise<string> {
    const commands: Record<string, string> = {
      npm: `npm uninstall ${packageName}`,
      pip: `pip3 uninstall -y ${packageName}`,
      cargo: `cargo remove ${packageName}`,
    };

    return this.runCommand(commands[type], { cwd: options.cwd });
  }

  // ─── Project Execution ───

  /**
   * Run a project's dev server
   */
  async runDevServer(
    projectPath: string,
    customCommand?: string
  ): Promise<string> {
    // Auto-detect run command
    if (customCommand) {
      return this.runCommand(customCommand, { cwd: projectPath });
    }

    const { exists } = await import('@tauri-apps/api/fs');

    // Check for common dev scripts
    try {
      const hasPackageJson = await exists(`${projectPath}/package.json`);
      if (hasPackageJson) {
        const { readTextFile } = await import('@tauri-apps/api/fs');
        const pkg = JSON.parse(await readTextFile(`${projectPath}/package.json`));
        if (pkg.scripts?.dev) return this.runCommand('npm run dev', { cwd: projectPath });
        if (pkg.scripts?.start) return this.runCommand('npm start', { cwd: projectPath });
        if (pkg.scripts?.serve) return this.runCommand('npm run serve', { cwd: projectPath });
      }
    } catch { /* ignore */ }

    try {
      const hasCargo = await exists(`${projectPath}/Cargo.toml`);
      if (hasCargo) return this.runCommand('cargo run', { cwd: projectPath });
    } catch { /* ignore */ }

    try {
      const hasManagePy = await exists(`${projectPath}/manage.py`);
      if (hasManagePy) return this.runCommand('python3 manage.py runserver', { cwd: projectPath });
    } catch { /* ignore */ }

    try {
      const hasMainPy = await exists(`${projectPath}/main.py`);
      if (hasMainPy) return this.runCommand('python3 main.py', { cwd: projectPath });
    } catch { /* ignore */ }

    const processId = `proc-${++this.processCounter}-${Date.now()}`;
    this.emitOutput(processId, 'error', 'Impossible de détecter la commande de démarrage. Utilise une commande personnalisée.');
    return processId;
  }

  /**
   * Run project build
   */
  async buildProject(projectPath: string): Promise<string> {
    const { exists } = await import('@tauri-apps/api/fs');

    try {
      const hasPackageJson = await exists(`${projectPath}/package.json`);
      if (hasPackageJson) {
        const { readTextFile } = await import('@tauri-apps/api/fs');
        const pkg = JSON.parse(await readTextFile(`${projectPath}/package.json`));
        if (pkg.scripts?.build) return this.runCommand('npm run build', { cwd: projectPath });
      }
    } catch { /* ignore */ }

    try {
      const hasCargo = await exists(`${projectPath}/Cargo.toml`);
      if (hasCargo) return this.runCommand('cargo build --release', { cwd: projectPath });
    } catch { /* ignore */ }

    const processId = `proc-${++this.processCounter}-${Date.now()}`;
    this.emitOutput(processId, 'error', 'Aucun script de build trouvé.');
    return processId;
  }

  /**
   * Run linting
   */
  async lintProject(projectPath: string): Promise<string> {
    const { exists, readTextFile } = await import('@tauri-apps/api/fs');

    try {
      const hasPackageJson = await exists(`${projectPath}/package.json`);
      if (hasPackageJson) {
        const pkg = JSON.parse(await readTextFile(`${projectPath}/package.json`));
        if (pkg.scripts?.lint) return this.runCommand('npm run lint', { cwd: projectPath });
      }
    } catch { /* ignore */ }

    return this.runCommand('echo "Aucun script de lint trouvé"', { cwd: projectPath });
  }

  // ─── Git Operations ───

  async gitStatus(projectPath: string): Promise<string> {
    return this.runCommand('git status --short', { cwd: projectPath });
  }

  async gitCommit(projectPath: string, message: string): Promise<string> {
    // Sanitize commit message: remove shell metacharacters
    const safeMessage = message
      .replace(/[`$\\!;"'|&<>(){}]/g, '')
      .slice(0, 200)
      .trim();
    if (!safeMessage) {
      const processId = `proc-${++this.processCounter}-${Date.now()}`;
      this.emitOutput(processId, 'error', '⛔ Message de commit invalide');
      return processId;
    }
    return this.runCommand(`git add -A && git commit -m "${safeMessage}"`, { cwd: projectPath });
  }

  async gitPush(projectPath: string): Promise<string> {
    return this.runCommand('git push', { cwd: projectPath });
  }

  async gitPull(projectPath: string): Promise<string> {
    return this.runCommand('git pull', { cwd: projectPath });
  }

  async gitInit(projectPath: string): Promise<string> {
    return this.runCommand('git init', { cwd: projectPath });
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

  /**
   * Kill all running processes
   */
  async killAll(): Promise<void> {
    for (const [id, process] of this.processes) {
      if (process.status === 'running') {
        await this.killProcess(id);
      }
    }
  }

  /**
   * Get all running processes
   */
  getRunningProcesses(): RunningProcess[] {
    return Array.from(this.processes.values()).filter(
      (p) => p.status === 'running'
    );
  }

  /**
   * Get process by ID
   */
  getProcess(processId: string): RunningProcess | undefined {
    return this.processes.get(processId);
  }

  /**
   * Get output history for a process
   */
  getOutputHistory(processId: string): ProcessOutput[] {
    return this.outputHistory.get(processId) || [];
  }

  /**
   * Get all output across all processes (terminal log)
   */
  getAllOutput(): ProcessOutput[] {
    const all: ProcessOutput[] = [];
    for (const outputs of this.outputHistory.values()) {
      all.push(...outputs);
    }
    return all.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Clear output history
   */
  clearOutput(processId?: string): void {
    if (processId) {
      this.outputHistory.delete(processId);
    } else {
      this.outputHistory.clear();
    }
  }

  // ─── System Info ───

  /**
   * Check if a command is available on the system
   */
  async isCommandAvailable(command: string): Promise<boolean> {
    const checkCmd = this.isWindows ? `where ${command}` : `which ${command}`;
    const result = await this.exec(checkCmd, { timeout: 5000 });
    return result.success;
  }

  /**
   * Get Node.js version
   */
  async getNodeVersion(): Promise<string | null> {
    const result = await this.exec('node --version', { timeout: 5000 });
    return result.success ? result.stdout.trim() : null;
  }

  /**
   * Get npm version
   */
  async getNpmVersion(): Promise<string | null> {
    const result = await this.exec('npm --version', { timeout: 5000 });
    return result.success ? result.stdout.trim() : null;
  }

  /**
   * Get Python version
   */
  async getPythonVersion(): Promise<string | null> {
    const result = await this.exec('python3 --version', { timeout: 5000 });
    return result.success ? result.stdout.trim() : null;
  }

  /**
   * Get git version
   */
  async getGitVersion(): Promise<string | null> {
    const result = await this.exec('git --version', { timeout: 5000 });
    return result.success ? result.stdout.trim() : null;
  }

  /**
   * Get system environment info for diagnostics
   */
  async getEnvironmentInfo(): Promise<Record<string, string | null>> {
    const [node, npm, python, git] = await Promise.all([
      this.getNodeVersion(),
      this.getNpmVersion(),
      this.getPythonVersion(),
      this.getGitVersion(),
    ]);
    return { node, npm, python, git, platform: this.platform };
  }

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
