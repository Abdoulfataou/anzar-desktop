/**
 * Projets : un projet = un dossier de travail ouvert dans ANZAR (metadata.localPath).
 * L'agent lit et écrit directement sur le disque ; ce store ne garde que la liste
 * des projets et le projet actif (projects.json).
 */

import { createJsonFileStorage } from '@/lib/fileStore';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Project } from '@/types';
import { generateId } from '@/lib/utils';
import { terminalService } from '@/services/runtime/terminal';

interface ProjectStore {
  projects: Project[];
  activeProjectId: string | null;

  /** Crée un projet et le rend actif */
  createProject: (name: string, description: string, model?: import('@/types').AIModel) => Project;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
}

const localPathOf = (p?: Project | null): string | null => {
  const path = (p?.metadata as any)?.localPath;
  return typeof path === 'string' && path.trim() ? path : null;
};

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,

      createProject: (name, description, model = 'fast') => {
        const project: Project = {
          id: generateId(),
          name,
          description,
          status: 'complete',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          files: [],
          agents: [],
          metadata: { model },
        };
        set((state) => ({ projects: [project, ...state.projects], activeProjectId: project.id }));
        return project;
      },

      updateProject: (id, updates) => {
        // Le terminal n'exécute des commandes que dans les dossiers de projets connus
        const existing = get().projects.find((p) => p.id === id);
        const nextPath = (updates.metadata as any)?.localPath ?? localPathOf(existing);
        if (typeof nextPath === 'string' && nextPath.trim()) terminalService.registerProjectPath(nextPath);

        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p)),
        }));
      },

      deleteProject: (id) => {
        const path = localPathOf(get().projects.find((p) => p.id === id));
        if (path) terminalService.unregisterProjectPath(path);

        set((state) => {
          const filtered = state.projects.filter((p) => p.id !== id);
          return {
            projects: filtered,
            activeProjectId: state.activeProjectId === id ? (filtered[0]?.id ?? null) : state.activeProjectId,
          };
        });
      },

      setActiveProject: (id) => set({ activeProjectId: id }),
    }),

    {
      name: 'anzar-project-storage',
      storage: createJsonFileStorage('projects.json') as any,
      // Un projet lié à un dossier a ses fichiers SUR LE DISQUE : pas de copie ici.
      // Les anciens projets générés sans dossier gardent leurs fichiers (seule copie).
      partialize: (state) => ({
        projects: state.projects.map((p) =>
          localPathOf(p) && p.files.length > 0 ? { ...p, files: [] } : p
        ),
        // Dossier actif conservé au redémarrage : sinon la tâche rouverte n'a plus d'outils
        activeProjectId: state.activeProjectId,
      }) as any,
      onRehydrateStorage: () => (state) => {
        // Réautorise les dossiers des projets pour le terminal
        try {
          for (const p of state?.projects || []) {
            const path = localPathOf(p);
            if (path) terminalService.registerProjectPath(path);
          }
        } catch {
          // ignore
        }
        // Réécriture immédiate au format allégé → libère l'espace dès le démarrage
        setTimeout(() => {
          try { useProjectStore.setState((st) => ({ projects: [...st.projects] })); } catch { /* ignore */ }
        }, 0);
      },
    }
  )
);
