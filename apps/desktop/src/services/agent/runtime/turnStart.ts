/**
 * Ouverture d'un tour : dossier de travail, pièces jointes, messages affichés, historique,
 * budget, route Auto, skills, connecteurs et vérificateur.
 *
 * La préparation ne décide de rien sur le déroulé : elle construit l'état du tour (`session`
 * pour ce qui ne bouge pas, `progress` pour ce qui évolue) et le rend à `runTurn`.
 */
import type {
  AIModel, ChatAttachment, Message, TimelineItem, ToolDefinition, ToolEvent,
} from '@/types';
import type { ExternalSource } from '@/services/agent/policy/untrusted';
import { BACKGROUND_BUDGET, BudgetLedger, CHAT_BUDGET } from '@/services/agent/engine/budget';
import { loadSession, recordSessionEvent, saveSession } from './sessionStore';
import { loadPersonalInstructions, personalInstructionsSection } from '@/services/workspace/personalInstructions';
import { mcpAgentTools, setMcpRoots } from '@/services/mcp/manager';
import { listSkills, type Skill } from '@/services/skills';
import { useSettingsStore } from '@/stores/settingsStore';
import { withAttachments } from '@/services/agent/context/attachments';
import { resolveAgentRoot } from '@/services/agent/context/agentRoot';
import { useChatStore } from '@/stores/chatStore';
import { useUsageStore } from '@/stores/usageStore';
import { refreshCredits } from '@/lib/credits';
import { routeRequest, type Route } from '@/services/ai/autoRouter';
import { appendTimelineText, appendTimelineTool, snapshotTimeline } from '@/services/agent/engine/chatSession';
import type { Snapshots } from '@/services/agent/tools/fileChanges';
import { copyAttachmentsToWorkspace } from '@/services/workspace/attachmentFiles';
import {
  PERSONAL_SUBDIR, conversationUsesPersonalSpace, ensurePersonalSpace, personalSpaceContext,
} from '@/services/workspace/personalSpace';
import type { AgentStopReason } from '@/services/agent/engine/agentSession';
import type { TurnToolState } from './toolHost';
import type { TurnSink } from './turnFallbacks';
import { newServerCost, type ServerCost } from './turnAccounting';
import type { TurnHost, TurnInput } from './turnTypes';
import { createTurnVerifier, type TurnVerifier } from './turnVerify';
import { autoVerifyAllowed } from '../policy/isolation';

/** Ce qui évolue pendant le tour et doit être lu par les fermetures de la préparation. */
export interface TurnProgress {
  content: string;
  reasoning: string;
  promptTokens: number;
  completionTokens: number;
  stepContent: string;
  stepReasoning: string;
  stepTokensIn: number;
  stepCostAtStart: number;
  retryNoticeShown: boolean;
  route: Route | null;
  toolErrors: number;
  escalations: number;
  stopReason: AgentStopReason;
  costFCFA?: number;
}

/** Ce qui est fixé à l'ouverture du tour. */
export interface TurnSession {
  convId: string;
  agentRoot: string | null;
  workspacePath: string | null;
  workspaceName?: string;
  model: AIModel;
  background: boolean;
  personalSpace: boolean;
  attachments: ChatAttachment[];
  apiContent: string;
  userMsg: Message;
  assistantId: string;
  controller: AbortController;
  onFileChanged?: (relativePath: string, action: 'create' | 'edit' | 'delete') => void;
  budget: BudgetLedger;
  balanceBefore: number | null;
  cost: ServerCost;
  startedAt: number;
  events: ToolEvent[];
  timeline: TimelineItem[];
  snapshots: Snapshots;
  externalSources: ExternalSource[];
  turn: TurnToolState;
  toolEvents: Map<string, ToolEvent>;
  skills: Skill[];
  personal: string;
  webEnabled: boolean;
  mcpTools: ToolDefinition[];
  verifier: TurnVerifier;
  flush: (liveText?: string) => void;
  flushLive: (liveText: string) => void;
  appendContent: (text: string) => void;
  sink: TurnSink;
  persist: () => void;
  offBudget: () => void;
  callModel: () => AIModel;
}

export interface TurnStarted {
  session: TurnSession;
  progress: TurnProgress;
}

/** Prépare un tour. Peut lever : l'appelant décide alors de l'échec. */
export async function startTurn(host: TurnHost, input: TurnInput): Promise<TurnStarted> {
  const { content, rawAttachments = [], resumeFrom } = input;
  const { workspacePath, workspaceName, model, background = false, onFileChanged } = host.opts;
  const { addMessage, updateMessage, setIsGenerating: setStoreGenerating } = useChatStore.getState();
  const { addRecordAndDeduct: addUsage, addRecord: addUsageRecord } = useUsageStore.getState();

    // Ce que le tour accumule et fera évoluer : lu par les fermetures ci-dessous.
    const p: TurnProgress = {
      content: resumeFrom?.accContent ?? '',
      reasoning: '',
      promptTokens: resumeFrom?.promptTokens ?? 0,
      completionTokens: resumeFrom?.completionTokens ?? 0,
      stepContent: '',
      stepReasoning: '',
      stepTokensIn: 0,
      stepCostAtStart: 0,
      retryNoticeShown: false,
      route: null,
      toolErrors: 0,
      escalations: 0,
      stopReason: 'error',
      costFCFA: undefined,
    };

    const refd = rawAttachments.slice(0, 8).map((a, i) => ({ ...a, ref: a.ref || String.fromCharCode(65 + i) }));
    const convId = resumeFrom?.convId ?? input.conversationId ?? host.ensureConversation();
    if (!resumeFrom) host.userRequest = content.slice(0, 2000);
    // Dossier où l'agent peut agir : le projet ouvert, ou à défaut l'« espace ANZAR ».
    const conv = !workspacePath && !background
      ? useChatStore.getState().conversations.find((c) => c.id === convId)
      : undefined;
    const root = await resolveAgentRoot({
      workspacePath,
      background,
      conversationId: convId,
      content,
      attachments: refd,
      personalConversations: host.personalConvs,
      conversationPersonalSpace: conversationUsesPersonalSpace(conv),
      ensurePersonalSpace,
    });
    const agentRoot = root.agentRoot;
    const personalSpace = root.personalSpace;
    if (personalSpace) {
      host.personalConvs.add(convId);
      // Mémorisé dans la conversation : l'espace reste ouvert après un redémarrage de l'app
      if (!conv?.personalSpace) {
        useChatStore.setState((st) => ({
          conversations: st.conversations.map((c) => (c.id === convId ? { ...c, personalSpace: true } : c)),
        }));
      }
    }

    // Copie des fichiers joints dans le dossier de travail : l'agent peut alors les transformer (pas seulement les lire)
    const attachments = agentRoot && !resumeFrom
      ? await copyAttachmentsToWorkspace(agentRoot, refd,
          personalSpace ? { subdir: PERSONAL_SUBDIR, gitignore: false } : {}).catch(() => refd)
      : refd;
    const apiContent = withAttachments(content, attachments);
    if (!resumeFrom) host.resumeState = null; // un nouveau message rend l'ancienne reprise caduque

    // Reset de l'historique API si on change de conversation
    if (!resumeFrom && host.activeConv !== convId) {
      // Session enregistrée (redémarrage, crash, autre fenêtre) : l'agent garde tout son contexte.
      const saved = await loadSession(convId).catch(() => null);
      host.apiHistory = saved ?? [];
      host.lastCallAt = 0;
      host.lastRoute = null;
      host.activeConv = convId;
    }

    const controller = new AbortController();
    host.abort = controller;
    host.setState({ isGenerating: true });
    if (!background) setStoreGenerating(true);

    const userMsg: Message = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content,
      timestamp: Date.now(),
      // Affichage : nom et type seulement (le contenu part au modèle, pas dans l'historique local)
      attachments: attachments.length
        ? attachments.map(({ excerpt: _excerpt, dataUrl: _data, sourcePath: _src, ...rest }) => rest)
        : undefined,
    };
    if (!resumeFrom) addMessage(userMsg, convId);
    if (!resumeFrom) recordSessionEvent(convId, { type: 'user', chars: content.length, attachments: attachments.length });
    /** Écrit la session sur disque (historique + journal) ; jamais bloquant. */
    const persist = () => { void saveSession(convId, host.apiHistory); };

    const assistantId = resumeFrom?.assistantId ?? `msg_${Date.now()}_a`;
    if (resumeFrom) {
      // Reprise : on continue DANS la même réponse, sans le message d'erreur
      updateMessage(assistantId, {
        content: resumeFrom.accContent,
        timeline: resumeFrom.timeline.map((t) => ({ ...t })),
        isStreaming: true,
        isError: false,
        resumable: false,
        toolEvents: [...resumeFrom.events],
      });
    } else {
      addMessage({
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        model,
        isStreaming: true,
        toolEvents: [],
      }, convId);
    }

    const events: ToolEvent[] = resumeFrom?.events ?? [];
    const snapshots: Snapshots = resumeFrom?.snapshots ?? new Map();
    const t0 = Date.now();
    // Solde serveur avant la tâche : la différence à la fin = coût réel facturé.
    const balanceBefore = resumeFrom ? resumeFrom.balanceBefore : await refreshCredits();
    const cost: ServerCost = resumeFrom?.cost ?? newServerCost();
    // Budget du tour : plafonds FCFA/durée (le moteur y ajoute les étapes). Sans plafond
    // explicite, un tour interactif et un travail de fond n'ont pas le même risque.
    const budget = new BudgetLedger(host.opts.budget ?? (background ? BACKGROUND_BUDGET : CHAT_BUDGET));
    host.setState({ budget: budget.view() });
    const offBudget = budget.onChange((view) => host.setState({ budget: view }));
    // Mode Auto : réglage choisi pour cette demande ; il peut monter d'un cran si l'agent bute
    p.route = resumeFrom ? resumeFrom.route ?? null : model === 'auto'
      ? routeRequest({
          text: content,
          workspace: !!workspacePath,
          planMode: host.mode === 'plan',
          images: attachments.filter((a) => a.kind === 'image').length,
          attachmentChars: attachments.reduce((n, a) => n + (a.excerpt?.length || 0), 0),
          previous: host.lastRoute?.mode,
        })
      : null;
    const callModel = (): AIModel => (p.route ? p.route.mode : model === 'auto' ? 'thinking' : model);
    if (p.route) { updateMessage(assistantId, { autoRoute: p.route }); host.lastRoute = p.route; }
    // Contenus externes (web, connecteurs) lus pendant cette demande : les commandes et
    // actions de connecteur qui suivent demandent l'accord (voir policy/untrusted.ts)
    const externalSources: ExternalSource[] = [];
    // Chronologie affichée : texte et actions dans l'ordre où l'agent les produit
    const timeline: TimelineItem[] = resumeFrom ? resumeFrom.timeline.map((t) => ({ ...t })) : [];

    /** Met à jour l'affichage ; `liveText` = texte en cours d'écriture de l'étape. */
    const flush = (liveText = '') => {
      updateMessage(assistantId, {
        content: liveText ? p.content + (p.content ? '\n\n' : '') + liveText : p.content,
        timeline: snapshotTimeline(timeline, liveText),
        reasoning: p.reasoning ? [p.reasoning] : undefined,
        isStreaming: true,
        toolEvents: [...events],
      });
    };
    // Texte en direct, au plus ~16 rafraîchissements par seconde
    let lastLiveFlush = 0;
    const flushLive = (liveText: string) => {
      const now = Date.now();
      if (now - lastLiveFlush < 60) return;
      lastLiveFlush = now;
      flush(liveText);
    };
    /** Ajoute du texte à la réponse ET à la chronologie (texte de l'agent, y compris hors moteur). */
    const appendContent = (text: string) => {
      p.content += (p.content ? '\n\n' : '') + text;
      appendTimelineText(timeline, text);
    };

    // Skills du projet et personnelles : la liste va dans le prompt, le contenu via load_skill
    const skills: Skill[] = workspacePath ? await listSkills(workspacePath).catch(() => []) : [];
    const personal = personalInstructionsSection(await loadPersonalInstructions().catch(() => ''));
    // Recherche web (Search / Fetch DeepSeek) : désactivable dans les Paramètres
    const webEnabled = useSettingsStore.getState().settings.webTools !== false;
    // Connecteurs MCP activés (Context7, Playwright, GitHub…) : un serveur lent ne bloque pas le départ
    setMcpRoots(workspacePath ? [workspacePath] : []);
    const mcpTools = await mcpAgentTools({ waitMs: 8_000 }).catch(() => []);

    // État mutable du tour (partagé entre la boucle et l'hôte d'outils)
    const turn: TurnToolState = { stepImages: [], doneInBatch: false, filesWritten: 0, planProposed: false };
    const toolEvents = new Map<string, ToolEvent>();

    // Affichage + comptabilité vus par les replis (sauvetage d'export, synthèse forcée)
    const sink: TurnSink = {
      appendContent,
      flush: () => flush(),
      flushLive: (text) => flushLive(text),
      addToolEvent: (ev) => {
        toolEvents.set(ev.id, ev);
        events.push(ev);
        appendTimelineTool(timeline, ev.id);
        flush();
      },
      addModelCost: (c) => {
        cost.sum += c;
        cost.reports++;
        budget.charge({ fcfa: c });
        host.opts.onProgress?.({ costFCFA: cost.sum });
      },
      onModelCall: () => {
        cost.calls++;
        host.lastCallAt = Date.now();
      },
      addPromptTokens: (n) => { p.promptTokens += n; },
      addCompletionTokens: (n) => { p.completionTokens += n; },
    };

    // Vérification : référence avant la première écriture, contrôle ciblé au task_done.
    const verifier = createTurnVerifier({
      enabled: !!workspacePath && !!agentRoot
        && useSettingsStore.getState().settings.autoVerifyAfterApply !== false
        // Référence prise avant la première écriture : elle lance aussi des commandes.
        && autoVerifyAllowed(host.mode),
      convId,
      agentRoot,
      background,
      signal: controller.signal,
      addEvent: (ev) => sink.addToolEvent(ev),
      flush,
      requestApproval: host.requestApproval,
      fullAccess: () => host.mode === 'full',
      recordSessionEvent,
      changedFiles: () => [...snapshots.keys()],
    });


  return {
    session: {
      convId, agentRoot, workspacePath, workspaceName, model, background, personalSpace,
      attachments, apiContent, userMsg, assistantId, controller, onFileChanged,
      budget, balanceBefore, cost, startedAt: t0, events, timeline, snapshots,
      externalSources, turn, toolEvents, skills, personal, webEnabled, mcpTools,
      verifier, flush, flushLive, appendContent, sink, persist, offBudget, callModel,
    },
    progress: p,
  };
}
