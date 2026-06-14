/**
 * Developer Memory Store — Zustand store for Hermes-inspired persistent preferences.
 * Syncs with backend /api/user/memory endpoints.
 * Hybrid: auto-learned from projects + manually editable.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { memoryService, MemoryEntry, MemoryCategory, MemoryProfile } from '@/services/memoryService';

// ============================================================================
// TYPES
// ============================================================================

interface DevMemoryState {
  // Data
  entries: MemoryEntry[];
  profile: MemoryProfile;

  // UI state
  loading: boolean;
  error: string | null;
  selectedCategory: MemoryCategory | null;

  // Actions — fetch
  fetchEntries: (category?: MemoryCategory) => Promise<void>;
  fetchProfile: () => Promise<void>;

  // Actions — CRUD
  upsertEntry: (category: MemoryCategory, key: string, value: string) => Promise<void>;
  deleteEntry: (category: MemoryCategory, key: string) => Promise<void>;
  clearAll: (category?: MemoryCategory) => Promise<void>;

  // Actions — UI
  setSelectedCategory: (category: MemoryCategory | null) => void;
  clearError: () => void;
}

// ============================================================================
// CATEGORY LABELS
// ============================================================================

export const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  stack: 'Stack technologique',
  conventions: 'Conventions de code',
  patterns: 'Patterns & Architecture',
  errors: 'Erreurs connues',
  preferences: 'Préférences générales',
  style: 'Style de code',
};

export const CATEGORY_ICONS: Record<MemoryCategory, string> = {
  stack: '🔧',
  conventions: '📏',
  patterns: '🏗️',
  errors: '⚠️',
  preferences: '⚙️',
  style: '🎨',
};

export const ALL_CATEGORIES: MemoryCategory[] = [
  'stack', 'conventions', 'patterns', 'errors', 'preferences', 'style',
];

// ============================================================================
// STORE
// ============================================================================

export const useDevMemoryStore = create<DevMemoryState>()((set, get) => ({
  // Initial state
  entries: [],
  profile: {},
  loading: false,
  error: null,
  selectedCategory: null,

  // ────────────────────────────────────────────────────────────────────────
  // FETCH
  // ────────────────────────────────────────────────────────────────────────

  fetchEntries: async (category?: MemoryCategory) => {
    set({ loading: true, error: null });
    try {
      const entries = await memoryService.getEntries(category);
      set({ entries, loading: false });
    } catch (err: any) {
      set({ error: err.message || 'Erreur de chargement', loading: false });
    }
  },

  fetchProfile: async () => {
    set({ loading: true, error: null });
    try {
      const profile = await memoryService.getProfile();
      set({ profile, loading: false });
    } catch (err: any) {
      set({ error: err.message || 'Erreur de chargement', loading: false });
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────────────────────────────────

  upsertEntry: async (category: MemoryCategory, key: string, value: string) => {
    set({ error: null });
    try {
      await memoryService.upsert({ category, key, value });
      // Refresh entries for the current view
      const { selectedCategory } = get();
      await get().fetchEntries(selectedCategory ?? undefined);
    } catch (err: any) {
      set({ error: err.message || "Erreur lors de la sauvegarde" });
    }
  },

  deleteEntry: async (category: MemoryCategory, key: string) => {
    set({ error: null });
    try {
      await memoryService.deleteEntry(category, key);
      // Optimistic remove from local state
      set((state) => ({
        entries: state.entries.filter(
          (e) => !(e.category === category && e.key === key)
        ),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Erreur lors de la suppression' });
    }
  },

  clearAll: async (category?: MemoryCategory) => {
    set({ error: null });
    try {
      await memoryService.clearAll(category);
      if (category) {
        set((state) => ({
          entries: state.entries.filter((e) => e.category !== category),
        }));
      } else {
        set({ entries: [] });
      }
    } catch (err: any) {
      set({ error: err.message || 'Erreur lors de la suppression' });
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  // UI
  // ────────────────────────────────────────────────────────────────────────

  setSelectedCategory: (category: MemoryCategory | null) => {
    set({ selectedCategory: category });
  },

  clearError: () => set({ error: null }),
}));

// ============================================================================
// SELECTOR HOOKS
// ============================================================================

/** Get entries filtered by the currently selected category. */
export const useFilteredEntries = () =>
  useDevMemoryStore(
    useShallow((state) => {
      const { entries, selectedCategory } = state;
      if (!selectedCategory) return entries;
      return entries.filter((e) => e.category === selectedCategory);
    })
  );

/** Get entry count per category. */
export const useCategoryCounts = () =>
  useDevMemoryStore(
    useShallow((state) => {
      const counts: Record<string, number> = {};
      for (const cat of ALL_CATEGORIES) {
        counts[cat] = state.entries.filter((e) => e.category === cat).length;
      }
      return counts;
    })
  );
