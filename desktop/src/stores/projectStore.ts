/**
 * Project Store - Zustand store for managing projects and code generation
 * Handles project lifecycle, file management, and agent coordination
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Project, ProjectFile, AgentStatus, FileOperation } from '@/types';
import { generateId } from '@/lib/utils';
import { fileSystemService } from '@/services/fileSystem';
import { terminalService } from '@/services/terminal';

/**
 * Project store state and actions
 */
interface ProjectStore {
  // State
  projects: Project[];
  activeProjectId: string | null;

  // Selectors
  /** Get the active project */
  getActiveProject: () => Project | null;

  /** Get all projects sorted by recent first */
  getSortedProjects: () => Project[];

  /** Get projects by status */
  getProjectsByStatus: (status: Project['status']) => Project[];

  // Actions
  /** Create a new project */
  createProject: (
    name: string,
    description: string,
    model?: 'fast' | 'thinking'
  ) => Project;

  /** Update a project */
  updateProject: (id: string, updates: Partial<Project>) => void;

  /** Delete a project */
  deleteProject: (id: string) => void;

  /** Set the active project */
  setActiveProject: (id: string | null) => void;

  /** Add a file to a project */
  addFile: (projectId: string, file: ProjectFile) => void;

  /** Update a file in a project */
  updateFile: (projectId: string, filePath: string, updates: Partial<ProjectFile>) => void;

  /** Delete a file from a project */
  deleteFile: (projectId: string, filePath: string) => void;

  /** Update agent status */
  updateAgentStatus: (projectId: string, agentName: string, status: Partial<AgentStatus>) => void;

  /** Update project status */
  setProjectStatus: (
    projectId: string,
    status: Project['status'],
    errorMessage?: string
  ) => void;

  /** Update project progress */
  setProjectProgress: (projectId: string, progress: number) => void;

  /** Rename a file in a project */
  renameFile: (projectId: string, oldPath: string, newPath: string) => void;

  /** Load files from disk into a project (Tauri FS) */
  loadProjectFromDisk: (projectId: string) => Promise<void>;

  /** Save a single file to disk (Tauri FS) */
  saveFileToDisk: (projectId: string, filePath: string) => Promise<void>;

  /** Save all project files to disk (Tauri FS) */
  saveAllFilesToDisk: (projectId: string) => Promise<void>;

  /** Execute batch file operations and sync store */
  executeBatchOperations: (
    projectId: string,
    operations: FileOperation[],
    options?: { writeToDisk?: boolean }
  ) => Promise<void>;

  /** Clear all projects */
  clearAllProjects: () => void;

  /** Import projects from backup */
  importProjects: (projects: Project[]) => void;

  /** Export all projects */
  exportProjects: () => Project[];
}

/**
 * Create the project store with persistence
 */
export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      // Initial state
      projects: [],
      activeProjectId: null,

      // ========================================================================
      // SELECTORS
      // ========================================================================

      /**
       * Get the currently active project
       */
      getActiveProject: () => {
        const { projects, activeProjectId } = get();
        if (!activeProjectId) return null;
        return projects.find((p) => p.id === activeProjectId) || null;
      },

      /**
       * Get all projects sorted by most recent first
       */
      getSortedProjects: () => {
        return get().projects.sort((a, b) => b.updatedAt - a.updatedAt);
      },

      /**
       * Get projects filtered by status
       */
      getProjectsByStatus: (status: Project['status']) => {
        return get().projects.filter((p) => p.status === status);
      },

      // ========================================================================
      // ACTIONS
      // ========================================================================

      /**
       * Create a new project
       */
      createProject: (
        name: string,
        description: string,
        model = 'fast' as const
      ) => {
        const project: Project = {
          id: generateId(),
          name,
          description,
          status: 'planning',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          files: [],
          agents: [
            { name: 'orchestrator', status: 'idle', progress: 0 },
            { name: 'planner', status: 'idle', progress: 0 },
            { name: 'coder', status: 'idle', progress: 0 },
            { name: 'tester', status: 'idle', progress: 0 },
            { name: 'executor', status: 'idle', progress: 0 },
          ],
          metadata: { model },
        };

        set((state) => ({
          projects: [project, ...state.projects],
          activeProjectId: project.id,
        }));

        return project;
      },

      /**
       * Update a project
       */
      updateProject: (id: string, updates: Partial<Project>) => {
        // Register allowed project paths for terminal execution when a localPath appears
        const existing = get().projects.find((p) => p.id === id);
        const nextLocalPath =
          (updates.metadata as any)?.localPath ??
          (existing?.metadata as any)?.localPath;

        if (typeof nextLocalPath === 'string' && nextLocalPath.trim()) {
          terminalService.registerProjectPath(nextLocalPath);
        }

        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id
              ? { ...p, ...updates, updatedAt: Date.now() }
              : p
          ),
        }));
      },

      /**
       * Delete a project
       */
      deleteProject: (id: string) => {
        const project = get().projects.find((p) => p.id === id);
        const localPath = (project?.metadata as any)?.localPath;
        if (typeof localPath === 'string' && localPath.trim()) {
          terminalService.unregisterProjectPath(localPath);
        }

        set((state) => {
          const filtered = state.projects.filter((p) => p.id !== id);
          let newActiveId = state.activeProjectId;

          if (state.activeProjectId === id) {
            newActiveId = filtered.length > 0 ? filtered[0].id : null;
          }

          return {
            projects: filtered,
            activeProjectId: newActiveId,
          };
        });
      },

      /**
       * Set the active project
       */
      setActiveProject: (id: string | null) => {
        set({ activeProjectId: id });
      },

      /**
       * Add a file to a project
       */
      addFile: (projectId: string, file: ProjectFile) => {
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                files: [...p.files, file],
                updatedAt: Date.now(),
              };
            }
            return p;
          }),
        }));
      },

      /**
       * Update a file in a project
       */
      updateFile: (projectId: string, filePath: string, updates: Partial<ProjectFile>) => {
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                files: p.files.map((f) =>
                  f.path === filePath ? { ...f, ...updates } : f
                ),
                updatedAt: Date.now(),
              };
            }
            return p;
          }),
        }));
      },

      /**
       * Delete a file from a project
       */
      deleteFile: (projectId: string, filePath: string) => {
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                files: p.files.filter((f) => f.path !== filePath),
                updatedAt: Date.now(),
              };
            }
            return p;
          }),
        }));
      },

      /**
       * Update agent status for a project
       */
      updateAgentStatus: (projectId: string, agentName: string, status: Partial<AgentStatus>) => {
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                agents: p.agents.map((a) =>
                  a.name === agentName ? { ...a, ...status } : a
                ),
                updatedAt: Date.now(),
              };
            }
            return p;
          }),
        }));
      },

      /**
       * Set the project status
       */
      setProjectStatus: (
        projectId: string,
        status: Project['status'],
        errorMessage?: string
      ) => {
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                status,
                errorMessage,
                updatedAt: Date.now(),
              };
            }
            return p;
          }),
        }));
      },

      /**
       * Update project progress (0-100)
       */
      setProjectProgress: (projectId: string, progress: number) => {
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                metadata: {
                  ...p.metadata,
                  progress: Math.max(0, Math.min(100, progress)),
                },
                updatedAt: Date.now(),
              };
            }
            return p;
          }),
        }));
      },

      /**
       * Rename a file in a project
       */
      renameFile: (projectId: string, oldPath: string, newPath: string) => {
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id === projectId) {
              return {
                ...p,
                files: p.files.map((f) =>
                  f.path === oldPath
                    ? { ...f, path: newPath, language: newPath.split('.').pop() || f.language, updatedAt: Date.now() }
                    : f
                ),
                updatedAt: Date.now(),
              };
            }
            return p;
          }),
        }));
      },

      /**
       * Load files from disk into the project store (Tauri FS)
       */
      loadProjectFromDisk: async (projectId: string) => {
        const project = get().projects.find((p) => p.id === projectId);
        if (!project) return;

        const localPath = project.metadata?.localPath;
        if (!localPath) return;

        try {
          const files = await fileSystemService.readProjectFiles(localPath);
          set((state) => ({
            projects: state.projects.map((p) =>
              p.id === projectId
                ? { ...p, files, updatedAt: Date.now() }
                : p
            ),
          }));
        } catch (error) {
          console.error('Failed to load project from disk:', error);
        }
      },

      /**
       * Save a single file to disk
       */
      saveFileToDisk: async (projectId: string, filePath: string) => {
        const project = get().projects.find((p) => p.id === projectId);
        if (!project) return;

        const localPath = project.metadata?.localPath;
        if (!localPath) return;

        const file = project.files.find((f) => f.path === filePath);
        if (!file) return;

        try {
          await fileSystemService.writeFile(`${localPath}/${file.path}`, file.content);
        } catch (error) {
          console.error('Failed to save file to disk:', error);
        }
      },

      /**
       * Save all project files to disk
       */
      saveAllFilesToDisk: async (projectId: string) => {
        const project = get().projects.find((p) => p.id === projectId);
        if (!project) return;

        const localPath = project.metadata?.localPath;
        if (!localPath) return;

        try {
          await fileSystemService.saveProjectFiles(localPath, project.files);
        } catch (error) {
          console.error('Failed to save project files:', error);
        }
      },

      /**
       * Execute batch file operations and sync store
       */
      executeBatchOperations: async (
        projectId: string,
        operations: FileOperation[],
        options: { writeToDisk?: boolean } = {}
      ) => {
        const project = get().projects.find((p) => p.id === projectId);
        if (!project) return;

        const localPath = project.metadata?.localPath;

        // Apply operations to store
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id !== projectId) return p;

            let files = [...p.files];

            for (const op of operations) {
              switch (op.type) {
                case 'create':
                case 'edit': {
                  const existing = files.findIndex((f) => f.path === op.path);
                  const lang = op.path.split('.').pop() || 'plaintext';
                  if (existing >= 0) {
                    files[existing] = { ...files[existing], content: op.content, size: op.content.length, language: lang, updatedAt: Date.now() };
                  } else {
                    files.push({ path: op.path, content: op.content, language: lang, size: op.content.length, createdAt: Date.now(), updatedAt: Date.now() });
                  }
                  break;
                }
                case 'delete':
                  files = files.filter((f) => f.path !== op.path);
                  break;
                case 'rename': {
                  files = files.map((f) =>
                    f.path === op.oldPath
                      ? { ...f, path: op.newPath, language: op.newPath.split('.').pop() || f.language, updatedAt: Date.now() }
                      : f
                  );
                  break;
                }
              }
            }

            return { ...p, files, updatedAt: Date.now() };
          }),
        }));

        // Also write to disk if explicitly requested (A-mode: no silent disk writes)
        if (options.writeToDisk && localPath) {
          try {
            await fileSystemService.executeBatch(localPath, operations);
          } catch (error) {
            console.error('Failed to execute batch on disk:', error);
          }
        }
      },

      /**
       * Clear all projects (destructive)
       */
      clearAllProjects: () => {
        // Unregister all allowed paths
        for (const p of get().projects) {
          const localPath = (p.metadata as any)?.localPath;
          if (typeof localPath === 'string' && localPath.trim()) {
            terminalService.unregisterProjectPath(localPath);
          }
        }

        set({
          projects: [],
          activeProjectId: null,
        });
      },

      /**
       * Import projects from backup
       */
      importProjects: (projects: Project[]) => {
        // Register local paths from imported projects
        for (const p of projects) {
          const localPath = (p.metadata as any)?.localPath;
          if (typeof localPath === 'string' && localPath.trim()) {
            terminalService.registerProjectPath(localPath);
          }
        }
        set((state) => ({
          projects: [...state.projects, ...projects],
        }));
      },

      /**
       * Export all projects for backup
       */
      exportProjects: () => {
        return get().projects;
      },
    }),

    {
      name: 'anzar-project-storage',
      partialize: (state) => ({
        projects: state.projects,
      }),
      onRehydrateStorage: () => (state) => {
        // After hydration, re-register approved project paths (TerminalService)
        try {
          const projects = state?.projects || [];
          for (const p of projects) {
            const localPath = (p.metadata as any)?.localPath;
            if (typeof localPath === 'string' && localPath.trim()) {
              terminalService.registerProjectPath(localPath);
            }
          }
        } catch {
          // ignore
        }
      },
    }
  )
);

// ============================================================================
// EXPORT HOOKS FOR COMMON USE CASES
// ============================================================================

/**
 * Hook to get the active project
 */
export const useActiveProject = () =>
  useProjectStore((state) => state.getActiveProject());

/**
 * Hook to get sorted projects
 */
export const useSortedProjects = () =>
  useProjectStore((state) => state.getSortedProjects());
