/**
 * ActivityStore — Suivi en temps réel de l'activité des agents IA
 *
 * Comme Cursor / Claude Cowork : chaque étape du processus est visible
 * Thinking → Reading → Planning → Writing → Editing → Testing → Complete
 */
import { create } from 'zustand';

// ============================================================================
// TYPES
// ============================================================================

/** Types d'actions que l'agent peut effectuer */
export type AgentActionType =
  | 'thinking'        // Réflexion / raisonnement
  | 'understanding'   // Compréhension de la demande
  | 'planning'        // Planification de la solution
  | 'reading'         // Lecture de fichiers
  | 'searching'       // Recherche dans le code
  | 'analyzing'       // Analyse du code / erreurs
  | 'writing'         // Écriture de nouveau code
  | 'editing'         // Modification de fichier existant
  | 'creating'        // Création de fichier
  | 'deleting'        // Suppression de fichier
  | 'installing'      // Installation de dépendances
  | 'running'         // Exécution de commande
  | 'testing'         // Tests en cours
  | 'building'        // Build / compilation
  | 'debugging'       // Debugging / résolution d'erreur
  | 'deploying'       // Déploiement
  | 'complete'        // Terminé
  | 'error';          // Erreur

/** Une seule étape dans le processus de l'agent */
export interface AgentStep {
  id: string;
  type: AgentActionType;
  label: string;             // Ex: "Lecture de src/App.tsx"
  detail?: string;           // Ex: contenu ou info supplémentaire
  filePath?: string;         // Fichier concerné
  status: 'active' | 'done' | 'error';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
}

/** Todo item for the generation checklist (TRAE-style) */
export interface TodoItem {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  startedAt?: number;
  completedAt?: number;
}

/** Context file being processed */
export interface ContextFile {
  path: string;
  type: 'skill' | 'file' | 'other';
  status: 'reading' | 'writing' | 'done';
}

/** Session d'activité (une conversation/tâche) */
export interface ActivitySession {
  id: string;
  label: string;             // Ex: "Créer un composant Login"
  steps: AgentStep[];
  status: 'active' | 'done' | 'error';
  startedAt: number;
  completedAt?: number;
  totalDurationMs?: number;

  // TRAE-style additions
  todos: TodoItem[];
  contextFiles: ContextFile[];
  contextPercent: number;     // 0-100
  filesCreated: number;
  filesModified: number;
  commandsRun: number;
}

// ============================================================================
// STORE
// ============================================================================

interface ActivityStore {
  // State
  sessions: Map<string, ActivitySession>;
  activeSessionId: string | null;

  // Actions
  startSession: (id: string, label: string) => void;
  endSession: (id: string, status?: 'done' | 'error') => void;
  addStep: (sessionId: string, step: Omit<AgentStep, 'id' | 'startedAt' | 'status'>) => string;
  completeStep: (sessionId: string, stepId: string, status?: 'done' | 'error') => void;
  updateStepLabel: (sessionId: string, stepId: string, label: string) => void;

  // TRAE-style Todo & Context actions
  setTodos: (sessionId: string, todos: Omit<TodoItem, 'id'>[]) => void;
  updateTodo: (sessionId: string, todoId: string, status: TodoItem['status']) => void;
  addContextFile: (sessionId: string, file: ContextFile) => void;
  removeContextFile: (sessionId: string, path: string) => void;
  setContextPercent: (sessionId: string, percent: number) => void;
  incrementStat: (sessionId: string, stat: 'filesCreated' | 'filesModified' | 'commandsRun', by?: number) => void;

  // Getters
  getActiveSession: () => ActivitySession | null;
  getSession: (id: string) => ActivitySession | null;
  getActiveSteps: (sessionId: string) => AgentStep[];
  clearSessions: () => void;
}

export const useActivityStore = create<ActivityStore>()((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,

  startSession: (id, label) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(id, {
        id,
        label,
        steps: [],
        status: 'active',
        startedAt: Date.now(),
        todos: [],
        contextFiles: [],
        contextPercent: 0,
        filesCreated: 0,
        filesModified: 0,
        commandsRun: 0,
      });
      return { sessions, activeSessionId: id };
    });
  },

  endSession: (id, status = 'done') => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(id);
      if (session) {
        const now = Date.now();
        // Create new step objects to avoid mutation
        const updatedSteps = session.steps.map((s) => {
          if (s.status === 'active') {
            return {
              ...s,
              status: (status === 'done' ? 'done' : 'error') as typeof s.status,
              completedAt: now,
              durationMs: now - s.startedAt,
            };
          }
          return s;
        });
        sessions.set(id, {
          ...session,
          status,
          completedAt: now,
          totalDurationMs: now - session.startedAt,
          steps: updatedSteps,
        });
      }
      return {
        sessions,
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      };
    });
  },

  addStep: (sessionId, stepData) => {
    const stepId = `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        // Auto-complete previous active steps of same type
        const updatedSteps = session.steps.map((s) => {
          if (s.status === 'active' && s.type !== 'thinking') {
            return {
              ...s,
              status: 'done' as const,
              completedAt: Date.now(),
              durationMs: Date.now() - s.startedAt,
            };
          }
          return s;
        });

        const newStep: AgentStep = {
          ...stepData,
          id: stepId,
          status: stepData.type === 'complete' ? 'done' : 'active',
          startedAt: Date.now(),
          completedAt: stepData.type === 'complete' ? Date.now() : undefined,
        };

        sessions.set(sessionId, {
          ...session,
          steps: [...updatedSteps, newStep],
        });
      }
      return { sessions };
    });

    return stepId;
  },

  completeStep: (sessionId, stepId, status = 'done') => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        const steps = session.steps.map((s) =>
          s.id === stepId
            ? {
                ...s,
                status,
                completedAt: Date.now(),
                durationMs: Date.now() - s.startedAt,
              }
            : s
        );
        sessions.set(sessionId, { ...session, steps });
      }
      return { sessions };
    });
  },

  updateStepLabel: (sessionId, stepId, label) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        const steps = session.steps.map((s) =>
          s.id === stepId ? { ...s, label } : s
        );
        sessions.set(sessionId, { ...session, steps });
      }
      return { sessions };
    });
  },

  // ── TRAE-style Todo & Context ──

  setTodos: (sessionId, todos) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, {
          ...session,
          todos: todos.map((t, i) => ({ ...t, id: `todo-${i}` })),
        });
      }
      return { sessions };
    });
  },

  updateTodo: (sessionId, todoId, status) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        const now = Date.now();
        const todos = session.todos.map((t) =>
          t.id === todoId
            ? {
                ...t,
                status,
                startedAt: status === 'active' ? now : t.startedAt,
                completedAt: status === 'done' || status === 'error' ? now : undefined,
              }
            : t,
        );
        sessions.set(sessionId, { ...session, todos });
      }
      return { sessions };
    });
  },

  addContextFile: (sessionId, file) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        const exists = session.contextFiles.some((f) => f.path === file.path);
        const contextFiles = exists
          ? session.contextFiles.map((f) => (f.path === file.path ? file : f))
          : [...session.contextFiles, file];
        sessions.set(sessionId, { ...session, contextFiles });
      }
      return { sessions };
    });
  },

  removeContextFile: (sessionId, path) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, {
          ...session,
          contextFiles: session.contextFiles.filter((f) => f.path !== path),
        });
      }
      return { sessions };
    });
  },

  setContextPercent: (sessionId, percent) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, contextPercent: Math.min(100, Math.max(0, percent)) });
      }
      return { sessions };
    });
  },

  incrementStat: (sessionId, stat, by = 1) => {
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, [stat]: (session[stat] || 0) + by });
      }
      return { sessions };
    });
  },

  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    if (!activeSessionId) return null;
    return sessions.get(activeSessionId) || null;
  },

  getSession: (id) => {
    return get().sessions.get(id) || null;
  },

  getActiveSteps: (sessionId) => {
    const session = get().sessions.get(sessionId);
    if (!session) return [];
    return session.steps.filter((s) => s.status === 'active');
  },

  clearSessions: () => {
    set({ sessions: new Map(), activeSessionId: null });
  },
}));
