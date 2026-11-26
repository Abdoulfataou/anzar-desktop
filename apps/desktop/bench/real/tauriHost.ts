/**
 * Shim Tauri pour le banc réel — remplace le backend Rust de l'app quand on exécute le
 * vrai `AgentRunner` hors interface (vitest, dossier `bench/real`).
 *
 * Ce que le shim garantit :
 * - les commandes de l'agent partent dans **le même sandbox-exec Seatbelt** que l'app
 *   (profil de `seatbelt.ts`, fidèle au commit mesuré) ;
 * - l'environnement des commandes est reconstruit comme Rust le fait (`env_clear` +
 *   variables conservées + PATH enrichi) — le jeton du banc n'y figure donc jamais ;
 * - la politique de commandes du commit mesuré est appliquée : gate d'installation et
 *   refus git/npm/python pour `avant` (e058e56), shell confiné pour `apres` ;
 * - les fichiers (plugin-fs), les événements (tool://output, tool://exit) et les
 *   commandes utilitaires (programs_status, node_status…) répondent comme Rust.
 *
 * Limite documentée : le relais réseau local de `avant` (netproxy) n'est pas répliqué ;
 * aucune des tâches du banc ne dépend de son filtrage d'hôtes (les installations sont
 * refusées avant tout accès réseau côté `avant`, par le gate d'accord).
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync,
  readFileSync, realpathSync, renameSync, rmSync, statSync, truncateSync, writeFileSync,
} from 'node:fs';
import { version as osVersion } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gitInitAllowed, sandboxAvailable, wrap, type BenchVariant } from './seatbelt';

export interface TauriShimOptions {
  variant: BenchVariant;
  /** Dossier de données du banc (équivalent appDataDir) : sessions, baselines, skills… */
  appDataDir: string;
  /** Dossiers « ouverts comme projet » (équivalent de la liste Rust des roots). */
  allowedRoots?: string[];
  /** Chemin de commands.json (politique de programmes de la variante `avant`). */
  commandsJsonPath?: string;
}

interface Proc {
  pid: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Fin des flux : readline peut livrer des lignes après la mort du processus. */
  done: Promise<void[]>;
  kill: () => void;
}

const HOME = realpathSync(process.env.HOME || '/var/empty');

/** PATH enrichi, recopié de `src-tauri/src/mcp.rs::enriched_path`. */
export function enrichedPath(): string {
  const parts = (process.env.PATH || '').split(':').filter(Boolean);
  const extras = [
    '.local/bin', '.cargo/bin', '.volta/bin', '.bun/bin', '.deno/bin', '.npm-global/bin',
    '.asdf/shims', '.pyenv/shims', 'Library/pnpm', 'flutter/bin', 'development/flutter/bin',
    'fvm/default/bin', '.pub-cache/bin', 'go/bin', '.dotnet/tools', '.composer/vendor/bin',
    '.rbenv/shims', 'Library/Android/sdk/platform-tools',
  ].map((p) => join(HOME, p));
  // nvm : version de Node la plus récente installée
  try {
    const versions = readdirSync(join(HOME, '.nvm/versions/node')).sort();
    if (versions.length > 0) extras.push(join(HOME, '.nvm/versions/node', versions[versions.length - 1], 'bin'));
  } catch { /* nvm absent */ }
  extras.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/local/go/bin', '/usr/local/share/dotnet', '/usr/bin', '/bin');
  return [...parts, ...extras].join(':');
}

/** Variables conservées par `env_clear` de Rust (apply_base_env). */
const BASE_ENV_KEYS = [
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'TZ',
  'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'FLUTTER_ROOT', 'PUB_CACHE', 'CHROME_EXECUTABLE',
  'GOPATH', 'GOROOT', 'DOTNET_ROOT', 'GEM_HOME', 'GEM_PATH', 'DEVELOPER_DIR',
  'CARGO_HOME', 'RUSTUP_HOME', 'PNPM_HOME', 'BUN_INSTALL', 'DENO_DIR', 'COMPOSER_HOME',
  'GRADLE_USER_HOME', 'PYENV_ROOT',
];

// ── Politique de programmes de la variante `avant` (commands.json, source unique TS/Rust) ──

interface AvantProgramRule {
  name: string; installs: string[]; network: string[];
  deny: { args: string; reason: string }[]; launches: string[];
}

function loadCommandsPolicy(path?: string): {
  programs: AvantProgramRule[]; deniedPrograms: string[]; limits: { maxArgs: number; maxArgChars: number };
} | null {
  if (!path || !existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return {
      programs: (raw.programs || []).map((p: any) => ({
        name: p.name, installs: p.installs || [], network: p.network || [],
        deny: p.deny || [], launches: p.launches || [],
      })),
      deniedPrograms: raw.deniedPrograms?.names || [],
      limits: { maxArgs: raw.limits?.maxArgs ?? 64, maxArgChars: raw.limits?.maxArgChars ?? 4096 },
    };
  } catch { return null; }
}

const matchesRule = (pos: string[], rule: string): boolean => {
  if (rule === '<none>') return pos.length === 0;
  const words = rule.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
  if (words.length === 0) return true; // "" = toute invocation
  return words.every((w, i) => pos[i] === w);
};
const positional = (args: string[]): string[] =>
  args.filter((a) => !a.startsWith('-')).map((a) => a.toLowerCase());

function isDeniedProgram(name: string, policy: ReturnType<typeof loadCommandsPolicy>): boolean {
  const base = name.trim().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  return !!policy?.deniedPrograms.includes(base);
}

const isValidProgramName = (name: string): boolean =>
  name.length >= 1 && name.length <= 64 && /[a-zA-Z0-9]/.test(name[0])
  && /^[a-zA-Z0-9._+-]+$/.test(name);

function findInPath(program: string): string | null {
  for (const dir of enrichedPath().split(':')) {
    const p = join(dir, program);
    if (existsSync(p)) return p;
  }
  return null;
}

function python3Fallback(program: string): string {
  if (program === 'python' && !findInPath('python') && findInPath('python3')) return 'python3';
  if (program === 'pip' && !findInPath('pip') && findInPath('pip3')) return 'pip3';
  return program;
}

/** Une commande de shell mentionne-t-elle un port réservé aux connecteurs ? (tool_runner) */
function mentionsBlockedLocalApp(command: string): boolean {
  if (command.includes('audacity_script_pipe')) return true;
  const tokens = command.split(/[\s"'=,/;&|]+/);
  return tokens.some((t) => {
    const digits = t.replace(/[^0-9]/g, '');
    return ['9876', '9877', '4455'].includes(digits);
  });
}

/** Gate d'installation et refus, recopié de `validate_args` (e058e56, tool_runner.rs). */
function validateArgsAvant(program: string, args: string[], approved: boolean, policy: ReturnType<typeof loadCommandsPolicy>): void {
  const first = args[0] || '';
  const second = args[1] || '';
  if (program === 'node' && ['-e', '--eval', '-p', '--print'].includes(first)) {
    throw new Error('node -e/--eval/-p est refusé.');
  }
  if ((program === 'python' || program === 'python3') && first === '-c') {
    throw new Error('python -c est refusé. Écris un fichier .py puis exécute-le.');
  }
  if ((program === 'python' || program === 'python3') && first === '-m' && !second) {
    throw new Error('Module Python manquant.');
  }
  if (program === 'git' && (first === 'config' || first === '-c')) {
    throw new Error('git config / git -c est refusé (hooks et fsmonitor).');
  }
  if (program === 'git' && args.some((a) =>
    a === '-C' || ['--git-dir', '--work-tree', '--separate-git-dir', '--template', '--exec-path', '--config-env', '--super-prefix']
      .some((o) => a === o || a.startsWith(`${o}=`)))) {
    throw new Error('Option git refusée (-C, --git-dir, --work-tree, --separate-git-dir, --template…) : le dépôt reste dans le projet, avec ses hooks protégés.');
  }
  if (program === 'git' && (first === 'push' || (first === 'remote' && second === 'add'))) {
    throw new Error('git push / git remote add est refusé par la politique locale.');
  }
  if (program === 'git' && first === 'reset' && second === '--hard') {
    throw new Error('git reset --hard est refusé par la politique locale.');
  }
  if (program === 'git' && first === 'clean' && second.startsWith('-')) {
    throw new Error('git clean est refusé par la politique locale.');
  }
  if (program === 'npm' && ['exec', 'publish'].includes(first)) {
    throw new Error('npm exec / npm publish est refusé par la politique locale.');
  }
  if (program === 'npm' && ['install', 'i', 'ci', 'add'].includes(first) && !approved) {
    throw new Error('Installation npm refusée sans ton accord : l\'agent doit la demander (carte d\'accord).');
  }
  if ((program === 'pip' || program === 'pip3') && first === 'install' && !approved) {
    throw new Error('Installation pip refusée sans ton accord : l\'agent doit la demander (carte d\'accord).');
  }
  if (program === 'cargo' && first === 'install' && !approved) {
    throw new Error('cargo install refusée sans ton accord : l\'agent doit le demander (carte d\'accord).');
  }
  const rule = policy?.programs.find((p) => p.name === program);
  if (rule) {
    const pos = positional(args);
    const deny = rule.deny.find((d) => matchesRule(pos, d.args));
    if (deny) throw new Error(`« ${program} ${deny.args} » est refusé : ${deny.reason}.`);
    if (!approved && rule.installs.some((r) => matchesRule(pos, r))) {
      throw new Error(`« ${program} ${pos[0] || ''} » installe ou télécharge du code : il faut ton accord (carte d'accord).`);
    }
  }
}

export interface TauriShim {
  /** Ajoute un dossier de projet autorisé (équivalent : ouvrir le projet dans l'app). */
  addRoot(dir: string): void;
  /** Journal des commandes lancées, pour le diagnostic du banc. */
  readonly spawned: { id: string; program: string; args: string[]; cwd: string }[];
}

/** Installe `window.__TAURI_INTERNALS__` : à faire AVANT tout import des services ANZAR. */
export function installTauriShim(opts: TauriShimOptions): TauriShim {
  const win = (globalThis as any).window;
  if (!win) throw new Error('bench/real : environnement sans `window` — le banc exige jsdom.');

  const procs = new Map<string, Proc>();
  const callbacks = new Map<number, (payload: any) => void>();
  const eventListeners = new Map<string, Map<number, (payload: any) => void>>();
  const roots = new Set<string>((opts.allowedRoots || []).map((d) => realpathSync(d)));
  const spawned: TauriShim['spawned'] = [];
  const avantPolicy = opts.variant === 'avant' ? loadCommandsPolicy(opts.commandsJsonPath) : null;
  let callbackCounter = 0;

  const emit = (event: string, payload: unknown) => {
    const listeners = eventListeners.get(event);
    if (!listeners) return;
    for (const handler of listeners.values()) handler({ event, id: 0, payload });
  };

  const transformCallback = (callback: (payload: any) => void): number => {
    const id = ++callbackCounter;
    callbacks.set(id, callback);
    return id;
  };

  const home = HOME;
  const canonical = (p: string): string => realpathSync(p);

  /** validate_dir de Rust : racine et dossier de travail dans le home, cwd dans le projet. */
  function validateDir(root: string, cwd: string): { root: string; cwd: string } {
    const rootP = canonical(root);
    const cwdP = canonical(cwd);
    if (!rootP.startsWith(home) || !cwdP.startsWith(home)) {
      throw new Error('Dossier hors du répertoire utilisateur.');
    }
    if (!cwdP.startsWith(rootP)) throw new Error('Dossier de travail hors du projet.');
    return { root: rootP, cwd: cwdP };
  }

  function isAllowedRoot(root: string): boolean {
    for (const r of roots) if (root === r || root.startsWith(`${r}/`)) return true;
    return false;
  }

  /** tool_spawn : le cœur du shim — même politique, même isolation que l'app. */
  function toolSpawn(a: Record<string, any>): number {
    const id: string = a.id;
    if (!id || id.length > 128 || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('Identifiant de processus invalide.');
    const useShell = a.shell === true;
    let program: string = String(a.program || '');
    let args: string[] = Array.isArray(a.args) ? a.args.map(String) : [];
    const cwd: string = a.cwd;
    const rootParam: string = a.root;
    const approved = a.approved === true;

    if (useShell) {
      if (opts.variant !== 'apres' || !sandboxAvailable()) {
        throw new Error('Le shell confiné n\'est pas disponible sur cet ordinateur : utilise run_command.');
      }
      const command = String(a.shellCommand || '');
      if (!command.trim()) throw new Error('Commande vide.');
      if (command.length > 20_000) throw new Error('Commande trop longue (max 20 000 caractères).');
      if (command.includes('\0')) throw new Error('Commande invalide (caractère NUL).');
      if (mentionsBlockedLocalApp(command.trim())) {
        throw new Error('Les ports locaux 9876 (Blender), 9877 (GIMP) et 4455 (OBS), ainsi que le tube d\'Audacity, sont réservés aux connecteurs d\'ANZAR : une commande ne doit pas les utiliser.');
      }
      program = 'bash';
      args = ['-c', command];
    } else if (opts.variant === 'avant') {
      program = program.trim().toLowerCase();
      if (program.includes('/') || program.includes('\\') || !isValidProgramName(program)) {
        throw new Error('Programme non autorisé.');
      }
      if (isDeniedProgram(program, avantPolicy)) {
        throw new Error(`« ${program} » est interdit à l'agent, même avec ton accord.`);
      }
      program = python3Fallback(program);
      const known = !!avantPolicy?.programs.some((p) => p.name === program);
      if (!known && !approved) {
        throw new Error(`« ${program} » n'est pas dans la liste d'ANZAR : il faut ton accord (carte d'accord).`);
      }
      if (avantPolicy && args.length > avantPolicy.limits.maxArgs) {
        throw new Error(`Trop d'arguments (max ${avantPolicy.limits.maxArgs}).`);
      }
      validateArgsAvant(program, args, approved, avantPolicy);
    } else {
      program = python3Fallback(program.trim().toLowerCase());
      if (mentionsBlockedLocalApp(`${program} ${args.join(' ')}`)) {
        throw new Error('Les ports locaux 9876 (Blender), 9877 (GIMP) et 4455 (OBS), ainsi que le tube d\'Audacity, sont réservés aux connecteurs d\'ANZAR : une commande ne doit pas les utiliser.');
      }
    }

    const { root, cwd: cwdReal } = validateDir(rootParam, cwd);
    if (!isAllowedRoot(root)) throw new Error('Dossier non autorisé : ouvre-le d\'abord comme projet dans ANZAR.');

    // gradlew : script du projet, résolu dans le dossier de travail (jamais via le PATH)
    let exe = program;
    if (!useShell && program === 'gradlew') {
      const file = join(cwdReal, 'gradlew');
      const real = canonical(file);
      if (!real.startsWith(root)) throw new Error('Le script gradlew est hors du projet.');
      exe = real;
    }

    const isolated = (a.sandbox === undefined ? true : a.sandbox === true) && sandboxAvailable();
    if (isolated && !useShell && findInPath(program) === null && program !== 'gradlew') {
      throw new Error(`« ${program} » est introuvable sur cet ordinateur.`);
    }

    const allowNetwork = opts.variant === 'avant'
      ? true // le relais netproxy n'est pas répliqué (voir en-tête) : réseau direct
      : true;
    const gitInit = opts.variant === 'avant' && gitInitAllowed(program, args, root, cwdReal);
    const wrappedCmd = isolated
      ? wrap(exe, args, root, opts.variant, { allowNetwork, gitInit })
      : { program: exe, args: [...args] };

    const env: Record<string, string> = {};
    for (const key of BASE_ENV_KEYS) {
      const v = process.env[key];
      if (v !== undefined) env[key] = v;
    }
    env.PATH = enrichedPath();

    const child = spawn(wrappedCmd.program, wrappedCmd.args, {
      cwd: cwdReal,
      env,
      detached: true, // nouveau groupe de processus, comme process_group(0)
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pid = child.pid ?? -1;
    spawned.push({ id, program, args, cwd: cwdReal });

    const streamsDone: Promise<void>[] = [];
    const proc: Proc = {
      pid,
      exitCode: null,
      stdout: '',
      stderr: '',
      done: Promise.all(streamsDone),
      kill: () => {
        try { process.kill(-pid, 'SIGTERM'); } catch { /* groupe déjà mort */ }
        setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* idem */ } }, 1500);
      },
    };
    procs.set(id, proc);

    const pipe = (stream: 'stdout' | 'stderr', source: NodeJS.ReadableStream | null) => {
      if (!source) return;
      streamsDone.push(new Promise<void>((resolve) => {
        createInterface({ input: source }).on('line', (line: string) => {
          proc[stream] += `${line}\n`;
          emit('tool://output', { id, stream, line });
        }).on('close', () => resolve());
      }));
    };
    pipe('stdout', child.stdout);
    pipe('stderr', child.stderr);
    proc.done = Promise.all(streamsDone);
    const exited = new Promise<void>((resolve) => {
      child.on('exit', (code) => {
        proc.exitCode = code ?? 1;
        emit('tool://exit', { id, code: proc.exitCode });
        resolve();
      });
      child.on('error', () => {
        if (proc.exitCode === null) {
          proc.exitCode = 1;
          emit('tool://exit', { id, code: 1 });
        }
        resolve();
      });
    });
    proc.done = Promise.all([exited, ...streamsDone]);
    return pid;
  }

  // ── Système de fichiers (plugin-fs) ──────────────────────────────────────────

  const fsShim: Record<string, (a: any, raw?: any, options?: any) => unknown> = {
    'plugin:fs|read_text_file': (a) => byteFile(a.path),
    'plugin:fs|read_file': (a) => byteFile(a.path),
    'plugin:fs|write_text_file': (_a, raw, options) => {
      const path = decodeURIComponent(options?.headers?.path ?? _a.path);
      writeFileSync(path, Buffer.from(raw));
    },
    'plugin:fs|write_file': (_a, raw, options) => {
      const path = decodeURIComponent(options?.headers?.path ?? _a.path);
      writeFileSync(path, Buffer.from(raw));
    },
    'plugin:fs|exists': (a) => existsSync(a.path),
    'plugin:fs|mkdir': (a) => {
      mkdirSync(a.path, { recursive: a.options?.recursive === true });
    },
    'plugin:fs|read_dir': (a) =>
      readdirSync(a.path, { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        isSymlink: e.isSymbolicLink(),
      })),
    'plugin:fs|remove': (a) => {
      rmSync(a.path, { recursive: a.options?.recursive === true, force: true });
    },
    'plugin:fs|rename': (a) => renameSync(a.oldPath, a.newPath),
    'plugin:fs|copy_file': (a) => copyFileSync(a.fromPath, a.toPath),
    'plugin:fs|stat': (a) => fileStat(a.path, false),
    'plugin:fs|lstat': (a) => fileStat(a.path, true),
    'plugin:fs|truncate': (a) => truncateSync(a.path, a.len ?? 0),
  };

  /** Octets d'un fichier, comme l'IPC Tauri les transmet (tableau de nombres). */
  function byteFile(path: string): number[] {
    return Array.from(readFileSync(path));
  }

  function fileStat(path: string, _symlink: boolean) {
    const s = statSync(path);
    return { isFile: s.isFile(), isDirectory: s.isDirectory(), isSymlink: s.isSymbolicLink(), size: s.size, mtimeMs: s.mtimeMs, atimeMs: s.atimeMs, ctimeMs: s.ctimeMs, birthtimeMs: s.birthtimeMs };
  }

  // ── Chemins (plugin:path) : AppData = dossier de données du banc ────────────

  const BASE_DIRS: Record<number, string> = {
    4: join(HOME, 'Library/Application Support'), // Data
    6: join(HOME, 'Documents'),
    7: join(HOME, 'Downloads'),
    12: process.env.TMPDIR || '/tmp',
    14: opts.appDataDir, // AppData (bundle identifier de l'app : dossier du banc)
    15: opts.appDataDir,
    16: join(opts.appDataDir, 'caches'),
    18: join(HOME, 'Desktop'),
    21: HOME,
  };

  // ── Programmes disponibles (programs_status / node_status) ──────────────────

  const programVersion = (cmd: string): string | null => {
    try {
      const out = spawnSyncOutput(cmd, ['--version']);
      return out ? out.trim().split('\n')[0] : null;
    } catch { return null; }
  };
  const nodeVersion = `v${process.versions.node}`;

  const commands: Record<string, (a: any, raw?: any, options?: any) => unknown> = {
    ...fsShim,
    'tool_spawn': toolSpawn,
    'tool_wait': (a) => {
      const proc = procs.get(a.id);
      if (!proc) throw new Error('Processus inconnu.');
      return (async () => {
        const deadline = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Attente de processus trop longue (1 h).')), 3_600_000));
        await Promise.race([proc.done, deadline]);
        return { code: proc.exitCode ?? 1, stdout: proc.stdout, stderr: proc.stderr };
      })();
    },
    'tool_kill': (a) => {
      const proc = procs.get(a.id);
      if (proc) proc.kill();
    },
    'plugin:path|resolve_directory': (a) => {
      const dir = BASE_DIRS[a.directory];
      if (!dir) throw new Error(`Répertoire inconnu du banc : ${a.directory}`);
      return dir;
    },
    'plugin:event|listen': (a) => {
      const handler = callbacks.get(a.handler);
      const listeners = eventListeners.get(a.event) || new Map();
      if (handler) listeners.set(a.handler, handler);
      eventListeners.set(a.event, listeners);
      return a.handler;
    },
    'plugin:event|unlisten': () => undefined,
    'fs_realpath': (a) => realpathSync(a.path),
    'programs_status': () => [
      { id: 'node', name: 'Node.js', status: 'ok', version: nodeVersion, path: process.execPath, install: 'auto', note: null },
      { id: 'git', name: 'Git', status: programVersion('git') ? 'ok' : 'missing', version: programVersion('git'), path: findInPath('git'), install: 'apple', note: null },
      { id: 'python', name: 'Python', status: programVersion('python3') ? 'ok' : 'missing', version: programVersion('python3'), path: findInPath('python3'), install: 'manual', note: null },
      { id: 'python3', name: 'Python 3', status: programVersion('python3') ? 'ok' : 'missing', version: programVersion('python3'), path: findInPath('python3'), install: 'manual', note: null },
      { id: 'uv', name: 'uv', status: 'missing', version: null, path: null, install: 'manual', note: null },
      { id: 'cargo', name: 'Rust', status: programVersion('cargo') ? 'ok' : 'missing', version: programVersion('cargo'), path: findInPath('cargo'), install: 'manual', note: null },
      { id: 'docker', name: 'Docker', status: 'missing', version: null, path: null, install: 'manual', note: null },
      { id: 'bun', name: 'Bun', status: 'missing', version: null, path: null, install: 'manual', note: null },
      { id: 'deno', name: 'Deno', status: 'missing', version: null, path: null, install: 'manual', note: null },
      { id: 'chrome', name: 'Chrome', status: 'missing', version: null, path: null, install: 'manual', note: null },
    ],
    'node_status': () => ({ active: nodeVersion, source: 'system', system: nodeVersion, managed: null, min_major: 18 }),
    'secure_app_secrets': () => undefined,
    'mcp_config_load': () => [],
    'mcp_config_save': () => undefined,
    'mcp_stop': () => undefined,
    'command_policy_get': () => ({ sandbox: true, network: true, proxy: true, extraHosts: [], trustedPrograms: [] }),
    'command_policy_set': () => ({ sandbox: true, network: true, proxy: true, extraHosts: [], trustedPrograms: [] }),
    'tools_catalog': () => [],
    'reveal_path': () => undefined,
    'open_personal_space': () => join(HOME, 'Documents/ANZAR'),
    // Services absents du banc : échec propre, lisible dans les traces.
    'tool_install': () => { throw new Error('Installation d\'outil indisponible dans le banc.'); },
    'git_install': () => { throw new Error('Installation de Git indisponible dans le banc.'); },
    'apple_dev_tools_install': () => { throw new Error('Installation des outils Apple indisponible dans le banc.'); },
    'node_install': () => { throw new Error('Téléchargement de Node indisponible dans le banc.'); },
    'npx': () => { throw new Error('npx interne indisponible dans le banc.'); },
    'playwright': () => { throw new Error('Navigateur intégré indisponible dans le banc.'); },
    'chromium': () => { throw new Error('Navigateur intégré indisponible dans le banc.'); },
    'mcp_http': () => { throw new Error('Connecteurs MCP indisponibles dans le banc.'); },
    'mcp_spawn': () => { throw new Error('Connecteurs MCP indisponibles dans le banc.'); },
    'mcp_send': () => { throw new Error('Connecteurs MCP indisponibles dans le banc.'); },
    'secret_set': () => { throw new Error('Coffre indisponible dans le banc.'); },
    'secret_get': () => { throw new Error('Coffre indisponible dans le banc.'); },
    'secret_delete': () => { throw new Error('Coffre indisponible dans le banc.'); },
  };

  const invoke = (cmd: string, args: any = {}, options?: any): Promise<unknown> =>
    new Promise((resolve, reject) => {
      setImmediate(() => {
        const handler = commands[cmd];
        if (!handler) {
          reject(new Error(`Commande Tauri non implémentée par le banc : ${cmd}`));
          return;
        }
        try {
          resolve(handler(args, args, options));
        } catch (e: any) {
          reject(new Error(e?.message || String(e)));
        }
      });
    });

  (win as any).__TAURI_INTERNALS__ = { invoke, transformCallback };
  (win as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
    eol: '\n',
    platform: 'macos',
    version: osVersion(),
    family: 'unix',
    os_type: 'Macintosh',
    arch: process.arch,
    exe_extension: '',
  };

  return {
    addRoot: (dir: string) => { roots.add(realpathSync(dir)); },
    spawned,
  };
}

/** Version courte d'un programme (pour programs_status). */
function spawnSyncOutput(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? r.stdout : null;
}
