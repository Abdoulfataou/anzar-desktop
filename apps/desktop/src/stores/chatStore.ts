/**
 * Chat Store - Zustand store for managing conversations and messages
 * Handles conversation lifecycle, message persistence, and streaming state
 */

import { createTaskStorage } from '@/lib/fileStore';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { Conversation, Message, AIModel } from '@/types';
import { generateId } from '@/lib/utils';

/**
 * Chat store state and actions
 */
interface ChatStore {
  // State
  conversations: Conversation[];
  activeConversationId: string | null;
  isGenerating: boolean;


  // Selectors
  getActiveConversation: () => Conversation | null;
  getSortedConversations: () => Conversation[];

  // Actions
  /** Create a new conversation */
  createConversation: (title?: string, model?: import('@/types').AIModel, opts?: { activate?: boolean; projectId?: string }) => Conversation;

  /** Delete a conversation */
  deleteConversation: (id: string) => void;

  /** Rename a conversation */
  renameConversation: (id: string, title: string) => void;

  /** Set the active conversation */
  setActiveConversation: (id: string | null) => void;

  /** Add a message to the active conversation */
  /** Ajoute un message à la tâche donnée (par défaut : la tâche affichée). */
  addMessage: (message: Message, conversationId?: string) => void;

  /** Update a message in the active conversation */
  updateMessage: (id: string, updates: Partial<Message>) => void;









  /** Set generation state */
  setIsGenerating: (isGenerating: boolean) => void;




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
        // B11 : copie avant tri (la mutation sur place ne déclenchait pas de re-render)
        return get().conversations.sort((a, b) => b.updatedAt - a.updatedAt);
      },

      // ========================================================================
      // ACTIONS
      // ========================================================================

      /**
       * Create a new conversation
       */
      createConversation: (title?: string, model: import('@/types').AIModel = 'fast', opts?: { activate?: boolean; projectId?: string }) => {
        const conversation: Conversation = {
          id: generateId(),
          title: title || getDefaultConversationTitle(),
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          model,
          tags: [],
          ...(opts?.projectId ? { projectId: opts.projectId } : {}),
        };

        set((state) => ({
          conversations: [conversation, ...state.conversations],
          // Une tâche créée en arrière-plan (automatisation) ne remplace pas la tâche affichée
          activeConversationId: opts?.activate === false ? state.activeConversationId : conversation.id,
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
       * Rename a conversation
       */
      renameConversation: (id: string, title: string) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c
          ),
        }));
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
      addMessage: (message: Message, conversationId?: string) => {
        set((state) => {
          const targetId = conversationId ?? state.activeConversationId;
          const activeConversation = state.conversations.find(
            (c) => c.id === targetId
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
            if (c.id === targetId) {
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
          // La tâche qui contient le message (l'utilisateur a pu changer de tâche entre-temps)
          const owner = state.conversations.find((c) => c.messages.some((m) => m.id === id));
          if (!owner) return state;
          const updated = state.conversations.map((c) => {
            if (c.id === owner.id) {
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
       * Set the generation state
       */
      setIsGenerating: (isGenerating: boolean) => {
        set({ isGenerating });
      },

      /**
       * Clear all conversations (destructive operation)
       */
      clearAllConversations: () => {
        set({
          conversations: [],
          activeConversationId: null,
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
      // Une tâche = un fichier sur le disque (voir lib/fileStore) : plus de limite à 5 Mo.
      storage: createTaskStorage(),
      // Only persist conversations, not UI state.
      // Prune to avoid localStorage bloat: keep last 50 conversations,
      // max 100 messages per conversation.
      // On passe les conversations telles quelles (mêmes références) : le stockage
      // ne réécrit que les tâches qui ont changé.
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }) as any,
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

