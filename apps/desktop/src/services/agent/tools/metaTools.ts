/**
 * Outils méta : explore (explorateurs), remember (mémoire ANZAR.md), task_done.
 */
import { appendProjectMemory } from '../context/agentContext';
import { ToolExecutionContext, ToolResult } from './types';

export async function execExplore(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const questions: string[] = (Array.isArray(args.questions) ? args.questions : [args.questions])
    .filter((q: any) => typeof q === 'string' && q.trim());
  if (!questions.length) return { output: 'Erreur: indique au moins une question dans questions.', isError: true };
  // Import dynamique : explorers importe ce module
  const { exploreInParallel, formatExploreResults } = await import('../subagents/explorers');
  const { results, costFCFA } = await exploreInParallel(questions, ctx);
  const failed = results.filter((r) => !r.ok).length;
  return {
    output: `${results.length} exploration${results.length > 1 ? 's' : ''} terminée${results.length > 1 ? 's' : ''}${failed ? ` (${failed} sans réponse)` : ''}. Résumés :\n\n${formatExploreResults(results)}\n\n(Vérifie toi-même avec read_file un point précis avant de modifier le code.)`,
    isError: failed === results.length,
    costFCFA,
  };
}

export async function execRemember(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const category = String(args.category || 'note').slice(0, 40);
  const note = String(args.note || '').trim();
  if (!note) return { output: 'Erreur: note vide.', isError: true };
  await appendProjectMemory(ctx.projectRoot, category, note);
  return { output: `OK — mémorisé dans ANZAR.md [${category}].` };
}

export async function execTaskDone(args: any): Promise<ToolResult> {
  const summary = args.summary || 'Tâche terminée.';
  const verification = args.verification ? `\nVérification: ${args.verification}` : '';
  return { output: `${summary}${verification}`, isDone: true };
}
