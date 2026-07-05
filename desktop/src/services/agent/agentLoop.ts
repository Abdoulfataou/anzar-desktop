/**
 * AgentLoop — Boucle agentique tool-use d'ANZAR (cœur de la Phase 1)
 *
 * Principe (style Claude Code) :
 *   1. Appel du modèle (via backend proxy, streaming SSE) avec les outils
 *   2. Le modèle répond avec du texte et/ou des tool_calls
 *   3. Les tool_calls sont exécutés localement (FS Tauri + shell allowlisté)
 *   4. Les résultats sont réinjectés (role: tool) et on boucle
 *   5. Fin quand l'agent appelle task_done, ou budget épuisé, ou annulation
 *
 * Sécurité :
 *   - Checkpoint git automatique avant la session (rollback en 1 clic)
 *   - Budgets stricts : étapes, erreurs consécutives, taille de l'historique
 */

import { APIMessage, ToolCall, AIModel, AIProvider } from '@/types';
import { aiService } from '@/services/ai/ai';
import { terminalService } from '@/services/terminal';
import { AGENT_TOOLS, executeToolCall, ToolExecutionContext, ToolResult } from './agentTools';
import { buildAgentSystemPrompt, AgentPromptContext } from './agentPrompts';
import { runVerification, VerifyCommandResult } from './agentVerifier';
import { buildAgentContext } from './agentContext';

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

export type AgentStopReason =
  | 'task_done'        // L'agent a appelé task_done (et la vérification est passée)
  | 'final_answer'     // L'agent a répondu sans outil (réponse conversationnelle)
  | 'max_steps'        // Budget d'étapes épuisé
  | 'verify_failed'    // Vérification toujours en échec après maxVerifyAttempts
  | 'aborted'          // Annulé par l'utilisateur
  | 'error';           // Erreur irrécupérable

export interface AgentSessionOptions {
  /** Contexte projet pour le system prompt */
  prompt: AgentPromptContext;
  /** Tâche demandée par l'utilisateur */
  task: string;
  /** Historique de conversation précédent (optionnel, pour le suivi multi-tours) */
  history?: APIMessage[];
  /** Modèle ('fast' par défaut — 'thinking' pour les tâches complexes) */
  model?: AIModel;
  provider?: AIProvider;
  /** Nombre max d'itérations de la boucle (défaut: 40) */
  maxSteps?: number;
  /** Checkpoint git automatique avant de commencer (défaut: true) */
  gitCheckpoint?: boolean;
  /**
   * Vérification automatique au task_done (défaut: true).
   * Si lint/build/tests échouent, task_done est REFUSÉ et les erreurs
   * sont réinjectées à l'agent pour correction (boucle Verify→Fix→Verify).
   */
  autoVerify?: boolean;
  /** Nombre max de cycles vérification-correction (défaut: 3) */
  maxVerifyAttempts?: number;
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

const DEFAULT_MAX_STEPS = 40;
const MAX_CONSECUTIVE_ERRORS = 4;
const MAX_HISTORY_CHARS = 220_000; // ~55k tokens — compaction au-delà

// ============================================================================
// ASSEMBLAGE DES TOOL CALLS EN STREAMING
// ============================================================================

/**
 * Les tool_calls arrivent fragmentés dans les deltas SSE (format OpenAI) :
 * chaque fragment porte un `index`; id/name arrivent au premier fragment,
 * arguments s'accumulent ensuite.
 */
class ToolCallAssembler {
  private calls = new Map<number, ToolCall>();

  add(fragments: Partial<ToolCall>[]): void {
    for (const frag of fragments) {
      const index = (frag as any).index ?? 0;
      let call = this.calls.get(index);
      if (!call) {
        call = {
          id: frag.id || `call_${Date.now()}_${index}`,
          type: 'function',
          function: { name: '', arguments: '' },
        };
        this.calls.set(index, call);
      }
      if (frag.id) call.id = frag.id;
      if (frag.function?.name) call.function.name += frag.function.name;
      if (frag.function?.arguments) call.function.arguments += frag.function.arguments;
    }
  }

  finish(): ToolCall[] {
    return [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  }

  get hasCalls(): boolean {
    return this.calls.size > 0;
  }
}

// ============================================================================
// COMPACTION DE L'HISTORIQUE
// ============================================================================

/**
 * Si l'historique dépasse le budget, on tronque les VIEUX résultats d'outils
 * (les plus volumineux) en gardant la structure de la conversation intacte.
 */
function compactHistory(messages: APIMessage[]): APIMessage[] {
  let total = messages.reduce((s, m) => s + (m.content?.length || 0), 0);
  if (total <= MAX_HISTORY_CHARS) return messages;

  const compacted = messages.map((m) => ({ ...m }));
  // On protège le system prompt, la tâche initiale et les 6 derniers messages
  for (let i = 2; i < compacted.length - 6 && total > MAX_HISTORY_CHARS; i++) {
    const m = compacted[i];
    if (m.role === 'tool' && m.content && m.content.length > 500) {
      total -= m.content.length - 200;
      m.content = m.content.slice(0, 160) + '\n… [résultat compacté pour économiser le contexte]';
    }
  }
  return compacted;
}

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

export async function runAgentSession(options: AgentSessionOptions): Promise<AgentSessionResult> {
  const {
    prompt,
    task,
    history = [],
    model = 'fast',
    provider = 'deepseek',
    maxSteps = DEFAULT_MAX_STEPS,
    gitCheckpoint = true,
    autoVerify = true,
    maxVerifyAttempts = 3,
    onEvent,
    signal,
    onFileChanged,
  } = options;

  const emit = (e: AgentEvent) => onEvent?.(e);
  const filesChanged = new Set<string>();

  const toolCtx: ToolExecutionContext = {
    projectRoot: prompt.projectRoot,
    signal,
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
    { role: 'system', content: buildAgentSystemPrompt(effectivePrompt) },
    ...history,
    { role: 'user', content: task },
  ];

  let consecutiveErrors = 0;
  let nudgedForCompletion = false;
  let verifyAttempts = 0;

  /**
   * Gate de vérification : appelé quand l'agent déclare task_done.
   * Renvoie null si la vérification passe (→ on peut terminer),
   * sinon le message d'erreurs à réinjecter à l'agent.
   */
  const runVerifyGate = async (): Promise<string | null> => {
    if (!autoVerify || filesChanged.size === 0) return null;

    verifyAttempts++;
    emit({ type: 'verify_start', attempt: verifyAttempts, maxAttempts: maxVerifyAttempts });

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

    if (report.passed) return null;
    return report.failureSummary;
  };

  const finish = (stopReason: AgentStopReason, summary: string, steps: number): AgentSessionResult => {
    emit({ type: 'done', reason: stopReason, summary, steps });
    return { stopReason, summary, steps, messages, filesChanged: [...filesChanged] };
  };

  // ─── Boucle principale ───
  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) return finish('aborted', 'Session annulée.', step - 1);

    emit({ type: 'step_start', step, maxSteps });

    // Appel du modèle en streaming avec assemblage des tool_calls
    const assembler = new ToolCallAssembler();
    let textContent = '';
    let streamError: string | null = null;

    try {
      const stream = aiService.chatStream(compactHistory(messages), {
        model,
        provider,
        tools: AGENT_TOOLS,
        signal,
      });
      for await (const delta of stream) {
        if (signal?.aborted) break;
        if (delta.content) {
          textContent += delta.content;
          emit({ type: 'text', content: delta.content });
        }
        if (delta.reasoning_content) {
          emit({ type: 'reasoning', content: delta.reasoning_content });
        }
        if (delta.tool_calls?.length) {
          assembler.add(delta.tool_calls);
        }
      }
    } catch (e: any) {
      streamError = e?.message || String(e);
    }

    if (signal?.aborted) return finish('aborted', 'Session annulée.', step);

    if (streamError) {
      consecutiveErrors++;
      emit({ type: 'error', message: streamError });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return finish('error', `Erreur réseau répétée: ${streamError}`, step);
      }
      await new Promise((r) => setTimeout(r, 1500 * consecutiveErrors));
      continue; // Retente le même tour
    }

    const toolCalls = assembler.finish();

    // ─── Cas 1 : réponse texte sans outil ───
    if (toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: textContent || null });

      // Si des fichiers ont été modifiés, on exige task_done (une relance max)
      if (filesChanged.size > 0 && !nudgedForCompletion) {
        nudgedForCompletion = true;
        messages.push({
          role: 'user',
          content:
            "Tu as modifié des fichiers mais tu n'as pas appelé task_done. Vérifie ton travail (run_command: build/lint/tests si applicable) puis appelle task_done avec un résumé. Si la tâche n'est pas finie, continue.",
        });
        continue;
      }
      return finish('final_answer', textContent || 'Réponse terminée.', step);
    }

    // ─── Cas 2 : exécution des tool_calls ───
    messages.push({
      role: 'assistant',
      content: textContent || null,
      tool_calls: toolCalls,
    });

    // On répond à TOUS les tool_calls (exigence API), puis on traite task_done
    let doneOutput: string | null = null;

    for (const call of toolCalls) {
      let parsedArgs: Record<string, any> = {};
      try {
        parsedArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        /* executeToolCall gère l'erreur de parsing */
      }
      emit({ type: 'tool_call', step, name: call.function.name, args: parsedArgs, callId: call.id });

      const result: ToolResult = await executeToolCall(call, toolCtx);

      emit({
        type: 'tool_result',
        step,
        name: call.function.name,
        callId: call.id,
        output: result.output,
        isError: !!result.isError,
      });

      messages.push({
        role: 'tool',
        content: result.output,
        tool_call_id: call.id,
      });

      if (result.isDone) {
        doneOutput = result.output;
        continue;
      }

      consecutiveErrors = result.isError ? consecutiveErrors + 1 : 0;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS * 2) {
        return finish('error', 'Trop d’erreurs consécutives — session interrompue pour éviter une boucle infinie.', step);
      }
    }

    // ─── task_done déclaré → gate de vérification (Verify→Fix→Verify) ───
    if (doneOutput !== null) {
      const failureSummary = await runVerifyGate();

      if (failureSummary === null) {
        return finish('task_done', doneOutput, step);
      }

      if (verifyAttempts >= maxVerifyAttempts) {
        return finish(
          'verify_failed',
          `La vérification échoue toujours après ${verifyAttempts} tentatives de correction.\n\n${failureSummary.slice(0, 2000)}`,
          step
        );
      }

      // Refus du task_done : les erreurs repartent vers l'agent
      messages.push({
        role: 'user',
        content:
          `⚠️ task_done REFUSÉ — la vérification automatique a échoué (tentative ${verifyAttempts}/${maxVerifyAttempts}).\n\n` +
          `${failureSummary}\n\n` +
          `Analyse ces erreurs, corrige les fichiers concernés, puis rappelle task_done. ` +
          `La vérification sera relancée automatiquement.`,
      });
    }
  }

  return finish(
    'max_steps',
    `Budget d'étapes épuisé (${maxSteps}). Fichiers modifiés: ${[...filesChanged].join(', ') || 'aucun'}. Relance l'agent pour continuer.`,
    maxSteps
  );
}
