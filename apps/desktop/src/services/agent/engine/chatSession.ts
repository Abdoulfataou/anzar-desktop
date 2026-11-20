/**
 * Chronologie et comptabilité d'une session de chat, sans React ni Tauri.
 * L'adaptateur garde l'état (tableaux) et appelle ces fonctions pures.
 */
import type { APIMessage, TimelineItem } from '@/types';

export const estimateHistoryTokens = (messages: APIMessage[]): number =>
  Math.ceil(messages.reduce((n, m) => n + (m.content?.length || 0) + JSON.stringify(m.tool_calls || []).length, 0) / 4);

export const estimateCompletionTokens = (text: string, toolCalls: unknown): number =>
  Math.ceil((text.length + JSON.stringify(toolCalls || []).length) / 4);

/** Ajoute un morceau de texte à la chronologie (ignore le vide). */
export function appendTimelineText(timeline: TimelineItem[], text: string): void {
  if (text.trim()) timeline.push({ kind: 'text', text });
}

/** Ajoute un outil au dernier groupe d'actions, ou en crée un. */
export function appendTimelineTool(timeline: TimelineItem[], id: string): void {
  const last = timeline[timeline.length - 1];
  if (last?.kind === 'tools') last.ids = [...last.ids, id];
  else timeline.push({ kind: 'tools', ids: [id] });
}

/** Copie sérialisable de la chronologie, avec le texte en cours d'écriture. */
export function snapshotTimeline(timeline: TimelineItem[], liveText = ''): TimelineItem[] {
  const copy = timeline.map((t) => (t.kind === 'tools' ? { kind: 'tools' as const, ids: [...t.ids] } : { ...t }));
  if (liveText.trim()) copy.push({ kind: 'text', text: liveText });
  return copy;
}

export interface SessionCostInput {
  serverCostSum: number;
  serverCostReports: number;
  serverModelCalls: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
  promptTokens: number;
  completionTokens: number;
  priceInPerMillion: number;
  priceOutPerMillion: number;
}

export interface SessionCostResult {
  costFCFA: number;
  fromServer: boolean;
  exact: boolean;
  estimate: number;
}

/** Vrai si le serveur a envoyé un coût exact pour chaque appel modèle. */
export const hasExactCost = (reports: number, calls: number): boolean => reports > 0 && reports >= calls;

/**
 * Coût réel : coûts exacts du serveur s'ils sont complets, sinon écart de solde,
 * sinon estimation locale (FCFA par million de tokens).
 */
export function computeSessionCost(input: SessionCostInput): SessionCostResult {
  const estimate = Math.round(
    (input.promptTokens / 1_000_000) * input.priceInPerMillion
    + (input.completionTokens / 1_000_000) * input.priceOutPerMillion,
  );
  const exact = hasExactCost(input.serverCostReports, input.serverModelCalls);
  const fromServer = exact || (input.balanceBefore !== null && input.balanceAfter !== null);
  const costFCFA = exact
    ? Math.round(input.serverCostSum * 100) / 100
    : fromServer
      ? Math.max(0, Math.round((input.balanceBefore! - input.balanceAfter!) * 100) / 100)
      : estimate;
  return { costFCFA, fromServer, exact, estimate };
}
