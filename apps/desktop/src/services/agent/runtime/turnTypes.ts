/**
 * Types publics d'un tour de conversation.
 *
 * Extraits de `agentRunner` pour que les modules du tour (hôte d'outils, replis,
 * comptabilité) puissent les partager sans importer la classe — et donc sans cycle.
 * Aucun import React, Tauri ou store.
 */
import type { AIModel, APIMessage, ChatAttachment, TimelineItem, ToolEvent } from '@/types';
import type { AgentStopReason } from '../engine/agentSession';
import type { PermissionMode } from '../policy/permissions';
import type { Route } from '@/services/ai/autoRouter';
import type { QuestionRequest } from '../tools/questions';
import type { Snapshots } from '../tools/fileChanges';
import type { ServerCost } from './turnAccounting';
import type { BudgetSpec, BudgetView } from '../engine/budget';
import type { AgentQuestion, QuestionAnswer } from '../tools/questions';

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
  /** Programme hors de la liste d'ANZAR : la carte propose « Toujours autoriser ». */
  trustProgram?: string;
}

/** Tout ce qu'il faut pour reprendre une réponse là où elle s'est arrêtée. */
export interface ResumeState {
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

export interface AgentRunnerOptions {
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
  /** Plafonds du tour. Par défaut : budget interactif, ou budget de fond si `background`. */
  budget?: BudgetSpec;
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

export interface AgentRunnerState {
  isGenerating: boolean;
  approval: ApprovalRequest | null;
  question: QuestionRequest | null;
  /** Consommation du budget du tour en cours (ou du dernier tour), pour l'affichage. */
  budget: BudgetView | null;
}

/**
 * Ce dont un tour a besoin de la session : ses options, son historique, son mode, et les
 * points d'entrée des accords et des questions. Le runner fournit cet objet ; le tour ne
 * touche jamais ses champs privés.
 */
export interface TurnHost {
  readonly opts: AgentRunnerOptions;
  readonly mode: PermissionMode;
  readonly state: AgentRunnerState;
  readonly personalConvs: Set<string>;
  apiHistory: APIMessage[];
  lastCallAt: number;
  lastRoute: Route | null;
  userRequest: string;
  activeConv: string | null;
  resumeState: ResumeState | null;
  abort: AbortController | null;
  setState(patch: Partial<AgentRunnerState>): void;
  /** Remet à zéro les accords et questions en attente (fin de tour). */
  clearPending(): void;
  ensureConversation(): string;
  requestApproval(request: ApprovalRequest): Promise<boolean>;
  requestAnswers(callId: string, questions: AgentQuestion[]): Promise<QuestionAnswer[] | null>;
}

export interface TurnInput {
  content: string;
  rawAttachments?: ChatAttachment[];
  resumeFrom?: ResumeState;
  /** Tâche cible (automatisations) ; par défaut la tâche affichée. */
  conversationId?: string;
}

