/**
 * useChat Hook
 * Custom React hook for managing chat interactions
 * Combines chatStore + AI service for full conversation management
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import { useShallow } from 'zustand/react/shallow';
import { aiRouter } from '@/services/router';
import { useSettingsStore } from '@/stores/settingsStore';
import { useOffline } from '@/hooks/useOffline';
import { Message, APIMessage, AIModel } from '@/types';
import { generateId } from '@/lib/utils';
import { authService } from '@/services/infra/auth';

/**
 * Return type for useChat hook
 */
export interface UseChatReturn {
  /** Send a user message and get AI response */
  sendMessage: (content: string) => Promise<void>;

  /** Stop the current generation */
  stopGeneration: () => void;

  /** Get active conversation */
  activeConversation: ReturnType<typeof useActiveConversation>;

  /** Whether generation is in progress */
  isGenerating: boolean;

  /** Current streaming content */
  streamingContent: string;

  /** Current error if any */
  error: string | null;

  /** Clear current error */
  clearError: () => void;

  /** Whether device is online */
  isOnline: boolean;

  /** Queued messages waiting to be sent (when offline) */
  queuedMessages: string[];

  /** Estimated token count for the active conversation */
  tokenCount: number;
}

/**
 * useChat Hook
 * Manages the full chat flow from user input to AI response
 *
 * @example
 * ```typescript
 * const { sendMessage, isGenerating, streamingContent } = useChat();
 *
 * const handleSend = async (message: string) => {
 *   await sendMessage(message);
 * };
 * ```
 */
export function useChat(): UseChatReturn {
  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);

  // Store hooks — use selectors to avoid subscribing to entire store
  const {
    addMessage,
    updateStreamingContent,
    appendStreamingContent,
    finalizeStreamingMessage,
    setIsGenerating,
  } = useChatStore(useShallow((s) => ({
    addMessage: s.addMessage,
    updateStreamingContent: s.updateStreamingContent,
    appendStreamingContent: s.appendStreamingContent,
    finalizeStreamingMessage: s.finalizeStreamingMessage,
    setIsGenerating: s.setIsGenerating,
  })));

  const getSetting = useSettingsStore((s) => s.getSetting);

  // Network status
  const { isOnline } = useOffline();

  // Get state from store
  const isGenerating = useChatStore((state) => state.isGenerating);
  const streamingContent = useChatStore((state) => state.streamingContent);
  const activeConversation = useActiveConversation();
  const tokenCount = useChatStore((state) => state.estimateConversationTokens().totalTokens);

  // Ref to avoid stale closure — activeConversation changes mid-request
  const activeConversationRef = useRef(activeConversation);
  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  // Local state
  const [error, setError] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);

  const model = getSetting('model') as AIModel;

  // Cleanup timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Auto-send queued messages when coming back online
  useEffect(() => {
    if (isOnline && queuedMessages.length > 0) {
      const queue = [...queuedMessages];
      setQueuedMessages([]);
      // Send messages sequentially
      const sendQueued = async () => {
        for (const msg of queue) {
          await sendMessage(msg);
        }
      };
      sendQueued();
    }
  }, [isOnline]);

  /**
   * Clear error message
   */
  const clearError = useCallback(() => {
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }
    setError(null);
  }, []);

  /**
   * Set error with auto-clear
   */
  const setErrorWithClear = useCallback(
    (message: string, duration = 5000) => {
      setError(message);
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
      errorTimeoutRef.current = setTimeout(() => {
        setError(null);
      }, duration);
    },
    []
  );

  /**
   * Stop generation
   */
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  }, [setIsGenerating]);

  /**
   * Retry with exponential backoff (1s → 2s → 4s)
   */
  const shouldRetry = (error: any, status?: number): boolean => {
    // 401: auth error — don't retry
    if (status === 401 || error.message?.includes('401')) return false;
    // 429: rate limit — don't retry (show message and wait)
    if (status === 429 || error.message?.includes('429')) return false;
    // Network errors or 5xx — retry
    if (error.message?.includes('Network') || error.message?.includes('Timeout')) return true;
    if (status && status >= 500) return true;
    return false;
  };

  const getRetryDelay = (attempt: number): number => {
    return Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
  };

  /**
   * Send a message to the AI and stream the response with retry logic
   */
  const sendMessage = useCallback(
    async (content: string) => {
      // Validation
      if (!content.trim()) {
        setErrorWithClear('Veuillez entrer un message');
        return;
      }

      // Check if offline
      if (!isOnline) {
        setQueuedMessages((prev) => [...prev, content]);
        setErrorWithClear('Vous êtes hors ligne. Le message sera envoyé quand la connexion reviendra.');
        return;
      }

      // Snapshot conversation via ref to avoid stale closure
      const conversation = activeConversationRef.current;
      if (!conversation) {
        setErrorWithClear('Aucune conversation active');
        return;
      }

      try {
        // Add user message
        const userMessage: Message = {
          id: generateId(),
          role: 'user',
          content,
          timestamp: Date.now(),
        };

        addMessage(userMessage);

        // Vérification solde prépayé — blocage dur si solde = 0
        const { useAccountStore } = await import('@/stores/accountStore');
        const accountState = useAccountStore.getState();
        if (!accountState.hasCredit()) {
          setErrorWithClear('Votre solde est épuisé. Rechargez pour continuer à utiliser ANZAR.', 10000);
          return;
        }

        // ── Auto-compaction du contexte ──
        // Seuil: 30K tokens (~120K chars). Au-delà, on résume les vieux messages
        // pour économiser les tokens et rester dans un budget raisonnable.
        // DeepSeek V4 supporte 1M tokens en entrée, mais envoyer 200K tokens
        // à chaque message coûte cher et ralentit la réponse.
        const COMPACT_THRESHOLD_TOKENS = 30000;
        const MIN_MESSAGES_TO_COMPACT = 10;

        const allMessages = conversation.messages;
        const estimatedTokens = Math.ceil(
          allMessages.reduce((sum, m) => sum + m.content.length, 0) / 4
        );

        if (estimatedTokens > COMPACT_THRESHOLD_TOKENS && allMessages.length > MIN_MESSAGES_TO_COMPACT) {
          try {
            // Garder les 6 derniers messages intacts, résumer le reste
            const keepLast = 6;
            const messagesToSummarize = allMessages.slice(
              allMessages[0]?.role === 'system' ? 1 : 0,
              -keepLast
            );

            if (messagesToSummarize.length > 2) {
              const { aiService } = await import('@/services');
              const summaryPrompt: APIMessage[] = [
                {
                  role: 'system',
                  content: `Tu es un assistant de résumé. Résume la conversation suivante en un résumé structuré et concis (max 800 tokens).
Garde:
- Le sujet principal et l'objectif de l'utilisateur
- Les décisions clés prises
- Le contexte technique important (noms de fichiers, technologies, erreurs résolues)
- Les instructions ou préférences exprimées par l'utilisateur
Ignore: les formules de politesse, les répétitions, les détails mineurs.
Réponds UNIQUEMENT avec le résumé, sans introduction.`,
                },
                {
                  role: 'user',
                  content: messagesToSummarize
                    .map((m) => `[${m.role}]: ${m.content.slice(0, 2000)}`)
                    .join('\n\n'),
                },
              ];

              const summaryResponse = await aiService.chat(summaryPrompt, {
                provider: 'deepseek',
                model: 'fast',
              });
              const summary = summaryResponse.choices?.[0]?.message?.content || '';

              if (summary && summary.length > 50) {
                const { compactConversation } = useChatStore.getState();
                compactConversation(summary);
                console.info(
                  `[useChat] Compaction: ${allMessages.length} msgs (${estimatedTokens} tokens) → ${keepLast + 2} msgs`
                );
              }
            }
          } catch (err) {
            // Fallback: trim brutalement les anciens messages
            const { trimOldMessages } = useChatStore.getState();
            trimOldMessages(20);
            console.warn('[useChat] Auto-compact failed, falling back to trim:', err);
          }
        }

        // Prepare messages for API — APRÈS compaction pour utiliser l'historique à jour
        const currentConv = useChatStore.getState().getActiveConversation();
        const apiMessages: APIMessage[] = (currentConv?.messages || conversation.messages).map(
          (msg) => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content,
          })
        );
        // Ajouter le message courant s'il n'est pas déjà dans la conversation
        if (!apiMessages.some((m) => m.role === 'user' && m.content === content)) {
          apiMessages.push({ role: 'user', content });
        }

        // Start generation
        setIsGenerating(true);
        updateStreamingContent('');
        retryCountRef.current = 0;

        // Create abort controller
        abortControllerRef.current = new AbortController();

        let lastError: Error | null = null;
        let hasPartialContent = false;

        // Retry loop (up to 3 attempts)
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            // Stream response via intelligent router
            for await (const delta of aiRouter.chatStream(apiMessages, {
              model,
              enableFallback: true,
              signal: abortControllerRef.current.signal,
            })) {
              if (delta.content) {
                appendStreamingContent(delta.content);
              }
            }

            // Success — finalize
            finalizeStreamingMessage();
            clearError();
            return;
          } catch (err: any) {
            lastError = err;

            // Extract status code if available
            let status: number | undefined;
            if (err.message?.includes('API') && err.message?.match(/\d{3}/)) {
              status = parseInt(err.message.match(/\d{3}/)[0]);
            }

            // Handle 401: Unauthorized
            if (status === 401 || err.message?.includes('401') || err.message?.includes('Unauthorized')) {
              authService.logout();
              // Dispatch a custom event for navigation
              window.dispatchEvent(
                new CustomEvent('auth-error', { detail: { message: 'Session expirée. Veuillez vous reconnecter.' } })
              );
              setErrorWithClear('Session expirée. Veuillez vous reconnecter.');
              setIsGenerating(false);
              return;
            }

            // Handle 429: Rate limit
            if (status === 429 || err.message?.includes('429') || err.message?.includes('rate')) {
              setErrorWithClear('Trop de requêtes. Veuillez patienter quelques minutes.');
              setIsGenerating(false);
              return;
            }

            // Check if should retry
            if (!shouldRetry(err, status) || attempt === 3) {
              break;
            }

            // Wait before retry
            const delay = getRetryDelay(attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        // All retries failed — save partial content if available
        // Use getState() to avoid stale closure on streamingContent
        const currentContent = useChatStore.getState().streamingContent;
        if (currentContent.trim()) {
          hasPartialContent = true;
          appendStreamingContent(' [Réponse interrompue]');
        }

        finalizeStreamingMessage();

        // Show error
        if (lastError) {
          if (lastError.message?.includes('Network')) {
            setErrorWithClear('Erreur réseau après 3 tentatives. Vérifiez votre connexion.');
          } else if (lastError.message?.includes('Timeout')) {
            setErrorWithClear('La réponse a pris trop de temps. Veuillez réessayer.');
          } else {
            setErrorWithClear(`Erreur: ${lastError.message}`, 7000);
          }
        }
      } catch (err) {
        // Handle unexpected errors (AbortError, etc.)
        if (err instanceof Error && err.name === 'AbortError') {
          setErrorWithClear('Génération annulée');
        } else if (err instanceof Error) {
          setErrorWithClear(`Erreur: ${err.message}`, 7000);
        } else {
          setErrorWithClear('Erreur inconnue lors de la génération');
        }

        // Reset state
        setIsGenerating(false);
      } finally {
        abortControllerRef.current = null;
      }
    },
    [
      addMessage,
      appendStreamingContent,
      finalizeStreamingMessage,
      setIsGenerating,
      updateStreamingContent,
      model,
      setErrorWithClear,
      clearError,
      isOnline,
    ]
  );

  return {
    sendMessage,
    stopGeneration,
    activeConversation,
    isGenerating,
    streamingContent,
    error,
    clearError,
    isOnline,
    queuedMessages,
    tokenCount,
  };
}

/**
 * Hook for managing chat input state
 */
export function useChatInput(onSend?: (message: string) => Promise<void> | void) {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    if (!message.trim()) return;
    await onSend?.(message.trim());
    setMessage('');
  }, [message, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const clear = useCallback(() => {
    setMessage('');
  }, []);

  return {
    // State
    message,
    isFocused,

    // Refs
    textareaRef,

    // Handlers
    setMessage,
    setIsFocused,
    handleSend,
    handleKeyDown,
    clear,

    // Computed
    isEmpty: message.trim().length === 0,
    hasMessage: message.trim().length > 0,
    tokenCount: Math.ceil(message.length / 4),
  };
}

/**
 * Hook for managing message actions (copy, edit, delete)
 */
export function useMessageActions() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);

  const copyMessage = useCallback((messageId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(messageId);

    const timeout = setTimeout(() => {
      setCopiedId(null);
    }, 2000);

    return () => clearTimeout(timeout);
  }, []);

  const editMessage = useCallback(
    (messageId: string, newContent: string) => {
      updateMessage(messageId, { content: newContent });
    },
    [updateMessage]
  );

  const removeMessage = useCallback(
    (messageId: string) => {
      deleteMessage(messageId);
    },
    [deleteMessage]
  );

  return {
    copiedId,
    copyMessage,
    editMessage,
    removeMessage,
  };
}
