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

interface CommandsManifest {
  version: number;
  limits: { maxArgs: number; maxArgChars: number; maxCommandChars: number };
  programs: { name: string; agent?: boolean; install?: boolean }[];
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

export function parseExecutable(command: string): { cmdName: string; args: string[] } | null {
  const parts = tokenize(command);
  if (parts.length === 0) return null;
  const base = COMMAND_NAME_MAP[parts[0].toLowerCase()];
  if (!base) return null;
  const args = parts.slice(1);
  if (args.length > MAX_ARGS) return null;
  return { cmdName: `${base}-${args.length}`, args };
}
