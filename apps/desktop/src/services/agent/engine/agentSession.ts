/**
 * Moteur de session agent générique.
 *
 * Il ne connaît ni React, ni les stores, ni les outils concrets : le modèle est
 * fourni par `stream`, les outils par `executeTool`, et la vérification par
 * `verify`. Les deux boucles d'ANZAR (chat principal et sous-agents) sont des
 * adaptateurs de ce moteur.
 */
import type { APIMessage, StreamDelta, ToolCall, ToolDefinition } from '@/types';
import { ToolCallAssembler } from './toolCallAssembler';

export type AgentStopReason =
  | 'task_done'
  | 'final_answer'
  | 'plan'
  | 'max_steps'
  | 'verify_failed'
  | 'aborted'
  | 'error';

export interface AgentToolOutcome {
  output: string;
  isError?: boolean;
  isDone?: boolean;
  /** Interrompt la session après avoir répondu à l'appel (mode plan). */
  stop?: 'plan';
  images?: { label: string; dataUrl: string }[];
  media?: { path: string; kind: 'video' | 'image' };
  costFCFA?: number;
}

export interface AgentRetryPolicy {
  /** Nombre de nouvelles tentatives après la première. */
  attempts: number;
  delayMs: (attempt: number) => number;
  isRetryable: (error: unknown) => boolean;
}

export interface AgentSessionOptions {
  /** Historique mutable : le moteur y ajoute ses messages. */
  messages: APIMessage[];
  tools?: ToolDefinition[] | (() => ToolDefinition[] | undefined);
  /** Si fourni, seuls ces outils peuvent être appelés (défense en profondeur). */
  allowedTools?: Set<string>;
  stream: (
    messages: APIMessage[],
    tools: ToolDefinition[] | undefined,
  ) => AsyncGenerator<StreamDelta, void, undefined>;
  executeTool: (call: ToolCall, step: number) => Promise<AgentToolOutcome>;
  maxSteps?: number;
  maxConsecutiveErrors?: number;
  signal?: AbortSignal;
  retry?: AgentRetryPolicy;
  verify?: () => Promise<{ passed: boolean; failureSummary: string }>;
  shouldVerify?: () => boolean;
  maxVerifyAttempts?: number;
  shouldNudge?: () => boolean;
  nudgeMessage?: string;
  /** Appelé avant chaque appel modèle (compaction, estimation de tokens…). */
  beforeStep?: (messages: APIMessage[], step: number) => void | Promise<void>;
  onStepStart?: (step: number) => void;
  onTextDelta?: (text: string, step: number) => void;
  onReasoningDelta?: (text: string, step: number) => void;
  onStepEnd?: (info: { step: number; text: string; reasoning: string; toolCalls: ToolCall[] }) => void;
  onToolCall?: (call: ToolCall, step: number) => void;
  onToolResult?: (call: ToolCall, outcome: AgentToolOutcome, step: number) => void;
  onImages?: (images: NonNullable<AgentToolOutcome['images']>, step: number) => void;
  /** Après tous les tool_calls d'une étape (ex. injecter les captures d'écran). */
  onToolBatchEnd?: (step: number) => void;
  onCostDelta?: (costFCFA: number) => void;
  onRetry?: (attempt: number, delayMs: number, error: unknown, step: number) => void;
  onError?: (message: string, step: number) => void;
  onVerifyStart?: (attempt: number, maxAttempts: number) => void;
  onVerifyResult?: (passed: boolean, failureSummary: string) => void;
}

export interface AgentEngineResult {
  stopReason: AgentStopReason;
  summary: string;
  steps: number;
  messages: APIMessage[];
  errorMessage?: string;
}

const DEFAULT_NUDGE =
  "Tu as modifié des fichiers mais tu n'as pas appelé task_done. Vérifie ton travail puis appelle task_done avec un résumé. Si la tâche n'est pas finie, continue.";

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export const DEFAULT_MAX_STEPS = 40;

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function runAgentEngine(options: AgentSessionOptions): Promise<AgentEngineResult> {
  const {
    messages,
    allowedTools,
    maxSteps = DEFAULT_MAX_STEPS,
    maxConsecutiveErrors = 4,
    signal,
    retry,
    verify,
    shouldVerify,
    maxVerifyAttempts = 3,
    onStepStart,
    onTextDelta,
    onReasoningDelta,
    onStepEnd,
    onToolCall,
    onToolResult,
    onImages,
    onToolBatchEnd,
    onCostDelta,
    onRetry,
    onError,
    onVerifyStart,
    onVerifyResult,
  } = options;

  const toolsFor: () => ToolDefinition[] | undefined =
    typeof options.tools === 'function'
      ? (options.tools as () => ToolDefinition[] | undefined)
      : () => options.tools as ToolDefinition[] | undefined;
  let consecutiveErrors = 0;
  let nudged = false;
  let verifyAttempts = 0;

  const finish = (stopReason: AgentStopReason, summary: string, steps: number, error?: string): AgentEngineResult => ({
    stopReason,
    summary,
    steps,
    messages,
    ...(error ? { errorMessage: error } : {}),
  });

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) return finish('aborted', 'Session annulée.', step - 1);

    onStepStart?.(step);
    await options.beforeStep?.(messages, step);

    let assembler = new ToolCallAssembler();
    let text = '';
    let reasoning = '';
    let streamFailure: string | null = null;

    // Une étape coupée est réessayée seule : l'historique reste intact.
    for (let attempt = 0; ; attempt++) {
      assembler = new ToolCallAssembler();
      text = '';
      reasoning = '';
      try {
        const stream = options.stream(messages, toolsFor());
        for await (const delta of stream) {
          if (signal?.aborted) break;
          if (delta.serverCostFCFA !== undefined) {
            onCostDelta?.(delta.serverCostFCFA);
            continue;
          }
          if (delta.content) {
            text += delta.content;
            onTextDelta?.(delta.content, step);
          }
          if (delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            onReasoningDelta?.(delta.reasoning_content, step);
          }
          if (delta.tool_calls?.length) assembler.add(delta.tool_calls);
        }
        streamFailure = null;
        break;
      } catch (e) {
        if (signal?.aborted) return finish('aborted', 'Session annulée.', step);
        const message = errorMessage(e);
        onError?.(message, step);
        if (retry && attempt < retry.attempts && retry.isRetryable(e)) {
          const delay = retry.delayMs(attempt);
          onRetry?.(attempt + 1, delay, e, step);
          await sleepAbortable(delay, signal);
          continue;
        }
        streamFailure = message;
        break;
      }
    }

    if (signal?.aborted) return finish('aborted', 'Session annulée.', step);
    if (streamFailure) return finish('error', `Erreur du modèle : ${streamFailure}`, step, streamFailure);

    const toolCalls = assembler.finish();
    onStepEnd?.({ step, text, reasoning, toolCalls });

    // ── Réponse texte sans outil ──
    if (toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: text || null });
      if (!nudged && options.shouldNudge?.()) {
        nudged = true;
        messages.push({ role: 'user', content: options.nudgeMessage || DEFAULT_NUDGE });
        continue;
      }
      return finish('final_answer', text || 'Réponse terminée.', step);
    }

    // ── Exécution des tool_calls ──
    messages.push({
      role: 'assistant',
      content: text || null,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      tool_calls: toolCalls,
    });

    let doneSummary: string | null = null;

    for (const call of toolCalls) {
      if (signal?.aborted) return finish('aborted', 'Session annulée.', step);
      onToolCall?.(call, step);
      let outcome: AgentToolOutcome;
      if (allowedTools && !allowedTools.has(call.function.name)) {
        outcome = {
          output: `Outil non autorisé pour cette session : ${call.function.name}.`,
          isError: true,
        };
      } else {
        try {
          outcome = await options.executeTool(call, step);
        } catch (e) {
          outcome = { output: `Erreur outil : ${errorMessage(e)}`, isError: true };
        }
      }
      onToolResult?.(call, outcome, step);

      messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.output || '(vide)' });
      if (outcome.images?.length) onImages?.(outcome.images, step);
      if (outcome.costFCFA) onCostDelta?.(outcome.costFCFA);

      if (outcome.stop === 'plan') {
        return finish('plan', outcome.output, step);
      }
      if (outcome.isDone) {
        doneSummary = outcome.output;
        continue;
      }

      consecutiveErrors = outcome.isError ? consecutiveErrors + 1 : 0;
      if (maxConsecutiveErrors > 0 && consecutiveErrors >= maxConsecutiveErrors) {
        return finish('error', 'Trop d’erreurs consécutives — session interrompue pour éviter une boucle infinie.', step);
      }
    }

    onToolBatchEnd?.(step);

    if (doneSummary !== null) {
      const needsVerify = verify && (shouldVerify ? shouldVerify() : true);
      if (!needsVerify) return finish('task_done', doneSummary, step);

      verifyAttempts++;
      onVerifyStart?.(verifyAttempts, maxVerifyAttempts);
      let report: { passed: boolean; failureSummary: string };
      try {
        report = await verify!();
      } catch (e) {
        report = { passed: false, failureSummary: errorMessage(e) };
      }
      onVerifyResult?.(report.passed, report.failureSummary);

      if (report.passed) return finish('task_done', doneSummary, step);
      if (verifyAttempts >= maxVerifyAttempts) {
        return finish(
          'verify_failed',
          `La vérification échoue toujours après ${verifyAttempts} tentatives de correction.\n\n${report.failureSummary.slice(0, 2000)}`,
          step,
        );
      }

      messages.push({
        role: 'user',
        content:
          `⚠️ task_done REFUSÉ — la vérification automatique a échoué (tentative ${verifyAttempts}/${maxVerifyAttempts}).\n\n` +
          `${report.failureSummary}\n\n` +
          `Analyse ces erreurs, corrige les fichiers concernés, puis rappelle task_done. ` +
          `La vérification sera relancée automatiquement.`,
      });
    }
  }

  return finish('max_steps', `Budget d'étapes épuisé (${maxSteps}). Relance l'agent pour continuer.`, maxSteps);
}
