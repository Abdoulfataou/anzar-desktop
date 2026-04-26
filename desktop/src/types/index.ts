/**
 * Core type definitions for ANZAR application
 * Multi-provider AI (DeepSeek + Kimi/Moonshot) + Project CRUD
 */

// ============================================================================
// AI PROVIDER & MODEL TYPES
// ============================================================================

/** AI Providers supported by ANZAR */
export type AIProvider = 'deepseek' | 'kimi';

/** User-facing mode names (white-labeled) */
export type AIModel = 'fast' | 'thinking';

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
  // DeepSeek models
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
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
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    provider: 'deepseek',
    mode: 'thinking',
    maxContext: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsVision: false,
    supportsJSON: true,
    supportsFIM: false,
    supportsStreaming: true,
    description: 'Raisonnement en chaîne (CoT), résolution de problèmes complexes',
  },
  // Kimi / Moonshot models
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    provider: 'kimi',
    mode: 'fast',
    maxContext: 262144,
    maxOutput: 262144,
    supportsTools: true,
    supportsVision: true,
    supportsJSON: true,
    supportsFIM: false,
    supportsStreaming: true,
    description: 'Ultra-long contexte 262K, code avancé et agents',
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'kimi',
    mode: 'thinking',
    maxContext: 131072,
    maxOutput: 131072,
    supportsTools: true,
    supportsVision: true,
    supportsJSON: true,
    supportsFIM: false,
    supportsStreaming: true,
    description: 'Multimodal avec raisonnement, vision et tool calling',
  },
];

/** Provider configuration */
export interface AIProviderConfig {
  provider: AIProvider;
  label: string;
  baseUrl: string;
  models: { fast: string; thinking: string };
  defaultTemperature: Record<AIModel, number>;
  features: string[];
}

/** Provider registry */
export const AI_PROVIDERS: Record<AIProvider, AIProviderConfig> = {
  deepseek: {
    provider: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: { fast: 'deepseek-chat', thinking: 'deepseek-reasoner' },
    defaultTemperature: { fast: 1.0, thinking: 1.0 },
    features: ['Chat', 'Streaming', 'Tool Calling', 'JSON Mode', 'FIM', 'Thinking CoT'],
  },
  kimi: {
    provider: 'kimi',
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.ai/v1',
    models: { fast: 'kimi-k2.6', thinking: 'kimi-k2.5' },
    defaultTemperature: { fast: 0.7, thinking: 0.7 },
    features: ['Chat', 'Streaming', 'Tool Calling', 'JSON Mode', 'Vision', '262K Context'],
  },
};

// ============================================================================
// MESSAGE & CONVERSATION TYPES
// ============================================================================

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  model?: AIModel;
  provider?: AIProvider;
  thinking?: string;           // DeepSeek reasoner CoT / Kimi thinking
  tokens?: { prompt: number; completion: number };
  isStreaming?: boolean;
  codeBlocks?: CodeBlock[];
  toolCalls?: ToolCall[];      // Function calls made by AI
  toolCallId?: string;         // For tool response messages
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

export * from './run';

// ============================================================================
// TOOL CALLING TYPES (OpenAI-compatible, used by both DeepSeek & Kimi)
// ============================================================================

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;    // JSON Schema
    strict?: boolean;                    // DeepSeek strict mode
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

export type AgentType = 'orchestrator' | 'planner' | 'coder' | 'tester' | 'executor';

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
}

export interface APIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  reasoning_content?: string;     // DeepSeek thinking
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
    prompt_cache_hit_tokens?: number;   // DeepSeek cache
    prompt_cache_miss_tokens?: number;
  };
}

/** Streaming chunk (SSE delta) */
export interface StreamDelta {
  content?: string;
  reasoning_content?: string;
  tool_calls?: Partial<ToolCall>[];
  finish_reason?: string | null;
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
