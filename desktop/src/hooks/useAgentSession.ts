/**
 * useAgentSession — Hook React pour piloter le moteur agentique (Phase 1)
 *
 * Usage:
 *   const [agent, actions] = useAgentSession();
 *   actions.start({ projectRoot, projectName, task: 'Ajoute un dark mode' });
 *   // agent.events / agent.streamingText alimentent l'UI en temps réel
 *   actions.abort(); // annulation
 *
 * Multi-tours : l'historique est conservé, chaque nouveau start() sur le
 * même projet poursuit la conversation (l'agent garde le contexte).
 */

import { useCallback, useRef, useState } from 'react';
import { APIMessage, AIModel } from '@/types';
import { runAgentSession, AgentEvent, AgentStopReason } from '@/services/agent';

// ============================================================================
// TYPES
// ============================================================================

export interface AgentLogEntry {
  id: string;
  timestamp: number;
  event: AgentEvent;
}

export interface AgentSessionState {
  isRunning: boolean;
  /** Texte assistant en cours de streaming (tour actuel) */
  streamingText: string;
  /** Journal complet des événements (tool calls, résultats, checkpoints…) */
  events: AgentLogEntry[];
  /** Étape courante / max */
  currentStep: number;
  maxSteps: number;
  /** Fichiers modifiés pendant la session */
  filesChanged: string[];
  /** Résultat final */
  stopReason: AgentStopReason | null;
  summary: string;
  error: string | null;
}

export interface StartAgentOptions {
  projectRoot: string;
  projectName: string;
  task: string;
  model?: AIModel;
  fileTree?: string;
  memory?: string;
  maxSteps?: number;
  /** Repart de zéro au lieu de poursuivre la conversation */
  resetHistory?: boolean;
  onFileChanged?: (relativePath: string, content: string, action: 'create' | 'edit' | 'delete') => void;
}

export interface AgentSessionActions {
  start: (options: StartAgentOptions) => Promise<void>;
  abort: () => void;
  clear: () => void;
}

const INITIAL_STATE: AgentSessionState = {
  isRunning: false,
  streamingText: '',
  events: [],
  currentStep: 0,
  maxSteps: 0,
  filesChanged: [],
  stopReason: null,
  summary: '',
  error: null,
};

// ============================================================================
// HOOK
// ============================================================================

let logCounter = 0;

export function useAgentSession(): [AgentSessionState, AgentSessionActions] {
  const [state, setState] = useState<AgentSessionState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<APIMessage[]>([]);
  const projectRootRef = useRef<string>('');

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    historyRef.current = [];
    setState(INITIAL_STATE);
  }, []);

  const start = useCallback(async (options: StartAgentOptions) => {
    // Nouveau projet ou reset explicite → on repart de zéro
    if (options.resetHistory || projectRootRef.current !== options.projectRoot) {
      historyRef.current = [];
    }
    projectRootRef.current = options.projectRoot;

    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...INITIAL_STATE,
      isRunning: true,
      maxSteps: options.maxSteps ?? 40,
    });

    const pushEvent = (event: AgentEvent) => {
      setState((prev) => {
        const next: AgentSessionState = {
          ...prev,
          events: [...prev.events, { id: `evt-${++logCounter}`, timestamp: Date.now(), event }],
        };
        switch (event.type) {
          case 'step_start':
            next.currentStep = event.step;
            next.maxSteps = event.maxSteps;
            next.streamingText = '';
            break;
          case 'text':
            next.streamingText = prev.streamingText + event.content;
            break;
          case 'error':
            next.error = event.message;
            break;
          case 'done':
            next.stopReason = event.reason;
            next.summary = event.summary;
            break;
        }
        return next;
      });
    };

    try {
      const result = await runAgentSession({
        prompt: {
          projectName: options.projectName,
          projectRoot: options.projectRoot,
          fileTree: options.fileTree,
          memory: options.memory,
        },
        task: options.task,
        history: historyRef.current,
        model: options.model,
        maxSteps: options.maxSteps,
        signal: controller.signal,
        onEvent: pushEvent,
        onFileChanged: options.onFileChanged,
      });

      // Historique conservé pour le tour suivant (sans le system prompt)
      historyRef.current = result.messages.filter((m) => m.role !== 'system');

      setState((prev) => ({
        ...prev,
        isRunning: false,
        filesChanged: result.filesChanged,
        stopReason: result.stopReason,
        summary: result.summary,
      }));
    } catch (e: any) {
      setState((prev) => ({
        ...prev,
        isRunning: false,
        stopReason: 'error',
        error: e?.message || String(e),
      }));
    } finally {
      abortRef.current = null;
    }
  }, []);

  return [state, { start, abort, clear }];
}
