/**
 * Chat Store - Zustand store for managing conversations and messages
 * Handles conversation lifecycle, message persistence, and streaming state
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { Conversation, Message, AIModel } from '@/types';
import { generateId } from '@/lib/utils';

function buildAttachmentsContext(attachments: Message['attachments']): string {
  if (!attachments || attachments.length === 0) return '';
  // Cap hard to avoid exploding context
  const MAX_TOTAL_CHARS = 8000;
  let used = 0;
  const lines: string[] = [];
  lines.push('\n\n[Pièces jointes — références]');

  for (const a of attachments) {
    const ref = a.ref || a.name;
    const header = `\n[${ref}] ${a.name} (${a.kind}${typeof a.sizeBytes === 'number' ? `, ${Math.round(a.sizeBytes / 1024)}KB` : ''})`;
    const excerpt = (a.excerpt || '').trim();
    const metaStr = a.meta ? `\nInfos: ${JSON.stringify(a.meta)}` : '';
    const block = `${header}${metaStr}${excerpt ? `\nExtrait:\n${excerpt}` : ''}\n`;
    if (used + block.length > MAX_TOTAL_CHARS) {
      lines.push('\n[... autres pièces jointes tronquées ...]');
      break;
    }
    used += block.length;
    lines.push(block);
  }
  lines.push('\n[Fin pièces jointes]');
  return lines.join('');
}

/**
 * Chat store state and actions
 */
interface ChatStore {
  // State
  conversations: Conversation[];
  activeConversationId: string | null;
  isGenerating: boolean;
  streamingContent: string;
  streamingMessageId: string | null;
  /** Buffer non flushé (throttle) pour limiter les re-renders */
  streamingBuffer: string;
  /** Timestamp du dernier flush */
  lastStreamFlushAt: number;
  /** Timer de flush (non persisté) */
  streamFlushTimerId: ReturnType<typeof setTimeout> | null;

  /** Retry réseau (session): relancer une requête échouée quand on revient online */
  pendingRetry: null | {
    userMessageId: string;
    content: string;
    hasImages: boolean;
    model: AIModel;
    attempts: number;
    lastError?: string;
  };

  // Selectors
  getActiveConversation: () => Conversation | null;
  getSortedConversations: () => Conversation[];
  estimateConversationTokens: () => { totalTokens: number; messageCount: number };
  getMessagesForAPI: (maxTokens?: number) => Message[];

  // Actions
  /** Create a new conversation */
  createConversation: (title?: string, model?: 'fast' | 'thinking') => Conversation;

  /** Delete a conversation */
  deleteConversation: (id: string) => void;

  /** Set the active conversation */
  setActiveConversation: (id: string | null) => void;

  /** Add a message to the active conversation */
  addMessage: (message: Message) => void;

  /** Update a message in the active conversation */
  updateMessage: (id: string, updates: Partial<Message>) => void;

  /** Delete a message from the active conversation */
  deleteMessage: (id: string) => void;

  /** Update streaming content in real-time */
  updateStreamingContent: (content: string) => void;

  /** Append to streaming content (for token-by-token updates) */
  appendStreamingContent: (token: string) => void;

  /** Start a streaming message (bind streamingContent to an existing message id) */
  startStreamingMessage: (messageId: string) => void;

  /** Flush buffer vers le message (throttled streaming) */
  flushStreamingBuffer: () => void;

  /** Clear streaming content and finalize message */
  finalizeStreamingMessage: () => Message | null;

  /** Stop generation and discard streaming content */
  stopGeneration: () => void;

  /** Gérer le retry réseau (session, non persisté) */
  setPendingRetry: (retry: ChatStore['pendingRetry']) => void;

  /** Set generation state */
  setIsGenerating: (isGenerating: boolean) => void;

  /** Compact conversation by replacing old messages with a summary */
  compactConversation: (summary: string) => void;

  /** Trim old messages, keeping only the last N messages */
  trimOldMessages: (keepLast: number) => void;

  /** Clear all conversations */
  clearAllConversations: () => void;

  /** Import conversations from export */
  importConversations: (conversations: Conversation[]) => void;

  /** Export conversations for backup */
  exportConversations: () => Conversation[];
}

/**
 * Default settings for new conversations
 */
const getDefaultConversationTitle = () => {
  const now = new Date();
  return `Conversation ${now.toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

/**
 * Create the chat store with persistence
 */
export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      // Initial state
      conversations: [],
      activeConversationId: null,
      isGenerating: false,
      streamingContent: '',
      streamingMessageId: null,
      streamingBuffer: '',
      lastStreamFlushAt: 0,
      streamFlushTimerId: null,
      pendingRetry: null,

      // ========================================================================
      // SELECTORS
      // ========================================================================

      /**
       * Get the currently active conversation
       */
      getActiveConversation: () => {
        const { conversations, activeConversationId } = get();
        if (!activeConversationId) return null;
        return conversations.find((c) => c.id === activeConversationId) || null;
      },

      /**
       * Get all conversations sorted by most recent first
       */
      getSortedConversations: () => {
        return get().conversations.sort((a, b) => b.updatedAt - a.updatedAt);
      },

      /**
       * Estimate the total tokens in the active conversation
       * Uses ~4 chars per token approximation
       */
      estimateConversationTokens: () => {
        const { conversations, activeConversationId } = get();
        if (!activeConversationId) return { totalTokens: 0, messageCount: 0 };

        const conversation = conversations.find((c) => c.id === activeConversationId);
        if (!conversation) return { totalTokens: 0, messageCount: 0 };

        let totalChars = 0;
        for (const msg of conversation.messages) {
          totalChars += msg.content.length;
        }

        return {
          totalTokens: Math.ceil(totalChars / 4),
          messageCount: conversation.messages.length,
        };
      },

      /**
       * Get messages suitable for API, trimming from the front if they exceed maxTokens
       * Always keeps the first system message if present, plus as many recent messages as fit
       */
      getMessagesForAPI: (maxTokens?: number) => {
        const { conversations, activeConversationId } = get();
        if (!activeConversationId) return [];

        const conversation = conversations.find((c) => c.id === activeConversationId);
        if (!conversation) return [];

        // IMPORTANT: on génère une vue "API" qui peut enrichir certains messages (ex: pièces jointes)
        const apiMessages: Message[] = conversation.messages.map((m) => {
          if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
            return {
              ...m,
              content: `${m.content}${buildAttachmentsContext(m.attachments)}`,
            };
          }
          return m;
        });

        if (!maxTokens) return [...apiMessages];

        // Find system message if present
        const systemMessageIndex = apiMessages.findIndex((m) => m.role === 'system');
        const hasSystemMessage = systemMessageIndex === 0;

        // Calculate tokens from the end backwards
        let selectedMessages: Message[] = [];
        let currentTokens = 0;

        // Start from the last message and work backwards
        for (let i = apiMessages.length - 1; i >= 0; i--) {
          const msg = apiMessages[i];
          const msgTokens = Math.ceil(msg.content.length / 4);

          // If adding this message exceeds maxTokens, stop
          if (currentTokens + msgTokens > maxTokens && selectedMessages.length > 0) {
            break;
          }

          selectedMessages.unshift(msg);
          currentTokens += msgTokens;
        }

        // Always include system message at the front if it existed
        if (hasSystemMessage && selectedMessages[0]?.role !== 'system') {
          selectedMessages.unshift(apiMessages[0]);
        }

        return selectedMessages;
      },

      // ========================================================================
      // ACTIONS
      // ========================================================================

      /**
       * Create a new conversation
       */
      createConversation: (title?: string, model = 'fast' as const) => {
        const conversation: Conversation = {
          id: generateId(),
          title: title || getDefaultConversationTitle(),
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          model,
          tags: [],
        };

        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: conversation.id,
        }));

        return conversation;
      },

      /**
       * Delete a conversation and switch to another if it was active
       */
      deleteConversation: (id: string) => {
        set((state) => {
          const filtered = state.conversations.filter((c) => c.id !== id);
          let newActiveId = state.activeConversationId;

          // If we deleted the active conversation, switch to the most recent
          if (state.activeConversationId === id) {
            newActiveId = filtered.length > 0 ? filtered[0].id : null;
          }

          return {
            conversations: filtered,
            activeConversationId: newActiveId,
          };
        });
      },

      /**
       * Set the active conversation
       */
      setActiveConversation: (id: string | null) => {
        set({ activeConversationId: id });
      },

      /**
       * Add a message to the active conversation
       */
      addMessage: (message: Message) => {
        set((state) => {
          const activeConversation = state.conversations.find(
            (c) => c.id === state.activeConversationId
          );

          if (!activeConversation) return state;

          // Auto-title: use first user message content as title
          const isFirstUserMsg =
            message.role === 'user' &&
            activeConversation.messages.filter((m) => m.role === 'user').length === 0;

          const autoTitle = isFirstUserMsg
            ? message.content.replace(/\*\*/g, '').replace(/\n/g, ' ').trim().slice(0, 50) + (message.content.length > 50 ? '...' : '')
            : undefined;

          const updated = state.conversations.map((c) => {
            if (c.id === state.activeConversationId) {
              return {
                ...c,
                messages: [...c.messages, message],
                title: autoTitle || c.title,
                updatedAt: Date.now(),
              };
            }
            return c;
          });

          return {
            conversations: updated,
          };
        });
      },

      /**
       * Update a message in the active conversation
       */
      updateMessage: (id: string, updates: Partial<Message>) => {
        set((state) => {
          const updated = state.conversations.map((c) => {
            if (c.id === state.activeConversationId) {
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === id ? { ...m, ...updates, updatedAt: Date.now() } : m
                ),
                updatedAt: Date.now(),
              };
            }
            return c;
          });

          return { conversations: updated };
        });
      },

      /**
       * Delete a message from the active conversation
       */
      deleteMessage: (id: string) => {
        set((state) => {
          const updated = state.conversations.map((c) => {
            if (c.id === state.activeConversationId) {
              return {
                ...c,
                messages: c.messages.filter((m) => m.id !== id),
                updatedAt: Date.now(),
              };
            }
            return c;
          });

          return { conversations: updated };
        });
      },

      /**
       * Replace streaming content (full update)
       */
      updateStreamingContent: (content: string) => {
        set((state) => {
          const { activeConversationId, streamingMessageId } = state;
          let conversations = state.conversations;
          // If a streaming message is bound, also update its content in the conversation
          if (activeConversationId && streamingMessageId) {
            conversations = state.conversations.map((c) => {
              if (c.id !== activeConversationId) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === streamingMessageId
                    ? { ...m, content, isStreaming: true }
                    : m
                ),
                updatedAt: Date.now(),
              };
            });
          }
          // updateStreamingContent est un "set" direct => on flush le buffer
          return {
            streamingContent: content,
            streamingBuffer: '',
            lastStreamFlushAt: Date.now(),
            conversations,
          };
        });
      },

      /**
       * Append a token to streaming content
       */
      appendStreamingContent: (token: string) => {
        const THROTTLE_MS = 50; // ~20fps max, fluide et léger
        set((state) => {
          const nextContent = state.streamingContent + token;
          const nextBuffer = state.streamingBuffer + token;
          const now = Date.now();

          // On ne touche pas à conversations ici => évite re-render lourd à chaque token
          // (on flush périodiquement via flushStreamingBuffer)
          let timerId = state.streamFlushTimerId;
          const shouldFlushNow = now - state.lastStreamFlushAt >= THROTTLE_MS && nextBuffer.length >= 120;

          if (!timerId && !shouldFlushNow) {
            timerId = globalThis.setTimeout(() => {
              try {
                useChatStore.getState().flushStreamingBuffer();
              } catch {
                // ignore
              }
            }, THROTTLE_MS);
          }

          // Si on a déjà assez de buffer et qu'on a dépassé l'intervalle, on flush immédiatement
          if (shouldFlushNow) {
            // Flush synchrone (dans un second set) pour garder cette fonction pure
            globalThis.queueMicrotask(() => {
              try {
                useChatStore.getState().flushStreamingBuffer();
              } catch {
                // ignore
              }
            });
          }

          return {
            streamingContent: nextContent,
            streamingBuffer: nextBuffer,
            streamFlushTimerId: timerId,
          };
        });
      },

      /**
       * Bind streaming content to an existing message in the active conversation.
       * Typically called right after creating a placeholder assistant message.
       */
      startStreamingMessage: (messageId: string) => {
        // Clear any previous timer
        const prev = get().streamFlushTimerId;
        if (prev) {
          try { clearTimeout(prev); } catch { /* ignore */ }
        }
        set({
          isGenerating: true,
          streamingContent: '',
          streamingBuffer: '',
          streamingMessageId: messageId,
          lastStreamFlushAt: Date.now(),
          streamFlushTimerId: null,
        });
      },

      /**
       * Flush le buffer vers le message dans la conversation active (throttle)
       */
      flushStreamingBuffer: () => {
        const { activeConversationId, streamingMessageId } = get();
        if (!activeConversationId || !streamingMessageId) return;

        set((state) => {
          // Clear timer if any
          if (state.streamFlushTimerId) {
            try { clearTimeout(state.streamFlushTimerId); } catch { /* ignore */ }
          }

          if (!state.streamingBuffer) {
            return {
              streamFlushTimerId: null,
              lastStreamFlushAt: Date.now(),
            };
          }

          const content = state.streamingContent; // contenu total accumulé
          const conversations = state.conversations.map((c) => {
            if (c.id !== activeConversationId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === streamingMessageId ? { ...m, content, isStreaming: true } : m
              ),
              updatedAt: Date.now(),
            };
          });

          return {
            conversations,
            streamingBuffer: '',
            streamFlushTimerId: null,
            lastStreamFlushAt: Date.now(),
          };
        });
      },

      /**
       * Finalize the streaming message and add it to conversation
       */
      finalizeStreamingMessage: () => {
        // Flush avant finalisation pour garantir que l'UI a le dernier texte
        get().flushStreamingBuffer();
        const { streamingContent, activeConversationId, streamingMessageId } = get();

        if (!streamingContent.trim() || !activeConversationId) {
          return null;
        }

        set((state) => {
          if (state.streamFlushTimerId) {
            try { clearTimeout(state.streamFlushTimerId); } catch { /* ignore */ }
          }
          const updated = state.conversations.map((c) => {
            if (c.id !== activeConversationId) return c;

            // Preferred: finalize into the bound streaming message if it exists
            if (streamingMessageId && c.messages.some((m) => m.id === streamingMessageId)) {
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === streamingMessageId
                    ? { ...m, content: streamingContent, isStreaming: false, timestamp: m.timestamp || Date.now() }
                    : m
                ),
                updatedAt: Date.now(),
              };
            }

            // Fallback: append a new assistant message
            const message: Message = {
              id: generateId(),
              role: 'assistant',
              content: streamingContent,
              timestamp: Date.now(),
              isStreaming: false,
            };
            return {
              ...c,
              messages: [...c.messages, message],
              updatedAt: Date.now(),
            };
          });

          return {
            conversations: updated,
            streamingContent: '',
            isGenerating: false,
            streamingMessageId: null,
            streamingBuffer: '',
            streamFlushTimerId: null,
          };
        });

        // Return the bound message if possible (or null if not found)
        const conv = get().conversations.find((c) => c.id === activeConversationId);
        if (!conv) return null;
        if (streamingMessageId) return conv.messages.find((m) => m.id === streamingMessageId) || null;
        return conv.messages[conv.messages.length - 1] || null;
      },

      /**
       * Stop generation and discard streaming content
       */
      stopGeneration: () => {
        set((state) => {
          const { activeConversationId, streamingMessageId } = state;
          let conversations = state.conversations;
          if (activeConversationId && streamingMessageId) {
            conversations = state.conversations.map((c) => {
              if (c.id !== activeConversationId) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === streamingMessageId ? { ...m, isStreaming: false } : m
                ),
                updatedAt: Date.now(),
              };
            });
          }
          if (state.streamFlushTimerId) {
            try { clearTimeout(state.streamFlushTimerId); } catch { /* ignore */ }
          }
          return {
            conversations,
            isGenerating: false,
            streamingContent: '',
            streamingMessageId: null,
            streamingBuffer: '',
            streamFlushTimerId: null,
          };
        });
      },

      /**
       * Set the generation state
       */
      setIsGenerating: (isGenerating: boolean) => {
        set({ isGenerating });
      },

      /**
       * Stocker/effacer une requête à réessayer (session uniquement)
       */
      setPendingRetry: (retry) => {
        set({ pendingRetry: retry });
      },

      /**
       * Compact conversation by replacing all messages except the last 6 with a summary
       * Keeps the first system message (if present) and adds a summary message
       */
      compactConversation: (summary: string) => {
        set((state) => {
          const updated = state.conversations.map((c) => {
            if (c.id === state.activeConversationId) {
              const messages = c.messages;
              if (messages.length <= 6) return c; // No need to compact

              // Check if first message is system
              const systemMessage = messages[0]?.role === 'system' ? messages[0] : null;
              const startIdx = systemMessage ? 1 : 0;

              // Keep only last 6 messages
              const recentMessages = messages.slice(-6);

              // Build new messages: system + summary + recent
              const newMessages: Message[] = [];

              if (systemMessage) {
                newMessages.push(systemMessage);
              }

              // Add summary as a system message
              const summaryMessage: Message = {
                id: generateId(),
                role: 'system',
                content: `[Résumé de la conversation précédente]\n\n${summary}\n\n[Fin du résumé — la conversation continue ci-dessous]`,
                timestamp: Date.now(),
              };

              newMessages.push(summaryMessage);
              newMessages.push(...recentMessages);

              return {
                ...c,
                messages: newMessages,
                updatedAt: Date.now(),
              };
            }
            return c;
          });

          return { conversations: updated };
        });
      },

      /**
       * Trim old messages, keeping only the last N messages
       * Preserves the system message if present
       */
      trimOldMessages: (keepLast: number) => {
        set((state) => {
          const updated = state.conversations.map((c) => {
            if (c.id === state.activeConversationId) {
              const messages = c.messages;

              // Check if first message is system
              const systemMessage = messages[0]?.role === 'system' ? messages[0] : null;

              // Keep system message + last N messages
              let newMessages = messages.slice(-keepLast);

              if (systemMessage && (newMessages.length === 0 || newMessages[0].id !== systemMessage.id)) {
                newMessages = [systemMessage, ...newMessages];
              }

              return {
                ...c,
                messages: newMessages,
                updatedAt: Date.now(),
              };
            }
            return c;
          });

          return { conversations: updated };
        });
      },

      /**
       * Clear all conversations (destructive operation)
       */
      clearAllConversations: () => {
        set({
          conversations: [],
          activeConversationId: null,
          streamingContent: '',
          isGenerating: false,
        });
      },

      /**
       * Import conversations from backup/export
       */
      importConversations: (conversations: Conversation[]) => {
        set((state) => ({
          conversations: [...state.conversations, ...conversations],
        }));
      },

      /**
       * Export all conversations for backup
       */
      exportConversations: () => {
        return get().conversations;
      },
    }),

    {
      name: 'anzar-chat-storage',
      // Only persist conversations, not UI state
      partialize: (state) => ({
        conversations: state.conversations,
        // Grand public: restaurer la dernière conversation active au relaunch
        activeConversationId: state.activeConversationId,
      }),
      // Après rehydrate: si aucune conversation active mais il y a un historique,
      // activer la plus récente automatiquement (UX grand public).
      onRehydrateStorage: () => (state, error) => {
        if (error) return;
        if (!state) return;
        if (!state.activeConversationId && state.conversations?.length) {
          // Important: ici on peut muter l'état réhydraté avant usage (pattern zustand persist).
          state.activeConversationId = state.conversations[0].id;
        }
      },
    }
  )
);

// ============================================================================
// EXPORT HOOKS FOR COMMON USE CASES
// ============================================================================

/**
 * Hook to get the active conversation.
 * Uses primitive selector (ID) to avoid creating new object references
 * that would cause infinite re-renders with Zustand's shallow comparison.
 */
export const useActiveConversation = () => {
  const activeId = useChatStore((state) => state.activeConversationId);
  const conversation = useChatStore((state) =>
    activeId ? state.conversations.find((c) => c.id === activeId) ?? null : null
  );
  return conversation;
};

/**
 * Hook to get sorted conversations — uses useShallow to avoid
 * infinite re-renders from new array references.
 */
export const useSortedConversations = () =>
  useChatStore(useShallow((state) => state.getSortedConversations()));

/**
 * Hook to get generation state — uses useShallow for object comparison.
 */
export const useGenerationState = () =>
  useChatStore(useShallow((state) => ({
    isGenerating: state.isGenerating,
    streamingContent: state.streamingContent,
  })));
