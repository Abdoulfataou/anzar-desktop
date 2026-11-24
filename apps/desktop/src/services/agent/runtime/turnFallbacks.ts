/**
 * Chemins de repli d'un tour, quand la boucle principale s'arrête sans réponse :
 *
 * - `runExportRescue` : la demande porte sur une animation/vidéo et aucun export n'a
 *   réussi — une dernière passe où seul `export_animation` est permis (mode Full) ;
 * - `runForcedFinalAnswer` : budget d'étapes épuisé — une réponse finale sans outil.
 *
 * Le sink fourni par l'appelant porte l'affichage et la comptabilité : ce module ne
 * connaît ni React, ni les stores, ni la classe AgentRunner.
 */
import type { AIModel, APIMessage, ToolCall, ToolEvent } from '@/types';
import { aiService } from '@/services/ai/ai';
import { AGENT_TOOLS } from '@/services/agent/tools';
import { runAgentEngine, type AgentToolOutcome } from '../engine/agentSession';
import { estimateCompletionTokens, estimateHistoryTokens } from '../engine/chatSession';

/** Effets d'affichage et de comptabilité d'un tour, fournis par l'adaptateur. */
export interface TurnSink {
  /** Ajoute du texte à la réponse et à la chronologie. */
  appendContent(text: string): void;
  /** Réaffiche l'état courant du message. */
  flush(): void;
  /** Réaffiche le texte en cours d'écriture (throttlé par l'appelant). */
  flushLive(text: string): void;
  /** Déclare un nouvel événement d'outil (affichage). */
  addToolEvent(event: ToolEvent): void;
  /** Ajoute un coût d'appel modèle (FCFA) au tour et compte le rapport de coût. */
  addModelCost(cost: number): void;
  /** Un appel au modèle de plus : comptabilité et fraîcheur du cache. */
  onModelCall(): void;
  addPromptTokens(tokens: number): void;
  addCompletionTokens(tokens: number): void;
}

// ============================================================================
// GARANTIE D'EXPORT (motion)
// ============================================================================

export interface ExportRescueInput {
  apiHistory: APIMessage[];
  signal: AbortSignal;
  callModel: () => AIModel;
  sink: TurnSink;
  /**
   * Exécution d'un outil : **l'hôte d'outils du tour**, pas un exécuteur direct. Le sauvetage
   * passe donc par la même politique d'approbation, les mêmes événements et le même budget
   * que la boucle principale — il n'en est qu'une variante à outils restreints.
   */
  executeTool: (call: ToolCall, step: number) => Promise<AgentToolOutcome>;
  /** Affichage d'un appel d'outil (même callback que la boucle principale). */
  onToolCall: (call: ToolCall, step: number) => void;
}

const EXPORT_ONLY = AGENT_TOOLS.filter((t) => t.function.name === 'export_animation');

/**
 * La tâche porte sur des animations/vidéos et AUCUN export n'a réussi (budget brûlé en
 * retouches) → UNE passe supplémentaire où seul export_animation est permis, avant la
 * synthèse finale. La vidéo doit toujours être livrée.
 *
 * Le sauvetage n'est déclenché qu'en mode Full (décidé par l'appelant) : c'est une variante
 * de la boucle principale, pas un chemin d'exécution parallèle.
 */
export async function runExportRescue(input: ExportRescueInput): Promise<{ answered: boolean }> {
  const { apiHistory, signal, sink } = input;
  let rescueText = '';

  apiHistory.push({
    role: 'user',
    content:
      "BUDGET D'ÉTAPES ÉPUISÉ — SAUF pour exporter. Appelle MAINTENANT export_animation pour CHAQUE animation " +
      "ou vidéo demandée (la vidéo doit être livrée), puis conclus en texte. Aucune autre modification : " +
      "la version actuelle des pages fait foi.",
  });

  const rescue = await runAgentEngine({
    messages: apiHistory,
    tools: EXPORT_ONLY,
    allowedTools: new Set(['export_animation']),
    maxSteps: 4,
    maxConsecutiveErrors: 0,
    signal,
    stream: (messages, tools) => aiService.chatStream(messages, { model: input.callModel(), tools, signal }),
    onStepStart: () => { rescueText = ''; },
    onTextDelta: (text) => { rescueText += text; sink.flushLive(rescueText); },
    onStepEnd: ({ text }) => {
      if (text) sink.appendContent(text);
      sink.onModelCall();
      rescueText = '';
      sink.flush();
    },
    onCostDelta: (c) => sink.addModelCost(c),
    onToolCall: (call, step) => input.onToolCall(call, step),
    executeTool: (call, step) => input.executeTool(call, step),
  });

  // Conclusion écrite pendant le sauvetage : inutile de forcer une synthèse en plus.
  return { answered: rescue.stopReason === 'final_answer' };
}

// ============================================================================
// SYNTHÈSE FORCÉE (budget d'étapes épuisé)
// ============================================================================

export interface FinalAnswerInput {
  apiHistory: APIMessage[];
  signal: AbortSignal;
  callModel: () => AIModel;
  sink: TurnSink;
}

/** Limite d'étapes atteinte sans réponse → synthèse forcée, sans outils. */
export async function runForcedFinalAnswer(input: FinalAnswerInput): Promise<void> {
  const { apiHistory, signal, sink } = input;
  sink.addPromptTokens(estimateHistoryTokens(apiHistory));
  apiHistory.push({
    role: 'user',
    content:
      "Limite d'étapes atteinte. N'utilise plus aucun outil. Donne maintenant ta réponse finale complète, " +
      "dans la langue de tes réponses précédentes, à partir de ce que tu as déjà lu. Si le travail est incomplet, dis précisément ce qui reste.",
  });
  let finalText = '';
  for await (const delta of aiService.chatStream(apiHistory, { model: input.callModel(), signal })) {
    if (delta.serverCostFCFA !== undefined) { sink.addModelCost(delta.serverCostFCFA); continue; }
    if (delta.content) {
      finalText += delta.content;
      sink.flushLive(finalText);
    }
  }
  sink.onModelCall();
  if (finalText) sink.appendContent(finalText);
  sink.addCompletionTokens(estimateCompletionTokens(finalText, []));
}
