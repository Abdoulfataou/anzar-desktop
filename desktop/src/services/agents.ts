/**
 * Multi-Agent Orchestration Service
 * Coordinates with the Python backend for complex code generation tasks
 * Falls back to direct AI API if backend is unavailable
 */

import { ProjectPlan, AgentStatus, Project } from '@/types';
import { aiRouter } from './router';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Agent service configuration
 */
interface AgentConfig {
  backendUrl: string;
  timeout: number;
  fallbackMode: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AgentConfig = {
  backendUrl: 'http://localhost:8000',
  timeout: 120000, // 2 minutes for long operations
  fallbackMode: false,
};

/**
 * Agent service for multi-agent orchestration
 */
class AgentService {
  private config: AgentConfig;
  private isBackendAvailable = false;

  constructor(config?: Partial<AgentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if backend is available
   */
  async checkBackendAvailability(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.config.backendUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      this.isBackendAvailable = response.ok;
      return this.isBackendAvailable;
    } catch {
      this.isBackendAvailable = false;
      return false;
    }
  }

  /**
   * Plan a project using the planner agent
   * Calls backend if available, otherwise uses AI API directly
   *
   * @param description - Project description
   * @returns Project plan
   *
   * @example
   * ```typescript
   * const plan = await agentService.planProject('Build a todo app');
   * ```
   */
  async planProject(description: string): Promise<ProjectPlan> {
    const isAvailable = await this.checkBackendAvailability();

    if (isAvailable) {
      return this.planViaBackend(description);
    } else {
      return this.planViaAI(description);
    }
  }

  /**
   * Execute a project using the backend agents
   * Returns an async generator that yields agent status updates
   *
   * @param projectId - Project ID
   * @param plan - Project plan to execute
   * @returns AsyncGenerator yielding agent status updates
   *
   * @example
   * ```typescript
   * for await (const status of agentService.executeProject(projectId, plan)) {
   *   console.log(status);
   * }
   * ```
   */
  async *executeProject(
    projectId: string,
    plan: ProjectPlan
  ): AsyncGenerator<AgentStatus[]> {
    const isAvailable = await this.checkBackendAvailability();

    if (!isAvailable) {
      // Fallback: just yield completion statuses
      yield [
        { name: 'orchestrator', status: 'done', progress: 100, message: 'Mode déconnecté' },
        { name: 'planner', status: 'done', progress: 100 },
        { name: 'coder', status: 'done', progress: 100 },
        { name: 'tester', status: 'done', progress: 100 },
        { name: 'executor', status: 'done', progress: 100 },
      ];
      return;
    }

    try {
      const response = await fetch(
        `${this.config.backendUrl}/api/projects/${projectId}/execute`,
        {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ plan }),
        }
      );

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines[lines.length - 1];

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();

          if (!line) continue;

          try {
            const data = JSON.parse(line);
            if (data.agents) {
              yield data.agents as AgentStatus[];
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }

      // Process remaining buffer
      if (buffer) {
        try {
          const data = JSON.parse(buffer);
          if (data.agents) {
            yield data.agents as AgentStatus[];
          }
        } catch (e) {
          // Ignore
        }
      }
    } catch (error) {
      console.error('Error executing project:', error);
      // Yield error state for all agents
      yield [
        { name: 'orchestrator', status: 'error', progress: 0, message: 'Erreur d\'exécution' },
        { name: 'planner', status: 'error', progress: 0 },
        { name: 'coder', status: 'error', progress: 0 },
        { name: 'tester', status: 'error', progress: 0 },
        { name: 'executor', status: 'error', progress: 0 },
      ];
    }
  }

  /**
   * Get the current status of agents for a project
   *
   * @param projectId - Project ID
   * @returns Agent statuses
   */
  async getStatus(projectId: string): Promise<AgentStatus[]> {
    const isAvailable = await this.checkBackendAvailability();

    if (!isAvailable) {
      return [
        { name: 'orchestrator', status: 'idle', progress: 0 },
        { name: 'planner', status: 'idle', progress: 0 },
        { name: 'coder', status: 'idle', progress: 0 },
        { name: 'tester', status: 'idle', progress: 0 },
        { name: 'executor', status: 'idle', progress: 0 },
      ];
    }

    try {
      const statusCtrl = new AbortController();
      const statusTimeout = setTimeout(() => statusCtrl.abort(), 5000);
      const response = await fetch(
        `${this.config.backendUrl}/api/projects/${projectId}/status`,
        { method: 'GET', headers: this.getAuthHeaders(), signal: statusCtrl.signal }
      );
      clearTimeout(statusTimeout);

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      return data.agents || [];
    } catch (error) {
      console.error('Error getting agent status:', error);
      return [
        { name: 'orchestrator', status: 'error', progress: 0, message: 'Erreur de connexion' },
        { name: 'planner', status: 'error', progress: 0 },
        { name: 'coder', status: 'error', progress: 0 },
        { name: 'tester', status: 'error', progress: 0 },
        { name: 'executor', status: 'error', progress: 0 },
      ];
    }
  }

  /**
   * Cancel project execution
   *
   * @param projectId - Project ID
   */
  async cancelExecution(projectId: string): Promise<void> {
    const isAvailable = await this.checkBackendAvailability();

    if (!isAvailable) {
      console.warn('Backend not available, cannot cancel execution');
      return;
    }

    try {
      const cancelCtrl = new AbortController();
      const cancelTimeout = setTimeout(() => cancelCtrl.abort(), 5000);
      await fetch(
        `${this.config.backendUrl}/api/projects/${projectId}/cancel`,
        { method: 'POST', headers: this.getAuthHeaders(), signal: cancelCtrl.signal }
      );
      clearTimeout(cancelTimeout);
    } catch (error) {
      console.error('Error canceling execution:', error);
    }
  }

  /**
   * Set backend URL (for configuration)
   */
  setBackendUrl(url: string): void {
    this.config.backendUrl = url;
  }

  /**
   * Get auth headers for backend requests
   * @private
   */
  private getAuthHeaders(): Record<string, string> {
    const token = useSettingsStore.getState().getAuthToken?.();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  // ========================================================================
  // PRIVATE METHODS
  // ========================================================================

  /**
   * Plan project using backend
   * @private
   */
  private async planViaBackend(description: string): Promise<ProjectPlan> {
    try {
      const response = await fetch(
        `${this.config.backendUrl}/api/projects/plan`,
        {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ description }),
          signal: AbortSignal.timeout(this.config.timeout),
        }
      );

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      return await response.json() as ProjectPlan;
    } catch (error) {
      console.error('Backend planning failed, falling back to AI:', error);
      return this.planViaAI(description);
    }
  }

  /**
   * Plan project using AI API directly
   * @private
   */
  private async planViaAI(description: string): Promise<ProjectPlan> {
    const prompt = `Vous êtes un planificateur de projet expert. Créez un plan détaillé pour le projet suivant:

${description}

Répondez en JSON avec la structure suivante:
{
  "title": "Titre du projet",
  "overview": "Vue d'ensemble du projet",
  "files": [
    {"path": "chemin/du/fichier", "description": "Description", "type": "type"}
  ],
  "phases": [
    {"name": "Nom", "description": "Description", "duration": "Durée estimée", "tasks": ["Tâche 1"]}
  ],
  "complexity": "low|medium|high",
  "notes": "Notes additionnelles"
}`;

    try {
      const plan = await aiRouter.planProject(prompt);
      return plan as ProjectPlan;
    } catch (error) {
      console.error('AI planning failed:', error);

      // Return a minimal fallback plan
      return {
        title: 'Plan par défaut',
        overview: description,
        files: [
          {
            path: 'README.md',
            description: 'Documentation du projet',
            type: 'markdown',
          },
        ],
        phases: [
          {
            name: 'Phase 1',
            description: 'Développement initial',
            duration: '1-2 jours',
            tasks: ['Mettre en place la structure du projet'],
          },
        ],
        complexity: 'medium',
        notes: 'Plan généré en mode dégradé',
      };
    }
  }
}

// Export singleton instance
export const agentService = new AgentService();

// Export the class for testing
export { AgentService };
