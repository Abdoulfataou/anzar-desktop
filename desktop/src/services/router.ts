/**
 * AIRouter — Routage intelligent DeepSeek (80%) / Kimi (20%)
 *
 * STRATÉGIE DE COÛTS:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ DeepSeek V3/R1 (~80% des requêtes)                            │
 * │  • Chat simple, Q&A                                           │
 * │  • Génération de code brut                                    │
 * │  • Raisonnement / Thinking (R1)                               │
 * │  • Tool calling / function calling                            │
 * │  • JSON mode                                                  │
 * │  • FIM autocomplete                                           │
 * │  • Planification de projets                                   │
 * │  Prix: ~0.14$/M input, ~0.28$/M output (V3) — ultra cheap     │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Kimi K2.6/K2.5 (~20% des requêtes)                            │
 * │  • Vision: images → description/analyse                       │
 * │  • Image-to-code: screenshot → code                           │
 * │  • Compréhension de bugs visuels (UI screenshots)             │
 * │  • Fallback quand DeepSeek échoue (2e tentative)              │
 * │  • Contexte ultra-long (>128K tokens)                         │
 * │  Prix: ~0.60$/M input, ~1.80$/M output — 4-6x plus cher       │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { AIProvider, AIModel, ChatOptions, APIMessage, StreamDelta } from '@/types';
import { aiService } from './ai';
import { getSystemPrompt, type PromptContext } from './prompts';

// ============================================================================
// TASK CLASSIFICATION
// ============================================================================

/** Types de tâches détectées automatiquement */
export type TaskType =
  | 'chat'              // Conversation simple
  | 'code_gen'          // Génération de code
  | 'code_edit'         // Modification de code existant
  | 'code_review'       // Revue / audit de code
  | 'reasoning'         // Analyse complexe, mathématiques
  | 'planning'          // Planification de projet
  | 'vision'            // Analyse d'image (screenshot, UI, photo)
  | 'image_to_code'     // Transformer une image en code
  | 'debug_visual'      // Débugger un problème visuel/UI
  | 'long_context'      // Document très long (>128K tokens)
  | 'fim'               // Autocomplétion de code (FIM)
  | 'tool_call';        // Opérations fichiers / outils

/** Résultat de la classification */
export interface TaskClassification {
  type: TaskType;
  confidence: number;       // 0-1
  provider: AIProvider;     // Provider recommandé
  reason: string;           // Explication du choix
  hasImages: boolean;       // Message contient des images
  estimatedTokens: number;  // Estimation de la taille du contexte
}

/** Résultat d'un appel routé */
export interface RoutedResult {
  provider: AIProvider;
  model: AIModel;
  taskType: TaskType;
  wasFallback: boolean;     // true si c'est un retry après échec DeepSeek
  cost: CostEstimate;
}

/** Estimation de coût */
export interface CostEstimate {
  provider: AIProvider;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  costFCFA: number;         // Pour le marché africain
}

// ============================================================================
// COST CONSTANTS (prix par million de tokens)
// ============================================================================

const COST_PER_M_TOKENS = {
  deepseek: {
    fast:     { input: 0.14, output: 0.28 },     // DeepSeek V3
    thinking: { input: 0.55, output: 2.19 },     // DeepSeek R1
    cache_hit: 0.014,                             // Cache discount 90%
  },
  kimi: {
    fast:     { input: 0.60, output: 1.80 },     // Kimi K2.6
    thinking: { input: 0.60, output: 1.80 },     // Kimi K2.5
  },
} as const;

/** Taux de change USD → FCFA (approximatif, mis à jour manuellement) */
const USD_TO_FCFA = 615;

// ============================================================================
// DETECTION PATTERNS
// ============================================================================

/** Mots-clés et patterns pour détecter le type de tâche */
const VISION_KEYWORDS = [
  'image', 'photo', 'capture', 'screenshot', 'écran', 'screen',
  'regarde', 'vois', 'montre', 'affiche', 'aperçu', 'preview',
  'ui', 'interface', 'design', 'maquette', 'mockup', 'wireframe',
  'logo', 'icône', 'icon', 'diagramme', 'schéma',
];

const IMAGE_TO_CODE_KEYWORDS = [
  'convertir en code', 'transformer en code', 'code à partir de',
  'reproduire', 'reproduis', 'copier ce design', 'recréer',
  'image to code', 'screenshot to code', 'image vers code',
  'coder cette', 'coder ce', 'code cette interface',
  'html à partir', 'react à partir', 'css à partir',
  'clone ce', 'clone cette', 'réplique',
];

const DEBUG_VISUAL_KEYWORDS = [
  'bug visuel', 'problème visuel', 'affichage', 'rendu',
  'css cassé', 'style cassé', 'mal aligné', 'décalé',
  'ne s\'affiche pas', 'n\'apparaît pas', 'invisible',
  'responsive', 'overflow', 'débordement',
  'pourquoi ça ressemble', 'look wrong', 'looks weird',
];

const CODE_GEN_KEYWORDS = [
  'créer', 'crée', 'génère', 'génère', 'code', 'programme',
  'développe', 'construis', 'build', 'implement', 'implémente',
  'écris', 'write', 'script', 'composant', 'component',
  'fonction', 'function', 'classe', 'class', 'module',
  'api', 'endpoint', 'route', 'service', 'hook',
  'application', 'app', 'site', 'page',
];

const REASONING_KEYWORDS = [
  'analyse', 'explique', 'pourquoi', 'compare', 'évalue',
  'optimise', 'refactor', 'architecture', 'design pattern',
  'algorithme', 'complexité', 'performance', 'sécurité',
  'mathématique', 'calcul', 'formule', 'preuve',
  'stratégie', 'décision', 'choix entre', 'avantages',
];

const PLANNING_KEYWORDS = [
  'plan', 'planifie', 'structure', 'organise', 'architecture',
  'projet', 'roadmap', 'étapes', 'phases', 'planning',
  'cahier des charges', 'spécification', 'spec',
];

// ============================================================================
// AI ROUTER CLASS
// ============================================================================

class AIRouter {
  /** Stats de coûts cumulés par session */
  private sessionStats = {
    deepseek: { requests: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 },
    kimi:     { requests: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 },
    fallbacks: 0,
    totalRequests: 0,
  };

  // ========================================================================
  // TASK CLASSIFICATION
  // ========================================================================

  /**
   * Classifie automatiquement une requête utilisateur
   * et détermine le provider optimal
   */
  classifyTask(
    messages: APIMessage[],
    options: {
      hasImages?: boolean;
      forceProvider?: AIProvider;
      contextLength?: number;
    } = {}
  ): TaskClassification {
    // Si un provider est forcé, on l'utilise
    if (options.forceProvider) {
      return {
        type: 'chat',
        confidence: 1,
        provider: options.forceProvider,
        reason: `Provider forcé: ${options.forceProvider}`,
        hasImages: options.hasImages || false,
        estimatedTokens: this.estimateTokens(messages),
      };
    }

    const lastUserMessage = this.getLastUserMessage(messages);
    const lowerMsg = lastUserMessage.toLowerCase();
    const estimatedTokens = this.estimateTokens(messages);
    const hasImages = options.hasImages || this.detectImages(messages);

    // ── RÈGLE 1: Images → TOUJOURS Kimi (DeepSeek n'a pas la vision) ──
    if (hasImages) {
      const isImageToCode = this.matchesKeywords(lowerMsg, IMAGE_TO_CODE_KEYWORDS);
      const isDebugVisual = this.matchesKeywords(lowerMsg, DEBUG_VISUAL_KEYWORDS);

      if (isImageToCode) {
        return {
          type: 'image_to_code',
          confidence: 0.95,
          provider: 'kimi',
          reason: 'Image → Code : Kimi est le seul avec la vision',
          hasImages: true,
          estimatedTokens,
        };
      }

      if (isDebugVisual) {
        return {
          type: 'debug_visual',
          confidence: 0.90,
          provider: 'kimi',
          reason: 'Debug visuel avec screenshot : Kimi vision requis',
          hasImages: true,
          estimatedTokens,
        };
      }

      return {
        type: 'vision',
        confidence: 0.95,
        provider: 'kimi',
        reason: 'Message avec image(s) : Kimi vision requis',
        hasImages: true,
        estimatedTokens,
      };
    }

    // ── RÈGLE 2: Contexte ultra-long (>128K) → Kimi (262K context) ──
    if (estimatedTokens > 120000) {
      return {
        type: 'long_context',
        confidence: 0.85,
        provider: 'kimi',
        reason: `Contexte très long (~${Math.round(estimatedTokens / 1000)}K tokens) → Kimi 262K`,
        hasImages: false,
        estimatedTokens,
      };
    }

    // ── RÈGLE 3: Détection vision sans image attachée (demande d'analyse d'image) ──
    if (this.matchesKeywords(lowerMsg, VISION_KEYWORDS) && this.mentionsImageFile(lowerMsg)) {
      return {
        type: 'vision',
        confidence: 0.80,
        provider: 'kimi',
        reason: 'Référence à une image/screenshot → Kimi vision',
        hasImages: false,
        estimatedTokens,
      };
    }

    // ── À PARTIR D'ICI: Tout va vers DeepSeek (80%+) ──

    // ── RÈGLE 4: Image-to-code sans image → DeepSeek code gen ──
    if (this.matchesKeywords(lowerMsg, IMAGE_TO_CODE_KEYWORDS) && !hasImages) {
      return {
        type: 'code_gen',
        confidence: 0.80,
        provider: 'deepseek',
        reason: 'Demande de code (pas d\'image jointe) → DeepSeek V3',
        hasImages: false,
        estimatedTokens,
      };
    }

    // ── RÈGLE 5: Planification → DeepSeek (bon et pas cher) ──
    if (this.matchesKeywords(lowerMsg, PLANNING_KEYWORDS)) {
      return {
        type: 'planning',
        confidence: 0.85,
        provider: 'deepseek',
        reason: 'Planification de projet → DeepSeek V3 (JSON mode)',
        hasImages: false,
        estimatedTokens,
      };
    }

    // ── RÈGLE 6: Raisonnement complexe → DeepSeek R1 (Thinking) ──
    if (this.matchesKeywords(lowerMsg, REASONING_KEYWORDS) && lowerMsg.length > 100) {
      return {
        type: 'reasoning',
        confidence: 0.80,
        provider: 'deepseek',
        reason: 'Analyse / raisonnement complexe → DeepSeek R1 (CoT)',
        hasImages: false,
        estimatedTokens,
      };
    }

    // ── RÈGLE 7: Génération de code → DeepSeek V3 ──
    if (this.matchesKeywords(lowerMsg, CODE_GEN_KEYWORDS)) {
      return {
        type: 'code_gen',
        confidence: 0.85,
        provider: 'deepseek',
        reason: 'Génération de code → DeepSeek V3 (rapide et économique)',
        hasImages: false,
        estimatedTokens,
      };
    }

    // ── RÈGLE 8: Défaut → Chat simple DeepSeek ──
    return {
      type: 'chat',
      confidence: 0.70,
      provider: 'deepseek',
      reason: 'Chat standard → DeepSeek V3 (économique)',
      hasImages: false,
      estimatedTokens,
    };
  }

  // ========================================================================
  // ROUTED OPERATIONS — chat, stream, tools
  // ========================================================================

  /**
   * Chat routé intelligemment avec fallback automatique
   * DeepSeek en premier → Kimi si échec
   */
  async chat(
    messages: APIMessage[],
    options: ChatOptions & {
      hasImages?: boolean;
      forceProvider?: AIProvider;
      enableFallback?: boolean;
    } = {}
  ) {
    const classification = this.classifyTask(messages, {
      hasImages: options.hasImages,
      forceProvider: options.forceProvider,
    });

    const enableFallback = options.enableFallback !== false;
    const chatOptions: ChatOptions = {
      ...options,
      provider: classification.provider,
    };

    // Forcer le mode thinking si la tâche est du raisonnement
    if (classification.type === 'reasoning' && !options.model) {
      chatOptions.model = 'thinking';
    }

    try {
      const response = await aiService.chat(messages, chatOptions);
      this.trackUsage(classification.provider, chatOptions.model || 'fast', response.usage);
      this.sessionStats.totalRequests++;

      return {
        response,
        routing: {
          provider: classification.provider,
          model: chatOptions.model || 'fast',
          taskType: classification.type,
          wasFallback: false,
          cost: this.estimateCost(
            classification.provider,
            chatOptions.model || 'fast',
            response.usage.prompt_tokens,
            response.usage.completion_tokens
          ),
        } as RoutedResult,
      };
    } catch (error: any) {
      // ── FALLBACK: DeepSeek échoue → Kimi prend le relais ──
      if (enableFallback && classification.provider === 'deepseek') {
        console.warn(`[AIRouter] DeepSeek failed, falling back to Kimi: ${error.message}`);
        this.sessionStats.fallbacks++;

        const fallbackOptions: ChatOptions = {
          ...options,
          provider: 'kimi',
        };
        try {
          const response = await aiService.chat(messages, fallbackOptions);
          this.trackUsage('kimi', fallbackOptions.model || 'fast', response.usage);
          this.sessionStats.totalRequests++;

          return {
            response,
            routing: {
              provider: 'kimi',
              model: fallbackOptions.model || 'fast',
              taskType: classification.type,
              wasFallback: true,
              cost: this.estimateCost(
                'kimi',
                fallbackOptions.model || 'fast',
                response.usage.prompt_tokens,
                response.usage.completion_tokens
              ),
            } as RoutedResult,
          };
        } catch (fallbackError: any) {
          // If fallback also fails, keep the original error (avoid confusing messages).
          throw error;
        }
      }

      throw error;
    }
  }

  /**
   * Streaming routé intelligemment avec fallback
   */
  async *chatStream(
    messages: APIMessage[],
    options: ChatOptions & {
      hasImages?: boolean;
      forceProvider?: AIProvider;
      enableFallback?: boolean;
      onRouting?: (classification: TaskClassification) => void;
    } = {}
  ): AsyncGenerator<StreamDelta & { _routing?: RoutedResult }, void, undefined> {
    const classification = this.classifyTask(messages, {
      hasImages: options.hasImages,
      forceProvider: options.forceProvider,
    });

    // Notifier le composant du routage choisi
    if (options.onRouting) {
      options.onRouting(classification);
    }

    const enableFallback = options.enableFallback !== false;
    const streamOptions: ChatOptions = {
      ...options,
      provider: classification.provider,
    };

    if (classification.type === 'reasoning' && !options.model) {
      streamOptions.model = 'thinking';
    }

    try {
      let totalContent = 0;

      for await (const delta of aiService.chatStream(messages, streamOptions)) {
        if (delta.content) totalContent += delta.content.length;
        yield delta;
      }

      // Estimation grossière du coût après streaming
      const inputTokens = this.estimateTokens(messages);
      const outputTokens = Math.ceil(totalContent / 4); // ~4 chars/token
      this.trackUsage(classification.provider, streamOptions.model || 'fast', {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      });
      this.sessionStats.totalRequests++;

    } catch (error: any) {
      // ── FALLBACK: retry avec Kimi ──
      if (enableFallback && classification.provider === 'deepseek' && error.name !== 'AbortError') {
        console.warn(`[AIRouter] DeepSeek stream failed, falling back to Kimi: ${error.message}`);
        this.sessionStats.fallbacks++;

        const fallbackOptions: ChatOptions = {
          ...options,
          provider: 'kimi',
        };

        try {
          for await (const delta of aiService.chatStream(messages, fallbackOptions)) {
            yield delta;
          }
          this.sessionStats.totalRequests++;
          return;
        } catch {
          // If fallback also fails, keep the original error.
          throw error;
        }
      }

      throw error;
    }
  }

  /**
   * Tool calling routé — toujours DeepSeek sauf vision
   */
  async chatWithTools(
    messages: APIMessage[],
    tools: import('@/types').ToolDefinition[],
    toolExecutor: (name: string, args: Record<string, any>) => Promise<string>,
    options: ChatOptions & { hasImages?: boolean } = {}
  ) {
    // Tool calling est toujours DeepSeek (pas cher, performant)
    // sauf si il y a des images
    const provider = options.hasImages ? 'kimi' : 'deepseek';

    return aiService.chatWithTools(messages, tools, toolExecutor, {
      ...options,
      provider,
    });
  }

  /**
   * FIM autocomplete — toujours DeepSeek (seul à le supporter)
   */
  async fimComplete(prefix: string, suffix: string = '', options?: { maxTokens?: number; signal?: AbortSignal }) {
    return aiService.fimComplete(prefix, suffix, options);
  }

  /**
   * JSON mode routé — DeepSeek par défaut
   */
  async chatJSON<T = any>(
    messages: APIMessage[],
    options: ChatOptions = {}
  ): Promise<T> {
    return aiService.chatJSON<T>(messages, {
      ...options,
      provider: options.provider || 'deepseek',
    });
  }

  /**
   * Planification de projet — DeepSeek V3 (JSON mode, pas cher)
   */
  async planProject(description: string, options: ChatOptions = {}) {
    return aiService.planProject(description, {
      ...options,
      provider: 'deepseek',
    });
  }

  /**
   * Génération de code fichier — DeepSeek V3
   */
  async generateFileCode(
    filePath: string,
    fileDescription: string,
    projectContext: string,
    existingFiles: { path: string; content: string }[] = [],
    options: ChatOptions = {}
  ) {
    return aiService.generateFileCode(filePath, fileDescription, projectContext, existingFiles, {
      ...options,
      provider: 'deepseek',
    });
  }

  // ========================================================================
  // COST TRACKING
  // ========================================================================

  /**
   * Estime le coût d'un appel API
   */
  estimateCost(
    provider: AIProvider,
    model: AIModel,
    inputTokens: number,
    outputTokens: number
  ): CostEstimate {
    const rates = COST_PER_M_TOKENS[provider][model];
    const costUSD = (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;

    return {
      provider,
      inputTokens,
      outputTokens,
      costUSD,
      costFCFA: Math.round(costUSD * USD_TO_FCFA),
    };
  }

  /**
   * Enregistre l'utilisation d'un appel API
   */
  private trackUsage(
    provider: AIProvider,
    model: AIModel,
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  ): void {
    const stats = this.sessionStats[provider];
    stats.requests++;
    stats.inputTokens += usage.prompt_tokens;
    stats.outputTokens += usage.completion_tokens;

    const rates = COST_PER_M_TOKENS[provider][model];
    stats.costUSD += (usage.prompt_tokens * rates.input + usage.completion_tokens * rates.output) / 1_000_000;
  }

  /**
   * Obtenir les statistiques de la session en cours
   */
  getSessionStats() {
    const total = this.sessionStats.deepseek.requests + this.sessionStats.kimi.requests;
    const deepseekPercent = total > 0 ? Math.round((this.sessionStats.deepseek.requests / total) * 100) : 0;
    const kimiPercent = total > 0 ? 100 - deepseekPercent : 0;

    return {
      ...this.sessionStats,
      totalCostUSD: this.sessionStats.deepseek.costUSD + this.sessionStats.kimi.costUSD,
      totalCostFCFA: Math.round((this.sessionStats.deepseek.costUSD + this.sessionStats.kimi.costUSD) * USD_TO_FCFA),
      deepseekPercent,
      kimiPercent,
      totalRequests: total,
    };
  }

  /**
   * Réinitialiser les stats de session
   */
  resetSessionStats(): void {
    this.sessionStats = {
      deepseek: { requests: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 },
      kimi: { requests: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 },
      fallbacks: 0,
      totalRequests: 0,
    };
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  /** Estimer le nombre de tokens dans les messages (~4 chars/token en moyenne) */
  public estimateTokens(messages: APIMessage[]): number {
    let totalChars = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') {
        totalChars += m.content.length;
      }
      if (m.reasoning_content) {
        totalChars += m.reasoning_content.length;
      }
    }
    return Math.ceil(totalChars / 4);
  }

  /** Extraire le dernier message utilisateur */
  private getLastUserMessage(messages: APIMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].content) {
        return messages[i].content as string;
      }
    }
    return '';
  }

  /** Vérifier si les messages contiennent des images (base64 ou URL) */
  private detectImages(messages: APIMessage[]): boolean {
    for (const m of messages) {
      if (typeof m.content === 'string') continue;
      // OpenAI vision format: content is an array with image_url items
      if (Array.isArray(m.content)) {
        for (const part of m.content as any[]) {
          if (part.type === 'image_url' || part.type === 'image') {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** Vérifier si un message mentionne un fichier image */
  private mentionsImageFile(msg: string): boolean {
    return /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)\b/i.test(msg) ||
           /capture d['']écran/i.test(msg) ||
           /screenshot/i.test(msg);
  }

  /** Vérifier si un texte contient des mots-clés */
  private matchesKeywords(text: string, keywords: string[]): boolean {
    return keywords.some((kw) => text.includes(kw));
  }

  /**
   * Arrêter tous les streams en cours
   */
  stopStream(requestId?: string): void {
    aiService.stopStream(requestId);
  }

  // ========================================================================
  // SMART SYSTEM PROMPT (Cache optimized)
  // ========================================================================

  /**
   * Prépare les messages avec le prompt système optimal pour le cache DeepSeek.
   * Le prompt système est:
   * - Identique entre les requêtes (cache hit garanti après la 1ère)
   * - >1024 tokens (seuil minimum pour le cache DeepSeek)
   * - Placé en premier (préfixe commun)
   *
   * Résultat: -90% sur les coûts d'input après la 1ère requête.
   */
  prepareMessages(
    userMessages: APIMessage[],
    taskType?: PromptContext
  ): APIMessage[] {
    const systemPrompt = getSystemPrompt(taskType || 'chat');

    // Vérifier si un message système existe déjà
    const hasSystem = userMessages.length > 0 && userMessages[0].role === 'system';

    let result: APIMessage[];

    if (hasSystem) {
      // Remplacer par le prompt optimisé pour le cache
      result = [
        { role: 'system', content: systemPrompt },
        ...userMessages.slice(1),
      ];
    } else {
      result = [
        { role: 'system', content: systemPrompt },
        ...userMessages,
      ];
    }

    // Safety check: ensure first message is system message
    if (result.length > 0 && result[0].role !== 'system') {
      console.warn('[AIRouter] Warning: first message is not system message after prepareMessages. Force-injecting.');
      result = [
        { role: 'system', content: systemPrompt },
        ...result,
      ];
    }

    return result;
  }

  // ========================================================================
  // BATCH API (DeepSeek -50% discount)
  // ========================================================================

  /**
   * Soumission batch pour la génération de projet multi-fichiers.
   * DeepSeek Batch API: traitement asynchrone avec -50% sur les coûts.
   *
   * Workflow:
   * 1. prepareBatchRequests() — prépare les requêtes
   * 2. submitBatch() — soumet au endpoint batch
   * 3. pollBatchStatus() — attend le résultat
   * 4. retrieveBatchResults() — récupère les fichiers générés
   */
  prepareBatchRequests(
    files: { path: string; description: string }[],
    projectContext: string
  ): BatchRequest[] {
    return files.map((file, idx) => ({
      custom_id: `file-${idx}-${file.path.replace(/\//g, '_')}`,
      method: 'POST',
      url: '/chat/completions',
      body: {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: getSystemPrompt('code_gen'),
          },
          {
            role: 'user',
            content: `Projet: ${projectContext}\n\nGénère le fichier: ${file.path}\nDescription: ${file.description}\n\nRéponds UNIQUEMENT avec le code source:`,
          },
        ],
        max_tokens: 4096,
      },
    }));
  }

  /**
   * Soumet un batch de requêtes à l'API DeepSeek
   * Retourne l'ID du batch pour le polling
   */
  async submitBatch(requests: BatchRequest[]): Promise<string> {
    // Créer le fichier JSONL
    const jsonlContent = requests.map((r) => JSON.stringify(r)).join('\n');
    const blob = new Blob([jsonlContent], { type: 'application/jsonl' });

    // Upload le fichier
    const formData = new FormData();
    formData.append('file', blob, 'batch_requests.jsonl');
    formData.append('purpose', 'batch');

    const uploadRes = await fetch(
      this.getBackendUrl('/api/deepseek/files'),
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!uploadRes.ok) throw new Error(`Batch upload failed: ${uploadRes.status}`);
    const uploadData = await uploadRes.json();

    // Créer le batch
    const batchRes = await fetch(
      this.getBackendUrl('/api/deepseek/batches'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_file_id: uploadData.id,
          endpoint: '/v1/chat/completions',
          completion_window: '24h',
        }),
      }
    );

    if (!batchRes.ok) throw new Error(`Batch creation failed: ${batchRes.status}`);
    const batchData = await batchRes.json();
    return batchData.id;
  }

  /**
   * Vérifie le statut d'un batch
   */
  async pollBatchStatus(batchId: string): Promise<{
    status: 'validating' | 'in_progress' | 'completed' | 'failed' | 'expired' | 'cancelled';
    completed: number;
    total: number;
    outputFileId?: string;
  }> {
    const res = await fetch(
      this.getBackendUrl(`/api/deepseek/batches/${batchId}`),
      { method: 'GET' }
    );

    if (!res.ok) throw new Error(`Batch status failed: ${res.status}`);
    const data = await res.json();

    return {
      status: data.status,
      completed: data.request_counts?.completed || 0,
      total: data.request_counts?.total || 0,
      outputFileId: data.output_file_id,
    };
  }

  /**
   * Récupère les résultats d'un batch complété
   */
  async retrieveBatchResults(outputFileId: string): Promise<BatchResult[]> {
    const res = await fetch(
      this.getBackendUrl(`/api/deepseek/files/${outputFileId}/content`),
      { method: 'GET' }
    );

    if (!res.ok) throw new Error(`Batch results failed: ${res.status}`);
    const text = await res.text();

    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const data = JSON.parse(line);
        return {
          customId: data.custom_id,
          content: data.response?.body?.choices?.[0]?.message?.content || '',
          usage: data.response?.body?.usage,
          error: data.error,
        };
      });
  }

  private getBackendUrl(path: string): string {
    // Single source of truth: settingsStore
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useSettingsStore } = require('@/stores/settingsStore');
      const BACKEND = useSettingsStore.getState().getBackendUrl();
      return `${BACKEND}${path}`;
    } catch {
      return `http://localhost:8000${path}`;
    }
  }

  // ========================================================================
  // IMAGE OPTIMIZATION (avant envoi à Kimi)
  // ========================================================================

  /**
   * Optimise une image avant envoi à Kimi pour réduire les coûts tokens.
   *
   * Stratégie:
   * - Redimensionner à 1024px max (largeur ou hauteur)
   * - Compresser en JPEG qualité 85%
   * - Estimer les tokens consommés
   *
   * Résultat: ~60-80% de réduction des tokens image
   */
  async optimizeImage(
    imageData: string,  // base64 ou data URL
    options: { maxSize?: number; quality?: number } = {}
  ): Promise<{ optimizedData: string; estimatedTokens: number; savedPercent: number }> {
    const maxSize = options.maxSize || 1024;
    const quality = options.quality || 0.85;

    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        const originalPixels = img.width * img.height;

        // Calculer les nouvelles dimensions
        let newWidth = img.width;
        let newHeight = img.height;

        if (newWidth > maxSize || newHeight > maxSize) {
          const ratio = Math.min(maxSize / newWidth, maxSize / newHeight);
          newWidth = Math.round(newWidth * ratio);
          newHeight = Math.round(newHeight * ratio);
        }

        // Dessiner sur un canvas
        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          // Fallback: retourner l'image originale
          resolve({
            optimizedData: imageData,
            estimatedTokens: Math.ceil(originalPixels / 750),
            savedPercent: 0,
          });
          return;
        }

        ctx.drawImage(img, 0, 0, newWidth, newHeight);

        // Exporter en JPEG compressé
        const optimizedData = canvas.toDataURL('image/jpeg', quality);
        const newPixels = newWidth * newHeight;

        // Estimation tokens: ~1 token pour 750 pixels (règle Kimi/OpenAI)
        const originalTokens = Math.ceil(originalPixels / 750);
        const newTokens = Math.ceil(newPixels / 750);
        const savedPercent = originalTokens > 0
          ? Math.round(((originalTokens - newTokens) / originalTokens) * 100)
          : 0;

        resolve({
          optimizedData,
          estimatedTokens: newTokens,
          savedPercent,
        });
      };

      img.onerror = () => {
        resolve({
          optimizedData: imageData,
          estimatedTokens: 1000, // Estimation par défaut
          savedPercent: 0,
        });
      };

      // Charger l'image
      if (imageData.startsWith('data:')) {
        img.src = imageData;
      } else {
        img.src = `data:image/png;base64,${imageData}`;
      }
    });
  }

  /**
   * Prépare un message vision avec image optimisée
   * Gère le format OpenAI multipart content
   */
  async prepareVisionMessage(
    textContent: string,
    images: string[],  // base64 ou data URLs
    options?: { maxSize?: number; quality?: number }
  ): Promise<APIMessage> {
    const optimizedImages = await Promise.all(
      images.map((img) => this.optimizeImage(img, options))
    );

    const content: any[] = [
      { type: 'text', text: textContent },
      ...optimizedImages.map((img) => ({
        type: 'image_url',
        image_url: { url: img.optimizedData },
      })),
    ];

    const totalSaved = optimizedImages.reduce((sum, img) => sum + img.savedPercent, 0);
    const avgSaved = optimizedImages.length > 0 ? Math.round(totalSaved / optimizedImages.length) : 0;

    // Image optimization stats available in avgSaved if needed for debugging

    return {
      role: 'user',
      content: content as any,
    };
  }

  // ========================================================================
  // FULL PROJECT ANALYSIS (Auto-switch Kimi 262K)
  // ========================================================================

  /**
   * Analyse un projet complet en mode contexte long.
   * Bascule automatiquement sur Kimi K2.6 (262K) si le contexte dépasse 128K.
   * Sinon utilise DeepSeek (moins cher).
   */
  async analyzeFullProject(
    files: { path: string; content: string }[],
    question: string,
    options: ChatOptions = {}
  ): Promise<{ response: any; provider: AIProvider; contextTokens: number }> {
    // Construire le contexte du projet
    const projectContext = files
      .map((f) => `===== ${f.path} =====\n${f.content}`)
      .join('\n\n');

    const totalChars = projectContext.length + question.length;
    const estimatedTokens = Math.ceil(totalChars / 4);

    // Décision de routage basée sur la taille du contexte
    const provider: AIProvider = estimatedTokens > 120000 ? 'kimi' : 'deepseek';
    const mode: AIModel = options.model || 'fast';

    const messages: APIMessage[] = this.prepareMessages([
      {
        role: 'user',
        content: `Voici le code source complet du projet:\n\n${projectContext}\n\n---\n\nQuestion: ${question}`,
      },
    ], 'code_review');

    const response = await aiService.chat(messages, {
      ...options,
      provider,
      model: mode,
    });

    if (response.usage) {
      this.trackUsage(provider, mode, response.usage);
    }

    return {
      response,
      provider,
      contextTokens: estimatedTokens,
    };
  }
}

// ============================================================================
// BATCH TYPES
// ============================================================================

export interface BatchRequest {
  custom_id: string;
  method: string;
  url: string;
  body: Record<string, any>;
}

export interface BatchResult {
  customId: string;
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: any;
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const aiRouter = new AIRouter();
export default AIRouter;
