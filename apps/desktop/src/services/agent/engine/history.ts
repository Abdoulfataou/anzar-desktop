/**
 * Gestion de l'historique API de l'agent : compaction compatible avec le cache
 * fournisseur, estimation de taille, et réparation des tool_calls orphelins.
 *
 * Ces fonctions sont pures (elles ne dépendent ni de React ni de Tauri) et sont
 * partagées par le hook de chat et par la boucle des sous-agents.
 */
import type { APIMessage, ToolCall } from '@/types';

export const KEEP_RECENT_TOOL_RESULTS = 6;
export const SMALL_RESULT_CHARS = 1_500;
export const STUB_CHARS = 600;
export const SOFT_LIMIT_CHARS = 160_000;
/** Seuil de compaction en jetons estimés (le serveur facture en jetons, pas en caractères). */
export const SOFT_LIMIT_TOKENS = 40_000;
/** Un résultat d'outil ancien plus long que ce seuil est élagué avant tout résumé. */
export const PRUNE_MAX_CHARS = 8_000;
export const PRUNE_HEAD_CHARS = 4_000;
export const PRUNE_TAIL_CHARS = 1_000;
export const PRUNE_MARK = '\n\n[… résultat d’outil ancien tronqué ; relance l’outil si tu as besoin du détail …]\n\n';
export const SHRUNK_MARK = '[ancien résultat raccourci';
/** Les résultats de skills ne sont jamais compactés : l'agent les relit rarement. */
export const SKILL_RESULT_PREFIX = '# Skill « ';

export function shrinkText(text: string, keep: number): string {
  if (text.length <= keep + 200 || text.includes(SHRUNK_MARK)) return text;
  return `${text.slice(0, keep)}\n… ${SHRUNK_MARK} : ${text.length.toLocaleString('fr-FR')} caractères au total — relance l'outil si tu as besoin du détail]`;
}

/** Raccourcit les longs arguments (contenu écrit par write_file/edit_file) d'un ancien appel d'outil. */
export function shrinkToolCallArgs(call: ToolCall): ToolCall {
  const raw = call.function.arguments || '';
  if (raw.length <= SMALL_RESULT_CHARS) return call;
  try {
    const args = JSON.parse(raw);
    for (const k of Object.keys(args)) {
      if (typeof args[k] === 'string' && args[k].length > 400) {
        args[k] = `${args[k].slice(0, 200)}… [${args[k].length} caractères, raccourci]`;
      }
    }
    return { ...call, function: { ...call.function, arguments: JSON.stringify(args) } };
  } catch {
    return call;
  }
}

/**
 * Élague les résultats d'outils anciens en gardant le début et la fin : moins destructeur
 * qu'un stub de 600 caractères, il conserve les erreurs et les derniers chemins. À appeler
 * avant `compactHistory` quand l'historique dépasse le seuil de jetons.
 */
export function pruneToolResults(history: APIMessage[], keepRecent: number, maxChars = PRUNE_MAX_CHARS): void {
  const toolIdx: number[] = [];
  history.forEach((m, i) => { if (m.role === 'tool') toolIdx.push(i); });
  const cutoff = keepRecent > 0 ? toolIdx[toolIdx.length - keepRecent] ?? 0 : history.length;
  for (let i = 0; i < cutoff; i++) {
    const m = history[i];
    if (m.role !== 'tool' || typeof m.content !== 'string') continue;
    if (m.content.length <= maxChars || m.content.startsWith(SKILL_RESULT_PREFIX)) continue;
    const head = m.content.slice(0, PRUNE_HEAD_CHARS);
    const tail = m.content.slice(-PRUNE_TAIL_CHARS);
    history[i] = { ...m, content: `${head}${PRUNE_MARK}${tail}` };
  }
}

/**
 * Raccourcit sur place tout ce qui précède les `keepRecent` derniers résultats
 * d'outils : leurs résultats longs et les longs arguments des appels
 * correspondants. À appeler rarement et en une fois (cache fournisseur).
 */
export function compactHistory(history: APIMessage[], keepRecent: number, stubChars: number): void {
  const toolIdx: number[] = [];
  history.forEach((m, i) => { if (m.role === 'tool') toolIdx.push(i); });
  const cutoff = keepRecent > 0 ? toolIdx[toolIdx.length - keepRecent] ?? 0 : history.length;
  for (let i = 0; i < cutoff; i++) {
    const m = history[i];
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > SMALL_RESULT_CHARS && !m.content.startsWith(SKILL_RESULT_PREFIX)) {
      history[i] = { ...m, content: shrinkText(m.content, stubChars) };
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      history[i] = { ...m, tool_calls: m.tool_calls.map(shrinkToolCallArgs) };
    }
  }
}

export const historyChars = (history: APIMessage[]): number =>
  history.reduce((n, m) => n + (m.content?.length || 0) + JSON.stringify(m.tool_calls || []).length, 0);

/**
 * Après une coupure, chaque tool_call annoncé doit avoir une réponse, sinon
 * l'API refuse l'historique.
 */
export function closeDanglingToolCalls(history: APIMessage[]): void {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue;
    const answeredIds = new Set(history.slice(i + 1).filter((x) => x.role === 'tool').map((x) => x.tool_call_id));
    for (const call of m.tool_calls) {
      if (!answeredIds.has(call.id)) {
        history.push({ role: 'tool', tool_call_id: call.id, content: 'Interrompu par une coupure. Relance cet outil si son résultat est nécessaire.' });
      }
    }
    return;
  }
}
