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
import { AGENT_TOOLS, executeToolCall, type ToolExecutionContext, type ToolResult } from './agentTools';
import { buildAgentContext } from './agentContext';
import { ToolCallAssembler } from './toolCallAssembler';
import { closeDanglingToolCalls } from './history';

const EXPLORER_TOOLS = AGENT_TOOLS.filter((t) => ['read_file', 'list_dir', 'search_files', 'get_diagnostics'].includes(t.function.name));
const MAX_QUESTIONS = 8;
/** Le serveur accepte 4 requêtes simultanées par compte : l'agent principal attend pendant ce temps */
const MAX_PARALLEL = 4;
const MAX_STEPS = 12;
const MAX_SUMMARY_CHARS = 3_000;

const EXPLORER_PROMPT = `Tu es un explorateur d'ANZAR, en LECTURE SEULE. Tu réponds à UNE question précise sur le projet pour un autre agent qui, lui, fera les modifications.

# Méthode
- Cherche efficacement : search_files pour trouver, read_file (avec offset/limit) pour vérifier. Ne lis pas tout le projet.
- Appuie chaque affirmation sur ce que tu as lu. Si tu n'as pas trouvé, dis-le.
- Au plus ${MAX_STEPS} étapes : réponds dès que tu en sais assez.

# Réponse finale (sans outil)
Un résumé de 15 lignes au plus, en français :
1. La réponse à la question, directe.
2. Les endroits clés sous la forme chemin:ligne — ce qu'on y trouve.
3. Ce qui reste incertain, s'il y a lieu.
Pas de code complet, pas de proposition de modification sauf si la question en demande.`;

export interface ExploreResult {
  question: string;
  summary: string;
  steps: number;
  ok: boolean;
}

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
  for (let step = 1; step <= MAX_STEPS + 1; step++) {
    if (ctx.signal?.aborted) return { question, summary: 'Annulé.', steps: step - 1, ok: false };
    const last = step > MAX_STEPS;
    if (last) {
      closeDanglingToolCalls(messages);
      messages.push({ role: 'user', content: 'Plus d\'outil : donne maintenant ton résumé final avec ce que tu as trouvé.' });
    }
    let assembler = new ToolCallAssembler();
    let text = '';
    // Une nouvelle tentative après une coupure ou une limite momentanée (requêtes simultanées)
    for (let attempt = 0; ; attempt++) {
      assembler = new ToolCallAssembler();
      text = '';
      try {
        const stream = aiService.chatStream(messages, {
          model: 'fast',
          reasoningEffort: 'low',
          tools: last ? undefined : EXPLORER_TOOLS,
          signal: ctx.signal,
        });
        for await (const delta of stream) {
          if (delta.serverCostFCFA !== undefined) { cost.sum += delta.serverCostFCFA; continue; }
          if (delta.content) text += delta.content;
          if (delta.tool_calls) assembler.add(delta.tool_calls);
        }
        break;
      } catch (e: any) {
        if (ctx.signal?.aborted) return { question, summary: 'Annulé.', steps: step, ok: false };
        if (attempt >= 2 || /cr[ée]dit|402/i.test(String(e?.message))) {
          return { question, summary: `Exploration interrompue : ${e?.message || e}`, steps: step, ok: false };
        }
        await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
      }
    }
    const calls = last ? [] : assembler.finish();
    if (!calls.length) {
      const summary = text.trim() || '(pas de réponse)';
      return {
        question,
        summary: summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS)}…` : summary,
        steps: step,
        ok: !!text.trim(),
      };
    }
    messages.push({ role: 'assistant', content: text || null, tool_calls: calls });
    onProgress?.(question, step);
    for (const call of calls) {
      const allowed = EXPLORER_TOOLS.some((t) => t.function.name === call.function.name);
      const result: ToolResult = allowed
        ? await executeToolCall(call, { ...ctx, onFileChanged: undefined })
        : { output: 'Outil non disponible pour un explorateur (lecture seule).', isError: true };
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.output });
    }
  }
  return { question, summary: '(aucun résumé)', steps: MAX_STEPS, ok: false };
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
