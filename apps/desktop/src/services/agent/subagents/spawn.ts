/**
 * Outil spawn_subagents : lance 2 à 3 sous-agents spécialisés et rassemble leurs rapports.
 */
import { AGENT_PROFILES, detectSubagentRole, isSubagentRole, subagentSystemPrompt, type SubagentRole } from '../profiles';
import { READ_ONLY_TOOLS } from '../policy/permissions';
import { subagentAllowedTools } from '../policy/subagentPolicy';
import { AGENT_TOOLS } from '../tools/definitions';
import type { SubagentProgress, ToolExecutionContext, ToolResult } from '../tools/types';

export async function execSpawnSubagents(args: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const depth = ctx.subagentDepth ?? 0;
  if (depth >= 2) {
    return { output: 'Profondeur maximale de sous-agents atteinte. Termine cette sous-tâche toi-même.', isError: true };
  }

  // Tâches : objets {task, role} (ou chaînes simples, rôle déduit)
  const rawTasks: any[] = Array.isArray(args.tasks) ? args.tasks.slice(0, 3) : [];
  const tasks: { task: string; role: SubagentRole }[] = rawTasks
    .map((t: any) => {
      const text = typeof t === 'string' ? t : typeof t?.task === 'string' ? t.task : '';
      if (!text.trim()) return null;
      const role: SubagentRole = isSubagentRole(t?.role) ? t.role : detectSubagentRole(text);
      return { task: text.trim(), role };
    })
    .filter(Boolean) as { task: string; role: SubagentRole }[];
  if (tasks.length < 2) {
    return { output: 'Erreur: spawn_subagents requiert 2 à 3 sous-tâches indépendantes (objets {task, role}). Pour une seule tâche, fais-la toi-même.', isError: true };
  }

  // Consignes et skills de chaque rôle : services/agent/profiles/<rôle>.md
  const extraFor = subagentSystemPrompt;

  const runAgentSession = ctx.runSubagent;
  if (!runAgentSession) {
    return { output: 'Sous-agents indisponibles dans ce contexte. Fais la tâche toi-même.', isError: true };
  }
  const projectName = ctx.projectRoot.split(/[\\/]/).filter(Boolean).pop() || 'projet';

  // Progression en direct vers l'UI (une ligne par sous-agent, action courante)
  const progress: SubagentProgress[] = tasks.map(({ task, role }) => ({
    task: task.length > 90 ? task.slice(0, 87) + '…' : task,
    role,
    status: 'running' as const,
    steps: 0,
  }));
  const pushProgress = () => ctx.onSubagentProgress?.(progress.map((p) => ({ ...p })));
  pushProgress();
  const shortAction = (name: string, args: Record<string, any>): string => {
    const a = args.path || args.file_path || args.command || args.query || args.url || args.output || '';
    return a ? `${name} · ${String(a).slice(0, 60)}` : name;
  };

  const allowedTools = subagentAllowedTools(
    AGENT_TOOLS.map((tool) => tool.function.name),
    ctx.permissionMode,
    READ_ONLY_TOOLS,
  );

  const runOne = async ({ task, role }: { task: string; role: SubagentRole }, i: number) => {
    try {
      const r = await runAgentSession({
        prompt: { projectName, projectRoot: ctx.projectRoot },
        task,
        systemPromptExtra: extraFor(role),
        maxSteps: AGENT_PROFILES[role]?.maxSteps ?? 15,
        gitCheckpoint: false,   // le checkpoint parent couvre déjà la session
        autoVerify: false,      // le parent vérifie après consolidation
        allowedTools,
        subagentDepth: depth + 1,
        signal: ctx.signal,
        onFileChanged: ctx.onFileChanged,
        onEvent: (ev) => {
          const p = progress[i];
          if (!p) return;
          if (ev.type === 'step_start') { p.steps = ev.step; pushProgress(); }
          else if (ev.type === 'tool_call') { p.current = shortAction(ev.name, ev.args); pushProgress(); }
          else if (ev.type === 'done') { p.status = 'done'; p.current = undefined; p.steps = ev.steps; pushProgress(); }
          else if (ev.type === 'error') { p.status = 'error'; p.current = ev.message.slice(0, 80); pushProgress(); }
        },
      });
      return { index: i + 1, task, role, ...r };
    } catch (e: any) {
      progress[i] = { ...progress[i], status: 'error', current: e?.message?.slice(0, 80) };
      pushProgress();
      return {
        index: i + 1,
        task,
        role,
        stopReason: 'error' as const,
        summary: e?.message || String(e),
        steps: 0,
        messages: [],
        filesChanged: [] as string[],
      };
    }
  };

  // En Full, les sous-agents peuvent écrire : on les exécute séquentiellement
  // pour éviter deux écritures concurrentes sur le même arbre. Hors Full ils
  // sont read-only, donc le parallélisme reste sûr.
  const results = ctx.permissionMode === 'full'
    ? await (async () => {
        const out: Awaited<ReturnType<typeof runOne>>[] = [];
        for (let i = 0; i < tasks.length; i++) {
          if (ctx.signal?.aborted) break;
          out.push(await runOne(tasks[i], i));
        }
        return out;
      })()
    : await Promise.all(tasks.map(runOne));

  const report = results
    .map(r =>
      `── Sous-agent ${r.index} [${r.stopReason}] — ${r.task.slice(0, 80)}\n` +
      `Fichiers: ${r.filesChanged.join(', ') || 'aucun'}\n` +
      `Résumé: ${r.summary.slice(0, 500)}`
    )
    .join('\n\n');

  const anyError = results.some(r => r.stopReason === 'error');
  return {
    output: `${report}\n\n→ Vérifie maintenant la cohérence de l'ensemble (imports croisés, build) avant task_done.`,
    isError: anyError,
  };
}
