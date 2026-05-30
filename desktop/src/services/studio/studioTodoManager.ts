/**
 * StudioTodoManager — Gestion des tâches du VibeCoding Studio.
 *
 * Inspiré de TRAE SOLO qui affiche une todo list gérée par l'agent
 * pendant la génération et l'itération, montrant exactement ce que
 * l'IA fait et ce qui reste à faire.
 *
 * Fonctionnalités:
 *  - Créer/mettre à jour des tâches avec statut (pending/running/done/error)
 *  - Auto-générer les tâches depuis un plan de génération
 *  - Auto-générer les tâches depuis une demande d'itération
 *  - Émettre des événements pour mise à jour UI en temps réel
 *  - Historique des tâches par session
 */

// ============================================================================
// TYPES
// ============================================================================

export type TodoStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface TodoItem {
  id: string;
  label: string;
  status: TodoStatus;
  /** File associated with this task (optional) */
  file?: string;
  /** Sub-label / detail shown under the main label */
  detail?: string;
  /** Timestamp when status last changed */
  updatedAt: number;
  /** Duration in ms (set when done/error) */
  duration?: number;
  /** Start timestamp (set when running) */
  startedAt?: number;
}

export interface TodoSession {
  id: string;
  type: 'generation' | 'iteration';
  label: string;
  items: TodoItem[];
  createdAt: number;
  completedAt?: number;
}

export type TodoListener = (items: TodoItem[], session: TodoSession | null) => void;

// ============================================================================
// SERVICE
// ============================================================================

class StudioTodoManagerService {
  private currentSession: TodoSession | null = null;
  private history: TodoSession[] = [];
  private listeners = new Set<TodoListener>();
  private idCounter = 0;

  // ── Listeners ──

  subscribe(listener: TodoListener): () => void {
    this.listeners.add(listener);
    // Emit current state immediately
    listener(this.getItems(), this.currentSession);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const items = this.getItems();
    const session = this.currentSession;
    this.listeners.forEach(fn => fn(items, session));
  }

  // ── Session management ──

  /**
   * Start a new todo session (generation or iteration).
   */
  startSession(type: 'generation' | 'iteration', label: string): void {
    // Archive previous session
    if (this.currentSession) {
      this.currentSession.completedAt = Date.now();
      this.history.push(this.currentSession);
      // Keep only last 10 sessions
      if (this.history.length > 10) this.history.shift();
    }

    this.currentSession = {
      id: `session-${Date.now()}`,
      type,
      label,
      items: [],
      createdAt: Date.now(),
    };
    this.emit();
  }

  /**
   * End the current session.
   */
  endSession(): void {
    if (!this.currentSession) return;

    // Mark any remaining pending/running items as skipped
    for (const item of this.currentSession.items) {
      if (item.status === 'pending' || item.status === 'running') {
        item.status = 'skipped';
        item.updatedAt = Date.now();
      }
    }

    this.currentSession.completedAt = Date.now();
    this.history.push(this.currentSession);
    if (this.history.length > 10) this.history.shift();
    this.currentSession = null;
    this.emit();
  }

  // ── Task CRUD ──

  /**
   * Add a new task to the current session.
   */
  addTask(label: string, file?: string, detail?: string): string {
    if (!this.currentSession) {
      this.startSession('iteration', label);
    }

    const id = `todo-${++this.idCounter}`;
    const item: TodoItem = {
      id,
      label,
      status: 'pending',
      file,
      detail,
      updatedAt: Date.now(),
    };

    this.currentSession!.items.push(item);
    this.emit();
    return id;
  }

  /**
   * Add multiple tasks at once (e.g., from a plan).
   */
  addTasks(tasks: Array<{ label: string; file?: string; detail?: string }>): string[] {
    return tasks.map(t => this.addTask(t.label, t.file, t.detail));
  }

  /**
   * Update a task's status.
   */
  updateTask(id: string, status: TodoStatus, detail?: string): void {
    if (!this.currentSession) return;

    const item = this.currentSession.items.find(i => i.id === id);
    if (!item) return;

    const now = Date.now();

    if (status === 'running' && !item.startedAt) {
      item.startedAt = now;
    }

    if ((status === 'done' || status === 'error') && item.startedAt) {
      item.duration = now - item.startedAt;
    }

    item.status = status;
    item.updatedAt = now;
    if (detail !== undefined) item.detail = detail;

    this.emit();
  }

  /**
   * Mark a task as running by label match (fuzzy — useful when we don't have the ID).
   */
  markRunningByFile(file: string): void {
    if (!this.currentSession) return;

    for (const item of this.currentSession.items) {
      if (item.file === file && item.status === 'pending') {
        item.status = 'running';
        item.startedAt = Date.now();
        item.updatedAt = Date.now();
        this.emit();
        return;
      }
    }
  }

  /**
   * Mark a task as done by file match.
   */
  markDoneByFile(file: string): void {
    if (!this.currentSession) return;

    for (const item of this.currentSession.items) {
      if (item.file === file && (item.status === 'running' || item.status === 'pending')) {
        const now = Date.now();
        item.status = 'done';
        item.updatedAt = now;
        if (item.startedAt) item.duration = now - item.startedAt;
        this.emit();
        return;
      }
    }
  }

  // ── Auto-generate from plan ──

  /**
   * Generate todo items from a generation plan.
   * Creates one task per planned file.
   */
  fromPlan(plan: { files: Array<{ path: string; description: string }> }, projectName: string): string[] {
    this.startSession('generation', `Générer ${projectName}`);

    const tasks: Array<{ label: string; file?: string; detail?: string }> = [
      { label: 'Analyser le plan', detail: `${plan.files.length} fichiers prévus` },
    ];

    for (const f of plan.files) {
      tasks.push({
        label: `Créer ${f.path.split('/').pop() || f.path}`,
        file: f.path,
        detail: f.description,
      });
    }

    tasks.push({ label: 'Finaliser le projet' });

    return this.addTasks(tasks);
  }

  /**
   * Generate todo items from an iteration request.
   * Creates tasks based on what the iteration will likely do.
   */
  fromIteration(message: string, fileFocus?: string): string[] {
    this.startSession('iteration', message.slice(0, 80));

    const tasks: Array<{ label: string; file?: string; detail?: string }> = [
      { label: 'Analyser la demande', detail: message.slice(0, 100) },
    ];

    if (fileFocus) {
      tasks.push({
        label: `Modifier ${fileFocus.split('/').pop() || fileFocus}`,
        file: fileFocus,
      });
    }

    tasks.push(
      { label: 'Appliquer les modifications' },
      { label: 'Vérifier la cohérence' },
    );

    return this.addTasks(tasks);
  }

  // ── Queries ──

  getItems(): TodoItem[] {
    return this.currentSession?.items || [];
  }

  getSession(): TodoSession | null {
    return this.currentSession;
  }

  getHistory(): TodoSession[] {
    return [...this.history];
  }

  getStats(): { total: number; done: number; running: number; pending: number; errors: number } {
    const items = this.getItems();
    return {
      total: items.length,
      done: items.filter(i => i.status === 'done').length,
      running: items.filter(i => i.status === 'running').length,
      pending: items.filter(i => i.status === 'pending').length,
      errors: items.filter(i => i.status === 'error').length,
    };
  }

  /**
   * Reset everything (new project).
   */
  clear(): void {
    this.currentSession = null;
    this.history = [];
    this.idCounter = 0;
    this.emit();
  }
}

export const studioTodoManager = new StudioTodoManagerService();
