/**
 * useAgentChat — LE chat ANZAR (style ZCode).
 *
 * Une seule boucle : l'utilisateur parle, l'agent agit avec ses outils
 * (read_file, edit_file, run_command…) en streaming, jusqu'à réponse finale.
 * Plus aucune détection d'intention, plus d'injection de dossier en bloc :
 * l'agent lit les fichiers À LA DEMANDE via ses outils.
 *
 * Réutilise tels quels : aiService.chatStream, AGENT_TOOLS + executeToolCall
 * (sécurité Tauri allowlist + anti-traversal), buildAgentSystemPrompt/context,
 * usageStore (débit FCFA), chatStore (persistance conversation).
 */
import { commandRisk, noteAgentWrite } from '@/services/agent/commandGuard';
import { ToolCallAssembler } from '@/services/agent/toolCallAssembler';
import { DEFAULT_MAX_STEPS, runAgentEngine, type AgentStopReason, type AgentToolOutcome } from '@/services/agent/agentSession';
import {
  closeDanglingToolCalls, compactHistory, historyChars,
  KEEP_RECENT_TOOL_RESULTS, SOFT_LIMIT_CHARS, STUB_CHARS, SKILL_RESULT_PREFIX,
} from '@/services/agent/history';
import { READ_ONLY_TOOLS, type PermissionMode } from '@/services/agent/permissions';
import { summarizeArgs, toolDelta, toolFilePath } from '@/services/agent/toolDisplay';
import { approvalDecision } from '@/services/agent/toolPolicy';
import { executeGenericTool } from '@/services/agent/toolExecution';
export type { PermissionMode } from '@/services/agent/permissions';
import { loadPersonalInstructions, personalInstructionsSection } from '@/services/workspace/personalInstructions';
import { useCallback, useRef, useState } from 'react';
import { aiService, markSlowNetwork } from '@/services/ai/ai';
import { AGENT_TOOLS, executeToolCall } from '@/services/agent/agentTools';
import { WEB_TOOLS } from '@/services/agent/webTools';
import { useSettingsStore } from '@/stores/settingsStore';
import { buildSessionSystemPrompt } from '@/services/agent/systemPrompt';
import { withAttachments } from '@/services/agent/attachments';
import { resolveAgentRoot } from '@/services/agent/agentRoot';
import { buildAgentContext } from '@/services/agent/agentContext';
import { useChatStore } from '@/stores/chatStore';
import { useUsageStore } from '@/stores/usageStore';
import { refreshCredits } from '@/lib/credits';
import { routeRequest, escalate, type Route } from '@/services/ai/autoRouter';
import type { QuestionRequest, QuestionAnswer } from '@/services/agent/questions';
import { askUser, loadSkill, parsePlan } from '@/services/agent/specialTools';
import {
  appendTimelineText, appendTimelineTool, computeSessionCost,
  estimateCompletionTokens, estimateHistoryTokens, hasExactCost, snapshotTimeline,
} from '@/services/agent/chatSession';
import { detectDevCommand } from '@/services/agent/devServer';
import { mcpAgentTools, isMcpTool, mcpToolRef, mcpNeedsApproval, setMcpRoots } from '@/services/mcp/manager';
import { listSkills, skillsPromptSection, findSkill, readSkillFile, skillToolOutput, type Skill } from '@/services/skills';
import { snapshotBeforeChange, collectChanges, type Snapshots } from '@/services/agent/fileChanges';
import { copyAttachmentsToWorkspace } from '@/services/workspace/attachmentFiles';
import { PERSONAL_SPACE_TOOLS, PERSONAL_SUBDIR, conversationUsesPersonalSpace, ensurePersonalSpace, personalSpaceContext } from '@/services/workspace/personalSpace';
import type { AIModel, APIMessage, ChatAttachment, Message, TimelineItem, ToolDefinition, ToolEvent } from '@/types';
export type { TimelineItem, ToolEvent } from '@/types';

/** Demande d'accord en attente (modes « ask » et « auto »). */
export interface ApprovalRequest {
  id: string;
  name: string;
  summary: string;
  /** Pourquoi l'accord est demandé alors que le mode ne l'exige pas (commande à risque) */
  reason?: string;
  /** Ce qui va réellement s'exécuter (corps d'un script npm) */
  detail?: string;
  /** Portée de l'accord quand elle dépasse cette seule action */
  scope?: string;
}

/** Attente avant chaque nouvelle tentative quand une étape est coupée (ms). */
const RETRY_DELAYS = [2000, 5000, 10000];

/** Une erreur de solde ou d'authentification ne se règle pas en réessayant. */
function isRetryable(e: any): boolean {
  const msg = String(e?.message || '');
  return !/cr[ée]dit|quota|solde|recharge|401|402|403|non autoris|unauthori[sz]ed|token/i.test(msg);
}

/** Tout ce qu'il faut pour reprendre une réponse là où elle s'est arrêtée. */
interface ResumeState {
  convId: string;
  assistantId: string;
  accContent: string;
  timeline: TimelineItem[];
  events: ToolEvent[];
  snapshots: Snapshots;
  promptTokens: number;
  completionTokens: number;
  balanceBefore: number | null;
  cost: ServerCost;
  /** Mode Auto : réglage en cours au moment de la coupure */
  route?: Route | null;
}

/** Coûts exacts envoyés par le serveur pour chaque appel au modèle (B6) */
interface ServerCost { sum: number; reports: number; calls: number }

/** Début du message qui montre au modèle les captures d'écran de capture_page */
const CAPTURE_MARK = "[Captures d'écran de capture_page]";

/** Charge les instructions complètes d'une skill (la liste seule est dans le prompt). */
const LOAD_SKILL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'load_skill',
    description: "Charge les instructions complètes d'une skill de la liste « Skills disponibles ». À utiliser avant d'agir quand une skill correspond à la tâche. Avec file : lit un fichier joint de la skill.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nom exact de la skill' },
        file: { type: 'string', description: 'Facultatif : chemin d\'un fichier joint, tel que listé après les instructions de la skill' },
      },
      required: ['name'],
    },
  },
};

/** Questions à choix posées à l'utilisateur (panneau au-dessus de la saisie, comme dans Claude Code). */
const ASK_USER_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ask_user',
    description:
      "Pose 1 à 4 questions à choix à l'utilisateur et attend ses réponses. À utiliser quand une décision lui revient et change ce que tu vas faire " +
      "(approche, technologie, périmètre, choix de design), avant de te lancer dans un travail coûteux à refaire. " +
      "Pour chaque question : 2 à 4 options concrètes et courtes, recommended = l'index de celle que tu conseilles — OBLIGATOIRE et pertinent : " +
      "sans réponse de l'utilisateur après ~25 secondes, les options recommandées sont validées automatiquement et le travail continue. " +
      "Il peut aussi répondre librement. N'utilise pas cet outil pour ce que tu peux décider toi-même ou trouver dans le code, " +
      "ni pour demander la permission de continuer (demande-la seulement via une question avec un défaut sûr).",
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '1 à 4 questions',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'La question, claire et autonome' },
              header: { type: 'string', description: 'Étiquette très courte (2 ou 3 mots), ex : « Base de données »' },
              options: {
                type: 'array',
                description: '2 à 4 réponses proposées',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Réponse courte' },
                    description: { type: 'string', description: 'Ce que ce choix implique, en une ligne' },
                  },
                  required: ['label'],
                },
              },
              recommended: { type: 'integer', description: "Index (à partir de 0) de l'option recommandée" },
              multi_select: { type: 'boolean', description: 'Plusieurs réponses possibles' },
            },
            required: ['question', 'options'],
          },
        },
      },
      required: ['questions'],
    },
  },
};

/** Outil réservé au mode plan : le plan s'affiche dans l'onglet « Plan » (comme ExitPlanMode dans ZCode). */
const PROPOSE_PLAN_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'propose_plan',
    description: "Mode plan uniquement : soumet le plan d'action à l'utilisateur pour validation. À appeler une seule fois, quand le plan est prêt.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre court du plan (moins de 60 caractères)' },
        plan: { type: 'string', description: 'Plan complet en Markdown : étapes numérotées, fichiers concernés, vérifications, risques' },
      },
      required: ['title', 'plan'],
    },
  },
};

const MAX_STEPS = DEFAULT_MAX_STEPS;
const MAX_TOOL_OUTPUT_DISPLAY = 600;

const CACHE_COLD_MS = 30 * 60 * 1000; // au-delà, le cache fournisseur a pu être vidé

interface UseAgentChatParams {
  workspacePath: string | null;
  workspaceName?: string;
  model: AIModel;
  /** Mode de permission (défaut : auto). */
  permissionMode?: PermissionMode;
  /** Appelé quand un outil modifie un fichier (refresh explorateur/éditeur). */
  onFileChanged?: (relativePath: string, action: 'create' | 'edit' | 'delete') => void;
  /** Exécution en arrière-plan (automatisations) : ne touche pas à l'indicateur global. */
  background?: boolean;
  /** Après chaque appel au modèle et chaque outil : coût cumulé (FCFA) de la réponse en cours. Sert au watchdog des tickets. */
  onProgress?: (p: { costFCFA: number }) => void;
}

/** Résultat structuré d'un tour, pour les tickets/automatisations. */
export interface AgentChatResult {
  stopReason: AgentStopReason;
  content: string;
  costFCFA?: number;
  filesChanged: string[];
  isError: boolean;
  conversationId: string;
  assistantId: string;
}

// Conversations où l'utilisateur a déjà autorisé l'exécution du code écrit par
// l'agent dans l'espace ANZAR : UN accord par conversation, persistant entre
// les remontées de vue et les redémarrages de l'app (avant : Set en mémoire,
// perdu à chaque navigation → re-demandes à répétition).
const TRUSTED_CONVS_KEY = 'anzar.trustedConvs';
function loadTrustedConvs(): Set<string> {
  try {
    const raw = localStorage.getItem(TRUSTED_CONVS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
const trustedConvs = loadTrustedConvs();
function trustConversation(id: string) {
  trustedConvs.add(id);
  try {
    const arr = [...trustedConvs].slice(-300); // borne mémoire
    localStorage.setItem(TRUSTED_CONVS_KEY, JSON.stringify(arr));
  } catch { /* stockage indisponible */ }
}

export function useAgentChat({ workspacePath, workspaceName, model, permissionMode = 'auto', onFileChanged, background = false, onProgress }: UseAgentChatParams) {
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const [isGenerating, setIsGenerating] = useState(false);
  // Le mode peut changer pendant que l'agent travaille : on lit toujours la valeur courante.
  const modeRef = useRef(permissionMode);
  modeRef.current = permissionMode;
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const approvalResolver = useRef<((ok: boolean) => void) | null>(null);
  /** Conversations de l'espace ANZAR où l'utilisateur a déjà autorisé le code écrit par l'agent */
  
  const resolveApproval = useCallback((ok: boolean) => {
    approvalResolver.current?.(ok);
    approvalResolver.current = null;
    setApproval(null);
  }, []);
  // Questions de l'agent (ask_user) : null = l'utilisateur passe, l'agent décide
  const [question, setQuestion] = useState<QuestionRequest | null>(null);
  const questionResolver = useRef<((answers: QuestionAnswer[] | null) => void) | null>(null);
  const resolveQuestion = useCallback((answers: QuestionAnswer[] | null) => {
    questionResolver.current?.(answers);
    questionResolver.current = null;
    setQuestion(null);
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  // Historique API complet de la conversation (tool exchanges inclus), par conversation
  const apiHistoryRef = useRef<APIMessage[]>([]);
  // Mode Auto : réglage de la dernière demande (une suite courte le garde)
  const lastRouteRef = useRef<Route | null>(null);
  // Conversations sans projet qui travaillent dans l'espace ANZAR
  const personalConvsRef = useRef<Set<string>>(new Set());
  // Heure du dernier appel au modèle : sert à savoir si le cache DeepSeek est encore chaud
  const lastCallAtRef = useRef(0);
  // Demande initiale (garantie d'export motion)
  const userRequestRef = useRef('');
  const activeConvRef = useRef<string | null>(null);
  const resumeRef = useRef<ResumeState | null>(null);

  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setStoreGenerating = useChatStore((s) => s.setIsGenerating);
  const addUsage = useUsageStore((s) => s.addRecordAndDeduct);
  const addUsageRecord = useUsageStore((s) => s.addRecord);

  const ensureConversation = useCallback((): string => {
    // Toujours lire l'état FRAIS du store : une closure périmée (effet de
    // replay au démarrage) créerait une 2ᵉ conversation orpheline (B4).
    const current = useChatStore.getState().activeConversationId;
    if (current) return current;
    return useChatStore.getState().createConversation(undefined, model).id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    resolveApproval(false);
    resolveQuestion(null);
  }, [resolveApproval, resolveQuestion]);

  const sendMessage = useCallback(async (
    content: string,
    rawAttachments: ChatAttachment[] = [],
    resumeFrom?: ResumeState,
    /** Tâche cible (automatisations) ; par défaut la tâche affichée */
    opts?: { conversationId?: string },
  ): Promise<AgentChatResult | null> => {
    if ((!content.trim() && !resumeFrom) || isGenerating) return null;
    const refd = rawAttachments.slice(0, 8).map((a, i) => ({ ...a, ref: a.ref || String.fromCharCode(65 + i) }));
    const convId = resumeFrom?.convId ?? opts?.conversationId ?? ensureConversation();
    if (!resumeFrom) userRequestRef.current = content.slice(0, 2000);
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
      personalConversations: personalConvsRef.current,
      conversationPersonalSpace: conversationUsesPersonalSpace(conv),
      ensurePersonalSpace,
    });
    const agentRoot = root.agentRoot;
    const personalSpace = root.personalSpace;
    if (personalSpace) {
      personalConvsRef.current.add(convId);
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
    if (!resumeFrom) resumeRef.current = null; // un nouveau message rend l'ancienne reprise caduque

    // Reset de l'historique API si on change de conversation
    if (!resumeFrom && activeConvRef.current !== convId) {
      apiHistoryRef.current = [];
      lastCallAtRef.current = 0;
      lastRouteRef.current = null;
      activeConvRef.current = convId;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
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

    let accContent = resumeFrom?.accContent ?? '';
    let accReasoning = '';
    const events: ToolEvent[] = resumeFrom?.events ?? [];
    const snapshots: Snapshots = resumeFrom?.snapshots ?? new Map();
    let promptTokens = resumeFrom?.promptTokens ?? 0;
    let completionTokens = resumeFrom?.completionTokens ?? 0;
    const t0 = Date.now();
    // Solde serveur avant la tâche : la différence à la fin = coût réel facturé.
    const balanceBefore = resumeFrom ? resumeFrom.balanceBefore : await refreshCredits();
    const cost: ServerCost = resumeFrom?.cost ?? { sum: 0, reports: 0, calls: 0 };
    // Repli si le serveur n'envoie pas le coût exact (FCFA / 1M tokens, ordre de grandeur)
    const priceIn = 250;
    const priceOut = 1000;
    // Mode Auto : réglage choisi pour cette demande ; il peut monter d'un cran si l'agent bute
    let route: Route | null = resumeFrom ? resumeFrom.route ?? null : model === 'auto'
      ? routeRequest({
          text: content,
          workspace: !!workspacePath,
          planMode: modeRef.current === 'plan',
          images: attachments.filter((a) => a.kind === 'image').length,
          attachmentChars: attachments.reduce((n, a) => n + (a.excerpt?.length || 0), 0),
          previous: lastRouteRef.current?.mode,
        })
      : null;
    const callModel = (): AIModel => (route ? route.mode : model === 'auto' ? 'thinking' : model);
    if (route) { updateMessage(assistantId, { autoRoute: route }); lastRouteRef.current = route; }
    let toolErrors = 0;
    let escalations = 0;
    // Chronologie affichée : texte et actions dans l'ordre où l'agent les produit
    const timeline: TimelineItem[] = resumeFrom ? resumeFrom.timeline.map((t) => ({ ...t })) : [];

    /** Met à jour l'affichage ; `liveText` = texte en cours d'écriture de l'étape. */
    const flush = (liveText = '') => {
      updateMessage(assistantId, {
        content: liveText ? accContent + (accContent ? '\n\n' : '') + liveText : accContent,
        timeline: snapshotTimeline(timeline, liveText),
        reasoning: accReasoning ? [accReasoning] : undefined,
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

    // Skills du projet et personnelles : la liste va dans le prompt, le contenu via load_skill
    const skills: Skill[] = workspacePath ? await listSkills(workspacePath).catch(() => []) : [];
    const personal = personalInstructionsSection(await loadPersonalInstructions().catch(() => ''));
    // Recherche web (Search / Fetch DeepSeek) : désactivable dans les Paramètres
    const webEnabled = useSettingsStore.getState().settings.webTools !== false;
    // Connecteurs MCP activés (Context7, Playwright, GitHub…) : un serveur lent ne bloque pas le départ
    setMcpRoots(workspacePath ? [workspacePath] : []);
    const mcpTools = await mcpAgentTools({ waitMs: 8_000 }).catch(() => []);

    let finalStopReason: AgentStopReason = 'error';
    let finalCostFCFA: number | undefined;

    try {
      if (resumeFrom) {
        closeDanglingToolCalls(apiHistoryRef.current);
      } else {
        // ── System prompt : agent si workspace, chat simple sinon ──
        // Cache DeepSeek : le début de la requête doit rester IDENTIQUE d'un appel à l'autre
        // (un token servi par le cache coûte ~2 % du prix normal). Le prompt système ne
        // contient donc que ce qui change rarement ; la carte du code, les indices de la
        // tâche et le mode plan vont dans le message de la demande, en fin de requête.
        let system: APIMessage;
        let turnContext = '';
        // Partie fixe du prompt système, et ce qui peut changer en cours de conversation
        // (mémoire ANZAR.md, skills, instructions personnelles)
        let systemHead = '';
        let systemRefresh = '';
        const freshHistory = apiHistoryRef.current.length === 0;
        const ctx = workspacePath
          ? await buildAgentContext(workspacePath, content).catch(() => null)
          : null;
        const bundle = buildSessionSystemPrompt({
          workspacePath,
          workspaceName,
          freshHistory,
          planMode: modeRef.current === 'plan',
          webEnabled,
          personal,
          skillsSection: skillsPromptSection(skills),
          memory: ctx?.memory,
          codeMap: ctx?.codeMap,
          taskHints: ctx?.taskHints,
          platform: navigator.platform.toLowerCase().includes('win') ? 'windows' : 'macos',
          personalSpaceContext: personalSpace && agentRoot ? personalSpaceContext(agentRoot) : '',
        });
        system = bundle.system;
        systemHead = bundle.systemHead;
        systemRefresh = bundle.systemRefresh;
        turnContext = bundle.turnContext;

        if (apiHistoryRef.current.length === 0) {
          // Reprise d'une conversation existante (redémarrage, changement de tâche) :
          // on redonne à l'agent les échanges texte précédents.
          const prior = (useChatStore.getState().conversations.find((c) => c.id === convId)?.messages || [])
            .filter((m) => m.id !== userMsg.id && m.id !== assistantId)
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }) as APIMessage);
          apiHistoryRef.current.push(system, ...prior);
        } else {
          const prev = apiHistoryRef.current[0];
          const prevText = typeof prev?.content === 'string' ? prev.content : '';
          if (prev?.role !== 'system' || !prevText.startsWith(systemHead)) {
            // Autre projet, passage chat ↔ agent ou nouvelle version de l'app : prompt remplacé
            apiHistoryRef.current[0] = system;
          } else if (prevText !== system.content && systemRefresh) {
            // Seules la mémoire, les skills ou les instructions ont changé : on garde le prompt
            // d'origine (servi par le cache) et on donne la version à jour dans la demande.
            turnContext += `\n\n---\n# Contexte mis à jour (remplace celui du début de la conversation)\n${systemRefresh}`;
          }
          // Si la réponse précédente a été coupée, l'historique doit rester valide pour « continue »
          closeDanglingToolCalls(apiHistoryRef.current);
        }
        // Les résultats d'outils des demandes précédentes ne servent plus qu'en résumé. On ne
        // les raccourcit que si le cache est froid ou l'historique trop long : sinon, les garder
        // tels quels coûte bien moins cher (servis par le cache) que de tout renvoyer modifié.
        if (Date.now() - lastCallAtRef.current > CACHE_COLD_MS || historyChars(apiHistoryRef.current) > SOFT_LIMIT_CHARS) {
          compactHistory(apiHistoryRef.current, 0, 300);
        }
        // Le raisonnement des demandes précédentes n'est plus utile au modèle (DeepSeek accepte
        // qu'on le retire entre deux demandes) : on l'enlève pour ne pas le repayer.
        for (let i = 0; i < apiHistoryRef.current.length; i++) {
          const m = apiHistoryRef.current[i];
          if (m.reasoning_content) apiHistoryRef.current[i] = { ...m, reasoning_content: undefined };
          // Images des demandes précédentes : déjà analysées, on ne les renvoie plus (connexions lentes)
          if (m.role === 'user' && Array.isArray(m.content)) {
            const text = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
            const n = m.content.filter((p) => p.type === 'image_url').length;
            apiHistoryRef.current[i] = {
              ...apiHistoryRef.current[i],
              content: text.startsWith(CAPTURE_MARK)
                ? `(${n} capture${n > 1 ? 's' : ''} d'écran prise${n > 1 ? 's' : ''} par capture_page, déjà examinée${n > 1 ? 's' : ''}.)`
                : `${text}\n\n(${n} image${n > 1 ? 's' : ''} jointe${n > 1 ? 's' : ''} à cette demande, déjà analysée${n > 1 ? 's' : ''} dans ta réponse.)`,
            };
          }
        }
        // Images jointes : envoyées au modèle (deepseek-flash est multimodal)
        const images = attachments.filter((a) => a.kind === 'image' && a.dataUrl).slice(0, 8);
        apiHistoryRef.current.push({
          role: 'user',
          content: images.length
            ? [
                { type: 'text', text: apiContent + turnContext },
                ...images.map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl!, detail: 'auto' as const } })),
              ]
            : apiContent + turnContext,
        });
      }

      let answered = false;
      let planProposed = false;

      let stepContent = '';
      let stepReasoning = '';
      let stepImages: { label: string; dataUrl: string }[] = [];
      let doneInBatch = false;
      let retryNoticeShown = false;
      const toolEvents = new Map<string, ToolEvent>();

      const toolsForStep = (): ToolDefinition[] | undefined => {
        const web = webEnabled ? WEB_TOOLS : [];
        // Sans personne devant l'écran (automatisations, tickets), pas de question possible
        const ask = background ? [] : [ASK_USER_TOOL];
        const personalTools = personalSpace
          ? AGENT_TOOLS.filter((t) => PERSONAL_SPACE_TOOLS.has(t.function.name)
              && (modeRef.current !== 'plan' || READ_ONLY_TOOLS.has(t.function.name)))
          : [];
        if (!workspacePath) {
          const tools = [...personalTools, ...web, ...ask, ...mcpTools];
          return tools.length ? tools : undefined;
        }
        return modeRef.current === 'plan'
          ? [...AGENT_TOOLS.filter((t) => READ_ONLY_TOOLS.has(t.function.name)), ...web, PROPOSE_PLAN_TOOL, ...(skills.length ? [LOAD_SKILL_TOOL] : []), ...ask]
          : [...AGENT_TOOLS, ...web, ...(skills.length ? [LOAD_SKILL_TOOL] : []), ...ask, ...mcpTools];
      };

      const historyLengthBeforeEngine = apiHistoryRef.current.length;
      const session = await runAgentEngine({
        messages: apiHistoryRef.current,
        tools: toolsForStep,
        maxSteps: MAX_STEPS,
        // Le chat principal n'impose pas de plafond d'erreurs d'outils : le mode Auto escalade.
        maxConsecutiveErrors: 0,
        signal: controller.signal,
        beforeStep: () => {
          // Compaction en une fois, seulement au-delà du plafond, pour garder le cache.
          if (historyChars(apiHistoryRef.current) > SOFT_LIMIT_CHARS) {
            compactHistory(apiHistoryRef.current, KEEP_RECENT_TOOL_RESULTS, STUB_CHARS);
            if (historyChars(apiHistoryRef.current) > SOFT_LIMIT_CHARS * 0.6) {
              compactHistory(apiHistoryRef.current, 2, 300);
            }
          }
          promptTokens += estimateHistoryTokens(apiHistoryRef.current);
        },
        stream: (messages, tools) =>
          aiService.chatStream(messages, { model: callModel(), tools, signal: controller.signal }),
        retry: {
          attempts: RETRY_DELAYS.length,
          delayMs: (attempt) => RETRY_DELAYS[attempt],
          isRetryable,
        },
        onStepStart: () => {
          stepContent = '';
          stepReasoning = '';
          stepImages = [];
          doneInBatch = false;
        },
        onTextDelta: (text) => {
          stepContent += text;
          flushLive(stepContent);
        },
        onReasoningDelta: (text) => {
          stepReasoning += text;
          // Le raisonnement remonte AUSSI en direct (sinon « réfléchit… »
          // sans détail pendant toute la phase de réflexion)
          flushLive(stepContent);
        },
        onStepEnd: ({ text, reasoning, toolCalls }) => {
          accReasoning += reasoning;
          if (text) {
            accContent += (accContent ? '\n\n' : '') + text;
            appendTimelineText(timeline, text);
            flush();
          }
          completionTokens += estimateCompletionTokens(text, toolCalls);
          cost.calls++;
          lastCallAtRef.current = Date.now();
          onProgressRef.current?.({ costFCFA: cost.sum });
          void refreshCredits();
          if (retryNoticeShown) {
            updateMessage(assistantId, { notice: undefined });
            retryNoticeShown = false;
          }
          stepContent = '';
          stepReasoning = '';
        },
        onCostDelta: (c) => {
          cost.sum += c;
          cost.reports++;
          onProgressRef.current?.({ costFCFA: cost.sum });
        },
        onRetry: (attempt, wait) => {
          markSlowNetwork();
          retryNoticeShown = true;
          updateMessage(assistantId, {
            notice: `Connexion perdue — nouvelle tentative dans ${wait / 1000} s (${attempt}/${RETRY_DELAYS.length})…`,
          });
          stepContent = '';
          stepReasoning = '';
          flush();
        },
        onToolCall: (call) => {
          let args: Record<string, any> = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* garde */ }
          const ev: ToolEvent = {
            id: call.id,
            name: call.function.name,
            argsSummary: summarizeArgs(call.function.name, args),
            filePath: toolFilePath(call.function.name, args),
            status: 'running',
          };
          toolEvents.set(call.id, ev);
          events.push(ev);
          appendTimelineTool(timeline, ev.id);
          flush();
        },
        onImages: (images) => { stepImages.push(...images); },
        onToolBatchEnd: () => {
          if (stepImages.length && !doneInBatch) {
            apiHistoryRef.current.push({
              role: 'user',
              content: [
                { type: 'text', text: `${CAPTURE_MARK} ${stepImages.map((im, i) => `${i + 1}. ${im.label}`).join(' ; ')}` },
                ...stepImages.slice(0, 8).map((im) => ({ type: 'image_url' as const, image_url: { url: im.dataUrl, detail: 'auto' as const } })),
              ],
            });
          }
          stepImages = [];
        },
        executeTool: async (call): Promise<AgentToolOutcome> => {
          const ev = toolEvents.get(call.id);
          if (!ev) return { output: `Outil inconnu : ${call.function.name}`, isError: true };

          let args: Record<string, any> = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* garde */ }

          // Commande qui exécute du code écrit par l'agent, ou script npm sensible :
          // accord demandé même en « Accès complet » (garde S3)
          const riskCommand = call.function.name === 'run_command'
            ? String(args.command || '')
            : call.function.name === 'start_dev_server' && workspacePath
            ? String(args.command || (await detectDevCommand(workspacePath).catch(() => null)) || '')
            : '';
          const risk = riskCommand && agentRoot && modeRef.current !== 'plan'
            ? await commandRisk(convId, agentRoot, riskCommand).catch(() => null)
            : null;

          // Connecteur MCP : lecture déclarée par le serveur, ou action à faire valider
          const mcpRef = isMcpTool(call.function.name) ? mcpToolRef(call.function.name) : undefined;
          const mcpReadOnly = !!mcpRef?.tool.annotations?.readOnlyHint;
          const mcpAsk = !!mcpRef && mcpNeedsApproval(modeRef.current, mcpRef);

          // Décision d'approbation (module pur, testé)
          const decision = approvalDecision({
            mode: modeRef.current,
            tool: call.function.name,
            mcpReadOnly,
            mcpAsk,
            mcpName: mcpRef?.serverName,
            background,
            risk,
            personalSpace,
            trusted: trustedConvs.has(convId),
          });
          let allowed = decision.allowed;
          let refusal = decision.refusal ?? "Refusé par l'utilisateur. N'insiste pas : propose une autre approche ou demande-lui ce qu'il préfère.";
          if (decision.ask) {
            const scope = personalSpace && risk ? "Autoriser vaut pour toute cette conversation dans l'espace ANZAR." : undefined;
            allowed = await new Promise<boolean>((resolve) => {
              approvalResolver.current = resolve;
              setApproval({ id: call.id, name: call.function.name, summary: ev.argsSummary, reason: risk?.reason, detail: risk?.detail, scope });
            });
            if (allowed && personalSpace && risk) trustConversation(convId);
          }

          // Original mémorisé avant toute modification (carte « fichiers modifiés » + annulation)
          if (allowed && agentRoot && ['write_file', 'edit_file', 'delete_file'].includes(call.function.name)) {
            await noteAgentWrite(convId, agentRoot, args.path || args.file_path).catch(() => {});
            await snapshotBeforeChange(snapshots, agentRoot, args.path || args.file_path);
          }

          // Questions à l'utilisateur : l'agent attend ses réponses
          if (call.function.name === 'ask_user') {
            const result = await askUser(args, {
              background,
              onQuestions: (questions, summary) => {
                ev.argsSummary = summary;
                flush();
              },
              requestAnswers: (questions) => new Promise<QuestionAnswer[] | null>((resolve) => {
                questionResolver.current = resolve;
                setQuestion({ id: call.id, questions });
              }),
            });
            ev.status = result.isError ? 'error' : 'ok';
            ev.output = result.output.slice(0, MAX_TOOL_OUTPUT_DISPLAY);
            flush();
            return { output: result.output, isError: result.isError };
          }

          // Skill : instructions lues côté app, renvoyées à l'agent
          if (call.function.name === 'load_skill') {
            const result = await loadSkill(args, skills);
            ev.status = result.isError ? 'error' : 'ok';
            ev.output = result.output.slice(0, MAX_TOOL_OUTPUT_DISPLAY);
            flush();
            return result;
          }

          // Plan soumis : affiché dans l'onglet « Plan », l'agent s'arrête et attend la validation
          if (call.function.name === 'propose_plan' && allowed) {
            const plan = parsePlan(args);
            updateMessage(assistantId, { plan: { title: plan.title, markdown: plan.markdown, status: 'pending' } });
            ev.status = 'ok';
            ev.argsSummary = plan.title;
            flush();
            doneInBatch = true;
            planProposed = true;
            return { output: plan.output, stop: 'plan' };
          }

          const result: { output: string; isError?: boolean; isDone?: boolean; costFCFA?: number; images?: { label: string; dataUrl: string }[]; media?: ToolEvent['media'] } = !allowed
            ? { output: refusal, isError: true }
            : await executeGenericTool(call, args, {
                agentRoot,
                workspacePath,
                signal: controller.signal,
                permissionMode: modeRef.current,
                onFileChanged: (rel, action) => { if (workspacePath) onFileChanged?.(rel, action); },
                onSubagentProgress: call.function.name === 'spawn_subagents'
                  ? (progress) => { ev.subagents = progress; flush(''); }
                  : undefined,
              });

          // Recherche et lecture web : facturées à part par le serveur, ajoutées au coût de la réponse
          if (result.costFCFA) cost.sum += result.costFCFA;
          onProgressRef.current?.({ costFCFA: cost.sum });

          const delta = toolDelta(call.function.name, args, result.isError);
          if (delta) ev.delta = delta;

          ev.status = result.isError ? 'error' : 'ok';
          if (!result.isError && result.media) ev.media = result.media;
          // Mode Auto : quatre échecs d'outils dans la même demande → un cran au-dessus (deux fois au plus)
          if (route && allowed && result.isError && ++toolErrors >= 4 && escalations < 2) {
            const up = escalate(route, `monté après ${toolErrors} échecs (${route.reason})`);
            if (up) {
              route = up;
              escalations++;
              toolErrors = 0;
              updateMessage(assistantId, { autoRoute: { ...up, escalated: true } });
              lastRouteRef.current = up;
            }
          }
          ev.output = (result.output || '').slice(0, MAX_TOOL_OUTPUT_DISPLAY);
          flush();

          if (result.isDone) doneInBatch = true;
          return {
            output: result.output || '(vide)',
            isError: result.isError,
            isDone: result.isDone,
            images: result.images,
            media: result.media,
          };
        },
      });

      finalStopReason = session.stopReason;
      if (session.stopReason === 'error') {
        throw new Error(session.errorMessage || session.summary || 'Erreur du modèle');
      }
      if (session.stopReason === 'task_done') {
        const summary = String(session.summary || '').trim();
        if (summary && !accContent.includes(summary)) {
          accContent += (accContent ? '\n\n' : '') + summary;
          appendTimelineText(timeline, summary);
        }
        answered = true;
      } else if (session.stopReason === 'plan') {
        planProposed = true;
        answered = true;
      } else if (session.stopReason === 'final_answer') {
        answered = true;
      }
      // aborted / max_steps / verify_failed : answered reste false → reprise, synthèse ou coupe.

      // Mode plan : si le modèle a écrit le plan en texte au lieu d'appeler propose_plan
      if (modeRef.current === 'plan' && !planProposed && answered) {
        const last = [...timeline].reverse().find((t) => t.kind === 'text') as { kind: 'text'; text: string } | undefined;
        if (last && last.text.length > 200) {
          const heading = /^#{1,3}\s+(.+)$/m.exec(last.text)?.[1];
          updateMessage(assistantId, { plan: { title: (heading || 'Plan proposé').slice(0, 80), markdown: last.text, status: 'pending' } });
        }
      }

      // ── Garantie d'export : la tâche porte sur des animations/vidéos et AUCUN
      // export n'a réussi (budget brûlé en retouches) → UNE passe supplémentaire
      // où seul export_animation est permis, avant la synthèse finale. La vidéo
      // doit toujours être livrée.
      const motionDeliverable = /vid[ée]o|animation|motion|\bpub\b|publicit|reel|story|format (mp4|gif)|export/i.test(userRequestRef.current || '');
      const hasExport = events.some((e) => e.name === 'export_animation' && e.status === 'ok');
      let exportRescueDone = false;
      // Ce sauvetage appelle directement executeToolCall : hors Full, il contournerait
      // l'approbation de l'outil. On le réserve donc au mode Full (où l'utilisateur
      // a explicitement accepté l'exécution sans confirmation).
      if (!answered && !controller.signal.aborted && modeRef.current === 'full' && motionDeliverable && !hasExport && agentRoot) {
        exportRescueDone = true;
        const EXPORT_ONLY = AGENT_TOOLS.filter((t) => t.function.name === 'export_animation');
        apiHistoryRef.current.push({
          role: 'user',
          content:
            "BUDGET D'ÉTAPES ÉPUISÉ — SAUF pour exporter. Appelle MAINTENANT export_animation pour CHAQUE animation " +
            "ou vidéo demandée (la vidéo doit être livrée), puis conclus en texte. Aucune autre modification : " +
            "la version actuelle des pages fait foi.",
        });
        for (let rescue = 0; rescue < 4; rescue++) {
          if (controller.signal.aborted) break;
          const assembler = new ToolCallAssembler();
          let rescueText = '';
          try {
            const stream = aiService.chatStream(apiHistoryRef.current, { model: callModel(), tools: EXPORT_ONLY, signal: controller.signal });
            for await (const delta of stream) {
              if (delta.content) { rescueText += delta.content; flushLive(rescueText); }
              if (delta.tool_calls) assembler.add(delta.tool_calls);
            }
          } catch { break; }
          if (rescueText) { accContent += (accContent ? '\n\n' : '') + rescueText; appendTimelineText(timeline, rescueText); }
          if (!assembler.hasCalls) break;
          for (const call of assembler.finish()) {
            let args: Record<string, any> = {};
            try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* garde */ }
            const ev: ToolEvent = {
              id: call.id, name: call.function.name,
              argsSummary: summarizeArgs(call.function.name, args),
              filePath: toolFilePath(call.function.name, args),
              status: 'running',
            };
            events.push(ev);
            appendTimelineTool(timeline, ev.id);
            flush();
            const result = await executeToolCall(call, {
              projectRoot: agentRoot,
              signal: controller.signal,
              onFileChanged: (rel: string, _c: string, action: 'create' | 'edit' | 'delete') => { if (workspacePath) onFileChanged?.(rel, action); },
            });
            ev.status = result.isError ? 'error' : 'ok';
            ev.output = (result.output || '').slice(0, MAX_TOOL_OUTPUT_DISPLAY);
            flush();
            apiHistoryRef.current.push({ role: 'assistant', content: rescueText || null, tool_calls: [call] });
            apiHistoryRef.current.push({ role: 'tool', tool_call_id: call.id, content: result.output || '(vide)' });
          }
        }
      }

      // ── Limite d'étapes atteinte sans réponse → synthèse forcée, sans outils ──
      if (!answered && !controller.signal.aborted) {
        promptTokens += estimateHistoryTokens(apiHistoryRef.current);
        apiHistoryRef.current.push({
          role: 'user',
          content:
            "Limite d'étapes atteinte. N'utilise plus aucun outil. Donne maintenant ta réponse finale complète, " +
            "en français, à partir de ce que tu as déjà lu. Si le travail est incomplet, dis précisément ce qui reste.",
        });
        let finalText = '';
        for await (const delta of aiService.chatStream(apiHistoryRef.current, { model: callModel(), signal: controller.signal })) {
          if (delta.serverCostFCFA !== undefined) { cost.sum += delta.serverCostFCFA; cost.reports++; continue; }
          if (delta.content) {
            finalText += delta.content;
            flushLive(finalText);
          }
        }
        cost.calls++;
        lastCallAtRef.current = Date.now();
        if (finalText) {
          accContent += (accContent ? '\n\n' : '') + finalText;
          appendTimelineText(timeline, finalText);
        }
        completionTokens += estimateCompletionTokens(finalText, []);
      }

      // ── Finalisation ──
      // Interruption utilisateur : la réponse partielle est marquée comme telle
      // (sinon le modèle croit avoir terminé et l'utilisateur voit une coupe sans signe).
      const wasAborted = controller.signal.aborted;
      const finalContent = wasAborted
        ? (accContent ? `${accContent}\n\n_(interrompu)_` : '_(génération interrompue)_')
        : accContent;

      // Réponse finale dans l'historique API. Le moteur a déjà ajouté le message
      // assistant de la dernière étape : on le remplace au lieu de le dupliquer.
      const lastApiMessage = apiHistoryRef.current[apiHistoryRef.current.length - 1];
      if (
        apiHistoryRef.current.length > historyLengthBeforeEngine
        && lastApiMessage?.role === 'assistant'
        && !lastApiMessage.tool_calls?.length
      ) {
        lastApiMessage.content = finalContent;
      } else {
        apiHistoryRef.current.push({ role: 'assistant', content: finalContent });
      }

      // La réponse est terminée : on l'affiche tout de suite, sans attendre la comptabilité.
      const changes = agentRoot ? await collectChanges(assistantId, agentRoot, snapshots).catch(() => undefined) : undefined;
      updateMessage(assistantId, {
        content: finalContent,
        timeline: snapshotTimeline(timeline),
        reasoning: accReasoning ? [accReasoning] : undefined,
        isStreaming: false,
        tokens: { prompt: promptTokens, completion: completionTokens },
        notice: undefined,
        resumable: false,
        toolEvents: [...events],
        fileChanges: changes,
      });

      // Coût et journal d'usage : une erreur ici ne doit jamais faire échouer la réponse.
      try {
        // ── Coût réel : coûts exacts du serveur, sinon écart de solde, sinon estimation ──
        const exact = hasExactCost(cost.reports, cost.calls);
        // Sans coûts exacts, on laisse au serveur le temps d'enregistrer le dernier appel.
        if (!exact) await new Promise((r) => setTimeout(r, 600));
        const balanceAfter = await refreshCredits();
        const { costFCFA, fromServer } = computeSessionCost({
          serverCostSum: cost.sum,
          serverCostReports: cost.reports,
          serverModelCalls: cost.calls,
          balanceBefore,
          balanceAfter,
          promptTokens,
          completionTokens,
          priceInPerMillion: priceIn,
          priceOutPerMillion: priceOut,
        });
        finalCostFCFA = costFCFA;
        updateMessage(assistantId, { costFCFA });

        const record = {
          provider: 'deepseek' as const,
          model,
          taskType: 'agent_chat',
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          costUSD: Math.round((costFCFA / 615) * 10000) / 10000,
          costFCFA,
          wasFallback: false,
          timestamp: Date.now(),
          durationMs: Date.now() - t0,
        };
        // Solde déjà synchronisé depuis le serveur → on journalise sans redébiter.
        if (fromServer) addUsageRecord(record);
        else addUsage(record);
      } catch (err) {
        console.warn('[agent] comptabilité du coût impossible', err);
      }
      return {
        stopReason: wasAborted ? 'aborted' : finalStopReason,
        content: finalContent,
        costFCFA: finalCostFCFA,
        filesChanged: changes?.map((c) => c.path) ?? [],
        isError: false,
        conversationId: convId,
        assistantId,
      };
    } catch (e: any) {
      const aborted = controller.signal.aborted;
      // On garde de quoi reprendre exactement ici (bouton « Reprendre »)
      resumeRef.current = aborted
        ? null
        : { convId, assistantId, accContent, timeline: snapshotTimeline(timeline), events, snapshots, promptTokens, completionTokens, balanceBefore, cost, route };
      const errorText = aborted
        ? '_(interrompu)_'
        : `**Erreur** — ${e?.message || 'service indisponible'}. Le travail déjà fait est conservé : clique sur « Reprendre » quand la connexion est revenue.`;
      const errorContent = aborted
        ? (accContent ? `${accContent}\n\n_(interrompu)_` : '_(génération interrompue)_')
        : `${accContent ? accContent + '\n\n' : ''}**Erreur** — ${e?.message || 'service indisponible'}. Le travail déjà fait est conservé : clique sur « Reprendre » quand la connexion est revenue.`;
      const errorChanges = agentRoot ? await collectChanges(assistantId, agentRoot, snapshots).catch(() => undefined) : undefined;
      updateMessage(assistantId, {
        notice: undefined,
        resumable: !aborted,
        content: errorContent,
        timeline: [...snapshotTimeline(timeline), { kind: 'text', text: errorText }],
        isStreaming: false,
        isError: !aborted,
        toolEvents: [...events],
        fileChanges: errorChanges,
      });
      return {
        stopReason: aborted ? 'aborted' : 'error',
        content: errorContent,
        costFCFA: finalCostFCFA,
        filesChanged: errorChanges?.map((c) => c.path) ?? [],
        isError: !aborted,
        conversationId: convId,
        assistantId,
      };
    } finally {
      setIsGenerating(false);
      if (!background) setStoreGenerating(false);
      abortRef.current = null;
      approvalResolver.current = null;
      setApproval(null);
      questionResolver.current = null;
      setQuestion(null);
      void refreshCredits();
    }
  }, [isGenerating, ensureConversation, addMessage, updateMessage, setStoreGenerating, background, model, workspacePath, workspaceName, onFileChanged, addUsage, addUsageRecord]);

  /** Reprend une réponse interrompue par une erreur. Retourne false si la reprise n'est plus possible. */
  const resume = useCallback((messageId: string): boolean => {
    const state = resumeRef.current;
    if (!state || state.assistantId !== messageId || activeConvRef.current !== state.convId) return false;
    resumeRef.current = null;
    void sendMessage('', [], state);
    return true;
  }, [sendMessage]);

  /** Change le mode immédiatement (avant le prochain rendu), ex. à la validation d'un plan. */
  const setModeNow = useCallback((m: PermissionMode) => { modeRef.current = m; }, []);

  return { sendMessage, stop, isGenerating, approval, resolveApproval, question, resolveQuestion, resume, setModeNow };
}
