/**
 * AgentLoop — Boucle agentique tool-use d'ANZAR (cœur de la Phase 1)
 *
 * Principe (style Claude Code) :
 *   1. Appel du modèle (via backend proxy, streaming SSE) avec les outils
 *   2. Le modèle répond avec du texte et/ou des tool_calls
 *   3. Les tool_calls sont exécutés localement (FS Tauri + shell allowlisté)
 *   4. Les résultats sont réinjectés (role: tool) et on boucle
 *   5. Fin quand l'agent répond sans demander d'outil (ou appelle task_done), budget épuisé, ou annulation
 *
 * Sécurité :
 *   - Checkpoint git automatique avant la session (rollback en 1 clic)
 *   - Budgets stricts : étapes, erreurs consécutives, taille de l'historique
 */

import { APIMessage, AIModel, AIProvider, ReasoningEffort } from '@/types';
import { aiService } from '@/services/ai/ai';
import { terminalService } from '@/services/runtime/terminal';
import { AGENT_TOOLS, executeToolCall, ToolExecutionContext, ToolResult } from '../tools';
import { buildAgentSystemPrompt, taskHintsSection, AgentPromptContext } from '../context/agentPrompts';
import { runVerification, VerifyCommandResult } from '../verify/agentVerifier';
import { buildAgentContext } from '../context/agentContext';
import { DEFAULT_MAX_STEPS, runAgentEngine, type AgentStopReason } from './agentSession';
export type { AgentStopReason } from './agentSession';
import { compactHistory, historyChars, SOFT_LIMIT_CHARS } from './history';
import { estimateCompletionTokens, estimateHistoryTokens } from './chatSession';
import type { BudgetLedger } from './budget';

// ============================================================================
// TYPES
// ============================================================================

export type AgentEvent =
  | { type: 'step_start'; step: number; maxSteps: number }
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; step: number; name: string; args: Record<string, any>; callId: string }
  | { type: 'tool_result'; step: number; name: string; callId: string; output: string; isError: boolean }
  | { type: 'checkpoint'; commitMessage: string }
  | { type: 'context_ready'; totalFiles: number; totalSymbols: number; indexMs: number; hasMemory: boolean }
  | { type: 'verify_start'; attempt: number; maxAttempts: number }
  | { type: 'verify_command'; label: string; command: string }
  | { type: 'verify_result'; label: string; command: string; passed: boolean; skipped: boolean; output: string }
  | { type: 'done'; reason: AgentStopReason; summary: string; steps: number }
  | { type: 'error'; message: string };

export interface AgentLoopOptions {
  /** Contexte projet pour le system prompt */
  prompt: AgentPromptContext;
  /** Tâche demandée par l'utilisateur */
  task: string;
  /** Historique de conversation précédent (optionnel, pour le suivi multi-tours) */
  history?: APIMessage[];
  /** Modèle ('fast' par défaut — 'thinking' pour les tâches complexes) */
  model?: AIModel;
  /** Effort de réflexion demandé par le profil du rôle. */
  reasoningEffort?: ReasoningEffort;
  provider?: AIProvider;
  /** Nombre max d'itérations de la boucle (défaut: 40) */
  maxSteps?: number;
  /** Checkpoint git automatique avant de commencer (défaut: true) */
  gitCheckpoint?: boolean;
  /**
   * Vérification automatique en fin de tour (défaut: false ; le chat principal la pilote
   * via le réglage autoVerifyAfterApply). Si lint/build/tests échouent, la réponse est
   * refusée et les erreurs sont réinjectées à l'agent (boucle Verify→Fix→Verify).
   */
  autoVerify?: boolean;
  /** Nombre max de cycles vérification-correction (défaut: 3) */
  maxVerifyAttempts?: number;
  /** Prompt système additionnel (rôle du sous-agent, skills injectées…) */
  systemPromptExtra?: string;
  /** Outils autorisés pour cette session (sous-agents hors Full). */
  allowedTools?: Set<string>;
  /** Profondeur de récursion des sous-agents (0 = agent principal). */
  subagentDepth?: number;
  /** Budget du sous-agent (enveloppe dérivée du parent). */
  budget?: BudgetLedger;
  /** Callback événements (UI) */
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
  /** Callback fichier modifié (rafraîchissement UI) */
  onFileChanged?: ToolExecutionContext['onFileChanged'];
}

export interface AgentSessionResult {
  stopReason: AgentStopReason;
  summary: string;
  steps: number;
  /** Historique complet (réutilisable pour un tour suivant) */
  messages: APIMessage[];
  filesChanged: string[];
}

// ============================================================================
// LIMITES
// ============================================================================

// Plus de plafond d'échecs dans la boucle : le budget d'étapes et le rappel de boucle
// suffisent. Un test qui échoue plusieurs fois pendant une correction est normal.
const MAX_CONSECUTIVE_ERRORS = 0;

// ============================================================================
// CHECKPOINT GIT
// ============================================================================

async function createCheckpoint(projectRoot: string, task: string): Promise<string | null> {
  try {
    const isRepo = await terminalService.gitIsRepo(projectRoot);
    if (!isRepo) {
      await terminalService.gitInit(projectRoot);
    }
    const label = `ANZAR checkpoint — avant: ${task.slice(0, 60).replace(/\n/g, ' ')}`;
    const result = await terminalService.gitCommit(projectRoot, label);
    return result.success ? label : null;
  } catch {
    return null; // Non bloquant : la session continue sans checkpoint
  }
}

// ============================================================================
// SESSION AGENT
// ============================================================================

export async function runAgentSession(options: AgentLoopOptions): Promise<AgentSessionResult> {
  const {
    prompt,
    task,
    history = [],
    model = 'fast',
    reasoningEffort,
    provider = 'deepseek',
    maxSteps = DEFAULT_MAX_STEPS,
    budget,
    gitCheckpoint = true,
    autoVerify = false,
    maxVerifyAttempts = 3,
    onEvent,
    signal,
    onFileChanged,
    subagentDepth,
  } = options;

  const emit = (e: AgentEvent) => onEvent?.(e);
  const filesChanged = new Set<string>();

  const toolCtx: ToolExecutionContext = {
    projectRoot: prompt.projectRoot,
    signal,
    subagentDepth,
    runSubagent: runAgentSession,
    onFileChanged: (path, content, action) => {
      filesChanged.add(path);
      onFileChanged?.(path, content, action);
    },
  };

  // ─── Checkpoint git avant toute modification ───
  if (gitCheckpoint) {
    const label = await createCheckpoint(prompt.projectRoot, task);
    if (label) emit({ type: 'checkpoint', commitMessage: label });
  }

  // ─── Contexte intelligent : code map + hints + mémoire ANZAR.md (Phase 3) ───
  let effectivePrompt = prompt;
  if (!prompt.codeMap) {
    const ctx = await buildAgentContext(prompt.projectRoot, task);
    effectivePrompt = {
      ...prompt,
      codeMap: ctx.codeMap || undefined,
      taskHints: ctx.taskHints || undefined,
      memory: prompt.memory || ctx.memory || undefined,
    };
    emit({
      type: 'context_ready',
      totalFiles: ctx.stats.totalFiles,
      totalSymbols: ctx.stats.totalSymbols,
      indexMs: ctx.stats.indexMs,
      hasMemory: !!ctx.memory,
    });
  }

  // ─── Construction des messages ───
  const messages: APIMessage[] = [
    { role: 'system', content: buildAgentSystemPrompt(effectivePrompt) + (options.systemPromptExtra || '') },
    ...history,
    { role: 'user', content: task + taskHintsSection(effectivePrompt.taskHints) },
  ];

  const result = await runAgentEngine({
    messages,
    tools: options.allowedTools
      ? AGENT_TOOLS.filter((t) => options.allowedTools!.has(t.function.name))
      : AGENT_TOOLS,
    allowedTools: options.allowedTools,
    maxSteps,
    budget,
    maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
    signal,
    beforeStep: (msgs) => {
      // Compaction rare et en une fois, compatible avec le cache fournisseur.
      if (historyChars(msgs) > SOFT_LIMIT_CHARS) compactHistory(msgs, 6, 160);
      budget?.charge({ tokensIn: estimateHistoryTokens(msgs) });
    },
    stream: (msgs, tools) => aiService.chatStream(msgs, {
      model, provider, tools, signal, ...(reasoningEffort ? { reasoningEffort } : {}),
    }),
    executeTool: async (call) => {
      const r: ToolResult = await executeToolCall(call, toolCtx);
      return {
        output: r.output,
        isError: r.isError,
        isDone: r.isDone,
        images: r.images,
        media: r.media,
        costFCFA: r.costFCFA,
      };
    },
    retry: {
      attempts: 3,
      delayMs: (attempt) => 1500 * (attempt + 1),
      isRetryable: () => true,
    },
    verify: async () => {
      const report = await runVerification(prompt.projectRoot, {
        signal,
        onCommandStart: (cmd) => emit({ type: 'verify_command', label: cmd.label, command: cmd.command }),
        onCommandResult: (r: VerifyCommandResult) =>
          emit({
            type: 'verify_result',
            label: r.label,
            command: r.command,
            passed: r.passed,
            skipped: r.skipped,
            output: r.output,
          }),
      });
      return { passed: report.passed, failureSummary: report.failureSummary };
    },
    shouldVerify: () => autoVerify && filesChanged.size > 0,
    maxVerifyAttempts,
    onStepStart: (step) => emit({ type: 'step_start', step, maxSteps }),
    onTextDelta: (content) => emit({ type: 'text', content }),
    onReasoningDelta: (content) => emit({ type: 'reasoning', content }),
    onStepEnd: ({ text, toolCalls }) => budget?.charge({ tokensOut: estimateCompletionTokens(text, toolCalls) }),
    onCostDelta: (cost) => budget?.charge({ fcfa: cost }),
    onToolCall: (call, step) => {
      let args: Record<string, any> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        /* executeToolCall gère l'erreur de parsing */
      }
      emit({ type: 'tool_call', step, name: call.function.name, args, callId: call.id });
    },
    onToolResult: (call, outcome, step) =>
      emit({
        type: 'tool_result',
        step,
        name: call.function.name,
        callId: call.id,
        output: outcome.output,
        isError: !!outcome.isError,
      }),
    onError: (message) => emit({ type: 'error', message }),
    onVerifyStart: (attempt, maxAttempts) => emit({ type: 'verify_start', attempt, maxAttempts }),
  });

  const summary = result.stopReason === 'max_steps'
    ? `Budget d'étapes épuisé (${maxSteps}). Fichiers modifiés: ${[...filesChanged].join(', ') || 'aucun'}. Relance l'agent pour continuer.`
    : result.summary;

  emit({ type: 'done', reason: result.stopReason, summary, steps: result.steps });
  return {
    stopReason: result.stopReason,
    summary,
    steps: result.steps,
    messages,
    filesChanged: [...filesChanged],
  };
}
