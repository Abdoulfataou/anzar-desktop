/**
 * Chat Store - Zustand store for managing conversations and messages
 * Handles conversation lifecycle, message persistence, and streaming state
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Conversation, Message } from '@/types';
import { generateId } from '@/lib/utils';

/**
 * Chat store state and actions
 */
interface ChatStore {
  // State
  conversations: Conversation[];
  activeConversationId: string | null;
  isGenerating: boolean;
  streamingContent: string;

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

  /** Clear streaming content and finalize message */
  finalizeStreamingMessage: () => Message | null;

  /** Stop generation and discard streaming content */
  stopGeneration: () => void;

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

        if (!maxTokens) return [...conversation.messages];

        // Find system message if present
        const systemMessageIndex = conversation.messages.findIndex((m) => m.role === 'system');
        const hasSystemMessage = systemMessageIndex === 0;

        // Calculate tokens from the end backwards
        let selectedMessages: Message[] = [];
        let currentTokens = 0;

        // Start from the last message and work backwards
        for (let i = conversation.messages.length - 1; i >= 0; i--) {
          const msg = conversation.messages[i];
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
          selectedMessages.unshift(conversation.messages[0]);
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

          const updated = state.conversations.map((c) => {
            if (c.id === state.activeConversationId) {
              return {
                ...c,
                messages: [...c.messages, message],
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
        set({ streamingContent: content });
      },

      /**
       * Append a token to streaming content
       */
      appendStreamingContent: (token: string) => {
        set((state) => ({
          streamingContent: state.streamingContent + token,
        }));
      },

      /**
       * Finalize the streaming message and add it to conversation
       */
      finalizeStreamingMessage: () => {
        const { streamingContent, activeConversationId } = get();

        if (!streamingContent.trim() || !activeConversationId) {
          return null;
        }

        const message: Message = {
          id: generateId(),
          role: 'assistant',
          content: streamingContent,
          timestamp: Date.now(),
          isStreaming: false,
        };

        set((state) => {
          const updated = state.conversations.map((c) => {
            if (c.id === activeConversationId) {
              return {
                ...c,
                messages: [...c.messages, message],
                updatedAt: Date.now(),
              };
            }
            return c;
          });

          return {
            conversations: updated,
            streamingContent: '',
            isGenerating: false,
          };
        });

        return message;
      },

      /**
       * Stop generation and discard streaming content
       */
      stopGeneration: () => {
        set({
          isGenerating: false,
          streamingContent: '',
        });
      },

      /**
       * Set the generation state
       */
      setIsGenerating: (isGenerating: boolean) => {
        set({ isGenerating });
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
      }),
    }
  )
);

// ============================================================================
// EXPORT HOOKS FOR COMMON USE CASES
// ============================================================================

/**
 * Hook to get the active conversation
 */
export const useActiveConversation = () =>
  useChatStore((state) => state.getActiveConversation());

/**
 * Hook to get sorted conversations
 */
export const useSortedConversations = () =>
  useChatStore((state) => state.getSortedConversations());

/**
 * Hook to get generation state
 */
export const useGenerationState = () =>
  useChatStore((state) => ({
    isGenerating: state.isGenerating,
    streamingContent: state.streamingContent,
  }));
