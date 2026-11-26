/**
 * Outils modèles de la couche de sous-agents vivants : spawn, message, attente, liste.
 */
import type { ToolExecutionContext, ToolResult } from '../tools/types';
import { AGENT_PROFILES } from '../profiles';
import {
  consumeLiveNotification, DEFAULT_WAIT_MS, listLiveAgents, resolveLiveAgent, sendToLiveAgent,
  spawnLiveAgent, stopLiveAgent, waitForLiveAgent, type LiveAgent,
} from './live';

function statusLabel(agent: LiveAgent): string {
  switch (agent.status) {
    case 'running': return 'en cours';
    case 'idle': return 'au repos, prêt pour un message';
    case 'error': return `erreur${agent.error ? ` (${agent.error.slice(0, 160)})` : ''}`;
    case 'stopped': return 'arrêté';
  }
}

/** Taille du rapport rendu au parent : celle du profil, sinon assez pour un rapport complet. */
const DEFAULT_REPORT_CHARS = 2_500;

function summaryOf(agent: LiveAgent, max = AGENT_PROFILES[agent.role]?.outputMaxChars ?? DEFAULT_REPORT_CHARS): string {
  const text = (agent.summary || '').trim();
  if (!text) return '(pas encore de résumé)';
  // Le relevé des fichiers touchés reste entier : c'est le fait le plus utile au parent.
  const marker = text.lastIndexOf('\n\nFichiers touchés (relevé ANZAR)');
  const body = marker >= 0 ? text.slice(0, marker) : text;
  const files = marker >= 0 ? text.slice(marker) : '';
  return (body.length > max ? `${body.slice(0, max)}…` : body) + files;
}

function describe(agent: LiveAgent): string {
  return `- ${agent.name} (${agent.role}, ${statusLabel(agent)}) · ${agent.steps} étapes\n  tâche : ${agent.task.slice(0, 140)}${agent.task.length > 140 ? '…' : ''}`;
}

export async function execSpawnAgent(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const spawned = spawnLiveAgent(ctx, args.task, args.role, args.name, args.output_schema);
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

function waitReport(agent: LiveAgent, timedOut: boolean, timeout: number): string {
  const structured = agent.structured !== undefined
    ? `\n\nRésultat structuré :\n${JSON.stringify(agent.structured, null, 2)}`
    : agent.structuredError
    ? `\n\nSortie structurée invalide : ${agent.structuredError}`
    : '';
  return `${agent.name} — ${statusLabel(agent)}${timedOut ? ` (toujours en cours après ${Math.round(timeout / 1000)} s)` : ''}\n` +
    `étape(s) : ${agent.steps}\n\nRésumé :\n${summaryOf(agent)}${structured}`;
}

export async function execWaitAgent(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const refs = (Array.isArray(args.agents) ? args.agents : [args.agent || args.name || args.id])
    .map((r: unknown) => String(r ?? '').trim())
    .filter(Boolean);
  const unique: string[] = [...new Set<string>(refs)];
  if (unique.length === 0) return { output: 'Erreur: indique le nom du sous-agent (agent), ou plusieurs noms (agents).', isError: true };
  const agents: LiveAgent[] = [];
  for (const ref of unique) {
    const agent = resolveLiveAgent(ctx.convId, ref);
    if (!agent) return { output: `Sous-agent inconnu « ${ref} ». Utilise list_agents.`, isError: true };
    if (!agents.includes(agent)) agents.push(agent);
  }
  const requested = Number(args.timeout_ms ?? args.timeoutMs);
  const timeout = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 300_000) : DEFAULT_WAIT_MS;
  const before = agents.map((a) => a.status);
  // Une seule échéance pour tous : ils travaillent en parallèle.
  await Promise.all(agents.map((a) => waitForLiveAgent(a, timeout, ctx.signal)));
  for (const a of agents) consumeLiveNotification(ctx.convId, a.name);
  const reports = agents.map((a, i) => waitReport(a, before[i] === 'running' && a.status === 'running', timeout));
  const anyIdle = agents.some((a) => a.status === 'idle');
  return {
    output: reports.join('\n\n────────\n\n') +
      (anyIdle ? `\n\nTu peux envoyer un autre message à un sous-agent au repos avec send_message si besoin.` : '') +
      (agents.length > 1 ? `\n\n→ Vérifie maintenant la cohérence de l'ensemble (imports croisés, build) avant de conclure.` : ''),
    isError: agents.every((a) => a.status === 'error'),
  };
}

export async function execStopAgent(args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const ref = String(args.agent || args.name || args.id || '').trim();
  if (!ref) return { output: 'Erreur: indique le nom du sous-agent (agent).', isError: true };
  if (!stopLiveAgent(ctx.convId, ref)) {
    return { output: `Sous-agent inconnu « ${ref} ». Utilise list_agents.`, isError: true };
  }
  return { output: `Sous-agent ${ref} arrêté. Son historique est conservé ; send_message peut le relancer.` };
}

export async function execListAgents(_args: Record<string, any>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const agents = listLiveAgents(ctx.convId);
  if (agents.length === 0) return { output: 'Aucun sous-agent vivant dans cette conversation.' };
  return {
    output: `${agents.length} sous-agent(s) :\n${agents.map(describe).join('\n')}\n\n` +
      'wait_agent attend un résultat ; send_message lui donne une suite ; un enfant au repos garde son historique.',
  };
}
