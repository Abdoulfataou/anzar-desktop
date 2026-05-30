/**
 * Student Store - Zustand store for managing student projects
 * Handles project state, current selection, and lifecycle operations.
 */

import { create } from 'zustand';
import { studentService, type StudentProject } from '@/services/student/studentService';

// ============================================================================
// TYPES
// ============================================================================

interface StudentState {
  // State
  projects: StudentProject[];
  currentProjectId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadProjects: () => Promise<void>;
  setCurrentProject: (id: string | null) => void;
  getCurrentProject: () => StudentProject | null;
  deleteProject: (id: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

// ============================================================================
// STORE
// ============================================================================

export const useStudentStore = create<StudentState>((set, get) => ({
  // State
  projects: [],
  currentProjectId: null,
  isLoading: false,
  error: null,

  // Actions
  loadProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await studentService.listProjects();
      set({ projects, isLoading: false });
    } catch (err: any) {
      const msg = err?.message || 'Erreur lors du chargement des projets';
      set({ error: msg, isLoading: false });
    }
  },

  setCurrentProject: (id: string | null) => {
    set({ currentProjectId: id });
  },

  getCurrentProject: () => {
    const { currentProjectId, projects } = get();
    if (!currentProjectId) return null;
    return projects.find((p) => p.id === currentProjectId) || null;
  },

  deleteProject: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await studentService.deleteProject(id);
      set((state) => {
        const updated = state.projects.filter((p) => p.id !== id);
        const newCurrentId =
          state.currentProjectId === id ? null : state.currentProjectId;
        return {
          projects: updated,
          currentProjectId: newCurrentId,
          isLoading: false,
        };
      });
    } catch (err: any) {
      const msg = err?.message || 'Erreur lors de la suppression du projet';
      set({ error: msg, isLoading: false });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set({
      projects: [],
      currentProjectId: null,
      isLoading: false,
      error: null,
    });
  },
}));
