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
import { loadPersonalInstructions, personalInstructionsSection } from '@/services/personalInstructions';
import { useCallback, useRef, useState } from 'react';
import { aiService, markSlowNetwork } from '@/services/ai/ai';
import { AGENT_TOOLS, executeToolCall } from '@/services/agent/agentTools';
import { WEB_TOOLS, WEB_TOOL_NAMES, executeWebTool } from '@/services/agent/webTools';
import { useSettingsStore } from '@/stores/settingsStore';
import { buildAgentSystemPrompt, FORMATTING_GUIDE, type AgentPromptContext } from '@/services/agent/agentPrompts';
import { buildAgentContext } from '@/services/agent/agentContext';
import { useChatStore } from '@/stores/chatStore';
import { useUsageStore } from '@/stores/usageStore';
import { refreshCredits } from '@/lib/credits';
import { listSkills, skillsPromptSection, MAX_SKILL_BODY_CHARS, type Skill } from '@/services/skills';
import { snapshotBeforeChange, collectChanges, type Snapshots } from '@/services/agent/fileChanges';
import type { AIModel, APIMessage, ChatAttachment, Message, ToolCall, ToolDefinition } from '@/types';

/** Qui décide avant que l'agent agisse. */
export type PermissionMode = 'ask' | 'auto' | 'plan' | 'full';

/** Demande d'accord en attente (modes « ask » et « auto »). */
export interface ApprovalRequest {
  id: string;
  name: string;
  summary: string;
  /** Pourquoi l'accord est demandé alors que le mode ne l'exige pas (commande à risque) */
  reason?: string;
  /** Ce qui va réellement s'exécuter (corps d'un script npm) */
  detail?: string;
}

/** Attente avant chaque nouvelle tentative quand une étape est coupée (ms). */
const RETRY_DELAYS = [2000, 5000, 10000];

/** Une erreur de solde ou d'authentification ne se règle pas en réessayant. */
function isRetryable(e: any): boolean {
  const msg = String(e?.message || '');
  return !/cr[ée]dit|quota|solde|recharge|401|402|403|non autoris|unauthori[sz]ed|token/i.test(msg);
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Morceau d'une réponse, dans l'ordre produit : du texte ou un groupe d'actions. */
export type TimelineItem =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; ids: string[] };

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
}

/** Coûts exacts envoyés par le serveur pour chaque appel au modèle (B6) */
interface ServerCost { sum: number; reports: number; calls: number }

/** Après une coupure, chaque appel d'outil annoncé doit avoir une réponse, sinon l'API refuse l'historique. */
function closeDanglingToolCalls(history: APIMessage[]): void {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue;
    const answeredIds = new Set(history.slice(i + 1).filter((x) => x.role === 'tool').map((x) => x.tool_call_id));
    for (const call of m.tool_calls) {
      if (!answeredIds.has(call.id)) {
        history.push({ role: 'tool', tool_call_id: call.id, content: 'Interrompu par une coupure. Relance cet outil si son résultat est nécessaire.' });
      }
    }
    return;
  }
}

const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'remember']);
const COMMAND_TOOLS = new Set(['run_command', 'spawn_subagents']);
const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'search_files', 'web_search', 'read_url']);

function needsApproval(mode: PermissionMode, tool: string): boolean {
  if (mode === 'ask') return EDIT_TOOLS.has(tool) || COMMAND_TOOLS.has(tool);
  if (mode === 'auto') return COMMAND_TOOLS.has(tool);
  return false;
}

const PLAN_MODE_PROMPT = `

# MODE PLAN (actif)
Tu ne peux RIEN modifier ni exécuter : seuls read_file, list_dir, search_files et propose_plan sont disponibles.
Explore ce qu'il faut (sans tout lire), puis appelle propose_plan UNE fois avec le plan complet en Markdown :
un titre court, puis des étapes numérotées et concrètes (fichiers concernés, changements prévus, vérifications), et les risques éventuels.
N'écris pas le plan dans ta réponse texte : il s'affiche dans un onglet dédié où l'utilisateur le valide.`;

/** Charge les instructions complètes d'une skill (la liste seule est dans le prompt). */
const LOAD_SKILL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'load_skill',
    description: "Charge les instructions complètes d'une skill de la liste « Skills disponibles ». À utiliser avant d'agir quand une skill correspond à la tâche.",
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Nom exact de la skill' } },
      required: ['name'],
    },
  },
};
const SKILL_RESULT_PREFIX = '# Skill « ';

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

/** Événement d'outil affichable dans le message (rendu ZCode). */
export interface ToolEvent {
  id: string;
  name: string;
  /** Argument principal lisible : chemin, commande, requête… */
  argsSummary: string;
  status: 'running' | 'ok' | 'error';
  /** Sortie tronquée pour affichage */
  output?: string;
  /** Delta de lignes pour edit_file/write_file : [ajoutées, supprimées] */
  delta?: [number, number];
}

const MAX_STEPS = 40;
const MAX_TOOL_OUTPUT_DISPLAY = 600;

// ── Économie de crédits ─────────────────────────────────────────────────────
// À chaque étape, TOUT l'historique est renvoyé au modèle (et facturé). Les
// anciens résultats d'outils (fichiers lus, sorties de commandes) en sont la
// plus grosse part et ne servent plus après quelques étapes : on les raccourcit.
// La modification est faite une fois, sur place : le début de l'historique reste
// identique d'une étape à l'autre (meilleur cache côté fournisseur).
const KEEP_RECENT_TOOL_RESULTS = 6;   // derniers résultats gardés en entier
const SMALL_RESULT_CHARS = 1_500;     // un résultat court n'est jamais raccourci
const STUB_CHARS = 600;               // ce qu'on garde d'un ancien résultat
const SOFT_LIMIT_CHARS = 140_000;     // au-delà, on serre davantage (~35k tokens)
const SHRUNK_MARK = '[ancien résultat raccourci';

function shrinkText(text: string, keep: number): string {
  if (text.length <= keep + 200 || text.includes(SHRUNK_MARK)) return text;
  return `${text.slice(0, keep)}\n… ${SHRUNK_MARK} : ${text.length.toLocaleString('fr-FR')} caractères au total — relance l'outil si tu as besoin du détail]`;
}

/** Raccourcit les longs arguments (contenu écrit par write_file/edit_file) d'un ancien appel d'outil. */
function shrinkToolCallArgs(call: ToolCall): ToolCall {
  const raw = call.function.arguments || '';
  if (raw.length <= SMALL_RESULT_CHARS) return call;
  try {
    const args = JSON.parse(raw);
    for (const k of Object.keys(args)) {
      if (typeof args[k] === 'string' && args[k].length > 400) {
        args[k] = `${args[k].slice(0, 200)}… [${args[k].length} caractères, raccourci]`;
      }
    }
    return { ...call, function: { ...call.function, arguments: JSON.stringify(args) } };
  } catch {
    return call;
  }
}

/**
 * Raccourcit sur place tout ce qui précède les `keepRecent` derniers résultats d'outils :
 * leurs résultats longs et les longs arguments des appels correspondants.
 */
function compactHistory(history: APIMessage[], keepRecent: number, stubChars: number): void {
  const toolIdx: number[] = [];
  history.forEach((m, i) => { if (m.role === 'tool') toolIdx.push(i); });
  const cutoff = keepRecent > 0 ? toolIdx[toolIdx.length - keepRecent] ?? 0 : history.length;
  for (let i = 0; i < cutoff; i++) {
    const m = history[i];
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > SMALL_RESULT_CHARS && !m.content.startsWith(SKILL_RESULT_PREFIX)) {
      history[i] = { ...m, content: shrinkText(m.content, stubChars) };
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      history[i] = { ...m, tool_calls: m.tool_calls.map(shrinkToolCallArgs) };
    }
  }
}

const historyChars = (history: APIMessage[]) =>
  history.reduce((n, m) => n + (m.content?.length || 0) + JSON.stringify(m.tool_calls || []).length, 0);
// Le contenu joint est renvoyé au modèle à CHAQUE étape : on le borne pour maîtriser le coût.
const MAX_ATTACHMENT_CHARS = 40_000;
const MAX_ATTACHMENTS_TOTAL_CHARS = 100_000;

/** Ajoute le contenu des pièces jointes au message envoyé au modèle. */
function withAttachments(content: string, attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return content;
  let budget = MAX_ATTACHMENTS_TOTAL_CHARS;
  const blocks = attachments.map((a) => {
    const label = `[${a.ref}] ${a.name} (${a.kind})`;
    if (a.kind === 'image') {
      return a.dataUrl
        ? `${label}\n(Image jointe : elle t'est montrée à la suite de ce message.)`
        : `${label}\n(Image jointe illisible : dis-le à l'utilisateur si sa demande en dépend.)`;
    }
    const full = (a.excerpt || '').trim();
    if (!full) return `${label}\n(Contenu illisible ou vide.)`;
    const take = Math.max(0, Math.min(full.length, MAX_ATTACHMENT_CHARS, budget));
    budget -= take;
    if (take === 0) return `${label}\n(Non inclus : limite de taille des pièces jointes atteinte.)`;
    const cut = take < full.length;
    return `${label}\n\`\`\`\n${full.slice(0, take)}\n\`\`\`${cut ? `\n(Tronqué : ${take.toLocaleString('fr-FR')} caractères sur ${full.length.toLocaleString('fr-FR')}. Préviens l'utilisateur si la suite est nécessaire.)` : ''}`;
  });
  return `${content}\n\n# Pièces jointes\n\n${blocks.join('\n\n')}`;
}

function summarizeArgs(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'delete_file':
      return args.path || args.file_path || '';
    case 'list_dir':
      return args.path || '.';
    case 'search_files':
      return args.query || args.pattern || '';
    case 'web_search':
      return args.query || '';
    case 'read_url':
      return args.url || '';
    case 'run_command':
      return args.command || '';
    case 'spawn_subagents':
      return (args.tasks || []).length ? `${(args.tasks || []).length} sous-tâches` : '';
    case 'remember':
      return String(args.content || '').slice(0, 80);
    case 'load_skill':
      return String(args.name || '');
    case 'task_done':
      return String(args.summary || '').slice(0, 100);
    default:
      return JSON.stringify(args).slice(0, 100);
  }
}

/** Assemble les tool_calls fragmentés du stream (pattern agentLoop). */
class Assembler {
  private calls = new Map<number, ToolCall>();
  add(fragments: Partial<ToolCall>[] = []) {
    for (const frag of fragments) {
      const index = (frag as any).index ?? 0;
      let call = this.calls.get(index);
      if (!call) {
        call = { id: frag.id || `call_${Date.now()}_${index}`, type: 'function', function: { name: '', arguments: '' } };
        this.calls.set(index, call);
      }
      if (frag.id) call.id = frag.id;
      if (frag.function?.name) call.function.name += frag.function.name;
      if (frag.function?.arguments) call.function.arguments += frag.function.arguments;
    }
  }
  finish(): ToolCall[] {
    return [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  }
  get hasCalls() { return this.calls.size > 0; }
}

interface UseAgentChatParams {
  workspacePath: string | null;
  workspaceName?: string;
  model: AIModel;
  /** Mode de permission (défaut : accès complet). */
  permissionMode?: PermissionMode;
  /** Appelé quand un outil modifie un fichier (refresh explorateur/éditeur). */
  onFileChanged?: (relativePath: string, action: 'create' | 'edit' | 'delete') => void;
  /** Exécution en arrière-plan (automatisations) : ne touche pas à l'indicateur global. */
  background?: boolean;
}

export function useAgentChat({ workspacePath, workspaceName, model, permissionMode = 'full', onFileChanged, background = false }: UseAgentChatParams) {
  const [isGenerating, setIsGenerating] = useState(false);
  // Le mode peut changer pendant que l'agent travaille : on lit toujours la valeur courante.
  const modeRef = useRef(permissionMode);
  modeRef.current = permissionMode;
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const approvalResolver = useRef<((ok: boolean) => void) | null>(null);

  const resolveApproval = useCallback((ok: boolean) => {
    approvalResolver.current?.(ok);
    approvalResolver.current = null;
    setApproval(null);
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  // Historique API complet de la conversation (tool exchanges inclus), par conversation
  const apiHistoryRef = useRef<APIMessage[]>([]);
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
  }, [resolveApproval]);

  const sendMessage = useCallback(async (
    content: string,
    rawAttachments: ChatAttachment[] = [],
    resumeFrom?: ResumeState,
    /** Tâche cible (automatisations) ; par défaut la tâche affichée */
    opts?: { conversationId?: string },
  ) => {
    if ((!content.trim() && !resumeFrom) || isGenerating) return;
    const attachments = rawAttachments.slice(0, 8).map((a, i) => ({ ...a, ref: a.ref || String.fromCharCode(65 + i) }));
    const apiContent = withAttachments(content, attachments);
    const convId = resumeFrom?.convId ?? opts?.conversationId ?? ensureConversation();
    if (!resumeFrom) resumeRef.current = null; // un nouveau message rend l'ancienne reprise caduque

    // Reset de l'historique API si on change de conversation
    if (!resumeFrom && activeConvRef.current !== convId) {
      apiHistoryRef.current = [];
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
        ? attachments.map(({ excerpt: _excerpt, dataUrl: _data, ...rest }) => rest)
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
    const historyTokens = () =>
      Math.ceil(apiHistoryRef.current.reduce((n, m) => n + (m.content?.length || 0) + JSON.stringify(m.tool_calls || []).length, 0) / 4);

    // Chronologie affichée : texte et actions dans l'ordre où l'agent les produit
    const timeline: TimelineItem[] = resumeFrom ? resumeFrom.timeline.map((t) => ({ ...t })) : [];
    const addText = (text: string) => {
      if (text.trim()) timeline.push({ kind: 'text', text });
    };
    const addToolToTimeline = (id: string) => {
      const last = timeline[timeline.length - 1];
      if (last?.kind === 'tools') last.ids = [...last.ids, id];
      else timeline.push({ kind: 'tools', ids: [id] });
    };
    const snapshotTimeline = (liveText = ''): TimelineItem[] => {
      const copy = timeline.map((t) => (t.kind === 'tools' ? { kind: 'tools' as const, ids: [...t.ids] } : { ...t }));
      if (liveText.trim()) copy.push({ kind: 'text', text: liveText });
      return copy;
    };

    /** Met à jour l'affichage ; `liveText` = texte en cours d'écriture de l'étape. */
    const flush = (liveText = '') => {
      updateMessage(assistantId, {
        content: liveText ? accContent + (accContent ? '\n\n' : '') + liveText : accContent,
        timeline: snapshotTimeline(liveText),
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
        const freshHistory = apiHistoryRef.current.length === 0;
        if (workspacePath) {
          const ctx = await buildAgentContext(workspacePath, content).catch(() => null);
          const promptCtx: AgentPromptContext = {
            projectName: workspaceName || workspacePath.split('/').pop() || 'projet',
            projectRoot: workspacePath,
            memory: ctx?.memory,
            platform: navigator.platform.toLowerCase().includes('win') ? 'windows' : 'macos',
          };
          system = {
            role: 'system',
            content: buildAgentSystemPrompt(promptCtx) + skillsPromptSection(skills) + personal,
          };
          const parts: string[] = [];
          // Carte du code : une fois par conversation (elle reste ensuite dans l'historique)
          if (freshHistory && ctx?.codeMap) parts.push(`## Carte du code (fichiers + symboles clés)\n${ctx.codeMap}`);
          if (ctx?.taskHints) parts.push(`## Fichiers probablement pertinents pour cette demande\n${ctx.taskHints}\n(Indices heuristiques : vérifie avec read_file.)`);
          if (modeRef.current === 'plan') parts.push(PLAN_MODE_PROMPT.trim());
          if (parts.length) turnContext = `\n\n---\n# Contexte fourni par ANZAR\n${parts.join('\n\n')}`;
        } else {
          system = {
            role: 'system',
            content:
              'Tu es ANZAR, assistant de développement. Réponds en français, clair et direct.\n\n' +
              (webEnabled
                ? "Tu peux chercher sur le web (web_search) et lire une page (read_url) quand la question porte sur une information récente " +
                  "ou une documentation ; cite alors tes sources avec leur URL. Ce sont tes SEULS outils.\n\n"
                : '') +
              "AUCUN DOSSIER N'EST OUVERT : tu n'as aucun outil sur les fichiers. Tu ne peux ni lire un fichier, ni lancer une commande, " +
              "ni modifier quoi que ce soit. Ne prétends JAMAIS l'avoir fait, même si l'historique de la conversation " +
              "montre que tu le faisais avant : n'invente aucun résultat de commande, de build ou de test. " +
              "Si la demande exige d'agir sur un projet, dis-le en une phrase et demande d'ouvrir le dossier " +
              "(bouton « Ouvrir un dossier » en haut de la conversation).\n\n" +
              FORMATTING_GUIDE + personal,
          };
        }

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
          apiHistoryRef.current[0] = system;
          // Si la réponse précédente a été coupée, l'historique doit rester valide pour « continue »
          closeDanglingToolCalls(apiHistoryRef.current);
        }
        // Les résultats d'outils des demandes précédentes ne servent plus qu'en résumé
        compactHistory(apiHistoryRef.current, 0, 300);
        // Le raisonnement des demandes précédentes n'est plus utile au modèle (DeepSeek accepte
        // qu'on le retire entre deux demandes) : on l'enlève pour ne pas le repayer.
        for (let i = 0; i < apiHistoryRef.current.length; i++) {
          const m = apiHistoryRef.current[i];
          if (m.reasoning_content) apiHistoryRef.current[i] = { ...m, reasoning_content: undefined };
          // Images des demandes précédentes : déjà analysées, on ne les renvoie plus (connexions lentes)
          if (m.role === 'user' && Array.isArray(m.content)) {
            const text = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
            const n = m.content.filter((p) => p.type === 'image_url').length;
            apiHistoryRef.current[i] = { ...apiHistoryRef.current[i], content: `${text}\n\n(${n} image${n > 1 ? 's' : ''} jointe${n > 1 ? 's' : ''} à cette demande, déjà analysée${n > 1 ? 's' : ''} dans ta réponse.)` };
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

      // ── Boucle agent ──
      for (let step = 0; step < MAX_STEPS; step++) {
        if (controller.signal.aborted) break;

        let assembler = new Assembler();
        let stepContent = '';

        // Chaque étape renvoie tout l'historique au modèle : on le compte à chaque fois.
        compactHistory(apiHistoryRef.current, KEEP_RECENT_TOOL_RESULTS, STUB_CHARS);
        if (historyChars(apiHistoryRef.current) > SOFT_LIMIT_CHARS) {
          compactHistory(apiHistoryRef.current, 2, 300);
        }
        promptTokens += historyTokens();
        const web = webEnabled ? WEB_TOOLS : [];
        const tools = !workspacePath
          ? (web.length ? web : undefined)
          : modeRef.current === 'plan'
            ? [...AGENT_TOOLS.filter((t) => READ_ONLY_TOOLS.has(t.function.name)), ...web, PROPOSE_PLAN_TOOL, ...(skills.length ? [LOAD_SKILL_TOOL] : [])]
            : [...AGENT_TOOLS, ...web, ...(skills.length ? [LOAD_SKILL_TOOL] : [])];

        // Une étape coupée par le réseau est réessayée seule : l'historique est intact,
        // donc rien de ce qui a déjà été fait n'est perdu ni refacturé.
        let stepReasoning = '';
        for (let attempt = 0; ; attempt++) {
          assembler = new Assembler();
          stepContent = '';
          stepReasoning = '';
          try {
            const stream = aiService.chatStream(apiHistoryRef.current, { model, tools, signal: controller.signal });
            for await (const delta of stream) {
              if (delta.serverCostFCFA !== undefined) { cost.sum += delta.serverCostFCFA; cost.reports++; continue; }
              if (delta.content) {
                stepContent += delta.content;
                flushLive(stepContent);
              }
              if (delta.reasoning_content) stepReasoning += delta.reasoning_content;
              if (delta.tool_calls) assembler.add(delta.tool_calls);
            }
            cost.calls++;
            break;
          } catch (e: any) {
            if (controller.signal.aborted) break;
            if (attempt >= RETRY_DELAYS.length || !isRetryable(e)) throw e;
            markSlowNetwork();
            const wait = RETRY_DELAYS[attempt];
            updateMessage(assistantId, {
              notice: `Connexion perdue — nouvelle tentative dans ${wait / 1000} s (${attempt + 1}/${RETRY_DELAYS.length})…`,
            });
            await sleepAbortable(wait, controller.signal);
            updateMessage(assistantId, { notice: undefined });
          }
        }
        if (controller.signal.aborted) break;
        accReasoning += stepReasoning;

        // Le texte de chaque étape s'accumule (les étapes tool-only sont vides)
        if (stepContent) {
          accContent += (accContent ? '\n\n' : '') + stepContent;
          addText(stepContent);
          flush();
        }
        completionTokens += Math.ceil((stepContent.length + JSON.stringify(assembler.finish()).length) / 4);
        // Le serveur vient de facturer cette étape : on rafraîchit la pilule de solde.
        void refreshCredits();

        // ── Pas de tool calls → réponse finale ──
        if (!assembler.hasCalls) { answered = true; break; }

        // ── Exécution des outils ──
        const toolCalls = assembler.finish();
        apiHistoryRef.current.push({
          role: 'assistant',
          content: stepContent || null,
          // DeepSeek exige le raisonnement de l'étape avec ses appels d'outils (sinon erreur 400)
          ...(stepReasoning ? { reasoning_content: stepReasoning } : {}),
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          if (controller.signal.aborted) break;
          let args: Record<string, any> = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* garde */ }

          const ev: ToolEvent = {
            id: call.id,
            name: call.function.name,
            argsSummary: summarizeArgs(call.function.name, args),
            status: 'running',
          };
          events.push(ev);
          addToolToTimeline(ev.id);
          flush();

          // Commande qui exécute du code écrit par l'agent, ou script npm sensible :
          // accord demandé même en « Accès complet » (garde S3)
          const risk = call.function.name === 'run_command' && workspacePath && modeRef.current !== 'plan'
            ? await commandRisk(convId, workspacePath, String(args.command || '')).catch(() => null)
            : null;

          // Accord de l'utilisateur selon le mode de permission
          let allowed = true;
          let refusal = "Refusé par l'utilisateur. N'insiste pas : propose une autre approche ou demande-lui ce qu'il préfère.";
          if (modeRef.current === 'plan' && !READ_ONLY_TOOLS.has(call.function.name) && !['task_done', 'propose_plan', 'load_skill'].includes(call.function.name)) {
            allowed = false;
          } else if (risk && background) {
            // Automatisation : personne pour valider → refus, expliqué à l'agent
            allowed = false;
            refusal = `Refusé automatiquement : ${risk.reason}. Personne n'est là pour valider pendant une automatisation. Ne contourne pas ce refus ; signale-le dans ta réponse.`;
          } else if (needsApproval(modeRef.current, call.function.name) || risk) {
            allowed = await new Promise<boolean>((resolve) => {
              approvalResolver.current = resolve;
              setApproval({ id: call.id, name: call.function.name, summary: ev.argsSummary, reason: risk?.reason, detail: risk?.detail });
            });
          }

          // Original mémorisé avant toute modification (carte « fichiers modifiés » + annulation)
          if (allowed && workspacePath && ['write_file', 'edit_file', 'delete_file'].includes(call.function.name)) {
            await noteAgentWrite(convId, workspacePath, args.path || args.file_path).catch(() => {});
            await snapshotBeforeChange(snapshots, workspacePath, args.path || args.file_path);
          }

          // Skill : instructions lues côté app, renvoyées à l'agent
          if (call.function.name === 'load_skill') {
            const wanted = String(args.name || '').trim().toLowerCase();
            const skill = skills.find((sk) => sk.name === wanted) || skills.find((sk) => sk.name.includes(wanted) && wanted.length > 2);
            const output = skill
              ? `${SKILL_RESULT_PREFIX}${skill.name} »\n\n${skill.body.slice(0, MAX_SKILL_BODY_CHARS)}`
              : `Skill « ${wanted} » introuvable. Skills disponibles : ${skills.map((sk) => sk.name).join(', ') || 'aucune'}.`;
            ev.status = skill ? 'ok' : 'error';
            ev.output = output.slice(0, MAX_TOOL_OUTPUT_DISPLAY);
            flush();
            apiHistoryRef.current.push({ role: 'tool', tool_call_id: call.id, content: output });
            continue;
          }

          // Plan soumis : affiché dans l'onglet « Plan », l'agent s'arrête et attend la validation
          if (call.function.name === 'propose_plan' && allowed) {
            const title = String(args.title || 'Plan').slice(0, 80);
            const markdown = String(args.plan || '').trim();
            updateMessage(assistantId, { plan: { title, markdown, status: 'pending' } });
            ev.status = 'ok';
            ev.argsSummary = title;
            flush();
            apiHistoryRef.current.push({
              role: 'tool',
              tool_call_id: call.id,
              content: "Plan affiché à l'utilisateur. Arrête-toi ici : il va le valider ou demander des changements.",
            });
            planProposed = true;
            answered = true;
            break;
          }

          const result: { output: string; isError?: boolean; isDone?: boolean; costFCFA?: number } = !allowed
            ? { output: refusal, isError: true }
            : WEB_TOOL_NAMES.has(call.function.name)
            ? await executeWebTool(call.function.name, args, controller.signal)
            : workspacePath
            ? await executeToolCall(call, {
                projectRoot: workspacePath,
                signal: controller.signal,
                onFileChanged: (rel, _c, action) => onFileChanged?.(rel, action),
              })
            : { output: 'Aucun dossier de travail ouvert.', isError: true };

          // Recherche et lecture web : facturées à part par le serveur, ajoutées au coût de la réponse
          if (result.costFCFA) cost.sum += result.costFCFA;

          // B7 : delta de lignes calculé depuis les ARGS de l'outil (l'ancien
          // parse attendait un format qu'aucun exécuteur ne produisait).
          if (!result.isError && call.function.name === 'write_file' && typeof args.content === 'string') {
            const lines = args.content.split('\n').length;
            ev.delta = [lines, 0];
          } else if (!result.isError && call.function.name === 'edit_file') {
            // Sans replace_all : exactement 1 remplacement. Avec replace_all,
            // le compte réel est dans result.output — on affiche le minimum (1).
            const oldLines = typeof args.old_text === 'string' ? args.old_text.split('\n').length : 0;
            const newLines = typeof args.new_text === 'string' ? args.new_text.split('\n').length : 0;
            ev.delta = [newLines, oldLines];
          }

          ev.status = result.isError ? 'error' : 'ok';
          ev.output = (result.output || '').slice(0, MAX_TOOL_OUTPUT_DISPLAY);
          flush();

          apiHistoryRef.current.push({
            role: 'tool',
            tool_call_id: call.id,
            content: result.output || '(vide)',
          });

          // task_done → son résumé EST la réponse finale
          if (result.isDone) {
            const summary = String(result.output || '').trim();
            if (summary && !accContent.includes(summary)) {
              accContent += (accContent ? '\n\n' : '') + summary;
              addText(summary);
            }
            answered = true;
            flush();
            break;
          }
        }
        if (answered) break;

        // Le contenu final remplace l'accumulation d'étapes intermédiaires vides
        if (stepContent && step < MAX_STEPS - 1) {
          // l'étape suivante produira la suite (réponse ou nouveaux outils)
        }
      }

      // Mode plan : si le modèle a écrit le plan en texte au lieu d'appeler propose_plan
      if (modeRef.current === 'plan' && !planProposed && answered) {
        const last = [...timeline].reverse().find((t) => t.kind === 'text') as { kind: 'text'; text: string } | undefined;
        if (last && last.text.length > 200) {
          const heading = /^#{1,3}\s+(.+)$/m.exec(last.text)?.[1];
          updateMessage(assistantId, { plan: { title: (heading || 'Plan proposé').slice(0, 80), markdown: last.text, status: 'pending' } });
        }
      }

      // ── Limite d'étapes atteinte sans réponse → synthèse forcée, sans outils ──
      if (!answered && !controller.signal.aborted) {
        promptTokens += historyTokens();
        apiHistoryRef.current.push({
          role: 'user',
          content:
            "Limite d'étapes atteinte. N'utilise plus aucun outil. Donne maintenant ta réponse finale complète, " +
            "en français, à partir de ce que tu as déjà lu. Si le travail est incomplet, dis précisément ce qui reste.",
        });
        let finalText = '';
        for await (const delta of aiService.chatStream(apiHistoryRef.current, { model, signal: controller.signal })) {
          if (delta.serverCostFCFA !== undefined) { cost.sum += delta.serverCostFCFA; cost.reports++; continue; }
          if (delta.content) {
            finalText += delta.content;
            flushLive(finalText);
          }
        }
        cost.calls++;
        if (finalText) {
          accContent += (accContent ? '\n\n' : '') + finalText;
          addText(finalText);
        }
        completionTokens += Math.ceil(finalText.length / 4);
      }

      // ── Finalisation ──
      // Interruption utilisateur : la réponse partielle est marquée comme telle
      // (sinon le modèle croit avoir terminé et l'utilisateur voit une coupe sans signe).
      const wasAborted = controller.signal.aborted;
      const finalContent = wasAborted
        ? (accContent ? `${accContent}\n\n_(interrompu)_` : '_(génération interrompue)_')
        : accContent;

      // Réponse finale dans l'historique API
      apiHistoryRef.current.push({ role: 'assistant', content: finalContent });

      // La réponse est terminée : on l'affiche tout de suite, sans attendre la comptabilité.
      updateMessage(assistantId, {
        content: finalContent,
        timeline: snapshotTimeline(),
        reasoning: accReasoning ? [accReasoning] : undefined,
        isStreaming: false,
        tokens: { prompt: promptTokens, completion: completionTokens },
        notice: undefined,
        resumable: false,
        toolEvents: [...events],
        fileChanges: workspacePath ? await collectChanges(assistantId, workspacePath, snapshots).catch(() => undefined) : undefined,
      });

      // Coût et journal d'usage : une erreur ici ne doit jamais faire échouer la réponse.
      try {
        // ── Coût réel : différence de solde serveur (le backend facture chaque appel) ──
        const estimate = Math.round((promptTokens / 1_000_000) * priceIn + (completionTokens / 1_000_000) * priceOut);
        // Sans coûts exacts du serveur, on lui laisse le temps d'enregistrer le dernier appel
        if (!(cost.reports > 0 && cost.reports >= cost.calls)) await new Promise((r) => setTimeout(r, 600));
        const balanceAfter = await refreshCredits();
        // 1) Coûts exacts envoyés par le serveur pour chaque appel : justes même si une
        //    automatisation consomme en parallèle. 2) Sinon (ancien serveur) : écart de solde.
        const exact = cost.reports > 0 && cost.reports >= cost.calls;
        const fromServer = exact || (balanceBefore !== null && balanceAfter !== null);
        const costFCFA = exact
          ? Math.round(cost.sum * 100) / 100
          : fromServer ? Math.max(0, Math.round((balanceBefore! - balanceAfter!) * 100) / 100) : estimate;
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
    } catch (e: any) {
      const aborted = controller.signal.aborted;
      // On garde de quoi reprendre exactement ici (bouton « Reprendre »)
      resumeRef.current = aborted
        ? null
        : { convId, assistantId, accContent, timeline: snapshotTimeline(), events, snapshots, promptTokens, completionTokens, balanceBefore, cost };
      const errorText = aborted
        ? '_(interrompu)_'
        : `**Erreur** — ${e?.message || 'service indisponible'}. Le travail déjà fait est conservé : clique sur « Reprendre » quand la connexion est revenue.`;
      updateMessage(assistantId, {
        notice: undefined,
        resumable: !aborted,
        content: aborted
          ? (accContent ? `${accContent}\n\n_(interrompu)_` : '_(génération interrompue)_')
          : `${accContent ? accContent + '\n\n' : ''}**Erreur** — ${e?.message || 'service indisponible'}. Le travail déjà fait est conservé : clique sur « Reprendre » quand la connexion est revenue.`,
        timeline: [...snapshotTimeline(), { kind: 'text', text: errorText }],
        isStreaming: false,
        isError: !aborted,
        toolEvents: [...events],
        fileChanges: workspacePath ? await collectChanges(assistantId, workspacePath, snapshots).catch(() => undefined) : undefined,
      });
    } finally {
      setIsGenerating(false);
      if (!background) setStoreGenerating(false);
      abortRef.current = null;
      approvalResolver.current = null;
      setApproval(null);
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

  return { sendMessage, stop, isGenerating, approval, resolveApproval, resume, setModeNow };
}
