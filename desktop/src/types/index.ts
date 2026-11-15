/**
 * Core type definitions for ANZAR application
 * IA DeepSeek (via le serveur ANZAR) + Project CRUD
 */

// ============================================================================
// AI PROVIDER & MODEL TYPES
// ============================================================================

/** Fournisseur IA d'ANZAR : 100 % DeepSeek (via le serveur ANZAR) */
export type AIProvider = 'deepseek';

/** User-facing mode names (white-labeled) */
/** Rapide = réflexion courte · Réflexion = effort standard des agents · Max = tâches difficiles */
export type AIModel = 'fast' | 'thinking' | 'max';

/** Effort de réflexion DeepSeek (« none » = sans réflexion) */
export type ReasoningEffort = 'none' | 'low' | 'high' | 'max';

/** Provider-specific model identifiers */
export interface ProviderModel {
  id: string;
  name: string;
  provider: AIProvider;
  mode: AIModel;
  maxContext: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsJSON: boolean;
  supportsFIM: boolean;
  supportsStreaming: boolean;
  description: string;
}

/** Complete model registry */
export const AI_MODELS: ProviderModel[] = [
  // Provider A (standard)
  {
    id: 'deepseek-flash',
    name: 'ANZAR Rapide',
    provider: 'deepseek',
    mode: 'fast',
    maxContext: 131072,
    maxOutput: 8192,
    supportsTools: true,
    supportsVision: false,
    supportsJSON: true,
    supportsFIM: true,
    supportsStreaming: true,
    description: 'Rapide et polyvalent, idéal pour le code et la conversation',
  },
  {
    id: 'deepseek-flash-thinking',
    name: 'ANZAR Raisonnement',
    provider: 'deepseek',
    mode: 'thinking',
    maxContext: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: false,
    supportsJSON: true,
    supportsFIM: false,
    supportsStreaming: true,
    description: 'Raisonnement avancé, résolution de problèmes complexes',
  },
];

/** Provider configuration */
export interface AIProviderConfig {
  provider: AIProvider;
  label: string;
  baseUrl: string;
  models: Record<AIModel, string>;
  /** Effort de réflexion envoyé pour chaque mode (fournisseurs qui le gèrent) */
  reasoningEffort?: Record<AIModel, ReasoningEffort>;
  defaultTemperature: Record<AIModel, number>;
  features: string[];
}

/** Provider registry */
export const AI_PROVIDERS: Record<AIProvider, AIProviderConfig> = {
  deepseek: {
    provider: 'deepseek',
    label: 'ANZAR Rapide',
    // NOTE: les requêtes passent par le backend ANZAR (proxy). Ne pas exposer de vendor URL ici.
    baseUrl: 'proxy',
    // deepseek-chat / deepseek-reasoner ont été retirés par DeepSeek (24/07/2026) :
    // un seul modèle, deepseek-flash, dont on règle l'effort de réflexion.
    models: { fast: 'deepseek-flash', thinking: 'deepseek-flash', max: 'deepseek-flash' },
    reasoningEffort: { fast: 'low', thinking: 'high', max: 'max' },
    defaultTemperature: { fast: 1.0, thinking: 1.0, max: 1.0 },
    features: ['Chat', 'Streaming', 'Tool Calling', 'JSON Mode', 'FIM', 'Raisonnement'],
  },
};

// ============================================================================
// MESSAGE & CONVERSATION TYPES
// ============================================================================

export type ChatAttachmentKind =
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'csv'
  | 'tsv'
  | 'text'
  | 'code'
  | 'image'
  | 'binary';

/**
 * Pièce jointe "chat" (grand public):
 * - On persiste seulement des métadonnées + un extrait (pour éviter de gonfler le storage).
 * - Le contenu complet peut être recalculé/relit si nécessaire.
 */
export interface ChatAttachment {
  id: string;
  name: string;
  kind: ChatAttachmentKind;
  sizeBytes?: number;
  /** Référence courte (A, B, C...) pour que l’IA puisse citer facilement */
  ref?: string;
  /** Extrait de texte (tronqué) utilisé pour le contexte IA */
  excerpt?: string;
  /** Infos additionnelles (pages, feuilles, lignes, etc.) */
  meta?: Record<string, any>;
  /** Image : contenu en data URL, envoyé au modèle (jamais sauvegardé dans l'historique) */
  dataUrl?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  model?: AIModel;
  provider?: AIProvider;
  thinking?: string;           // Contenu de raisonnement (si fourni par le modèle)
  /** Étapes de raisonnement (si fournies par le backend/provider) */
  reasoning?: string[];
  tokens?: { prompt: number; completion: number };
  /** Message d'état temporaire affiché pendant le travail (ex. nouvelle tentative réseau) */
  notice?: string;
  /** La réponse s'est arrêtée sur une erreur et peut être reprise */
  resumable?: boolean;
  /** Plan proposé en mode plan (onglet « Plan ») */
  plan?: { title: string; markdown: string; status: 'pending' | 'approved' | 'rejected' };
  /** Fichiers modifiés par l'agent pendant cette réponse */
  fileChanges?: import('@/services/agent/fileChanges').FileChange[];
  /** Les modifications de cette réponse ont été annulées */
  changesUndone?: boolean;
  /** Coût réel de la réponse en FCFA (différence de solde serveur) */
  costFCFA?: number;
  isStreaming?: boolean;
  /** Marqueur UI: message d'erreur (affichage rouge, etc.) */
  isError?: boolean;
  /** Lien UI vers la timeline d'activité (cowork-style) */
  activitySessionId?: string;
  /** Infos de routage (utile pour debug / transparence) */
  routingInfo?: {
    provider: string;
    taskType: string;
    wasFallback: boolean;
    reason: string;
  };
  codeBlocks?: CodeBlock[];
  toolCalls?: ToolCall[];      // Function calls made by AI
  toolCallId?: string;         // For tool response messages
  /** Pièces jointes associées au message (surtout côté user) */
  attachments?: ChatAttachment[];
  /** Ordre d'affichage : morceaux de texte et groupes d'actions, dans l'ordre produit */
  timeline?: import('@/hooks/useAgentChat').TimelineItem[];
  /** Événements d'outils de l'agent (rendu ZCode : read/edit/bash…) */
  toolEvents?: import('@/hooks/useAgentChat').ToolEvent[];
  /** If set, show an "Open & Run" action button for this project */
  actionProjectId?: string;
}

export interface CodeBlock {
  language: string;
  code: string;
  filename?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  model: AIModel;
  provider?: AIProvider;
  projectId?: string;
  tags?: string[];
}

// ============================================================================
// RUNS (execution timeline)
// ============================================================================
// (run.ts removed — Runs system was deleted in Phase 1 cleanup)
// ============================================================================
// TOOL CALLING TYPES (OpenAI-compatible, used by multiple providers)
// ============================================================================

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;    // JSON Schema
    strict?: boolean;                    // Mode strict (si supporté)
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;                   // JSON string
  };
}

/** Built-in tools ANZAR can expose to the AI */
export const ANZAR_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Crée un nouveau fichier dans le projet avec le contenu spécifié',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier dans le projet' },
          content: { type: 'string', description: 'Contenu du fichier' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Modifie un fichier existant en remplaçant son contenu',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier' },
          content: { type: 'string', description: 'Nouveau contenu complet du fichier' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Supprime un fichier du projet',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier à supprimer' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Lit le contenu d\'un fichier du projet',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier à lire' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Liste tous les fichiers et dossiers du projet',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Dossier à lister (vide = racine)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Crée un nouveau dossier dans le projet',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin du dossier à créer' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_file',
      description: 'Renomme ou déplace un fichier',
      parameters: {
        type: 'object',
        properties: {
          oldPath: { type: 'string', description: 'Chemin actuel du fichier' },
          newPath: { type: 'string', description: 'Nouveau chemin du fichier' },
        },
        required: ['oldPath', 'newPath'],
      },
    },
  },
];

// ============================================================================
// PROJECT & FILE TYPES
// ============================================================================

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'planning' | 'generating' | 'testing' | 'complete' | 'error';
  createdAt: number;
  updatedAt: number;
  files: ProjectFile[];
  agents: AgentStatus[];
  conversationId?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
  localPath?: string;
}

export interface ProjectFile {
  path: string;
  content: string;
  language: string;
  size: number;
  createdAt?: number;
  updatedAt?: number;
}

/** File operation types for project CRUD */
export type FileOperation =
  | { type: 'create'; path: string; content: string }
  | { type: 'edit'; path: string; content: string }
  | { type: 'delete'; path: string }
  | { type: 'rename'; oldPath: string; newPath: string }
  | { type: 'createDir'; path: string };

// ============================================================================
// AGENT TYPES
// ============================================================================

export type AgentType = 'planner' | 'coder';

export interface AgentStatus {
  name: AgentType;
  status: 'idle' | 'working' | 'done' | 'error';
  progress: number;
  message?: string;
  error?: string;
  duration?: number;
}

export interface ProjectPlan {
  title: string;
  overview: string;
  files: { path: string; description: string; type: string }[];
  phases: { name: string; description: string; duration: string; tasks: string[] }[];
  complexity: 'low' | 'medium' | 'high';
  notes?: string;
}

// ============================================================================
// MEMORY & HISTORY TYPES
// ============================================================================

export interface MemoryItem {
  id: string;
  conversationId: string;
  title: string;
  summary: string;
  timestamp: number;
  tags: string[];
  content?: string;
}

// ============================================================================
// SETTINGS & CONFIGURATION TYPES
// ============================================================================

export type Theme = 'dark' | 'light' | 'system';
export type Language = 'fr' | 'en';

export interface AppSettings {
  // AI
  model: AIModel;
  provider: AIProvider;

  // UI
  theme: Theme;
  language: Language;
  fontSize: number;
  compactMode: boolean;
  animations: boolean;

  // Features
  autoSave: boolean;
  bandwidthSaver: boolean;
  offlineMode: boolean;

  metadata?: Record<string, any>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  model: 'fast',
  provider: 'deepseek',
  theme: 'dark',
  language: 'fr',
  fontSize: 14,
  compactMode: false,
  animations: true,
  autoSave: true,
  bandwidthSaver: false,
  offlineMode: false,
};

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface ChatOptions {
  model?: AIModel;
  provider?: AIProvider;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  signal?: AbortSignal;
  stream?: boolean;
  tools?: ToolDefinition[];
  responseFormat?: { type: 'text' | 'json_object' };
  systemPrompt?: string;
  /** Force l'effort de réflexion (ex. « none » pour une réponse courte et peu chère) */
  reasoningEffort?: ReasoningEffort;
}

/** Bloc d'un message mixte (texte + images) */
export type APIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface APIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | APIContentPart[] | null;
  reasoning_content?: string;     // Raisonnement (si fourni)
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      reasoning_content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;   // Cache hit tokens (si fourni)
    prompt_cache_miss_tokens?: number;
  };
}

/** Streaming chunk (SSE delta) */
export interface StreamDelta {
  content?: string;
  reasoning_content?: string;
  tool_calls?: Partial<ToolCall>[];
  finish_reason?: string | null;
  /** Coût exact de l'appel, envoyé par le serveur juste avant la fin du flux (FCFA) */
  serverCostFCFA?: number;
}

export interface APIError {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

// ============================================================================
// UI STATE TYPES
// ============================================================================

export interface NetworkStatus {
  isOnline: boolean;
  isSlowConnection: boolean;
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g' | '5g';
  downlink?: number;
  rtt?: number;
}

export interface LoadingState {
  isLoading: boolean;
  progress?: number;
  message?: string;
  error?: string;
}

// ============================================================================
// ACCOUNT & CREDITS TYPES
// ============================================================================

/**
 * Modèle prépayé "achète et consomme" (pay-as-you-go)
 * Pas d'abonnement — l'utilisateur achète du crédit FCFA et consomme.
 * Quand le solde tombe à 0, il recharge via Wave, Orange Money, M-Pesa.
 */

/** @deprecated Alias conservé pour compatibilité — sera supprimé */
export type PlanType = 'prepaid';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  createdAt: number;
}

export interface CreditBalance {
  /** Total cumulé de toutes les recharges */
  totalRecharged: number;
  /** Total consommé (déductions API) */
  totalUsed: number;
  /** Solde disponible en FCFA */
  remaining: number;
}

export interface Transaction {
  id: string;
  type: 'recharge' | 'bonus' | 'usage';
  amount: number;
  description: string;
  date: number;
  paymentMethod?: 'wave' | 'orange_money' | 'airtel_money' | 'flooz' | 'mpesa' | 'nita_transfert' | 'amana_transfert' | 'card';
  status: 'completed' | 'pending' | 'failed';
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface Result<T> {
  success: boolean;
  data?: T;
  error?: string;
}
