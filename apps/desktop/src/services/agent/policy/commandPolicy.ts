/**
 * Découpage minimal d'une ligne de commande pour `run_command`.
 *
 * Harness n'a pas de liste blanche ni de liste noire de programmes : le shell
 * exécute l'argv demandé. ANZAR garde seulement le découpage (programme + arguments)
 * parce que son exécuteur Windows ne passe pas par un shell.
 */

/** Découpe une ligne en respectant les guillemets simples et doubles. */
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

/** Nom de programme sans chemin ni extension Windows, en minuscules. */
export function programBase(name: string): string {
  return String(name || '').trim().split(/[\\/]/).pop()!.toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
}

/** Programme + arguments, sans aucune règle de permission. */
export function parseExecutable(command: string): { cmdName: string; args: string[]; known: boolean } | null {
  const parts = tokenize(String(command || '').trim());
  if (parts.length === 0) return null;
  const base = programBase(parts[0]);
  if (!base) return null;
  return { cmdName: `${base}-${parts.length - 1}`, args: parts.slice(1), known: true };
}
