/**
 * Explorateurs : sous-agents en lecture seule, lancés en parallèle sur deepseek-flash
 * à réflexion courte. Chacun répond à UNE question sur le projet et ne rend qu'un
 * résumé court : l'agent principal comprend un gros projet sans remplir son propre
 * contexte (qui est renvoyé, et payé, à chaque étape).
 *
 * Tous les explorateurs partagent le même début de requête (consignes + carte du code) :
 * il est servi par le cache DeepSeek dès le deuxième.
 */
import { aiService } from '@/services/ai/ai';
import type { APIMessage, ToolCall } from '@/types';
import { AGENT_TOOLS } from '../tools/definitions';
import { execGetDiagnostics, execListDir, execReadFile, execSearchFiles } from '../tools/fsTools';
import type { ToolExecutionContext, ToolResult } from '../tools/types';
import { buildAgentContext } from '../context/agentContext';
import { runAgentEngine, type AgentEngineResult, type AgentSessionOptions } from '../engine/agentSession';
import { getProfile } from '../profiles';

/** Profil de l'explorateur : services/agent/profiles/explorer.md */
const EXPLORER = getProfile('explorer');

/** Seuls outils d'un explorateur : lecture, recherche et diagnostics. */
const EXPLORER_EXECUTORS: Record<string, (args: any, ctx: ToolExecutionContext) => Promise<ToolResult>> = {
  read_file: execReadFile,
  list_dir: execListDir,
  search_files: execSearchFiles,
  get_diagnostics: execGetDiagnostics,
};
// Le profil déclare les outils ; on ne garde que ceux qui ont un exécuteur (défense en
// profondeur) : un profil ne peut pas exposer un outil d'écriture à un explorateur.
const EXPLORER_TOOL_NAMES = new Set(
  (EXPLORER.tools.length ? EXPLORER.tools : Object.keys(EXPLORER_EXECUTORS))
    .filter((name) => name in EXPLORER_EXECUTORS),
);
const EXPLORER_TOOLS = AGENT_TOOLS.filter((t) => EXPLORER_TOOL_NAMES.has(t.function.name));
const MAX_QUESTIONS = 8;
/** Le serveur accepte 4 requêtes simultanées par compte : l'agent principal attend pendant ce temps */
const MAX_PARALLEL = 4;
const MAX_STEPS = EXPLORER.maxSteps;
const MAX_SUMMARY_CHARS = 3_000;

const EXPLORER_PROMPT = EXPLORER.prompt;

export interface ExploreResult {
  question: string;
  summary: string;
  steps: number;
  ok: boolean;
}

async function runReadOnlyTool(call: ToolCall, ctx: ToolExecutionContext): Promise<ToolResult> {
  const executor = EXPLORER_EXECUTORS[call.function.name];
  if (!executor) return { output: 'Outil non disponible pour un explorateur (lecture seule).', isError: true };
  let args: any = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { output: `Erreur: arguments JSON invalides pour ${call.function.name}.`, isError: true };
  }
  try {
    return await executor(args, { ...ctx, onFileChanged: undefined });
  } catch (e: any) {
    return { output: `Erreur ${call.function.name}: ${e?.message || String(e)}`, isError: true };
  }
}

const lastAssistantText = (messages: APIMessage[]): string => {
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  return typeof last?.content === 'string' ? last.content.trim() : '';
};

async function exploreOne(
  question: string,
  context: string,
  ctx: ToolExecutionContext,
  cost: { sum: number },
  onProgress?: (question: string, step: number) => void,
): Promise<ExploreResult> {
  const messages: APIMessage[] = [
    { role: 'system', content: `${EXPLORER_PROMPT}\n\n${context}` },
    { role: 'user', content: question },
  ];
  // Même moteur que l'agent principal : flux, assemblage des outils, relances.
  const common: Pick<AgentSessionOptions, 'messages' | 'signal' | 'retry' | 'onCostDelta' | 'maxConsecutiveErrors'> = {
    messages,
    signal: ctx.signal,
    maxConsecutiveErrors: 0,
    retry: {
      attempts: 2,
      delayMs: (attempt) => 1_500 * (attempt + 1),
      // Pas de nouvelle tentative quand le solde est épuisé
      isRetryable: (e) => !/cr[ée]dit|402/i.test(String((e as any)?.message ?? e)),
    },
    onCostDelta: (c) => { cost.sum += c; },
  };

  let result: AgentEngineResult = await runAgentEngine({
    ...common,
    tools: EXPLORER_TOOLS,
    allowedTools: EXPLORER_TOOL_NAMES,
    maxSteps: MAX_STEPS,
    stream: (msgs, tools) => aiService.chatStream(msgs, { model: EXPLORER.model ?? 'fast', reasoningEffort: EXPLORER.reasoningEffort ?? 'low', tools, signal: ctx.signal }),
    executeTool: (call) => runReadOnlyTool(call, ctx),
    onStepEnd: ({ step, toolCalls }) => { if (toolCalls.length) onProgress?.(question, step); },
  });
  let steps = result.steps;

  // Budget d'étapes épuisé : une dernière réponse, sans outil, avec ce qui a été trouvé.
  if (result.stopReason === 'max_steps') {
    messages.push({ role: 'user', content: "Plus d'outil : donne maintenant ton résumé final avec ce que tu as trouvé." });
    result = await runAgentEngine({
      ...common,
      maxSteps: 1,
      stream: (msgs) => aiService.chatStream(msgs, { model: EXPLORER.model ?? 'fast', reasoningEffort: EXPLORER.reasoningEffort ?? 'low', signal: ctx.signal }),
      executeTool: async () => ({ output: 'Plus aucun outil disponible.', isError: true }),
    });
    steps += result.steps;
  }

  if (result.stopReason === 'aborted') return { question, summary: 'Annulé.', steps, ok: false };
  if (result.stopReason === 'error') {
    return { question, summary: `Exploration interrompue : ${result.errorMessage || result.summary}`, steps, ok: false };
  }
  const summary = result.stopReason === 'final_answer' ? lastAssistantText(messages) : '';
  if (!summary) return { question, summary: '(aucun résumé)', steps, ok: false };
  return {
    question,
    summary: summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS)}…` : summary,
    steps,
    ok: true,
  };
}

/** Lance les explorateurs (4 à la fois au plus) et rassemble leurs résumés. */
export async function exploreInParallel(
  questions: string[],
  ctx: ToolExecutionContext,
  opts: { context?: string; onProgress?: (question: string, step: number) => void } = {},
): Promise<{ results: ExploreResult[]; costFCFA: number }> {
  const list = questions.map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUESTIONS);
  const projectName = ctx.projectRoot.split(/[\\/]/).filter(Boolean).pop() || 'projet';
  // Même début de requête pour tous : carte du code et mémoire du projet (cache DeepSeek)
  const project = await buildAgentContext(ctx.projectRoot, '').catch(() => null);
  const context = [
    `# Projet\nNom : ${projectName}\nRacine : ${ctx.projectRoot}`,
    project?.memory ? `# Mémoire du projet (ANZAR.md)\n${project.memory}` : '',
    project?.codeMap ? `# Carte du code (fichiers + symboles clés)\n${project.codeMap}` : '',
    opts.context || '',
  ].filter(Boolean).join('\n\n');
  const cost = { sum: 0 };
  const results: ExploreResult[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await exploreOne(list[i], context, ctx, cost, opts.onProgress);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, list.length) }, worker));
  return { results, costFCFA: Math.round(cost.sum * 100) / 100 };
}

export function formatExploreResults(results: ExploreResult[]): string {
  return results.map((r, i) => `## ${i + 1}. ${r.question}\n${r.summary}`).join('\n\n');
}
