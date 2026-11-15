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

// ── Réseau lent : délais d'attente allongés ────────────────────────────────
// Dès qu'une requête a dû être réessayée, on double les délais pendant 10 minutes,
// pour ne pas abandonner une réponse qui arrive lentement.
let slowUntil = 0;
export function markSlowNetwork(): void { slowUntil = Date.now() + 10 * 60 * 1000; }
function isSlowNetwork(): boolean {
  if (Date.now() < slowUntil) return true;
  const c = (navigator as any)?.connection;
  return !!c && (['slow-2g', '2g', '3g'].includes(c.effectiveType) || (typeof c.rtt === 'number' && c.rtt > 800));
}


/**
 * Réglages propres au modèle. DeepSeek : réflexion pilotée explicitement (elle est activée
 * par défaut chez eux, effort « high ») ; la température n'a pas d'effet sur deepseek-flash.
 */
function applyModelOptions(body: Record<string, any>, provider: AIProvider, mode: AIModel, options: ChatOptions) {
  const config = AI_PROVIDERS[provider];
  const effort = options.reasoningEffort ?? config.reasoningEffort?.[mode];
  if (provider === 'deepseek') {
    if (effort === 'none') {
      body.thinking = { type: 'disabled' };
    } else {
      body.thinking = { type: 'enabled' };
      body.reasoning_effort = effort || 'high';
    }
    return;
  }
  body.temperature = options.temperature ?? config.defaultTemperature[mode];
}

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

    applyModelOptions(body, provider, mode, options);

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

    // Timeout for non-streaming requests (60s default, 120s for large payloads)
    const contentLen = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
    const chatTimeout = contentLen > 10000 ? 120000 : 60000;

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const timeoutCtrl = new AbortController();
      const timeoutId = setTimeout(() => timeoutCtrl.abort(), chatTimeout);

      // Merge user signal + timeout signal
      const mergedSignal = options.signal
        ? (AbortSignal as any).any
          ? (AbortSignal as any).any([options.signal, timeoutCtrl.signal])
          : timeoutCtrl.signal // fallback: at least timeout works
        : timeoutCtrl.signal;

      try {
        const response = await fetch(this.getEndpoint(provider), {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify(body),
          signal: mergedSignal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const status = response.status;
          const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
          const msg = error.error?.message || `Erreur du service IA (${status})`;

          if (
            attempt < maxAttempts - 1 &&
            this.shouldRetryStatus(status) &&
            !options.signal?.aborted &&
            this.isOnline()
          ) {
            await this.sleep(status === 429 ? 2000 : 800);
            continue;
          }
          throw new Error(msg);
        }

        return response.json();
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (
          attempt < maxAttempts - 1 &&
          !options.signal?.aborted &&
          this.isOnline() &&
          (this.isTransientFetchError(err) || /abort/i.test(String(err?.message || '')))
        ) {
          await this.sleep(1000 * (attempt + 1)); // Backoff: 1s, 2s
          continue;
        }
        if (!this.isOnline()) {
          throw new Error('Pas de connexion internet. Vérifie ton réseau.');
        }
        if (/abort/i.test(String(err?.message || '')) && !options.signal?.aborted) {
          throw new Error('Le serveur met trop de temps à répondre. Réessaie.');
        }
        throw err;
      }
    }
    throw new Error('Impossible de joindre le serveur apres plusieurs tentatives.');
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

    // B1 : le signal de l'appelant (bouton Stop / abort d'agent) doit couper
    // le fetch réel — sinon le stream continue en arrière-plan ET est facturé.
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort);
    if (options.signal?.aborted) controller.abort();

    const body: Record<string, any> = {
      model: modelId,
      messages,
      stream: true,
    };

    applyModelOptions(body, provider, mode, options);

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
    const slowFactor = isSlowNetwork() ? 2 : 1;
    const fetchTimeout = (totalContentLength > 10000 ? 90000 : 45000) * slowFactor; // 45 s (90 s si gros envoi), doublé en réseau lent
    const fetchTimeoutController = new AbortController();
    const fetchTimeoutId = setTimeout(() => fetchTimeoutController.abort(), fetchTimeout);

    // Retry only if nothing has been yielded yet (avoid duplicate content)
    let yielded = false;
    const maxAttempts = 3;
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
              reject(new Error(`Timeout d'initialisation du streaming (${fetchTimeout / 1000}s)`));
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
        const CHUNK_TIMEOUT = 45000 * slowFactor; // 45 s entre deux morceaux, 90 s en réseau lent

        while (true) {
        // Set up chunk timeout
        const chunkTimeoutController = new AbortController();
        const chunkTimeoutId = setTimeout(() => chunkTimeoutController.abort(), CHUNK_TIMEOUT);

        try {
          // Race between read and timeout
          const readPromise = reader.read();
          const timeoutPromise = new Promise<never>((_, reject) =>
            chunkTimeoutController.signal.addEventListener('abort', () => {
              reject(new Error(`Aucune donnée reçue pendant ${CHUNK_TIMEOUT / 1000} s`));
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

            // B2 : on sépare le parse (chunk malformé → skip) de l'erreur SSE
            // (crédit insuffisant, 401… → doit remonter à l'appelant).
            let json: any;
            try {
              json = JSON.parse(trimmed.slice(6));
            } catch {
              continue; // chunk malformé — on l'ignore
            }

            // Coût exact de cet appel, calculé et débité par le serveur (B6)
            if (json.anzar && typeof json.anzar.cost_fcfa === 'number') {
              yield { serverCostFCFA: json.anzar.cost_fcfa };
              continue;
            }

            if (json.error) {
              // Erreur réelle du serveur, au milieu du stream : NE PAS l'avaler.
              throw new StreamAPIError(json.error.message || 'Erreur API dans le stream');
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
          !(err instanceof StreamAPIError) && // erreur métier (crédit, 401…) : pas de retry
          this.isOnline() &&
          !controller.signal.aborted &&
          (this.isTransientFetchError(err) || /timeout|abort/i.test(String(err?.message || '')))
        ) {
          await this.sleep(1000 * (attempt + 1)); // Backoff: 1s, 2s
          continue;
        }
        if (!this.isOnline()) {
          throw new Error('Pas de connexion internet. Vérifie ton réseau.');
        }
        throw err;
      } finally {
        clearTimeout(fetchTimeoutId);
        options.signal?.removeEventListener('abort', onExternalAbort);
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

  // ========================================================================
  // JSON OUTPUT MODE
  // ========================================================================

  // ========================================================================
  // TOOL CALLING HELPERS
  // ========================================================================

  // ========================================================================
  // SMART CHAT (backend-side web search via Serper)
  // ========================================================================

  // ========================================================================
  // PROJECT GENERATION (high-level)
  // ========================================================================

}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

/** Erreur SSE renvoyée par le serveur EN COURS de stream (ex: crédit insuffisant).
 *  Doit traverser le parseur sans être confondue avec un chunk malformé. */
class StreamAPIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamAPIError';
  }
}

export const aiService = new AIService();

export default AIService;
