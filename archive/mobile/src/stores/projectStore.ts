import { create } from 'zustand';

export type ProjectStatus = 'planned' | 'executing' | 'completed' | 'failed';

export type Project = {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  plan?: any;
  executionResult?: any;
  startUrl?: string;
};

type NewProjectInput = Omit<Project, 'createdAt' | 'updatedAt'>;

type ProjectStore = {
  projects: Project[];
  addProject: (project: NewProjectInput) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  getProject: (id: string) => Project | undefined;
};

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  projects: [],
  addProject: (project) => {
    const now = new Date().toISOString();
    set((state) => ({
      projects: [
        ...state.projects,
        {
          ...project,
          createdAt: now,
          updatedAt: now,
        },
      ],
    }));
  },
  updateProject: (id, updates) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
      ),
    }));
  },
  deleteProject: (id) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    }));
  },
  getProject: (id) => get().projects.find((p) => p.id === id),
}));

