/**
 * Fin d'un tour : réponse finale, coût réel, journal, ou chemin d'erreur avec reprise.
 *
 * Extrait de `turn.ts` pour que l'enchaînement d'un tour se lise d'un bloc : le tour décide
 * quand il a fini, ce module décide comment le terminer (message, coût, persistance, reprise).
 */
import type { AIModel, APIMessage, Message, TimelineItem, ToolEvent } from '@/types';
import { closeDanglingToolCalls } from '@/services/agent/engine/history';
import type { AgentStopReason } from '@/services/agent/engine/agentSession';
import { snapshotTimeline } from '@/services/agent/engine/chatSession';
import { collectChanges, type FileChange, type Snapshots } from '@/services/agent/tools/fileChanges';
import { endTurn } from '@/services/workspace/gitChanges';
import type { Route } from '@/services/ai/autoRouter';
import type { ServerCost, UsageRecord } from './turnAccounting';
import { finalizeTurnCost, needsSettleDelay, settleDelay } from './turnAccounting';

/**
 * Changements du tour : git d'abord (il voit aussi ce que les commandes ont modifié),
 * snapshots d'outils en repli (git indisponible, stockage absent, projet illisible).
 */
async function turnChanges(
  assistantId: string, agentRoot: string | null, snapshots: Snapshots,
): Promise<FileChange[] | undefined> {
  if (!agentRoot) return undefined;
  try {
    return await endTurn(agentRoot);
  } catch {
    return collectChanges(assistantId, agentRoot, snapshots).catch(() => undefined);
  }
}
import { refreshCredits } from '@/lib/credits';
import type { AgentChatResult } from './turnTypes';
import type { SessionEvent } from './sessionStore';

/** Ce que la fin d'un tour a besoin de connaître du tour lui-même. */
export interface TurnEndBase {
  apiHistory: APIMessage[];
  assistantId: string;
  convId: string;
  agentRoot: string | null;
  events: ToolEvent[];
  timeline: TimelineItem[];
  snapshots: Snapshots;
  content: string;
  reasoning: string;
  promptTokens: number;
  completionTokens: number;
  cost: ServerCost;
  balanceBefore: number | null;
  model: AIModel;
  startedAt: number;
  updateMessage: (id: string, patch: Partial<Message>) => void;
  recordSessionEvent: (conversationId: string, event: SessionEvent) => void;
  persist: () => void;
}

export interface FinishTurnInput extends TurnEndBase {
  /** Longueur de l'historique avant l'appel au moteur (pour ne pas dupliquer la réponse). */
  historyLengthBeforeEngine: number;
  stopReason: AgentStopReason;
  aborted: boolean;
  addUsage: (record: UsageRecord) => void;
  addUsageRecord: (record: UsageRecord) => void;
}

/**
 * Termine un tour normalement : réponse, coût, journal, résultat structuré.
 * Une erreur de comptabilité ne doit jamais faire échouer la réponse.
 */
export async function finishTurn(input: FinishTurnInput): Promise<AgentChatResult> {
  const {
    apiHistory, historyLengthBeforeEngine, assistantId, convId, agentRoot,
    events, timeline, snapshots, content, reasoning, promptTokens, completionTokens,
    cost, balanceBefore, model, startedAt, updateMessage, recordSessionEvent, persist,
  } = input;

  // Interruption utilisateur : la réponse partielle est marquée comme telle
  // (sinon le modèle croit avoir terminé et l'utilisateur voit une coupe sans signe).
  const finalContent = input.aborted
    ? (content ? `${content}\n\n_(interrompu)_` : '_(génération interrompue)_')
    : content;

  // Réponse finale dans l'historique API. Le moteur a déjà ajouté le message
  // assistant de la dernière étape : on le remplace au lieu de le dupliquer.
  const lastApiMessage = apiHistory[apiHistory.length - 1];
  if (
    apiHistory.length > historyLengthBeforeEngine
    && lastApiMessage?.role === 'assistant'
    && !lastApiMessage.tool_calls?.length
  ) {
    lastApiMessage.content = finalContent;
  } else {
    apiHistory.push({ role: 'assistant', content: finalContent });
  }

  // La réponse est terminée : on l'affiche tout de suite, sans attendre la comptabilité.
  const changes = await turnChanges(assistantId, agentRoot, snapshots);
  updateMessage(assistantId, {
    content: finalContent,
    timeline: snapshotTimeline(timeline),
    reasoning: reasoning ? [reasoning] : undefined,
    isStreaming: false,
    tokens: { prompt: promptTokens, completion: completionTokens },
    notice: undefined,
    resumable: false,
    toolEvents: [...events],
    fileChanges: changes,
  });

  let costFCFA: number | undefined;
  try {
    // Sans coûts exacts, on laisse au serveur le temps d'enregistrer le dernier appel.
    if (needsSettleDelay(cost)) await settleDelay();
    const balanceAfter = await refreshCredits();
    const finalized = finalizeTurnCost({
      cost,
      promptTokens,
      completionTokens,
      balanceBefore,
      balanceAfter,
      model,
      startedAt,
    });
    costFCFA = finalized.costFCFA;
    updateMessage(assistantId, { costFCFA: finalized.costFCFA });
    // Solde déjà synchronisé depuis le serveur → on journalise sans redébiter.
    if (finalized.fromServer) input.addUsageRecord(finalized.record);
    else input.addUsage(finalized.record);
  } catch (err) {
    console.warn('[agent] comptabilité du coût impossible', err);
  }

  const stopReason = input.aborted ? 'aborted' : input.stopReason;
  recordSessionEvent(convId, { type: 'done', stopReason, costFCFA });
  persist();
  return {
    stopReason,
    content: finalContent,
    costFCFA,
    filesChanged: changes?.map((c) => c.path) ?? [],
    isError: false,
    conversationId: convId,
    assistantId,
  };
}

export interface FailTurnInput extends TurnEndBase {
  error: unknown;
  aborted: boolean;
  /** Coût déjà calculé, si l'échec survient après la comptabilité. */
  costFCFA?: number;
  /** Mode Auto en cours, conservé pour la reprise. */
  route: Route | null;
  setResumeState: (state: import('./turnTypes').ResumeState | null) => void;
}

/** Termine un tour en erreur : message clair, historique valide, état de reprise. */
export async function failTurn(input: FailTurnInput): Promise<AgentChatResult> {
  const {
    apiHistory, assistantId, convId, agentRoot, events, timeline, snapshots,
    content, promptTokens, completionTokens, cost, balanceBefore, updateMessage,
    recordSessionEvent, persist, aborted,
  } = input;
  const message = String((input.error as any)?.message || input.error || 'service indisponible');

  recordSessionEvent(convId, aborted
    ? { type: 'done', stopReason: 'aborted' }
    : { type: 'error', message: message.slice(0, 300) });
  // L'historique reste valide pour « continue », même après un redémarrage.
  closeDanglingToolCalls(apiHistory);
  persist();
  // On garde de quoi reprendre exactement ici (bouton « Reprendre »)
  input.setResumeState(aborted ? null : {
    convId, assistantId, accContent: content, timeline: snapshotTimeline(timeline), events, snapshots,
    promptTokens, completionTokens, balanceBefore, cost, route: input.route,
  });

  const errorText = aborted
    ? '_(interrompu)_'
    : `**Erreur** — ${message}. Le travail déjà fait est conservé : clique sur « Reprendre » quand la connexion est revenue.`;
  const errorContent = aborted
    ? (content ? `${content}\n\n_(interrompu)_` : '_(génération interrompue)_')
    : `${content ? content + '\n\n' : ''}**Erreur** — ${message}. Le travail déjà fait est conservé : clique sur « Reprendre » quand la connexion est revenue.`;
  const errorChanges = await turnChanges(assistantId, agentRoot, snapshots);
  updateMessage(assistantId, {
    notice: undefined,
    resumable: !aborted,
    content: errorContent,
    timeline: [...snapshotTimeline(timeline), { kind: 'text', text: errorText }],
    isStreaming: false,
    isError: !aborted,
    toolEvents: [...events],
    fileChanges: errorChanges,
  });
  return {
    stopReason: aborted ? 'aborted' : 'error',
    content: errorContent,
    costFCFA: input.costFCFA,
    filesChanged: errorChanges?.map((c) => c.path) ?? [],
    isError: !aborted,
    conversationId: convId,
    assistantId,
  };
}
