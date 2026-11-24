/**
 * Politique de commandes du terminal : motifs interdits, validation, tokenisation
 * et résolution vers les entrées de scope Tauri. Module pur, partagé par
 * `terminal.ts` et `agentTools.precheckCommand`.
 */

/**
 * Politique de commandes — source unique : `commands.json`.
 *
 * Le même fichier est inclus par Rust à la compilation (`include_str!` dans
 * `tool_runner.rs`) : la liste des programmes autorisés et les plafonds d'arguments ne
 * peuvent plus diverger entre le pré-contrôle TypeScript et l'exécution réelle.
 *
 * Les motifs `blocked` sont la couche de **pré-contrôle** (message actionnable avant même
 * d'appeler Rust). L'application reste structurelle côté Rust : pas de shell, programme
 * allowlisté, arguments contrôlés — un motif oublié ici ne peut donc pas exécuter grand-chose.
 */
import manifest from './commands.json';

interface BlockedRule {
  id: string;
  pattern: string;
  flags?: string;
  reason: string;
}

interface ProgramRule {
  name: string;
  agent?: boolean;
  install?: boolean;
  /** Sous-commandes qui installent ou téléchargent du code (accord + réseau). "" = tout, "<none>" = sans argument. */
  installs?: string[];
  /** Sous-commandes qui ont besoin d'internet sans être des installations. */
  network?: string[];
  /** Sous-commandes toujours refusées. */
  deny?: { args: string; reason: string }[];
  /** Sous-commandes qui lancent un autre programme (npx X, bundle exec X…). */
  launches?: string[];
}

interface CommandsManifest {
  version: number;
  limits: { maxArgs: number; maxArgChars: number; maxCommandChars: number };
  programs: ProgramRule[];
  deniedPrograms?: { reason: string; names: string[] };
  blocked: BlockedRule[];
}

const policy = manifest as unknown as CommandsManifest;

export const MAX_ARGS = policy.limits.maxArgs;
export const MAX_ARG_CHARS = policy.limits.maxArgChars;
export const MAX_COMMAND_CHARS = policy.limits.maxCommandChars;

/** Tous les programmes que le lanceur accepte (agent ou usage interne). */
export const PROGRAMS: string[] = policy.programs.map((p) => p.name);
/** Programmes que l'agent peut réellement lancer via `run_command`. */
export const AGENT_PROGRAMS: string[] = policy.programs.filter((p) => p.agent).map((p) => p.name);
/** Programmes dont l'installation exige l'accord de l'utilisateur. */
export const INSTALL_PROGRAMS: string[] = policy.programs.filter((p) => p.install).map((p) => p.name);

const RULES = new Map(policy.programs.map((p) => [p.name, p]));
/** Programmes jamais lancés par l'agent, même avec accord (shells, sudo, réseau brut…). */
export const DENIED_PROGRAMS = new Set((policy.deniedPrograms?.names || []).map((n) => n.toLowerCase()));

/** Nom de programme sans chemin ni extension Windows, en minuscules. */
export function programBase(name: string): string {
  return String(name || '').trim().split(/[\\/]/).pop()!.toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
}

export function isKnownProgram(name: string): boolean {
  return RULES.has(programBase(name));
}

export function isDeniedProgram(name: string): boolean {
  return DENIED_PROGRAMS.has(programBase(name));
}

/** Nom de programme simple : `flutter`, `supabase`, `clang++`… (même règle que Rust). */
export function isValidProgramName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(name);
}

/** Arguments positionnels (sans options), en minuscules. */
function positional(args: string[]): string[] {
  return args.filter((a) => !a.startsWith('-')).map((a) => a.toLowerCase());
}

function matchesRule(pos: string[], rule: string): boolean {
  const r = rule.trim();
  if (r === '') return true;
  if (r === '<none>') return pos.length === 0;
  const words = r.split(/\s+/);
  return words.length <= pos.length && words.every((w, i) => w === pos[i]);
}

/** La commande installe-t-elle ou télécharge-t-elle du code (accord nécessaire) ? */
export function isInstallCommand(program: string, args: string[]): boolean {
  const rule = RULES.get(programBase(program));
  const pos = positional(args);
  return !!rule?.installs?.some((r) => matchesRule(pos, r));
}

const VALUE_OPTIONS = new Set(['--sdk', '-sdk', '--toolchain', '-toolchain', '-p', '--package', '--with',
  '--from', '--python', '--directory', '--cwd', '-C', '--project']);

function launchTarget(args: string[], skip: number): string | null {
  let seen = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      if (!a.includes('=') && VALUE_OPTIONS.has(a)) i++;
      continue;
    }
    if (seen === skip) return a.toLowerCase();
    seen++;
  }
  return null;
}

/**
 * Raison du refus d'une commande par les règles du manifeste (programme interdit, sous-commande
 * refusée, lanceur vers un programme interdit), ou null. Mêmes règles que `validate_args` (Rust).
 */
export function ruleRefusal(program: string, args: string[]): string | null {
  const base = programBase(program);
  if (DENIED_PROGRAMS.has(base)) {
    return `« ${base} » est interdit à l'agent (${policy.deniedPrograms?.reason || 'jamais lancé'}).`;
  }
  const rule = RULES.get(base);
  if (!rule) return null;
  const pos = positional(args);
  const deny = rule.deny?.find((d) => matchesRule(pos, d.args));
  if (deny) return `« ${base} ${deny.args} » est refusé : ${deny.reason}.`;
  for (const launch of rule.launches || []) {
    if (!matchesRule(pos, launch)) continue;
    const target = launchTarget(args, launch.trim() ? launch.trim().split(/\s+/).length : 0);
    if (target && isDeniedProgram(target)) {
      return `« ${base} » ne peut pas lancer « ${programBase(target)} » : programme interdit à l'agent.`;
    }
  }
  return null;
}

/** Motifs interdits, avec leur raison affichée à l'agent. */
export const BLOCKED_RULES: (BlockedRule & { re: RegExp })[] = policy.blocked.map((rule) => ({
  ...rule,
  re: new RegExp(rule.pattern, rule.flags || ''),
}));
/** Mêmes motifs, pour les tests et les appelants qui ne veulent que les expressions. */
export const BLOCKED_PATTERNS: RegExp[] = BLOCKED_RULES.map((r) => r.re);

export function validateCommand(command: string): { safe: boolean; reason?: string } {
  if (!command.trim()) return { safe: false, reason: 'Commande vide' };
  if (command.length > MAX_COMMAND_CHARS) {
    return { safe: false, reason: `Commande trop longue (max ${MAX_COMMAND_CHARS} caractères)` };
  }
  for (const rule of BLOCKED_RULES) {
    if (rule.re.test(command)) return { safe: false, reason: rule.reason };
  }
  return { safe: true };
}

/** Minimal command tokenizer (supports quotes). */
export function tokenize(command: string): string[] {
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
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) { out.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** Map "typed command" -> nom de programme autorisé (dérivée du manifeste). */
export const COMMAND_NAME_MAP: Record<string, string> = Object.fromEntries(
  PROGRAMS.map((name) => [name, name]),
);

/** `./gradlew` (script du projet) → programme « gradlew », résolu par Rust dans le dossier. */
function programToken(token: string): string {
  const t = token.toLowerCase();
  return t === './gradlew' || t === '.\\gradlew' || t === 'gradlew.bat' || t === './gradlew.bat' ? 'gradlew' : t;
}

/**
 * Commande → programme et arguments. Les programmes hors liste mais au nom valide et non
 * interdits sont acceptés ici : l'accord de l'utilisateur (carte) et Rust décident ensuite.
 */
export function parseExecutable(command: string): { cmdName: string; args: string[]; known: boolean } | null {
  const parts = tokenize(command);
  if (parts.length === 0) return null;
  const token = programToken(parts[0]);
  const known = COMMAND_NAME_MAP[token];
  if (!known && (!isValidProgramName(token) || isDeniedProgram(token))) return null;
  const base = known || token;
  const args = parts.slice(1);
  if (args.length > MAX_ARGS) return null;
  return { cmdName: `${base}-${args.length}`, args, known: !!known };
}
