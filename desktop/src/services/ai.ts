/**
 * AIService - Service IA multi-provider ANZAR (SECURE — proxy only)
 *
 * SÉCURITÉ: Toutes les requêtes IA passent par le backend proxy.
 * Les clés API ne sont JAMAIS stockées ni envoyées côté client.
 * Le backend gère l'authentification, le rate limiting et le routage.
 *
 * Fonctionnalités:
 * - Chat completions avec streaming SSE
 * - Thinking mode (raisonnement) pour les modèles compatibles
 * - Tool calling / Function calling
 * - JSON output mode
 * - FIM (Fill-In-the-Middle) pour les modèles compatibles
 * - Contexte ultra-long (262K) pour le provider vision
 */

import {
  AIProvider, AIModel, AIProviderConfig, AI_PROVIDERS,
  APIMessage, ChatOptions, ChatResponse, StreamDelta,
  ToolDefinition, ToolCall,
} from '@/types';
import { useSettingsStore } from '@/stores/settingsStore';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Get settings store state (direct import — no lazy-load needed) */
function getSettingsStore() {
  return useSettingsStore.getState();
}

/** Get the backend proxy URL (single source of truth) */
function getBackendUrl(): string {
  return getSettingsStore().getBackendUrl() || 'https://anzar-desktop-production.up.railway.app';
}

// ============================================================================
// AI SERVICE CLASS
// ============================================================================

class AIService {
  private abortControllers = new Map<string, AbortController>();

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private isOnline(): boolean {
    return globalThis.navigator?.onLine ?? true;
  }

  private shouldRetryStatus(status: number): boolean {
    // Transient server errors + rate limit
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
  }

  private isTransientFetchError(err: any): boolean {
    const msg = String(err?.message || err || '');
    return (
      err?.name === 'TypeError' || // fetch() network error
      /failed to fetch/i.test(msg) ||
      /networkerror/i.test(msg) ||
      /timeout/i.test(msg) ||
      /load failed/i.test(msg)
    );
  }

  // ========================================================================
  // CONFIGURATION — Proxy mode only (secure)
  // ========================================================================

  /** Get the provider config */
  getProviderConfig(provider: AIProvider): AIProviderConfig {
    return AI_PROVIDERS[provider];
  }

  /** Resolve the actual model ID from user-facing mode */
  resolveModel(provider: AIProvider, mode: AIModel): string {
    return AI_PROVIDERS[provider].models[mode];
  }

  /** Get the API endpoint URL — always through backend proxy */
  private getEndpoint(provider: AIProvider, path: string = '/chat/completions'): string {
    return `${getBackendUrl()}/api/${provider}${path}`;
  }

  /** Get request headers — auth token for backend, never raw API keys */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add user auth token if available (JWT from login)
    const token = getSettingsStore().getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  // ========================================================================
  // CHAT COMPLETIONS
  // ========================================================================

  /**
   * Send a chat completion request (non-streaming)
   */
  async chat(
    messages: APIMessage[],
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    const provider = options.provider || 'deepseek';
    const mode = options.model || 'fast';
    const modelId = this.resolveModel(provider, mode);
    const config = AI_PROVIDERS[provider];

    const body: Record<string, any> = {
      model: modelId,
      messages,
      stream: false,
    };

    // Temperature (non supportée par certains modèles de raisonnement)
    if (!(provider === 'deepseek' && mode === 'thinking')) {
      body.temperature = options.temperature ?? config.defaultTemperature[mode];
    }

    // Max tokens
    if (options.maxTokens) {
      body.max_completion_tokens = options.maxTokens;
    }

    // Tools / Function calling
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    // JSON mode
    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(this.getEndpoint(provider), {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify(body),
          signal: options.signal,
        });

        if (!response.ok) {
          const status = response.status;
          const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
          const msg = error.error?.message || `Erreur du service IA (${status})`;

          // Retry only for transient statuses and only if user is online
          if (
            attempt < maxAttempts - 1 &&
            this.shouldRetryStatus(status) &&
            !options.signal?.aborted &&
            this.isOnline()
          ) {
            await this.sleep(status === 429 ? 1200 : 600);
            continue;
          }
          throw new Error(msg);
        }

        return response.json();
      } catch (err: any) {
        if (
          attempt < maxAttempts - 1 &&
          !options.signal?.aborted &&
          this.isOnline() &&
          this.isTransientFetchError(err)
        ) {
          await this.sleep(700);
          continue;
        }
        if (!this.isOnline()) {
          throw new Error('Hors ligne — vérifie ta connexion internet.');
        }
        throw err;
      }
    }
    // Should never reach
    throw new Error('Erreur réseau');
  }

  /**
   * Send a chat completion with streaming (SSE)
   * Returns an async generator of deltas with network resilience
   *
   * Features:
   * - 45s timeout on initial fetch (90s for large payloads with attachments)
   * - 45s chunk-level timeout (if no data for 45s, throw)
   * - Mid-stream error parsing and proper error handling
   * - Partial content preservation on error
   */
  async *chatStream(
    messages: APIMessage[],
    options: ChatOptions = {}
  ): AsyncGenerator<StreamDelta, void, undefined> {
    const provider = options.provider || 'deepseek';
    const mode = options.model || 'fast';
    const modelId = this.resolveModel(provider, mode);
    const config = AI_PROVIDERS[provider];
    const requestId = `stream-${Date.now()}`;

    const controller = new AbortController();
    this.abortControllers.set(requestId, controller);

    const body: Record<string, any> = {
      model: modelId,
      messages,
      stream: true,
    };

    // Temperature
    if (!(provider === 'deepseek' && mode === 'thinking')) {
      body.temperature = options.temperature ?? config.defaultTemperature[mode];
    }

    if (options.maxTokens) {
      body.max_completion_tokens = options.maxTokens;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

    // Provider vision: include usage in stream
    if (provider === 'kimi') {
      body.stream_options = { include_usage: true };
    }

    // Set up fetch timeout controller
    // Use a longer timeout when messages contain attachments/large content
    const totalContentLength = messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
    const fetchTimeout = totalContentLength > 10000 ? 90000 : 45000; // 90s for large payloads, 45s otherwise
    const fetchTimeoutController = new AbortController();
    const fetchTimeoutId = setTimeout(() => fetchTimeoutController.abort(), fetchTimeout);

    // Retry only if nothing has been yielded yet (avoid duplicate content)
    let yielded = false;
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await Promise.race([
          fetch(this.getEndpoint(provider), {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify(body),
            signal: controller.signal,
          }),
          new Promise<Response>((_, reject) =>
            fetchTimeoutController.signal.addEventListener('abort', () => {
              reject(new Error('Timeout d\'initialisation du streaming (30s)'));
            })
          ),
        ]);

        clearTimeout(fetchTimeoutId);

        if (!response.ok) {
          const status = response.status;
          const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
          const msg = error.error?.message || `Erreur du service IA (${status})`;
          if (
            attempt < maxAttempts - 1 &&
            this.shouldRetryStatus(status) &&
            this.isOnline() &&
            !controller.signal.aborted &&
            !yielded
          ) {
            await this.sleep(status === 429 ? 1200 : 700);
            continue;
          }
          throw new Error(msg);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Streaming non supporté');

        const decoder = new TextDecoder();
        let buffer = '';
        let lastChunkTime = Date.now();
        const CHUNK_TIMEOUT = 45000; // 45s chunk-level timeout

        while (true) {
        // Set up chunk timeout
        const chunkTimeoutController = new AbortController();
        const chunkTimeoutId = setTimeout(() => chunkTimeoutController.abort(), CHUNK_TIMEOUT);

        try {
          // Race between read and timeout
          const readPromise = reader.read();
          const timeoutPromise = new Promise<never>((_, reject) =>
            chunkTimeoutController.signal.addEventListener('abort', () => {
              reject(new Error('Timeout lors de la réception de données (45s)'));
            })
          );

          const { done, value } = await Promise.race([readPromise, timeoutPromise]);
          clearTimeout(chunkTimeoutId);

          if (done) break;

          lastChunkTime = Date.now();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const json = JSON.parse(trimmed.slice(6));

              // Check for mid-stream errors (API error in SSE payload)
              if (json.error) {
                throw new Error(json.error.message || 'Erreur API dans le stream');
              }

              const delta = json.choices?.[0]?.delta;
              if (delta) {
                yielded = true;
                yield {
                  content: delta.content || undefined,
                  reasoning_content: delta.reasoning_content || undefined,
                  tool_calls: delta.tool_calls || undefined,
                  finish_reason: json.choices[0].finish_reason || undefined,
                };
              }
            } catch (parseError: any) {
              // Only throw if it's a mid-stream API error, skip malformed JSON chunks
              if (parseError.message?.includes('Erreur API')) {
                throw parseError;
              }
              // Otherwise silently skip malformed chunks
            }
          }
        } catch (timeoutError: any) {
          clearTimeout(chunkTimeoutId);
          if (timeoutError.message?.includes('Timeout')) {
            throw timeoutError;
          }
          throw timeoutError;
        }
        }
        // Completed successfully
        break;
      } catch (err: any) {
        clearTimeout(fetchTimeoutId);
        if (
          attempt < maxAttempts - 1 &&
          !yielded &&
          this.isOnline() &&
          !controller.signal.aborted &&
          (this.isTransientFetchError(err) || /timeout/i.test(String(err?.message || '')))
        ) {
          await this.sleep(800);
          continue;
        }
        if (!this.isOnline()) {
          throw new Error('Hors ligne — vérifie ta connexion internet.');
        }
        throw err;
      } finally {
        clearTimeout(fetchTimeoutId);
        this.abortControllers.delete(requestId);
      }
    }
  }

  /**
   * Stop an ongoing stream
   */
  stopStream(requestId?: string): void {
    if (requestId && this.abortControllers.has(requestId)) {
      this.abortControllers.get(requestId)!.abort();
      this.abortControllers.delete(requestId);
    } else {
      // Stop all streams
      this.abortControllers.forEach((controller) => controller.abort());
      this.abortControllers.clear();
    }
  }

  // ========================================================================
  // FIM (Fill-In-the-Middle) — modèles compatibles uniquement
  // ========================================================================

  /**
   * FIM completion for code autocomplete (beta)
   */
  async fimComplete(
    prefix: string,
    suffix: string = '',
    options: { maxTokens?: number; signal?: AbortSignal } = {}
  ): Promise<string> {
    const response = await fetch(`${getBackendUrl()}/api/deepseek/beta/completions`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        model: 'deepseek-chat',
        prompt: prefix,
        suffix,
        max_tokens: options.maxTokens || 512,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`FIM Error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.text || '';
  }

  // ========================================================================
  // JSON OUTPUT MODE
  // ========================================================================

  /**
   * Chat with structured JSON output
   */
  async chatJSON<T = any>(
    messages: APIMessage[],
    options: ChatOptions = {}
  ): Promise<T> {
    // Add json instruction to system message if not present
    const hasJsonInstruction = messages.some(
      (m) => m.role === 'system' && m.content?.toLowerCase().includes('json')
    );

    const enhancedMessages = hasJsonInstruction
      ? messages
      : [
          {
            role: 'system' as const,
            content: 'Tu dois répondre uniquement en format JSON valide. ' +
              (messages.find((m) => m.role === 'system')?.content || ''),
          },
          ...messages.filter((m) => m.role !== 'system'),
        ];

    const response = await this.chat(enhancedMessages, {
      ...options,
      responseFormat: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Réponse vide');

    return JSON.parse(content);
  }

  // ========================================================================
  // TOOL CALLING HELPERS
  // ========================================================================

  /**
   * Chat with tools and automatically handle tool call responses
   */
  async chatWithTools(
    messages: APIMessage[],
    tools: ToolDefinition[],
    toolExecutor: (name: string, args: Record<string, any>) => Promise<string>,
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    let currentMessages = [...messages];
    let maxIterations = 10; // Prevent infinite loops

    while (maxIterations-- > 0) {
      const response = await this.chat(currentMessages, {
        ...options,
        tools,
      });

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls;

      // No tool calls — return final response
      if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === 'stop') {
        return response;
      }

      // Add assistant message with tool calls
      currentMessages.push({
        role: 'assistant',
        content: choice.message.content || '',
        tool_calls: toolCalls,
      });

      // Execute each tool call and add results
      for (const toolCall of toolCalls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await toolExecutor(toolCall.function.name, args);

          currentMessages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        } catch (error: any) {
          currentMessages.push({
            role: 'tool',
            content: JSON.stringify({ error: error.message }),
            tool_call_id: toolCall.id,
          });
        }
      }
    }

    throw new Error('Trop d\'itérations de tool calling');
  }

  // ========================================================================
  // SMART CHAT (backend-side web search via Serper)
  // ========================================================================

  /**
   * Send a chat request to /api/chat/smart — the backend handles web search
   * automatically via Serper API + DeepSeek tool calling.
   *
   * Returns the same ChatResponse shape as chat().
   */
  async smartChat(
    messages: APIMessage[],
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      signal?: AbortSignal;
    } = {}
  ): Promise<ChatResponse> {
    const body: Record<string, any> = {
      messages,
      model: options.model || this.resolveModel('deepseek', 'fast'),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4096,
    };

    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`${getBackendUrl()}/api/chat/smart`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify(body),
          signal: options.signal,
        });

        if (!response.ok) {
          const status = response.status;
          const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
          const msg = error.detail || error.error?.message || `Erreur du service IA (${status})`;

          if (
            attempt < maxAttempts - 1 &&
            this.shouldRetryStatus(status) &&
            !options.signal?.aborted &&
            this.isOnline()
          ) {
            await this.sleep(status === 429 ? 1200 : 600);
            continue;
          }
          throw new Error(msg);
        }

        return response.json();
      } catch (err: any) {
        if (
          attempt < maxAttempts - 1 &&
          !options.signal?.aborted &&
          this.isOnline() &&
          this.isTransientFetchError(err)
        ) {
          await this.sleep(700);
          continue;
        }
        if (!this.isOnline()) {
          throw new Error('Hors ligne — vérifie ta connexion internet.');
        }
        throw err;
      }
    }
    throw new Error('Erreur réseau');
  }

  // ========================================================================
  // PROJECT GENERATION (high-level)
  // ========================================================================

  /**
   * Generate a project plan from description
   */
  async planProject(
    description: string,
    options: ChatOptions = {}
  ): Promise<any> {
    return this.chatJSON(
      [
        {
          role: 'system',
          content: `Tu es un architecte logiciel expert. Analyse la description du projet et génère un plan structuré en JSON avec ce format:
{
  "title": "Nom du projet",
  "overview": "Description technique",
  "files": [{"path": "chemin/fichier.ext", "description": "Rôle du fichier", "type": "component|service|config|style|test"}],
  "phases": [{"name": "Phase", "description": "Détail", "duration": "estimation", "tasks": ["tâche1", "tâche2"]}],
  "complexity": "low|medium|high",
  "techStack": ["React", "TypeScript", ...],
  "notes": "Remarques"
}
Sois précis sur les fichiers à créer. Chaque fichier doit avoir un chemin réaliste.`,
        },
        {
          role: 'user',
          content: description,
        },
      ],
      options
    );
  }

  /**
   * Generate a single file's code based on plan context
   */
  async generateFileCode(
    filePath: string,
    fileDescription: string,
    projectContext: string,
    existingFiles: { path: string; content: string }[] = [],
    options: ChatOptions = {}
  ): Promise<string> {
    const contextStr = existingFiles
      .slice(0, 5)
      .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 1500)}`)
      .join('\n\n');

    const response = await this.chat(
      [
        {
          role: 'system',
          content: `Tu es un développeur expert. Génère UNIQUEMENT le code du fichier demandé. Pas d'explication, pas de markdown, juste le code source complet et fonctionnel.`,
        },
        {
          role: 'user',
          content: `Projet: ${projectContext}\n\nFichiers existants:\n${contextStr}\n\nGénère le fichier: ${filePath}\nDescription: ${fileDescription}\n\nRéponds UNIQUEMENT avec le code source:`,
        },
      ],
      options
    );

    return response.choices[0]?.message?.content || '';
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const aiService = new AIService();

/** Legacy alias for backward compatibility */
export const deepseekService = aiService;

export default AIService;
