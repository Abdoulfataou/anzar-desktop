/**
 * Ligne de base de vérification : ce qui était déjà cassé AVANT que l'agent ne touche au projet.
 *
 * Sans elle, un projet dont le build est rouge ne peut jamais franchir `task_done` : l'agent
 * corrige, échoue, recommence, et rend `verify_failed` sur une erreur qui n'est pas la sienne.
 * Avec elle, seuls les **nouveaux** échecs bloquent.
 *
 * Comparaison volontairement tolérante : les lignes d'erreur sont normalisées (chemins absolus,
 * numéros de ligne, durées) pour qu'une erreur identique déplacée de quelques lignes reste
 * reconnue comme préexistante. Une commande qui échouait et échoue encore avec les mêmes lignes
 * ne bloque pas ; une ligne qui apparaît en plus bloque.
 *
 * Module pur (aucune I/O), plus un cache par projet pour ne pas relancer la vérification de
 * référence à chaque tour.
 */
import type { VerifyReport } from './agentVerifier';

const MAX_LINES_PER_COMMAND = 200;
const MAX_LINE_CHARS = 240;
/** Sentinelle quand une commande échoue sans message exploitable (exit code seul). */
export const NO_MESSAGE_FAILURE = '<échec sans message>';

export interface BaselineCommand {
  command: string;
  label: string;
  passed: boolean;
  /** Lignes d'erreur normalisées (vide si la commande passait). */
  failures: string[];
}

export interface VerifyBaseline {
  at: number;
  root: string;
  commands: BaselineCommand[];
}

export interface VerifyFailure {
  label: string;
  command: string;
  lines: string[];
}

export interface VerifyDiff {
  /** Échecs imputables à l'agent : ils seuls bloquent `task_done`. */
  newFailures: VerifyFailure[];
  /** Nombre de lignes déjà présentes avant les modifications. */
  preexisting: number;
  /** Commandes qui échouaient avant et passent maintenant. */
  resolved: number;
}

const ANSI = /\x1b\[[0-9;]*m/g;
/** Ligne qui ressemble à une erreur (sinon c'est de la progression de build, qui varie). */
const ERROR_LINE = /(error|erreur|failed|failure|\bfail\b|warning|✗|×|TS\d{3,5}|cannot find|not found|not recognized|exception|enoent|E\d{3,4}|exit code|code de sortie)/i;
/** Bruit stable d'un run à l'autre mais sans valeur : en-têtes npm, piles d'appels. */
const NOISE = /^(> |npm (ERR|WARN)|at )/;

/** Lignes d'erreur normalisées d'une sortie de commande. */
export function normalizeFailureLines(output: string, root = ''): string[] {
  const seen = new Set<string>();
  for (const raw of String(output || '').split('\n')) {
    let line = raw.replace(ANSI, '').trim();
    if (!line || NOISE.test(line) || !ERROR_LINE.test(line)) continue;
    // Chemins absolus : le projet est le même d'un run à l'autre.
    if (root) line = line.split(root).join('');
    line = line
      .replace(/:\d+(?::\d+)?/g, '')                      // fichier:ligne:colonne
      .replace(/\b\d+(?:\.\d+)?\s?(ms|s|m|min)\b/gi, '<durée>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_LINE_CHARS);
    if (!line) continue;
    seen.add(line);
    if (seen.size >= MAX_LINES_PER_COMMAND) break;
  }
  return [...seen];
}

/** Instantané à conserver avant la première écriture de l'agent. */
export function toBaseline(report: VerifyReport, root: string): VerifyBaseline {
  return {
    at: Date.now(),
    root,
    commands: report.results
      .filter((r) => !r.skipped)
      .map((r) => {
        if (r.passed) return { command: r.command, label: r.label, passed: true, failures: [] };
        const lines = normalizeFailureLines(r.output, root);
        return {
          command: r.command,
          label: r.label,
          passed: false,
          failures: lines.length ? lines : [NO_MESSAGE_FAILURE],
        };
      }),
  };
}

/**
 * Échecs imputables à l'agent.
 * - pas de ligne de base : tous les échecs comptent (comportement d'avant) ;
 * - commande qui passait et échoue : tout est nouveau ;
 * - commande qui échouait déjà : seules les lignes absentes de la référence comptent.
 */
export function diffAgainstBaseline(report: VerifyReport, baseline: VerifyBaseline | null): VerifyDiff {
  // Clé = label : la référence a tourné en vérification complète, le contrôle peut être ciblé
  // (« npm run lint -- src/a.ts ») — c'est le même contrôle, pas une nouvelle commande.
  const before = new Map((baseline?.commands || []).map((c) => [c.label, c]));
  const newFailures: VerifyFailure[] = [];
  let preexisting = 0;
  let resolved = 0;

  for (const r of report.results) {
    if (r.skipped) continue;
    const previous = before.get(r.label);
    if (r.passed) {
      if (previous && !previous.passed) resolved += 1;
      continue;
    }
    const lines = normalizeFailureLines(r.output, baseline?.root || '');
    const current = lines.length ? lines : [NO_MESSAGE_FAILURE];
    if (!previous || previous.passed) {
      newFailures.push({ label: r.label, command: r.command, lines: current });
      continue;
    }
    const known = new Set(previous.failures);
    const fresh = current.filter((line) => !known.has(line));
    preexisting += current.length - fresh.length;
    if (fresh.length) newFailures.push({ label: r.label, command: r.command, lines: fresh });
  }

  return { newFailures, preexisting, resolved };
}

/** Résumé réinjecté au modèle : uniquement ce qu'il doit corriger. */
export function summarizeVerifyDiff(diff: VerifyDiff, maxChars = 4_000): string {
  if (!diff.newFailures.length) {
    return diff.preexisting > 0
      ? `Aucun nouvel échec : les ${diff.preexisting} problème(s) restants étaient déjà présents avant tes modifications, ils ne sont pas comptés.`
      : '';
  }
  const head = `Vérification : ${diff.newFailures.length} commande${diff.newFailures.length > 1 ? 's' : ''} en échec après tes modifications`
    + (diff.preexisting > 0 ? ` (${diff.preexisting} problème(s) déjà présent(s) avant, non comptés)` : '')
    + '.';
  const body = diff.newFailures
    .map((f) => `### ${f.label} — \`${f.command}\`\n${f.lines.slice(0, 25).join('\n')}`)
    .join('\n\n');
  const text = `${head}\n\n${body}`;
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… [résumé tronqué]` : text;
}

// ============================================================================
// CACHE PAR PROJET
// ============================================================================

/** Au-delà, une référence trop vieille ne veut plus dire grand-chose. */
export const BASELINE_TTL_MS = 2 * 60 * 60_000;
const CACHE_TTL_MS = BASELINE_TTL_MS;
const cache = new Map<string, VerifyBaseline>();

/** Référence déjà capturée pour ce projet dans la session, si elle est encore fraîche. */
export function getCachedBaseline(root: string): VerifyBaseline | null {
  const entry = cache.get(root);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(root);
    return null;
  }
  return entry;
}

export function setCachedBaseline(baseline: VerifyBaseline): void {
  cache.set(baseline.root, baseline);
}

/**
 * Relit une référence persistée (survit au redémarrage de l'app, contrairement au cache
 * mémoire). Renvoie null si le JSON est illisible, s'il concerne un autre projet ou s'il a
 * dépassé le TTL : dans ces cas, l'appelant recapture.
 */
export function parseStoredBaseline(raw: string, root: string, now = Date.now()): VerifyBaseline | null {
  try {
    const data = JSON.parse(raw) as Partial<VerifyBaseline>;
    if (!data || data.root !== root) return null;
    if (typeof data.at !== 'number' || now - data.at > BASELINE_TTL_MS || data.at > now + 60_000) return null;
    if (!Array.isArray(data.commands)) return null;
    const commands = data.commands.filter(
      (c): c is BaselineCommand =>
        !!c && typeof c.command === 'string' && typeof c.label === 'string'
        && typeof c.passed === 'boolean' && Array.isArray(c.failures),
    );
    if (!commands.length) return null;
    return { at: data.at, root, commands };
  } catch {
    return null;
  }
}

/** Réservé aux tests : vide le cache pour isoler les scénarios. */
export function resetBaselineCache(): void {
  cache.clear();
}
