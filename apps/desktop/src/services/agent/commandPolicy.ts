/**
 * Politique de commandes du terminal : motifs interdits, validation, tokenisation
 * et résolution vers les entrées de scope Tauri. Module pur, partagé par
 * `terminal.ts` et `agentTools.precheckCommand`.
 */

/** Dangerous patterns that must NEVER be executed */
export const BLOCKED_PATTERNS: RegExp[] = [
  /sudo\s/i,
  /su\s+-/i,
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fd\b/i,
  /rm\s+-rf\s+[/~]/i,
  /rm\s+-rf\s+\.\./i,
  />\s*\/dev\//i,
  /\|/i,
  />/i,
  /</i,
  /;\s*/i,
  /&&/i,
  /\|\|/i,
  /curl\s/i,
  /wget\s/i,
  /eval\s*\(/i,
  /\$\(.*\)/,
  /`[^`]+`/,
  />\s*\/etc\//i,
  />\s*~\/\./i,
  /export\s+(PATH|LD_PRELOAD|LD_LIBRARY_PATH)\s*=/i,
  /nc\s+-/i,
  /python3?\s+-c\s/i,
  /node\s+(-e|--eval)\b/i,
  /\b(bash|sh|zsh)\s+-c\b/i,
  /(^|\s)(\/|~\/|[A-Za-z]:\\)/,
];

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
  if (/[|;<>]|&&|\|\|/.test(command)) {
    return 'Refusé : un seul programme par appel, sans |, ;, &&, >, < ni $(…). Découpe en plusieurs appels run_command, ou utilise search_files / list_dir / read_file.';
  }
  return `Commande bloquée (motif: ${pattern.source}). Utilise une seule commande simple de la liste autorisée.`;
}

export function validateCommand(command: string): { safe: boolean; reason?: string } {
  if (!command.trim()) return { safe: false, reason: 'Commande vide' };
  if (command.length > 2000) return { safe: false, reason: 'Commande trop longue (max 2000 caractères)' };
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return { safe: false, reason: blockedReason(command, pattern) };
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

/** Map "typed command" -> tauri allowlisted command name. */
export const COMMAND_NAME_MAP: Record<string, string> = {
  npm: 'npm',
  node: 'node',
  git: 'git',
  cargo: 'cargo',
  python3: 'python3',
  python: 'python',
  pip3: 'pip3',
  pip: 'pip',
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  rg: 'rg',
};

/** Nombre maximal d'arguments par commande (les capabilities déclarent 0 à 9 arguments). */
export const MAX_ARGS = 8;

export function parseExecutable(command: string): { cmdName: string; args: string[] } | null {
  const parts = tokenize(command);
  if (parts.length === 0) return null;
  const base = COMMAND_NAME_MAP[parts[0].toLowerCase()];
  if (!base) return null;
  const args = parts.slice(1);
  if (args.length > MAX_ARGS) return null;
  return { cmdName: `${base}-${args.length}`, args };
}
