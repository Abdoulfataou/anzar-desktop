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
import { buildAgentSystemPrompt, memorySection, FORMATTING_GUIDE, VISUALS_GUIDE, CONNECTORS_GUIDE, type AgentPromptContext } from '@/services/agent/agentPrompts';
import { buildAgentContext } from '@/services/agent/agentContext';
import { useChatStore } from '@/stores/chatStore';
import { useUsageStore } from '@/stores/usageStore';
import { refreshCredits } from '@/lib/credits';
import { routeRequest, escalate, type Route } from '@/services/ai/autoRouter';
import { parseQuestions, formatAnswers, type QuestionRequest, type QuestionAnswer } from '@/components/chat/QuestionPanel';
import { detectDevCommand } from '@/services/agent/devServer';
import { mcpAgentTools, isMcpTool, mcpToolRef, mcpNeedsApproval, callMcpTool, setMcpRoots } from '@/services/mcp/manager';
import { listSkills, skillsPromptSection, findSkill, readSkillFile, skillToolOutput, type Skill } from '@/services/skills';
import { snapshotBeforeChange, collectChanges, type Snapshots } from '@/services/agent/fileChanges';
import { copyAttachmentsToWorkspace } from '@/services/attachmentFiles';
import { PERSONAL_SPACE_TOOLS, PERSONAL_SUBDIR, conversationUsesPersonalSpace, ensurePersonalSpace, personalSpaceContext } from '@/services/personalSpace';
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
  /** Mode Auto : réglage en cours au moment de la coupure */
  route?: Route | null;
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

const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'remember', 'export_animation']);
const COMMAND_TOOLS = new Set(['run_command', 'spawn_subagents', 'start_dev_server']);
const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'search_files', 'get_diagnostics', 'explore', 'dev_server_logs', 'web_search', 'read_url', 'capture_page']);
/** Début du message qui montre au modèle les captures d'écran de capture_page */
const CAPTURE_MARK = "[Captures d'écran de capture_page]";

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
const SKILL_RESULT_PREFIX = '# Skill « ';

/** Questions à choix posées à l'utilisateur (panneau au-dessus de la saisie, comme dans Claude Code). */
const ASK_USER_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ask_user',
    description:
      "Pose 1 à 4 questions à choix à l'utilisateur et attend ses réponses. À utiliser quand une décision lui revient et change ce que tu vas faire " +
      "(approche, technologie, périmètre, choix de design), avant de te lancer dans un travail coûteux à refaire. " +
      "Pour chaque question : 2 à 4 options concrètes et courtes, recommended = l'index de celle que tu conseilles. Il peut aussi répondre librement. " +
      "N'utilise pas cet outil pour ce que tu peux décider toi-même ou trouver dans le code, ni pour demander la permission de continuer.",
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
// Mais le cache DeepSeek fait payer ~2 % du prix normal tout début de requête déjà
// envoyé tel quel. Raccourcir un peu à chaque étape modifierait l'historique au milieu
// et ferait repayer plein tarif tout ce qui suit (×50). On compacte donc RAREMENT et
// EN UNE FOIS : quand l'historique dépasse le plafond, ou au début d'une demande quand
// le cache est probablement froid. Entre deux, l'historique ne fait que s'allonger.
const KEEP_RECENT_TOOL_RESULTS = 6;   // derniers résultats gardés en entier
const SMALL_RESULT_CHARS = 1_500;     // un résultat court n'est jamais raccourci
const STUB_CHARS = 600;               // ce qu'on garde d'un ancien résultat
const SOFT_LIMIT_CHARS = 160_000;     // plafond avant compaction (~40k tokens)
const CACHE_COLD_MS = 30 * 60 * 1000; // au-delà, le cache fournisseur a pu être vidé
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
    const label = `[${a.ref}] ${a.name} (${a.kind})` + (a.projectCopy
      ? `\nCopie du fichier dans ton dossier de travail : \`${a.projectCopy}\`. Pour le transformer (découper, fusionner, `
        + `convertir, extraire des pages, redimensionner…), écris un script python ou node qui lit ce fichier et `
        + `écris les résultats dans le même dossier, sans jamais écraser l'original. Bibliothèques utiles : pypdf ou `
        + `pdf-lib (PDF), openpyxl (Excel), python-docx (Word), Pillow (images). Si python ou node manque, explique `
        + `à l'utilisateur comment l'installer. Donne-lui à la fin le chemin des fichiers produits.`
      : '');
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
    case 'start_dev_server':
      return args.command || 'commande du projet';
    case 'check_page':
      return args.url || 'serveur du projet';
    case 'export_animation':
      return String(args.output || `export/animation.${args.format === 'gif' ? 'gif' : 'mp4'}`);
    case 'capture_page':
      return `${args.url || 'page ouverte'}${Array.isArray(args.frames) && args.frames.length ? ` · ${args.frames.length} instants` : ''}`;
    case 'page_action':
      return [args.action, args.element || args.target, args.text].filter(Boolean).join(' · ');
    case 'explore':
      return (args.questions || []).length ? `${(args.questions || []).length} question${(args.questions || []).length > 1 ? 's' : ''} en parallèle` : '';
    case 'spawn_subagents':
      return (args.tasks || []).length ? `${(args.tasks || []).length} sous-tâches` : '';
    case 'remember':
      return String(args.content || '').slice(0, 80);
    case 'ask_user':
      return (args.questions || []).map((q: any) => q?.question).filter(Boolean).join(' · ').slice(0, 140);
    case 'load_skill':
      return args.file ? `${args.name || ''} · ${args.file}` : String(args.name || '');
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
  /** Après chaque appel au modèle et chaque outil : coût cumulé (FCFA) de la réponse en cours. Sert au watchdog des tickets. */
  onProgress?: (p: { costFCFA: number }) => void;
}

export function useAgentChat({ workspacePath, workspaceName, model, permissionMode = 'full', onFileChanged, background = false, onProgress }: UseAgentChatParams) {
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
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
  ) => {
    if ((!content.trim() && !resumeFrom) || isGenerating) return;
    const refd = rawAttachments.slice(0, 8).map((a, i) => ({ ...a, ref: a.ref || String.fromCharCode(65 + i) }));
    const convId = resumeFrom?.convId ?? opts?.conversationId ?? ensureConversation();
    // Dossier où l'agent peut agir : le projet ouvert, ou à défaut l'« espace ANZAR » (Documents/ANZAR),
    // ouvert dès qu'un fichier est joint ou si la conversation l'a déjà utilisé.
    let agentRoot: string | null = workspacePath;
    let personalSpace = false;
    if (!workspacePath && !background) {
      const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
      if (refd.some((a) => a.sourcePath) || personalConvsRef.current.has(convId) || conversationUsesPersonalSpace(conv)) {
        agentRoot = await ensurePersonalSpace().catch(() => null);
        personalSpace = !!agentRoot;
        if (personalSpace) personalConvsRef.current.add(convId);
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
    // Connecteurs MCP activés (Context7, Playwright, GitHub…) : un serveur lent ne bloque pas le départ
    setMcpRoots(workspacePath ? [workspacePath] : []);
    const mcpTools = await mcpAgentTools({ waitMs: 8_000 }).catch(() => []);
    const mcpReadOnlyTools = mcpTools.filter((t) => mcpToolRef(t.function.name)?.tool.annotations?.readOnlyHint);

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
          systemHead = buildAgentSystemPrompt({ ...promptCtx, memory: undefined });
          systemRefresh = [ctx?.memory ? memorySection(ctx.memory) : '', skillsPromptSection(skills).trim(), personal.trim()]
            .filter(Boolean).join('\n\n');
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
                  "ou une documentation ; cite alors tes sources avec leur URL.\n\n"
                : '') +
              "AUCUN PROJET N'EST OUVERT. Tu n'as des outils sur les fichiers que si ANZAR t'ouvre l'« espace ANZAR » : il te " +
              "l'indique alors dans la demande, et ces outils te sont fournis. Sinon, tu ne peux ni lire un fichier, ni lancer " +
              "une commande, ni modifier quoi que ce soit. Ne prétends JAMAIS avoir agi sans outil, même si l'historique de la " +
              "conversation montre que tu le faisais avant : n'invente aucun résultat de commande, de build ou de test. " +
              "Si la demande exige d'agir sur un projet de code, dis-le en une phrase et demande d'ouvrir le dossier " +
              "(bouton « Ouvrir un dossier » en haut de la conversation). Pour transformer un fichier (PDF, Excel…), " +
              "propose de le joindre : ANZAR ouvre alors l'espace ANZAR.\n\n" +
              FORMATTING_GUIDE + '\n\n' + VISUALS_GUIDE + '\n\n' + CONNECTORS_GUIDE + personal,
          };
          systemHead = (system.content as string).slice(0, (system.content as string).length - personal.length);
          systemRefresh = personal.trim();
          // Espace ANZAR : signalé dans la demande (le prompt système reste identique, donc servi par le cache)
          if (personalSpace && agentRoot) turnContext += personalSpaceContext(agentRoot);
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

      // ── Boucle agent ──
      for (let step = 0; step < MAX_STEPS; step++) {
        if (controller.signal.aborted) break;

        let assembler = new Assembler();
        let stepContent = '';

        // Chaque étape renvoie tout l'historique au modèle. Compaction en une fois, seulement
        // au-delà du plafond, pour que le début de la requête reste identique (cache).
        if (historyChars(apiHistoryRef.current) > SOFT_LIMIT_CHARS) {
          compactHistory(apiHistoryRef.current, KEEP_RECENT_TOOL_RESULTS, STUB_CHARS);
          if (historyChars(apiHistoryRef.current) > SOFT_LIMIT_CHARS * 0.6) {
            compactHistory(apiHistoryRef.current, 2, 300);
          }
        }
        promptTokens += historyTokens();
        const web = webEnabled ? WEB_TOOLS : [];
        // Sans personne devant l'écran (automatisations, tickets), pas de question possible
        const ask = background ? [] : [ASK_USER_TOOL];
        const personalTools = personalSpace
          ? AGENT_TOOLS.filter((t) => PERSONAL_SPACE_TOOLS.has(t.function.name)
              && (modeRef.current !== 'plan' || READ_ONLY_TOOLS.has(t.function.name)))
          : [];
        const tools = !workspacePath
          ? ([...personalTools, ...web, ...ask, ...mcpTools].length ? [...personalTools, ...web, ...ask, ...mcpTools] : undefined)
          : modeRef.current === 'plan'
            ? [...AGENT_TOOLS.filter((t) => READ_ONLY_TOOLS.has(t.function.name)), ...web, PROPOSE_PLAN_TOOL, ...(skills.length ? [LOAD_SKILL_TOOL] : []), ...ask, ...mcpReadOnlyTools]
            : [...AGENT_TOOLS, ...web, ...(skills.length ? [LOAD_SKILL_TOOL] : []), ...ask, ...mcpTools];

        // Une étape coupée par le réseau est réessayée seule : l'historique est intact,
        // donc rien de ce qui a déjà été fait n'est perdu ni refacturé.
        let stepReasoning = '';
        for (let attempt = 0; ; attempt++) {
          assembler = new Assembler();
          stepContent = '';
          stepReasoning = '';
          try {
            const stream = aiService.chatStream(apiHistoryRef.current, { model: callModel(), tools, signal: controller.signal });
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
            lastCallAtRef.current = Date.now();
            onProgressRef.current?.({ costFCFA: cost.sum });
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

        // Captures d'écran rendues par les outils de cette étape : montrées au modèle après tous les résultats
        const stepImages: { label: string; dataUrl: string }[] = [];
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

          // Accord de l'utilisateur selon le mode de permission
          let allowed = true;
          let refusal = "Refusé par l'utilisateur. N'insiste pas : propose une autre approche ou demande-lui ce qu'il préfère.";
          if (modeRef.current === 'plan' && !READ_ONLY_TOOLS.has(call.function.name) && !mcpReadOnly && !['task_done', 'propose_plan', 'load_skill', 'ask_user'].includes(call.function.name)) {
            allowed = false;
          } else if (mcpAsk && background) {
            allowed = false;
            refusal = `Refusé automatiquement : l'action « ${mcpRef!.tool.name} » du connecteur ${mcpRef!.serverName} demande un accord, et personne n'est là pendant une automatisation. Signale-le dans ta réponse.`;
          } else if (risk && background) {
            // Automatisation : personne pour valider → refus, expliqué à l'agent
            allowed = false;
            refusal = `Refusé automatiquement : ${risk.reason}. Personne n'est là pour valider pendant une automatisation. Ne contourne pas ce refus ; signale-le dans ta réponse.`;
          } else if (needsApproval(modeRef.current, call.function.name) || risk || mcpAsk) {
            allowed = await new Promise<boolean>((resolve) => {
              approvalResolver.current = resolve;
              setApproval({ id: call.id, name: call.function.name, summary: ev.argsSummary, reason: risk?.reason, detail: risk?.detail });
            });
          }

          // Original mémorisé avant toute modification (carte « fichiers modifiés » + annulation)
          if (allowed && agentRoot && ['write_file', 'edit_file', 'delete_file'].includes(call.function.name)) {
            await noteAgentWrite(convId, agentRoot, args.path || args.file_path).catch(() => {});
            await snapshotBeforeChange(snapshots, agentRoot, args.path || args.file_path);
          }

          // Skill : instructions lues côté app, renvoyées à l'agent
          // Questions à l'utilisateur : l'agent attend ses réponses
          if (call.function.name === 'ask_user') {
            const questions = parseQuestions(args);
            let output: string;
            if (!questions.length) {
              output = "Erreur : il faut au moins une question avec 2 options (questions[].question, questions[].options[].label).";
              ev.status = 'error';
            } else if (background) {
              output = "Personne n'est là pour répondre : prends l'option recommandée (ou la plus prudente), continue, et note ce choix dans ton résumé.";
              ev.status = 'ok';
            } else {
              ev.argsSummary = questions.map((q) => q.question).join(' · ').slice(0, 140);
              flush();
              const answers = await new Promise<QuestionAnswer[] | null>((resolve) => {
                questionResolver.current = resolve;
                setQuestion({ id: call.id, questions });
              });
              output = answers
                ? formatAnswers(answers)
                : "L'utilisateur a passé ces questions : décide toi-même (option recommandée), et indique tes choix dans ta réponse.";
              ev.status = 'ok';
            }
            ev.output = output.slice(0, MAX_TOOL_OUTPUT_DISPLAY);
            flush();
            apiHistoryRef.current.push({ role: 'tool', tool_call_id: call.id, content: output });
            continue;
          }

          if (call.function.name === 'load_skill') {
            const wanted = String(args.name || '').trim();
            const skill = findSkill(skills, wanted);
            const file = typeof args.file === 'string' ? args.file.trim() : '';
            let output: string;
            let ok = !!skill;
            if (!skill) {
              output = `Skill « ${wanted} » introuvable. Skills disponibles : ${skills.map((sk) => sk.name).join(', ') || 'aucune'}.`;
            } else if (file) {
              try {
                output = `${SKILL_RESULT_PREFIX}${skill.name} » — fichier ${file}\n\n${await readSkillFile(skill, file)}`;
              } catch (e: any) {
                ok = false;
                output = `Lecture impossible de « ${file} » : ${e?.message || e}`;
              }
            } else {
              output = skillToolOutput(skill, SKILL_RESULT_PREFIX);
            }
            ev.status = ok ? 'ok' : 'error';
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

          const result: { output: string; isError?: boolean; isDone?: boolean; costFCFA?: number; images?: { label: string; dataUrl: string }[] } = !allowed
            ? { output: refusal, isError: true }
            : WEB_TOOL_NAMES.has(call.function.name)
            ? await executeWebTool(call.function.name, args, controller.signal)
            : mcpRef
            ? await callMcpTool(call.function.name, args, controller.signal)
            : agentRoot && (workspacePath || PERSONAL_SPACE_TOOLS.has(call.function.name))
            ? await executeToolCall(call, {
                projectRoot: agentRoot,
                signal: controller.signal,
                onFileChanged: (rel, _c, action) => { if (workspacePath) onFileChanged?.(rel, action); },
              })
            : { output: 'Aucun dossier de travail ouvert.', isError: true };

          // Recherche et lecture web : facturées à part par le serveur, ajoutées au coût de la réponse
          if (result.costFCFA) cost.sum += result.costFCFA;
          onProgressRef.current?.({ costFCFA: cost.sum });

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

          apiHistoryRef.current.push({
            role: 'tool',
            tool_call_id: call.id,
            content: result.output || '(vide)',
          });
          if (result.images?.length) stepImages.push(...result.images);

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
        if (!answered && stepImages.length) {
          apiHistoryRef.current.push({
            role: 'user',
            content: [
              { type: 'text', text: `${CAPTURE_MARK} ${stepImages.map((im, i) => `${i + 1}. ${im.label}`).join(' ; ')}` },
              ...stepImages.slice(0, 8).map((im) => ({ type: 'image_url' as const, image_url: { url: im.dataUrl, detail: 'auto' as const } })),
            ],
          });
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
        fileChanges: agentRoot ? await collectChanges(assistantId, agentRoot, snapshots).catch(() => undefined) : undefined,
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
        : { convId, assistantId, accContent, timeline: snapshotTimeline(), events, snapshots, promptTokens, completionTokens, balanceBefore, cost, route };
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
        fileChanges: agentRoot ? await collectChanges(assistantId, agentRoot, snapshots).catch(() => undefined) : undefined,
      });
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
