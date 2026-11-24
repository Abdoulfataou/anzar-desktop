/**
 * Outils modèles de la couche de sous-agents vivants : spawn, message, attente, liste.
 */
import type { ToolExecutionContext, ToolResult } from '../tools/types';
import {
  DEFAULT_WAIT_MS, listLiveAgents, resolveLiveAgent, sendToLiveAgent, spawnLiveAgent, waitForLiveAgent,
  type LiveAgent,
} from './live';

function statusLabel(agent: LiveAgent): string {
  switch (agent.status) {
    case 'running': return 'en cours';
    case 'idle': return 'au repos, prêt pour un message';
    case 'error': return `erreur${agent.error ? ` (${agent.error.slice(0, 160)})` : ''}`;
    case 'stopped': return 'arrêté';
  }
}

function summaryOf(agent: LiveAgent, max = 1_200): string {
  const text = (agent.summary || '').trim();
  if (!text) return '(pas encore de résumé)';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describe(agent: LiveAgent): string {
  return `- ${agent.name} (${agent.role}, ${statusLabel(agent)}) · ${agent.steps} étapes\n  tâche : ${agent.task.slice(0, 140)}${agent.task.length > 140 ? '…' : ''}`;
}

export async function execSpawnAgent(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const spawned = spawnLiveAgent(ctx, args.task, args.role, args.name);
  if (spawned.error) return { output: spawned.error, isError: true };
  const agent = spawned.agent!;
  return {
    output:
      `Sous-agent lancé : ${agent.name} (${agent.role}), id ${agent.id}.\n` +
      `Il travaille en arrière-plan. Utilise wait_agent pour récupérer son résultat quand tu en as besoin, ` +
      `send_message pour lui donner une suite, list_agents pour voir l'état. ` +
      `Ne conclus pas avant d'avoir attendu les sous-agents dont ton travail dépend.`,
  };
}

export async function execSendMessage(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const ref = String(args.agent || args.name || args.id || '').trim();
  if (!ref) return { output: 'Erreur: indique le nom du sous-agent (agent).', isError: true };
  const sent = sendToLiveAgent(ctx, ref, String(args.message || ''));
  if (sent.error) return { output: sent.error, isError: true };
  return {
    output:
      `Message transmis à ${sent.agent!.name}. ` +
      (sent.agent!.status === 'running'
        ? 'Il le traitera après son travail en cours ; utilise wait_agent pour la suite.'
        : 'Il reprend avec son historique ; utilise wait_agent pour le résultat.'),
  };
}

export async function execWaitAgent(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const ref = String(args.agent || args.name || args.id || '').trim();
  if (!ref) return { output: 'Erreur: indique le nom du sous-agent (agent).', isError: true };
  const agent = resolveLiveAgent(ctx.convId, ref);
  if (!agent) return { output: `Sous-agent inconnu « ${ref} ». Utilise list_agents.`, isError: true };
  const requested = Number(args.timeout_ms ?? args.timeoutMs);
  const timeout = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 300_000) : DEFAULT_WAIT_MS;
  const before = agent.status;
  await waitForLiveAgent(agent, timeout, ctx.signal);
  const timedOut = before === 'running' && agent.status === 'running';
  return {
    output:
      `${agent.name} — ${statusLabel(agent)}${timedOut ? ` (toujours en cours après ${Math.round(timeout / 1000)} s)` : ''}\n` +
      `étape(s) : ${agent.steps}\n\nRésumé :\n${summaryOf(agent)}` +
      (agent.status === 'idle' ? '\n\nTu peux lui envoyer un autre message avec send_message si besoin.' : ''),
    isError: agent.status === 'error',
  };
}

export async function execListAgents(_args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const agents = listLiveAgents(ctx.convId);
  if (agents.length === 0) return { output: 'Aucun sous-agent vivant dans cette conversation.' };
  return {
    output: `${agents.length} sous-agent(s) :\n${agents.map(describe).join('\n')}\n\n` +
      'wait_agent attend un résultat ; send_message lui donne une suite ; un enfant au repos garde son historique.',
  };
}
