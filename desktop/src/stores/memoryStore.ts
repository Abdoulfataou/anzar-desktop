/**
 * Memory Store - Zustand store for managing conversation memories
 * Handles memory creation, search, and organization
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MemoryItem } from '@/types';
import { generateId } from '@/lib/utils';

/**
 * Memory store state and actions
 */
interface MemoryStore {
  // State
  memories: MemoryItem[];
  searchQuery: string;

  // Selectors
  /** Get memories matching the search query */
  getSearchResults: () => MemoryItem[];

  /** Get memories by tag */
  getMemoriesByTag: (tag: string) => MemoryItem[];

  /** Get unique tags across all memories */
  getAllTags: () => string[];

  // Actions
  /** Add a new memory item */
  addMemory: (memory: Omit<MemoryItem, 'id'>) => MemoryItem;

  /** Update an existing memory */
  updateMemory: (id: string, updates: Partial<MemoryItem>) => void;

  /** Delete a memory item */
  deleteMemory: (id: string) => void;

  /** Set the search query */
  setSearchQuery: (query: string) => void;

  /** Clear search query */
  clearSearch: () => void;

  /** Delete all memories from a conversation */
  deleteMemoriesByConversation: (conversationId: string) => void;

  /** Clear all memories */
  clearAllMemories: () => void;

  /** Import memories from backup */
  importMemories: (memories: MemoryItem[]) => void;

  /** Export all memories */
  exportMemories: () => MemoryItem[];
}

/**
 * Create the memory store with persistence
 */
export const useMemoryStore = create<MemoryStore>()(
  persist(
    (set, get) => ({
      // Initial state
      memories: [],
      searchQuery: '',

      // ========================================================================
      // SELECTORS
      // ========================================================================

      /**
       * Search memories by title, summary, and tags
       */
      getSearchResults: () => {
        const { memories, searchQuery } = get();

        if (!searchQuery.trim()) {
          return memories;
        }

        const query = searchQuery.toLowerCase();

        return memories.filter((memory) => {
          const titleMatch = memory.title.toLowerCase().includes(query);
          const summaryMatch = memory.summary.toLowerCase().includes(query);
          const tagsMatch = memory.tags.some((tag) =>
            tag.toLowerCase().includes(query)
          );
          const contentMatch = memory.content?.toLowerCase().includes(query) || false;

          return titleMatch || summaryMatch || tagsMatch || contentMatch;
        });
      },

      /**
       * Get all memories with a specific tag
       */
      getMemoriesByTag: (tag: string) => {
        return get().memories.filter((memory) =>
          memory.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
        );
      },

      /**
       * Get all unique tags across memories
       */
      getAllTags: () => {
        const tags = new Set<string>();
        get().memories.forEach((memory) => {
          memory.tags.forEach((tag) => tags.add(tag));
        });
        return Array.from(tags).sort();
      },

      // ========================================================================
      // ACTIONS
      // ========================================================================

      /**
       * Add a new memory item
       */
      addMemory: (memory: Omit<MemoryItem, 'id'>) => {
        const newMemory: MemoryItem = {
          ...memory,
          id: generateId(),
        };

        set((state) => ({
          memories: [newMemory, ...state.memories],
        }));

        return newMemory;
      },

      /**
       * Update an existing memory
       */
      updateMemory: (id: string, updates: Partial<MemoryItem>) => {
        set((state) => ({
          memories: state.memories.map((memory) =>
            memory.id === id ? { ...memory, ...updates } : memory
          ),
        }));
      },

      /**
       * Delete a single memory item
       */
      deleteMemory: (id: string) => {
        set((state) => ({
          memories: state.memories.filter((memory) => memory.id !== id),
        }));
      },

      /**
       * Set the search query
       */
      setSearchQuery: (query: string) => {
        set({ searchQuery: query });
      },

      /**
       * Clear the search query
       */
      clearSearch: () => {
        set({ searchQuery: '' });
      },

      /**
       * Delete all memories from a specific conversation
       */
      deleteMemoriesByConversation: (conversationId: string) => {
        set((state) => ({
          memories: state.memories.filter(
            (memory) => memory.conversationId !== conversationId
          ),
        }));
      },

      /**
       * Clear all memories (destructive)
       */
      clearAllMemories: () => {
        set({ memories: [], searchQuery: '' });
      },

      /**
       * Import memories from backup/export
       */
      importMemories: (memories: MemoryItem[]) => {
        set((state) => ({
          memories: [...state.memories, ...memories],
        }));
      },

      /**
       * Export all memories for backup
       */
      exportMemories: () => {
        return get().memories;
      },
    }),

    {
      name: 'anzar-memory-storage',
      partialize: (state) => ({
        memories: state.memories,
      }),
    }
  )
);

// ============================================================================
// EXPORT HOOKS FOR COMMON USE CASES
// ============================================================================

/**
 * Hook to get search results
 */
export const useMemorySearch = () =>
  useMemoryStore((state) => ({
    results: state.getSearchResults(),
    query: state.searchQuery,
    setQuery: state.setSearchQuery,
    clearSearch: state.clearSearch,
  }));

/**
 * Hook to get all tags
 */
export const useMemoryTags = () =>
  useMemoryStore((state) => state.getAllTags());
