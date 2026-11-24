/**
 * Sous-agents vivants : la couche de session que Cordis fournit à Harness, portée
 * nativement dans ANZAR.
 *
 * Un enfant garde son historique, peut recevoir un nouveau message après avoir fini
 * (reprise), et le parent peut attendre ou lister sans bloquer le tour. Le registre est
 * en mémoire, rattaché à la conversation : il survit aux tours, pas au redémarrage de
 * l'app. La limite est de 8 enfants actifs par conversation et la profondeur reste 1.
 *
 * Adapté de `packages/subagent` de DeepSeek Harness (MIT), sans Cordis : ANZAR a son
 * propre moteur de session (`runSubagent`), on réutilise son contrat.
 */
import type { APIMessage } from '@/types';
import type { AgentLoopOptions, AgentSessionResult } from '../engine/agentLoop';
import { AGENT_PROFILES, detectSubagentRole, isSubagentRole, subagentSystemPrompt, type SubagentRole } from '../profiles';
import { READ_ONLY_TOOLS, type PermissionMode } from '../policy/permissions';
import { subagentAllowedTools } from '../policy/subagentPolicy';
import { AGENT_TOOLS, BASH_TOOLS } from '../tools/definitions';
import type { ToolExecutionContext } from '../tools/types';

export const MAX_LIVE_AGENTS = 8;
export const DEFAULT_WAIT_MS = 120_000;

export type LiveAgentStatus = 'running' | 'idle' | 'error' | 'stopped';

export interface LiveAgent {
  id: string;
  name: string;
  role: SubagentRole;
  status: LiveAgentStatus;
  task: string;
  summary: string;
  error?: string;
  steps: number;
  createdAt: number;
  history: APIMessage[];
  queue: string[];
  current?: Promise<void>;
  controller?: AbortController;
  budget?: ReturnType<NonNullable<ToolExecutionContext['childBudget']>>;
  allowedTools: Set<string>;
  projectRoot: string;
  projectName: string;
  model?: AgentLoopOptions['model'];
  reasoningEffort?: AgentLoopOptions['reasoningEffort'];
  maxSteps: number;
}

interface Registry {
  byName: Map<string, LiveAgent>;
  byId: Map<string, LiveAgent>;
}

const registries = new Map<string, Registry>();
let sequence = 0;

function keyOf(convId: string | undefined): string {
  return convId || 'global';
}

function registryFor(convId: string | undefined): Registry {
  const key = keyOf(convId);
  let reg = registries.get(key);
  if (!reg) {
    reg = { byName: new Map(), byId: new Map() };
    registries.set(key, reg);
  }
  return reg;
}

function sanitizeName(raw: unknown): string | null {
  const name = String(raw ?? '').trim().toLowerCase();
  if (!name) return null;
  if (name === 'lead') return null;
  return /^[a-z][a-z0-9-]{0,31}$/.test(name) ? name : null;
}

function nextName(reg: Registry): string {
  for (let i = 1; i < 10_000; i++) {
    const name = `agent-${i}`;
    if (!reg.byName.has(name)) return name;
  }
  throw new Error('Trop de sous-agents nommés.');
}

function runningCount(reg: Registry): number {
  return [...reg.byId.values()].filter((a) => a.status === 'running').length;
}

export function resolveLiveAgent(convId: string | undefined, ref: string): LiveAgent | undefined {
  const reg = registryFor(convId);
  return reg.byName.get(ref) || reg.byId.get(ref);
}

export function listLiveAgents(convId: string | undefined): LiveAgent[] {
  return [...registryFor(convId).byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function linkParentAbort(ctx: ToolExecutionContext, controller: AbortController): () => void {
  if (!ctx.signal) return () => {};
  if (ctx.signal.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  return () => ctx.signal?.removeEventListener('abort', onAbort);
}

function startLoop(agent: LiveAgent, ctx: ToolExecutionContext): void {
  if (agent.current || agent.queue.length === 0) return;
  agent.current = (async () => {
    try {
      while (agent.queue.length > 0) {
        const task = agent.queue.shift()!;
        const controller = new AbortController();
        agent.controller = controller;
        agent.status = 'running';
        agent.error = undefined;
        const detach = linkParentAbort(ctx, controller);
        try {
          const result: AgentSessionResult = await ctx.runSubagent!({
            prompt: { projectName: agent.projectName, projectRoot: agent.projectRoot },
            task,
            history: agent.history,
            systemPromptExtra: subagentSystemPrompt(agent.role),
            maxSteps: agent.maxSteps,
            model: agent.model,
            reasoningEffort: agent.reasoningEffort,
            budget: agent.budget,
            gitCheckpoint: false,
            autoVerify: false,
            allowedTools: agent.allowedTools,
            subagentDepth: 1,
            signal: controller.signal,
            onFileChanged: ctx.onFileChanged,
            onEvent: (ev) => {
              if (ev.type === 'step_start') agent.steps = ev.step;
            },
          });
          // L'historique de reprise ne contient pas le prompt système : il est reconstruit
          // au prochain tour avec les consignes du rôle.
          agent.history = result.messages.filter((m) => m.role !== 'system');
          agent.summary = result.summary || '';
          agent.steps = result.steps;
          agent.status = result.stopReason === 'error' ? 'error' : (result.stopReason === 'aborted' ? 'stopped' : 'idle');
          if (result.stopReason === 'error') agent.error = result.summary;
        } catch (e) {
          agent.status = 'error';
          agent.error = e instanceof Error ? e.message : String(e);
        } finally {
          detach();
          agent.controller = undefined;
        }
      }
    } finally {
      if (agent.status === 'running') agent.status = 'idle';
      agent.current = undefined;
    }
  })();
}

export interface SpawnLiveResult {
  agent?: LiveAgent;
  error?: string;
}

/** Crée un enfant et démarre sa première tâche en arrière-plan. */
export function spawnLiveAgent(
  ctx: ToolExecutionContext,
  task: string,
  roleInput?: unknown,
  nameInput?: unknown,
): SpawnLiveResult {
  if ((ctx.subagentDepth ?? 0) >= 1) {
    return { error: 'Profondeur maximale de sous-agents atteinte. Termine cette sous-tâche toi-même.' };
  }
  if (!ctx.runSubagent) {
    return { error: 'Sous-agents indisponibles dans ce contexte.' };
  }
  const text = String(task || '').trim();
  if (!text) return { error: 'La tâche du sous-agent est vide.' };

  const reg = registryFor(ctx.convId);
  if (runningCount(reg) >= MAX_LIVE_AGENTS) {
    return { error: `Limite de ${MAX_LIVE_AGENTS} sous-agents actifs atteinte : attends-en un ou termine le travail toi-même.` };
  }
  const role: SubagentRole = isSubagentRole(roleInput) ? roleInput : detectSubagentRole(text);
  const profile = AGENT_PROFILES[role];
  const requested = sanitizeName(nameInput);
  if (String(nameInput ?? '').trim() && !requested) {
    return { error: 'Nom de sous-agent invalide (1-32 caractères, minuscules, chiffres et tirets, « lead » réservé).' };
  }
  const name = requested || nextName(reg);
  if (reg.byName.has(name)) return { error: `Un sous-agent nommé « ${name} » existe déjà.` };

  const allNames = [...AGENT_TOOLS, ...BASH_TOOLS].map((t) => t.function.name);
  const allowedTools = subagentAllowedTools({
    allToolNames: allNames,
    mode: ctx.permissionMode as PermissionMode | undefined,
    readOnlyTools: READ_ONLY_TOOLS,
    profileTools: profile?.tools,
    deny: profile?.deny,
  });
  const projectName = ctx.projectRoot.split(/[\\/]/).filter(Boolean).pop() || 'projet';
  const agent: LiveAgent = {
    id: `sa-${Date.now().toString(36)}-${++sequence}`,
    name,
    role,
    status: 'running',
    task: text,
    summary: '',
    steps: 0,
    createdAt: Date.now(),
    history: [],
    queue: [text],
    budget: ctx.childBudget?.(0.25, profile?.budgetFCFA),
    allowedTools,
    projectRoot: ctx.projectRoot,
    projectName,
    model: profile?.model,
    reasoningEffort: profile?.reasoningEffort,
    maxSteps: profile?.maxSteps ?? 15,
  };
  reg.byName.set(name, agent);
  reg.byId.set(agent.id, agent);
  startLoop(agent, ctx);
  return { agent };
}

/** Ajoute un message à l'enfant : suivi s'il tourne, reprise s'il est au repos. */
export function sendToLiveAgent(
  ctx: ToolExecutionContext,
  ref: string,
  message: string,
): { agent?: LiveAgent; error?: string } {
  const agent = resolveLiveAgent(ctx.convId, String(ref || '').trim());
  if (!agent) return { error: `Sous-agent inconnu « ${ref} ». Utilise list_agents pour voir les noms.` };
  const text = String(message || '').trim();
  if (!text) return { error: 'Le message est vide.' };
  agent.queue.push(text);
  startLoop(agent, ctx);
  return { agent };
}

/** Attend la fin du travail courant (ou du délai), sans tuer l'enfant. */
export async function waitForLiveAgent(
  agent: LiveAgent,
  timeoutMs = DEFAULT_WAIT_MS,
  signal?: AbortSignal,
): Promise<LiveAgent> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (agent.current) {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || signal?.aborted) break;
    await Promise.race([
      agent.current,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(remaining, 200));
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      }),
    ]);
  }
  return agent;
}

/** Arrête et oublie tous les enfants d'une conversation (tests, fermeture). */
export function clearLiveAgents(convId?: string): void {
  const keys = convId ? [keyOf(convId)] : [...registries.keys()];
  for (const key of keys) {
    const reg = registries.get(key);
    if (!reg) continue;
    for (const agent of reg.byId.values()) agent.controller?.abort();
    registries.delete(key);
  }
}
