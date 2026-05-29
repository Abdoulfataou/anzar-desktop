/**
 * ProjectGeneration — Service de génération de projets via le pipeline multi-agents.
 *
 * Appelle le backend ANZAR pour :
 * 1. Planifier un projet (Orchestrator + Planner)
 * 2. Exécuter la génération (Coder + Tester + Executor) via SSE stream
 *
 * Supporte: AbortController, base_dir local, gestion d'erreurs détaillées.
 */

import { useSettingsStore } from '@/stores/settingsStore';

// ============================================================================
// TYPES
// ============================================================================

export interface PlanRequest {
  description: string;
  project_name: string;
  project_type?: string;
  tech_stack?: string[];
  requirements?: string[];
}

export interface PlanResult {
  project_id: string;
  title: string;
  overview: string;
  files: Array<{ path: string; description: string; type: string }>;
  phases: Array<{ name: string; description: string; duration: string; tasks: string[] }>;
  complexity: string;
  architecture: Record<string, any>;
  tokens_used: number;
}

export interface AgentUpdate {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  progress: number;
  message?: string;
}

/** Granular file-level step event (TRAE-style) */
export interface StepEvent {
  type: 'step';
  action: string;   // reading, thinking, writing, creating, testing, complete, error
  label: string;
  file: string | null;
}

export interface AgentsEvent {
  type: 'agents';
  agents: AgentUpdate[];
}

/** File content streamed directly via SSE (Option 2 — write as received) */
export interface FileEvent {
  type: 'file';
  path: string;
  content: string;
}

/** Union of all SSE event types */
export type ExecutionEvent = AgentsEvent | StepEvent | FileEvent;

/** Legacy compatibility */
export type OnAgentUpdate = (event: ExecutionEvent) => void;

// ============================================================================
// HELPERS
// ============================================================================

function getBackendUrl(): string {
  try {
    return useSettingsStore.getState().getBackendUrl?.() || 'https://anzar-desktop-production.up.railway.app';
  } catch {
    return 'https://anzar-desktop-production.up.railway.app';
  }
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  try {
    const token = useSettingsStore.getState().getAuthToken?.();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {
    // no token available
  }
  return headers;
}

/** Parse une ligne SSE qui peut être "data: {json}", "{json}", ou juste du texte */
function parseSSELine(line: string): ExecutionEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === 'data: [DONE]' || trimmed === ':') return null;

  // Strip "data: " prefix if present
  const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;

  try {
    const parsed = JSON.parse(jsonStr);
    // New format: typed events
    if (parsed && parsed.type === 'file' && parsed.path && typeof parsed.content === 'string') {
      return parsed as FileEvent;
    }
    if (parsed && parsed.type === 'step') {
      return parsed as StepEvent;
    }
    if (parsed && parsed.type === 'agents' && Array.isArray(parsed.agents)) {
      return parsed as AgentsEvent;
    }
    // Legacy format: plain agents array (backward compat)
    if (parsed && Array.isArray(parsed.agents) && !parsed.type) {
      return { type: 'agents', agents: parsed.agents } as AgentsEvent;
    }
  } catch {
    // Not valid JSON — skip keepalive, comments, etc.
  }
  return null;
}

// ============================================================================
// PROJECT GENERATION SERVICE
// ============================================================================

class ProjectGenerationService {
  /** Active AbortController for the current generation — allows cancel */
  private _abortController: AbortController | null = null;

  /** Whether a generation is currently in progress */
  get isRunning(): boolean {
    return this._abortController !== null;
  }

  /**
   * Cancel the current generation (plan or execute).
   * Safe to call multiple times or when nothing is running.
   */
  abort(): void {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  /**
   * Phase 1 : Planifier le projet.
   * Appelle /api/projects/plan → Orchestrator + Planner s'exécutent côté backend.
   * Retourne le plan complet avec architecture, fichiers prévus, phases.
   */
  async plan(request: PlanRequest, signal?: AbortSignal): Promise<PlanResult> {
    const url = `${getBackendUrl()}/api/projects/plan`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      signal,
      body: JSON.stringify({
        description: request.description,
        project_name: request.project_name,
        project_type: request.project_type || 'other',
        tech_stack: request.tech_stack || [],
        requirements: request.requirements || [],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const msg = error?.error?.message || error?.detail || `Erreur planification (HTTP ${response.status})`;
      if (response.status === 402) throw new Error('Crédits insuffisants. Recharge ton compte pour continuer.');
      if (response.status === 401) throw new Error('Session expirée. Reconnecte-toi.');
      throw new Error(msg);
    }

    return response.json();
  }

  /**
   * Phase 2 : Exécuter la génération.
   * Appelle /api/projects/{id}/execute → Coder + Tester + Executor via SSE stream.
   * Chaque ligne du stream contient un JSON avec l'état de tous les agents.
   *
   * @param projectId - ID du projet (backend)
   * @param plan - Le plan complet retourné par phase 1
   * @param onUpdate - Callback appelé à chaque mise à jour d'agent
   * @param baseDir - Dossier local où écrire les fichiers (optionnel)
   * @param signal - AbortSignal pour annuler le stream
   */
  async execute(
    projectId: string,
    plan: Record<string, any>,
    onUpdate: OnAgentUpdate,
    baseDir?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${getBackendUrl()}/api/projects/${projectId}/execute`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      signal,
      body: JSON.stringify({ plan, base_dir: baseDir || undefined }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const msg = error?.error?.message || error?.detail || `Erreur exécution (HTTP ${response.status})`;
      if (response.status === 402) throw new Error('Crédits insuffisants. Recharge ton compte.');
      throw new Error(msg);
    }

    // Lire le stream SSE ligne par ligne
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Pas de flux de réponse du serveur');

    const decoder = new TextDecoder();
    let buffer = '';
    let lastEventTime = Date.now();
    const STREAM_TIMEOUT_MS = 300_000; // 5 minutes sans événement = timeout (keepalives every 15s)

    try {
      while (true) {
        // Check abort
        if (signal?.aborted) {
          reader.cancel();
          throw new DOMException('Generation cancelled', 'AbortError');
        }

        // Check stream timeout
        if (Date.now() - lastEventTime > STREAM_TIMEOUT_MS) {
          reader.cancel();
          throw new Error('Timeout: le serveur ne répond plus depuis 2 minutes');
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        lastEventTime = Date.now();

        // Split on newlines — each line is an independent event
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete last line

        for (const line of lines) {
          const event = parseSSELine(line);
          if (event) {
            onUpdate(event);
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const event = parseSSELine(buffer);
        if (event) onUpdate(event);
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Phase 3 : Itérer sur un projet existant.
   * Appelle POST /api/projects/{id}/iterate → CoderAgent refactor mode via SSE.
   * L'utilisateur décrit une modification ("change la couleur du header en bleu")
   * et le backend retourne les fichiers modifiés.
   *
   * @param projectId - ID backend du projet
   * @param message - Description de la modification en langage naturel
   * @param files - Map path → contenu des fichiers courants
   * @param onUpdate - Callback pour chaque événement SSE (step, file)
   * @param fileFocus - Fichier principal à modifier (optionnel)
   */
  async iterate(
    projectId: string,
    message: string,
    files: Record<string, string>,
    onUpdate: OnAgentUpdate,
    fileFocus?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${getBackendUrl()}/api/projects/${projectId}/iterate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      signal,
      body: JSON.stringify({
        message,
        files,
        file_focus: fileFocus || null,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const msg = error?.error?.message || error?.detail || `Erreur itération (HTTP ${response.status})`;
      if (response.status === 402) throw new Error('Crédits insuffisants. Recharge ton compte.');
      if (response.status === 401) throw new Error('Session expirée. Reconnecte-toi.');
      throw new Error(msg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Pas de flux de réponse du serveur');

    const decoder = new TextDecoder();
    let buffer = '';
    let lastEventTime = Date.now();
    const ITERATE_TIMEOUT_MS = 150_000; // 2.5 min sans événement = timeout

    try {
      while (true) {
        if (signal?.aborted) {
          reader.cancel();
          throw new DOMException('Itération annulée', 'AbortError');
        }

        if (Date.now() - lastEventTime > ITERATE_TIMEOUT_MS) {
          reader.cancel();
          throw new Error('Timeout: le serveur ne répond plus. Essaie une modification plus ciblée.');
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        lastEventTime = Date.now();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const event = parseSSELine(line);
          if (event) onUpdate(event);
        }
      }

      if (buffer.trim()) {
        const event = parseSSELine(buffer);
        if (event) onUpdate(event);
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Download generated files from backend.
   * Returns a dict of filepath → content to write locally via Tauri FS.
   */
  async downloadFiles(backendProjectId: string): Promise<Record<string, string>> {
    const url = `${getBackendUrl()}/api/projects/${backendProjectId}/download-files`;
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Erreur téléchargement fichiers (HTTP ${response.status})`);
    }

    const data = await response.json();
    return data.files || {};
  }

  /**
   * Pipeline complet : plan + execute avec AbortController intégré.
   * Retourne le plan si succès, null sinon.
   * Appelé depuis ChatView.handleProjectGeneration.
   */
  async generate(
    request: PlanRequest,
    callbacks: {
      onPhaseChange: (phase: string, message: string) => void;
      onAgentUpdate: OnAgentUpdate;
      onPlanReady: (plan: PlanResult) => void;
      onComplete: (projectId: string) => void;
      onError: (error: string) => void;
    },
    baseDir?: string,
  ): Promise<PlanResult | null> {
    // Create abort controller for this generation
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    try {
      // ── Phase 1: Planification ──
      callbacks.onPhaseChange('planning', 'Analyse et enrichissement de ta demande...');
      const plan = await this.plan(request, signal);
      callbacks.onPlanReady(plan);
      callbacks.onPhaseChange('planned', `Plan prêt: ${plan.files.length} fichiers prévus`);

      // ── Phase 2: Exécution ──
      callbacks.onPhaseChange('executing', 'Generation du code en cours...');
      await this.execute(plan.project_id, plan, callbacks.onAgentUpdate, baseDir, signal);
      callbacks.onPhaseChange('complete', 'Projet généré avec succès !');
      callbacks.onComplete(plan.project_id);

      return plan;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        callbacks.onError('Génération annulée par l\'utilisateur.');
      } else {
        callbacks.onError(error?.message || 'Erreur lors de la génération');
      }
      return null;
    } finally {
      this._abortController = null;
    }
  }
}

export const projectGeneration = new ProjectGenerationService();
