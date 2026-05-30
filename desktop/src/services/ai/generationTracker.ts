/**
 * GenerationTracker — Suivi des generations de projets en arriere-plan.
 *
 * Quand l'utilisateur lance une generation et navigue ailleurs,
 * ce service continue de poller /api/projects/{id}/status et met
 * a jour le projectStore. Quand c'est fini, il affiche un toast.
 *
 * Utilisation:
 *   generationTracker.track(projectId, backendProjectId, projectName)
 *   generationTracker.untrack(projectId) // si l'utilisateur annule
 */

import toast from 'react-hot-toast';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';

// ============================================================================
// TYPES
// ============================================================================

interface TrackedGeneration {
  projectId: string;          // local store project id
  backendProjectId: string;   // backend project id (proj_xxx)
  projectName: string;
  intervalId: ReturnType<typeof setInterval>;
  startedAt: number;
  lastStatus: string;
}

interface StatusResponse {
  status: string;
  agents: Array<{
    name: string;
    status: string;
    progress: number;
    message?: string;
  }>;
}

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
  const headers: Record<string, string> = {};
  try {
    const token = useSettingsStore.getState().getAuthToken?.();
    if (token) headers['Authorization'] = 'Bearer ' + token;
  } catch {
    // no token
  }
  return headers;
}

// ============================================================================
// TRACKER
// ============================================================================

const POLL_INTERVAL_MS = 5_000; // Poll every 5 seconds
const MAX_TRACK_DURATION_MS = 10 * 60 * 1000; // Stop after 10 minutes

class GenerationTrackerService {
  private _tracked = new Map<string, TrackedGeneration>();

  /** Number of active tracked generations */
  get activeCount(): number {
    return this._tracked.size;
  }

  /** Check if a project is being tracked */
  isTracking(projectId: string): boolean {
    return this._tracked.has(projectId);
  }

  /** Get all tracked project IDs */
  getTrackedIds(): string[] {
    return Array.from(this._tracked.keys());
  }

  /**
   * Start tracking a project generation in the background.
   * Polls /api/projects/{backendProjectId}/status every 5s.
   * Updates projectStore and shows toast when done.
   */
  track(projectId: string, backendProjectId: string, projectName: string): void {
    // Don't double-track
    if (this._tracked.has(projectId)) return;

    const intervalId = setInterval(() => {
      void this._poll(projectId);
    }, POLL_INTERVAL_MS);

    this._tracked.set(projectId, {
      projectId,
      backendProjectId,
      projectName,
      intervalId,
      startedAt: Date.now(),
      lastStatus: 'running',
    });
  }

  /** Stop tracking a project */
  untrack(projectId: string): void {
    const tracked = this._tracked.get(projectId);
    if (tracked) {
      clearInterval(tracked.intervalId);
      this._tracked.delete(projectId);
    }
  }

  /** Stop all tracking (e.g. on logout) */
  clear(): void {
    for (const [, tracked] of this._tracked) {
      clearInterval(tracked.intervalId);
    }
    this._tracked.clear();
  }

  // ── Internal poll logic ──

  private async _poll(projectId: string): Promise<void> {
    const tracked = this._tracked.get(projectId);
    if (!tracked) return;

    // Safety: stop after max duration
    if (Date.now() - tracked.startedAt > MAX_TRACK_DURATION_MS) {
      this.untrack(projectId);
      return;
    }

    try {
      const url = getBackendUrl() + '/api/projects/' + tracked.backendProjectId + '/status';
      const response = await fetch(url, {
        method: 'GET',
        headers: getAuthHeaders(),
      });

      if (!response.ok) return; // silently skip on error

      const data: StatusResponse = await response.json();

      // Update agent statuses in projectStore
      const store = useProjectStore.getState();
      for (const agent of data.agents) {
        store.updateAgentStatus(projectId, agent.name, {
          status: agent.status === 'done' ? 'done'
            : agent.status === 'error' ? 'error'
            : agent.status === 'running' ? 'working'
            : 'idle',
          progress: agent.progress,
          message: agent.message || '',
        });
      }

      // Calculate overall progress
      const total = data.agents.length;
      const doneAgents = data.agents.filter((a) => a.status === 'done');
      if (total > 0) {
        const progress = Math.round((doneAgents.length / total) * 100);
        store.setProjectProgress(projectId, progress);
      }

      // Check terminal states
      if (data.status === 'completed' || data.status === 'complete') {
        store.setProjectStatus(projectId, 'complete');
        store.setProjectProgress(projectId, 100);

        // Load files from disk if possible
        try {
          await store.loadProjectFromDisk(projectId);
        } catch {
          // non-blocking
        }

        toast.success(tracked.projectName + ' - Projet genere avec succes !', {
          duration: 6000,
        });

        this.untrack(projectId);
      } else if (data.status === 'error') {
        store.setProjectStatus(projectId, 'error', 'Erreur lors de la generation');
        toast.error(tracked.projectName + ' - Erreur lors de la generation.', {
          duration: 6000,
        });
        this.untrack(projectId);
      }

      tracked.lastStatus = data.status;
    } catch {
      // Network error — silently retry on next poll
    }
  }
}

export const generationTracker = new GenerationTrackerService();
