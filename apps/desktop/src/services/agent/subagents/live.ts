/**
 * Sous-agents vivants : la couche de session que Cordis fournit à Harness, portée
 * nativement dans ANZAR.
 *
 * Un enfant garde son historique, peut recevoir un nouveau message après avoir fini
 * (reprise), et le parent peut attendre ou lister sans bloquer le tour. Le registre est
 * persistant par conversation (localStorage) : les enfants au repos sont restaurés au
 * redémarrage, pas ceux qui étaient en cours. La limite est de 8 enfants actifs par
 * conversation et la profondeur reste 1.
 *
 * Adapté de `packages/subagent` de DeepSeek Harness (MIT), sans Cordis : ANZAR a son
 * propre moteur de session (`runSubagent`), on réutilise son contrat.
 */
import type { APIMessage } from '@/types';
import type { AgentLoopOptions, AgentSessionResult } from '../engine/agentLoop';
import { detectSubagentRole, type AgentProfile, type SubagentRole } from '../profiles';
import { availableRoles, resolveRole } from '../profiles/custom';
import type { Skill } from '@/services/skills';
import { READ_ONLY_TOOLS, type PermissionMode } from '../policy/permissions';
import { subagentAllowedTools } from '../policy/subagentPolicy';
import { AGENT_TOOLS, BASH_TOOLS } from '../tools/definitions';
import type { ToolExecutionContext } from '../tools/types';

export const MAX_LIVE_AGENTS = 8;
export const DEFAULT_WAIT_MS = 120_000;
const STORAGE_PREFIX = 'anzar.liveAgents.';
const MAX_PERSISTED_MESSAGES = 80;

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
  /** Taille maximale du rapport rendu au parent (profil du rôle). */
  outputMaxChars?: number;
  /**
   * Profil du rôle (intégré ou personnalisé), gardé en mémoire seulement : après un
   * redémarrage, il est retrouvé par son nom dans les agents du contexte.
   */
  profile?: AgentProfile;
  /** Schéma JSON demandé pour la sortie structurée, s'il y en a un. */
  outputSchema?: unknown;
  /** Valeur validée, quand l'enfant a rendu un bloc ```json conforme. */
  structured?: unknown;
  structuredError?: string;
}

interface Notification {
  agent: string;
  text: string;
}

interface Registry {
  byName: Map<string, LiveAgent>;
  byId: Map<string, LiveAgent>;
  notifications: Notification[];
  restored: boolean;
}

interface PersistedAgent {
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
  projectRoot: string;
  projectName: string;
  model?: AgentLoopOptions['model'];
  reasoningEffort?: AgentLoopOptions['reasoningEffort'];
  maxSteps: number;
  outputMaxChars?: number;
  allowedTools: string[];
  outputSchema?: unknown;
  structured?: unknown;
  structuredError?: string;
}

const registries = new Map<string, Registry>();
const listeners = new Set<() => void>();
let sequence = 0;

function keyOf(convId: string | undefined): string {
  return convId || 'global';
}

function emit(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* l'UI ne doit pas casser le registre */ }
  }
}

/** Abonnement à l'état des sous-agents (panneau UI). */
export function subscribeLiveAgents(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function persist(key: string): void {
  const reg = registries.get(key);
  const store = storage();
  if (!reg || !store) return;
  try {
    const agents: PersistedAgent[] = [...reg.byId.values()].map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status === 'running' ? 'stopped' : a.status,
      task: a.task,
      summary: a.summary,
      error: a.error,
      steps: a.steps,
      createdAt: a.createdAt,
      history: a.history.slice(-MAX_PERSISTED_MESSAGES),
      projectRoot: a.projectRoot,
      projectName: a.projectName,
      model: a.model,
      reasoningEffort: a.reasoningEffort,
      maxSteps: a.maxSteps,
      outputMaxChars: a.outputMaxChars,
      allowedTools: [...a.allowedTools],
      outputSchema: a.outputSchema,
      structured: a.structured,
      structuredError: a.structuredError,
    }));
    store.setItem(STORAGE_PREFIX + key, JSON.stringify({ version: 1, agents }));
  } catch {
    // Quota ou stockage indisponible : le registre en mémoire reste la vérité.
  }
}

function restore(key: string): LiveAgent[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; agents?: PersistedAgent[] };
    if (!Array.isArray(parsed.agents)) return [];
    return parsed.agents
      .filter((a) => a && typeof a.name === 'string' && typeof a.id === 'string')
      .map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        // Un enfant qui tournait au moment de la fermeture est arrêté, pas repris à l'aveugle.
        status: a.status === 'running' ? 'stopped' : a.status,
        task: a.task || '',
        summary: a.summary || '',
        error: a.error,
        steps: a.steps || 0,
        createdAt: a.createdAt || Date.now(),
        history: Array.isArray(a.history) ? a.history.slice(-MAX_PERSISTED_MESSAGES) : [],
        queue: [],
        allowedTools: new Set(Array.isArray(a.allowedTools) ? a.allowedTools : []),
        projectRoot: a.projectRoot,
        projectName: a.projectName,
        model: a.model,
        reasoningEffort: a.reasoningEffort,
        maxSteps: a.maxSteps || 15,
        outputMaxChars: a.outputMaxChars,
        outputSchema: a.outputSchema,
        structured: a.structured,
        structuredError: a.structuredError,
      }));
  } catch {
    return [];
  }
}

function registryFor(convId: string | undefined): Registry {
  const key = keyOf(convId);
  let reg = registries.get(key);
  if (!reg) {
    reg = { byName: new Map(), byId: new Map(), notifications: [], restored: false };
    registries.set(key, reg);
    for (const agent of restore(key)) {
      if (reg.byName.has(agent.name)) continue;
      reg.byName.set(agent.name, agent);
      reg.byId.set(agent.id, agent);
    }
    reg.restored = true;
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

/** Texte des notifications de fin de travail, consommé par le tour du parent. */
export function takeLiveNotifications(convId: string | undefined): string[] {
  const reg = registryFor(convId);
  const texts = reg.notifications.map((n) => n.text);
  reg.notifications = [];
  return texts;
}

/** Retire les notifications d'un agent déjà lu par wait_agent. */
export function consumeLiveNotification(convId: string | undefined, name: string): void {
  const reg = registryFor(convId);
  reg.notifications = reg.notifications.filter((n) => n.agent !== name);
}

function pushNotification(reg: Registry, agent: LiveAgent): void {
  if (!agent.summary.trim()) return;
  reg.notifications.push({
    agent: agent.name,
    text: `[Sous-agent ${agent.name} (${agent.role}) — ${agent.status === 'error' ? 'échec' : 'terminé'}]\n${agent.summary.slice(0, 1_500)}`,
  });
  // On garde les notifications récentes ; le parent les consomme au prochain pas.
  reg.notifications = reg.notifications.slice(-20);
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

/**
 * Skills du projet, personnelles et intégrées, pour la liste du sous-agent. Une lecture lente
 * (disque réseau, serveur de skills) ne retarde pas le départ de plus de quelques secondes.
 */
const SKILLS_WAIT_MS = 3_000;
async function skillsFor(projectRoot: string): Promise<Skill[]> {
  try {
    const { listSkills } = await import('@/services/skills');
    return await Promise.race([
      listSkills(projectRoot),
      new Promise<Skill[]>((resolve) => setTimeout(() => resolve([]), SKILLS_WAIT_MS)),
    ]);
  } catch {
    return [];
  }
}

/** Ajout au prompt du sous-agent : la sortie structurée demandée, s'il y en a une. */
function systemExtraFor(agent: LiveAgent): string {
  if (!agent.outputSchema) return '';
  return `\n\n# Sortie structurée\nTermine par un unique bloc \`\`\`json … \`\`\` conforme à ce schéma JSON. ` +
    `Aucun texte après le bloc. Si une valeur manque, écris null plutôt que d'inventer.\n${JSON.stringify(agent.outputSchema)}`;
}

/**
 * Rapport rendu au parent : le résumé de l'enfant, complété de son dernier message quand il
 * a été arrêté (étapes ou budget épuisés), et des fichiers réellement touchés relevés par
 * ANZAR — un fait que le parent peut vérifier, même si le résumé l'oublie.
 */
export function reportOf(result: AgentSessionResult): string {
  let text = (result.summary || '').trim();
  if (result.stopReason === 'max_steps' || result.stopReason === 'budget_exhausted') {
    const last = lastText(result.messages).trim();
    if (last && !text.includes(last)) text = `${text}\n\nDernier point de l'agent avant l'arrêt :\n${last.slice(0, 1_500)}`;
  }
  if (result.filesChanged.length) {
    text += `\n\nFichiers touchés (relevé ANZAR) : ${result.filesChanged.slice(0, 30).join(', ')}${result.filesChanged.length > 30 ? '…' : ''}`;
  }
  return text.trim();
}

function lastText(messages: APIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    if (typeof m.content === 'string' && m.content.trim()) return m.content;
    if (Array.isArray(m.content)) {
      const text = m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      if (text.trim()) return text;
    }
  }
  return '';
}

/** Extraction best-effort du dernier bloc ```json et validation superficielle. */
export function parseStructuredOutput(text: string, schema: unknown): { value?: unknown; error?: string } {
  if (!schema) return {};
  const blocks = [...String(text || '').matchAll(/```json\s*([\s\S]*?)```/gi)];
  const raw = blocks.length > 0 ? blocks[blocks.length - 1][1] : (String(text).trim().startsWith('{') ? text : '');
  if (!raw.trim()) return { error: 'aucun bloc ```json trouvé dans la réponse finale' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { error: `JSON invalide (${e instanceof Error ? e.message : String(e)})` };
  }
  const error = validateSchema(value, schema);
  return error ? { error } : { value };
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  if (type === 'integer') return actual === 'integer';
  return actual === type;
}

function sameJson(a: unknown, b: unknown): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/** Validation d'un sous-ensemble de JSON Schema : types, enum, const, oneOf/anyOf/allOf, tableaux. */
function validateSchema(value: unknown, schema: any, path = 'root'): string | null {
  if (schema === true || schema === undefined) return null;
  if (schema === false) return `${path}: valeur interdite par le schéma`;
  if (!schema || typeof schema !== 'object') return null;

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate: unknown) => sameJson(candidate, value))) {
    return `${path}: valeur hors de l'énumération ${JSON.stringify(schema.enum)}`;
  }
  if ('const' in schema && !sameJson(schema.const, value)) {
    return `${path}: valeur différente de const ${JSON.stringify(schema.const)}`;
  }
  if (schema.nullable === true && value === null) return null;

  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf) {
      const err = validateSchema(value, child, path);
      if (err) return err;
    }
  }
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((child: unknown) => validateSchema(value, child, path) === null)) {
      return `${path}: ne correspond à aucune branche anyOf`;
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((child: unknown) => validateSchema(value, child, path) === null).length;
    if (matches !== 1) return `${path}: doit correspondre à exactement une branche oneOf (reçu ${matches})`;
  }

  const declaredTypes: string[] = Array.isArray(schema.type)
    ? schema.type
    : schema.type ? [schema.type] : [];
  if (declaredTypes.length > 0 && !declaredTypes.some((type) => typeMatches(value, type))) {
    return `${path}: type attendu ${declaredTypes.join('|')}, reçu ${typeOf(value)}`;
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return `${path}: chaîne trop courte`;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return `${path}: chaîne trop longue`;
    if (typeof schema.pattern === 'string') {
      try { if (!new RegExp(schema.pattern).test(value)) return `${path}: ne correspond pas au motif`; } catch { /* motif invalide ignoré */ }
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path}: inférieur à minimum`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path}: supérieur à maximum`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${path}: trop peu d'éléments`;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${path}: trop d'éléments`;
    if (schema.items && !Array.isArray(schema.items)) {
      for (let i = 0; i < value.length; i++) {
        const err = validateSchema(value[i], schema.items, `${path}[${i}]`);
        if (err) return err;
      }
    } else if (Array.isArray(schema.items)) {
      for (let i = 0; i < Math.min(value.length, schema.items.length); i++) {
        const err = validateSchema(value[i], schema.items[i], `${path}[${i}]`);
        if (err) return err;
      }
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!(key in obj)) return `${path}: champ requis manquant « ${key} »`;
    }
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (key in obj) {
          const err = validateSchema(obj[key], child, `${path}.${key}`);
          if (err) return err;
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties && typeof schema.properties === 'object') {
      const allowed = new Set(Object.keys(schema.properties));
      const extra = Object.keys(obj).find((key) => !allowed.has(key));
      if (extra) return `${path}: champ non autorisé « ${extra} »`;
    }
  }
  return null;
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
        emit();
        const detach = linkParentAbort(ctx, controller);
        try {
          const skills = await skillsFor(agent.projectRoot);
          const result: AgentSessionResult = await ctx.runSubagent!({
            prompt: { projectName: agent.projectName, projectRoot: agent.projectRoot },
            task,
            history: agent.history,
            subagentRole: agent.role,
            subagentProfile: agent.profile ?? resolveRole(agent.role, ctx.customAgents),
            permissionMode: ctx.permissionMode as PermissionMode | undefined,
            skills,
            systemPromptExtra: systemExtraFor(agent),
            maxSteps: agent.maxSteps,
            model: agent.model,
            reasoningEffort: agent.reasoningEffort,
            budget: agent.budget,
            gitCheckpoint: false,
            autoVerify: false,
            allowedTools: agent.allowedTools,
            subagentDepth: 1,
            convId: ctx.convId,
            agentId: agent.id,
            signal: controller.signal,
            onFileChanged: ctx.onFileChanged,
            onEvent: (ev) => {
              if (ev.type === 'step_start') agent.steps = ev.step;
            },
          });
          // L'historique de reprise ne contient pas le prompt système : il est reconstruit
          // au prochain tour avec les consignes du rôle.
          agent.history = result.messages.filter((m) => m.role !== 'system').slice(-MAX_PERSISTED_MESSAGES);
          agent.summary = reportOf(result);
          agent.steps = result.steps;
          agent.status = result.stopReason === 'error' ? 'error' : (result.stopReason === 'aborted' ? 'stopped' : 'idle');
          if (result.stopReason === 'error') agent.error = result.summary;
          if (agent.outputSchema) {
            const parsed = parseStructuredOutput(lastText(result.messages) || agent.summary, agent.outputSchema);
            agent.structured = parsed.value;
            agent.structuredError = parsed.error;
          }
          pushNotification(registryFor(ctx.convId), agent);
        } catch (e) {
          agent.status = 'error';
          agent.error = e instanceof Error ? e.message : String(e);
          pushNotification(registryFor(ctx.convId), agent);
        } finally {
          detach();
          agent.controller = undefined;
          persist(keyOf(ctx.convId));
          emit();
        }
      }
    } finally {
      if (agent.status === 'running') agent.status = 'idle';
      agent.current = undefined;
      persist(keyOf(ctx.convId));
      emit();
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
  outputSchema?: unknown,
): SpawnLiveResult {
  if ((ctx.subagentDepth ?? 0) >= 1) {
    return { error: 'Profondeur maximale de sous-agents atteinte. Termine cette sous-tâche toi-même.' };
  }
  if (!ctx.runSubagent) {
    return { error: 'Sous-agents indisponibles dans ce contexte.' };
  }
  const text = String(task || '').trim();
  if (!text) return { error: 'La tâche du sous-agent est vide.' };
  if (outputSchema !== undefined && (typeof outputSchema !== 'object' || outputSchema === null || Array.isArray(outputSchema))) {
    return { error: 'output_schema doit être un objet JSON Schema (type, properties, required…).' };
  }

  const reg = registryFor(ctx.convId);
  if (runningCount(reg) >= MAX_LIVE_AGENTS) {
    return { error: `Limite de ${MAX_LIVE_AGENTS} sous-agents actifs atteinte : attends-en un ou termine le travail toi-même.` };
  }
  // Rôle demandé : intégré ou personnalisé. Un nom inconnu est une erreur explicite (faute de
  // frappe, rôle supprimé) plutôt qu'un repli silencieux sur un autre rôle.
  const requestedRole = typeof roleInput === 'string' ? roleInput.trim() : '';
  if (requestedRole && !resolveRole(requestedRole, ctx.customAgents)) {
    return { error: `Rôle inconnu « ${requestedRole} ». Rôles disponibles : ${availableRoles(ctx.customAgents).join(', ')}.` };
  }
  const role: SubagentRole = requestedRole || detectSubagentRole(text, ctx.customAgents);
  const profile = resolveRole(role, ctx.customAgents);
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
    outputMaxChars: profile?.outputMaxChars,
    profile,
    outputSchema,
  };
  reg.byName.set(name, agent);
  reg.byId.set(agent.id, agent);
  persist(keyOf(ctx.convId));
  emit();
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
  if (!ctx.runSubagent) return { error: 'Sous-agents indisponibles dans ce contexte.' };
  const text = String(message || '').trim();
  if (!text) return { error: 'Le message est vide.' };
  // Après un redémarrage, la politique et le budget sont recalculés depuis le contexte.
  const profile = agent.profile ?? resolveRole(agent.role, ctx.customAgents);
  if (profile && !agent.profile) agent.profile = profile;
  if (agent.allowedTools.size === 0) {
    const allNames = [...AGENT_TOOLS, ...BASH_TOOLS].map((t) => t.function.name);
    agent.allowedTools = subagentAllowedTools({
      allToolNames: allNames,
      mode: ctx.permissionMode as PermissionMode | undefined,
      readOnlyTools: READ_ONLY_TOOLS,
      profileTools: profile?.tools,
      deny: profile?.deny,
    });
  }
  if (!agent.budget) agent.budget = ctx.childBudget?.(0.25, profile?.budgetFCFA);
  agent.queue.push(text);
  persist(keyOf(ctx.convId));
  emit();
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

/** Arrête le travail courant d'un enfant (le garde au repos avec son historique). */
export function stopLiveAgent(convId: string | undefined, ref: string): boolean {
  const agent = resolveLiveAgent(convId, ref);
  if (!agent) return false;
  agent.queue = [];
  agent.controller?.abort();
  agent.status = 'stopped';
  persist(keyOf(convId));
  emit();
  return true;
}

/** Arrête et oublie tous les enfants d'une conversation (tests, fermeture). */
export function clearLiveAgents(convId?: string): void {
  const keys = convId ? [keyOf(convId)] : [...registries.keys()];
  for (const key of keys) {
    const reg = registries.get(key);
    if (reg) for (const agent of reg.byId.values()) agent.controller?.abort();
    registries.delete(key);
    try { storage()?.removeItem(STORAGE_PREFIX + key); } catch { /* ignore */ }
  }
  emit();
}

/** Tests : vide les registres mémoire sans effacer le stockage (simule un redémarrage). */
export function resetLiveRegistryForTests(): void {
  registries.clear();
  listeners.clear();
}
