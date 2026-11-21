/**
 * AgentRunner — LA session de chat ANZAR, sans React.
 *
 * Une seule responsabilité : la durée de vie d'une conversation. Il garde l'historique API,
 * le mode de permission, les accords et questions en attente, la reprise après erreur, et
 * délègue le déroulé d'un tour à `turn.ts` (`runTurn`) via l'objet `host`.
 *
 * Utilisable depuis un composant (via le hook useAgentChat) ou depuis un service qui tourne
 * sans interface (tickets, automatisations).
 */
import { useChatStore } from '@/stores/chatStore';
import type { Route } from '@/services/ai/autoRouter';
import type { AgentQuestion, QuestionAnswer } from '@/services/agent/tools/questions';
import type { PermissionMode } from '@/services/agent/policy/permissions';
import type { APIMessage, ChatAttachment } from '@/types';
import { runTurn, type TurnHost } from './turn';
import type {
  AgentChatResult, AgentRunnerOptions, AgentRunnerState, ApprovalRequest, ResumeState,
} from './turnTypes';

export type {
  AgentChatResult, AgentRunnerOptions, AgentRunnerState, ApprovalRequest, ResumeState,
} from './turnTypes';
export type { PermissionMode } from '@/services/agent/policy/permissions';
export type { TimelineItem, ToolEvent } from '@/types';

export class AgentRunner {
  private opts: AgentRunnerOptions;
  /** Le mode peut changer pendant que l'agent travaille : on lit toujours la valeur courante. */
  private mode: PermissionMode;
  private state: AgentRunnerState = { isGenerating: false, approval: null, question: null, budget: null };
  private listeners = new Set<() => void>();
  private approvalResolver: ((ok: boolean) => void) | null = null;
  /** Questions de l'agent (ask_user) : null = l'utilisateur passe, l'agent décide */
  private questionResolver: ((answers: QuestionAnswer[] | null) => void) | null = null;
  private abort: AbortController | null = null;
  /** Historique API complet de la conversation (échanges d'outils inclus) */
  private apiHistory: APIMessage[] = [];
  /** Mode Auto : réglage de la dernière demande (une suite courte le garde) */
  private lastRoute: Route | null = null;
  /** Conversations sans projet qui travaillent dans l'espace ANZAR */
  private personalConvs = new Set<string>();
  /** Heure du dernier appel au modèle : sert à savoir si le cache DeepSeek est encore chaud */
  private lastCallAt = 0;
  /** Demande initiale (garantie d'export motion) */
  private userRequest = '';
  private activeConv: string | null = null;
  private resumeState: ResumeState | null = null;
  /** Ce que le tour voit de la session : champs en lecture, ou en lecture-écriture. */
  private host: TurnHost;

  constructor(options: AgentRunnerOptions) {
    this.opts = options;
    this.mode = options.permissionMode ?? 'auto';
    const self = this;
    this.host = {
      get opts() { return self.opts; },
      get mode() { return self.mode; },
      get state() { return self.state; },
      get personalConvs() { return self.personalConvs; },
      get apiHistory() { return self.apiHistory; },
      set apiHistory(value) { self.apiHistory = value; },
      get lastCallAt() { return self.lastCallAt; },
      set lastCallAt(value) { self.lastCallAt = value; },
      get lastRoute() { return self.lastRoute; },
      set lastRoute(value) { self.lastRoute = value; },
      get userRequest() { return self.userRequest; },
      set userRequest(value) { self.userRequest = value; },
      get activeConv() { return self.activeConv; },
      set activeConv(value) { self.activeConv = value; },
      get resumeState() { return self.resumeState; },
      set resumeState(value) { self.resumeState = value; },
      get abort() { return self.abort; },
      set abort(value) { self.abort = value; },
      setState: (patch) => self.setState(patch),
      clearPending: () => self.clearPending(),
      ensureConversation: () => self.ensureConversation(),
      requestApproval: (request) => self.requestApproval(request),
      requestAnswers: (callId, questions) => self.requestAnswers(callId, questions),
    };
  }

  /** Met à jour les options (projet ouvert, modèle, mode…) ; pris en compte à la prochaine demande. */
  setOptions(options: AgentRunnerOptions): void {
    this.opts = options;
    this.mode = options.permissionMode ?? 'auto';
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getState = (): AgentRunnerState => this.state;

  private setState(patch: Partial<AgentRunnerState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  resolveApproval = (ok: boolean): void => {
    this.approvalResolver?.(ok);
    this.approvalResolver = null;
    this.setState({ approval: null });
  };

  resolveQuestion = (answers: QuestionAnswer[] | null): void => {
    this.questionResolver?.(answers);
    this.questionResolver = null;
    this.setState({ question: null });
  };

  /** Pose une demande d'accord et attend la réponse de l'utilisateur (ou l'arrêt). */
  private requestApproval = (request: ApprovalRequest): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      this.approvalResolver = resolve;
      this.setState({ approval: request });
    });

  /** Pose des questions et attend les réponses (null = l'utilisateur passe). */
  private requestAnswers = (callId: string, questions: AgentQuestion[]): Promise<QuestionAnswer[] | null> =>
    new Promise<QuestionAnswer[] | null>((resolve) => {
      this.questionResolver = resolve;
      this.setState({ question: { id: callId, questions } });
    });

  /** Fin de tour : plus rien n'attend de réponse. */
  private clearPending(): void {
    this.approvalResolver = null;
    this.questionResolver = null;
    this.setState({ approval: null, question: null });
  }

  private ensureConversation(): string {
    // Toujours lire l'état FRAIS du store : une closure périmée (effet de
    // replay au démarrage) créerait une 2ᵉ conversation orpheline (B4).
    const current = useChatStore.getState().activeConversationId;
    if (current) return current;
    return useChatStore.getState().createConversation(undefined, this.opts.model).id;
  }

  stop = (): void => {
    this.abort?.abort();
    this.resolveApproval(false);
    this.resolveQuestion(null);
  };

  sendMessage = async (
    content: string,
    rawAttachments: ChatAttachment[] = [],
    resumeFrom?: ResumeState,
    opts?: { conversationId?: string },
  ): Promise<AgentChatResult | null> => {
    if ((!content.trim() && !resumeFrom) || this.state.isGenerating) return null;
    return runTurn(this.host, {
      content,
      rawAttachments,
      resumeFrom,
      conversationId: opts?.conversationId,
    });
  };

  /** Reprend une réponse interrompue par une erreur. Retourne false si la reprise n'est plus possible. */
  resume = (messageId: string): boolean => {
    const state = this.resumeState;
    if (!state || state.assistantId !== messageId || this.activeConv !== state.convId) return false;
    this.resumeState = null;
    void this.sendMessage('', [], state);
    return true;
  };

  /** Change le mode immédiatement (avant le prochain rendu), ex. à la validation d'un plan. */
  setModeNow = (m: PermissionMode): void => { this.mode = m; };
}
