/**
 * useVibeCodingStudio — Hook qui pilote le VibeCodingStudio depuis ChatView.
 *
 * Encapsule :
 *  - L'état du studio (phase, plan, fichiers, agents)
 *  - La gestion du cycle de vie : planning → reviewing → generating → iterating
 *  - La réception des événements SSE pour peupler les fichiers en temps réel
 *  - L'itération par chat (modif de fichiers existants)
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import type { StudioPhase, StudioFile } from '@/components/vibecoding/VibeCodingStudio';
import type { PlanResult, ExecutionEvent, StepEvent, FileEvent, AgentsEvent, AgentUpdate } from '@/services/projectGeneration';
import { projectGeneration } from '@/services/projectGeneration';
import { extractProjectName } from '@/services/intentDetection';
import { fileSystemService } from '@/services/fileSystem';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { documentDir } from '@tauri-apps/api/path';

// ============================================================================
// TYPES
// ============================================================================

export interface VibeCodingStudioState {
  /** Est-ce que le studio est ouvert ? */
  isOpen: boolean;
  /** Phase actuelle */
  phase: StudioPhase;
  /** ID du projet (store local) */
  projectId: string;
  /** Nom du projet */
  projectName: string;
  /** Plan reçu du backend */
  plan: PlanResult | null;
  /** Fichiers en Map (path → StudioFile), mis à jour en temps réel */
  files: Map<string, StudioFile>;
  /** Liste des agents + leur statut */
  agents: AgentUpdate[];
  /** Étape courante de génération */
  currentStep: StepEvent | null;
  /** Fichier en cours de génération */
  activeGeneratingFile: string | undefined;
  /** Message d'erreur */
  errorMessage: string | undefined;
  /** Est-ce qu'une itération est en cours ? */
  isIterating: boolean;
  /** Résultat de la dernière itération (pour le chat) */
  lastIterationResult: IterationResult | null;
}

/** Résultat d'une itération renvoyé au StudioChat */
export interface IterationResult {
  success: boolean;
  modifiedFiles: string[];
  error?: string;
}

export interface VibeCodingStudioActions {
  /** Ouvre le studio et lance la planification */
  startGeneration: (description: string, meta?: { projectType?: string; techs?: string[] }) => Promise<void>;
  /** Valide le plan et lance l'exécution */
  executePlan: () => Promise<void>;
  /** Envoie un message d'itération (retourne quand terminé) */
  iterate: (message: string, fileFocus?: string) => Promise<void>;
  /** Édition manuelle d'un fichier dans l'éditeur */
  updateFile: (path: string, newContent: string) => void;
  /** Revenir à la version précédente d'un fichier */
  revertFile: (path: string) => void;
  /** Annule la génération en cours */
  cancel: () => void;
  /** Annule l'itération en cours */
  cancelIteration: () => void;
  /** Ferme le studio */
  close: () => void;
  /** Reçoit un événement SSE externe (pour compatibilité) */
  handleSSEEvent: (event: ExecutionEvent) => void;
}

// ============================================================================
// HOOK
// ============================================================================

export function useVibeCodingStudio(): [VibeCodingStudioState, VibeCodingStudioActions] {
  // ── Core state ──
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<StudioPhase>('planning');
  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [files, setFiles] = useState<Map<string, StudioFile>>(new Map());
  const [agents, setAgents] = useState<AgentUpdate[]>([]);
  const [currentStep, setCurrentStep] = useState<StepEvent | null>(null);
  const [activeGeneratingFile, setActiveGeneratingFile] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isIterating, setIsIterating] = useState(false);
  const [lastIterationResult, setLastIterationResult] = useState<IterationResult | null>(null);

  // Refs
  const localPathRef = useRef<string | undefined>();
  const planRef = useRef<PlanResult | null>(null);
  /** Backend project ID (may differ from store projectId) */
  const backendProjectIdRef = useRef<string | undefined>();

  // Store actions
  const createProject = useProjectStore(s => s.createProject);
  const updateProject = useProjectStore(s => s.updateProject);
  const setProjectStatus = useProjectStore(s => s.setProjectStatus);
  const loadProjectFromDisk = useProjectStore(s => s.loadProjectFromDisk);
  const selectedModel = useSettingsStore(s => s.settings.model);

  // ══════════════════════════════════════════════════════════════════════════
  // START GENERATION
  // ══════════════════════════════════════════════════════════════════════════

  const startGeneration = useCallback(async (
    description: string,
    meta?: { projectType?: string; techs?: string[] },
  ) => {
    const name = extractProjectName(description);
    setProjectName(name);
    setIsOpen(true);
    setPhase('planning');
    setFiles(new Map());
    setAgents([
      { name: 'planner', status: 'running', progress: 0, message: 'Planification...' },
      { name: 'coder', status: 'pending', progress: 0 },
    ]);
    setCurrentStep(null);
    setErrorMessage(undefined);

    // Create project in store
    const project = createProject(name, description, selectedModel);
    setProjectId(project.id);

    // Create local directory
    let localPath: string | undefined;
    try {
      const docsDir = await documentDir();
      const base = `${docsDir}ANZAR/Projects`;
      try { await fileSystemService.createDirectory(base); } catch { /* ok */ }
      localPath = `${base}/${name}`;
      await fileSystemService.createDirectory(localPath);
      updateProject(project.id, { metadata: { ...project.metadata, localPath } });
    } catch {
      // non-blocking
    }
    localPathRef.current = localPath;

    // ── Phase 1: Plan ──
    try {
      const planResult = await projectGeneration.plan({
        description,
        project_name: name,
        project_type: meta?.projectType || 'other',
        tech_stack: meta?.techs || [],
      });

      setPlan(planResult);
      planRef.current = planResult;

      // Pre-populate pending files
      const pendingFiles = new Map<string, StudioFile>();
      for (const f of planResult.files) {
        pendingFiles.set(f.path, {
          path: f.path,
          content: '',
          language: f.path.split('.').pop() || 'txt',
          status: 'pending',
        });
      }
      setFiles(pendingFiles);

      // Update agents
      setAgents([
        { name: 'planner', status: 'done', progress: 100, message: `${planResult.files.length} fichiers planifiés` },
        { name: 'coder', status: 'pending', progress: 0 },
      ]);

      // Save backend project id
      backendProjectIdRef.current = planResult.project_id;
      updateProject(project.id, {
        metadata: { ...(project.metadata as any), localPath, backendProjectId: planResult.project_id },
      });

      // → PlanReview
      setPhase('reviewing');

    } catch (err: any) {
      setPhase('error');
      setErrorMessage(err?.message || 'Erreur de planification');
      setAgents(prev => prev.map(a => a.name === 'planner' ? { ...a, status: 'error', message: err?.message } : a));
    }
  }, [createProject, updateProject, selectedModel]);

  // ══════════════════════════════════════════════════════════════════════════
  // EXECUTE PLAN
  // ══════════════════════════════════════════════════════════════════════════

  const executePlan = useCallback(async () => {
    if (!planRef.current) return;

    setPhase('generating');
    setAgents([
      { name: 'planner', status: 'done', progress: 100, message: 'Plan validé' },
      { name: 'coder', status: 'running', progress: 10, message: 'Génération du code...' },
    ]);

    const thePlan = planRef.current;
    const receivedFiles = new Map<string, string>();

    try {
      await projectGeneration.execute(
        thePlan.project_id,
        thePlan,
        (event: ExecutionEvent) => {
          handleSSEEvent(event);

          // Also collect files for disk write
          if (event.type === 'file') {
            const fe = event as FileEvent;
            receivedFiles.set(fe.path, fe.content);
          }
        },
        localPathRef.current,
      );

      // ── Write files to disk ──
      const localPath = localPathRef.current;
      if (localPath && receivedFiles.size > 0) {
        for (const [filePath, content] of receivedFiles) {
          try {
            const fullPath = `${localPath}/${filePath}`;
            const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
            await fileSystemService.createDirectory(parentDir).catch(() => {});
            await fileSystemService.writeFile(fullPath, content);
          } catch {
            // non-blocking
          }
        }
        try { await loadProjectFromDisk(projectId); } catch { /* ok */ }
      }

      // ── Download fallback if no SSE files ──
      if (receivedFiles.size === 0 && localPath) {
        try {
          const serverFiles = await projectGeneration.downloadFiles(thePlan.project_id);
          for (const [filePath, content] of Object.entries(serverFiles)) {
            setFiles(prev => {
              const next = new Map(prev);
              next.set(filePath, { path: filePath, content, language: filePath.split('.').pop() || 'txt', status: 'done' });
              return next;
            });
            // Write to disk
            try {
              const fullPath = `${localPath}/${filePath}`;
              const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
              await fileSystemService.createDirectory(parentDir).catch(() => {});
              await fileSystemService.writeFile(fullPath, content);
            } catch { /* ok */ }
          }
        } catch { /* ok */ }
      }

      // Done!
      setPhase('iterating');
      setProjectStatus(projectId, 'complete');
      setAgents([
        { name: 'planner', status: 'done', progress: 100, message: 'Plan validé' },
        { name: 'coder', status: 'done', progress: 100, message: `${receivedFiles.size || files.size} fichiers générés` },
      ]);
      setCurrentStep(null);

    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setPhase('error');
        setErrorMessage('Génération annulée');
      } else {
        setPhase('error');
        setErrorMessage(err?.message || 'Erreur de génération');
      }
      setAgents(prev => prev.map(a => a.name === 'coder' ? { ...a, status: 'error', message: err?.message } : a));
    }
  }, [projectId, files.size, setProjectStatus, loadProjectFromDisk]);

  // ══════════════════════════════════════════════════════════════════════════
  // HANDLE SSE EVENTS (for live updates)
  // ══════════════════════════════════════════════════════════════════════════

  const handleSSEEvent = useCallback((event: ExecutionEvent) => {
    if (event.type === 'file') {
      const fe = event as FileEvent;
      setFiles(prev => {
        const next = new Map(prev);
        next.set(fe.path, {
          path: fe.path,
          content: fe.content,
          language: fe.path.split('.').pop() || 'txt',
          status: 'done',
        });
        return next;
      });
      setActiveGeneratingFile(undefined);
      return;
    }

    if (event.type === 'step') {
      const step = event as StepEvent;
      setCurrentStep(step);

      if (step.file && (step.action === 'writing' || step.action === 'creating')) {
        setActiveGeneratingFile(step.file);
        setFiles(prev => {
          const next = new Map(prev);
          const existing = next.get(step.file!);
          if (existing && existing.status !== 'done') {
            next.set(step.file!, { ...existing, status: 'generating' });
          }
          return next;
        });
      }

      // Update progress based on file count
      if (step.action === 'complete') {
        setCurrentStep(null);
      }
      return;
    }

    if (event.type === 'agents') {
      const ae = event as AgentsEvent;
      setAgents(ae.agents);
    }
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // ITERATE (chat-driven modifications)
  // ══════════════════════════════════════════════════════════════════════════

  const iterateAbortRef = useRef<AbortController | null>(null);

  const iterate = useCallback(async (message: string, fileFocus?: string) => {
    const bpId = backendProjectIdRef.current;
    if (!bpId) {
      setLastIterationResult({ success: false, modifiedFiles: [], error: 'Aucun projet backend associé' });
      return;
    }

    // Abort any previous iteration
    iterateAbortRef.current?.abort();
    const abortController = new AbortController();
    iterateAbortRef.current = abortController;

    setIsIterating(true);
    setLastIterationResult(null);

    // Build current files dict for context — filter empty/placeholder files
    const currentFiles: Record<string, string> = {};
    files.forEach((f, path) => {
      if (f.content && f.content.trim().length > 5) {
        currentFiles[path] = f.content;
      }
    });

    const modifiedPaths: string[] = [];
    let encounteredError = false;
    let errorMsg = '';

    try {
      await projectGeneration.iterate(
        bpId,
        message,
        currentFiles,
        (event) => {
          // Reuse same SSE handler for step + file events
          if (event.type === 'file') {
            const fe = event as FileEvent;
            modifiedPaths.push(fe.path);

            // Update file in state with 'modified' status
            setFiles(prev => {
              const next = new Map(prev);
              const existing = next.get(fe.path);
              next.set(fe.path, {
                path: fe.path,
                content: fe.content,
                language: fe.path.split('.').pop() || 'txt',
                status: 'modified',
                previousContent: existing?.content,
              });
              return next;
            });

            // Write to disk
            const localPath = localPathRef.current;
            if (localPath) {
              const fullPath = `${localPath}/${fe.path}`;
              const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
              fileSystemService.createDirectory(parentDir).catch(() => {});
              fileSystemService.writeFile(fullPath, fe.content).catch(() => {});
            }
          }

          if (event.type === 'step') {
            const step = event as StepEvent;
            setCurrentStep(step);
            if (step.action === 'error') {
              encounteredError = true;
              errorMsg = step.label || 'Erreur côté serveur';
            }
            if (step.action === 'complete') {
              setCurrentStep(null);
            }
          }
        },
        fileFocus,
        abortController.signal,
      );

      if (encounteredError) {
        setLastIterationResult({ success: false, modifiedFiles: modifiedPaths, error: errorMsg });
      } else {
        setLastIterationResult({ success: true, modifiedFiles: modifiedPaths });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setLastIterationResult({ success: false, modifiedFiles: modifiedPaths, error: 'Itération annulée' });
      } else {
        const msg = err?.message || 'Erreur lors de l\'itération';
        setLastIterationResult({ success: false, modifiedFiles: modifiedPaths, error: msg });
      }
    } finally {
      setIsIterating(false);
      if (iterateAbortRef.current === abortController) {
        iterateAbortRef.current = null;
      }
    }
  }, [files, projectId]);

  // ══════════════════════════════════════════════════════════════════════════
  // UPDATE FILE (manual edit)
  // ══════════════════════════════════════════════════════════════════════════

  const updateFile = useCallback((path: string, newContent: string) => {
    setFiles(prev => {
      const next = new Map(prev);
      const existing = next.get(path);
      if (existing) {
        next.set(path, { ...existing, content: newContent, status: 'modified' });
      }
      return next;
    });

    // Debounced write to disk
    const localPath = localPathRef.current;
    if (localPath) {
      const fullPath = `${localPath}/${path}`;
      fileSystemService.writeFile(fullPath, newContent).catch(() => {});
    }
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // REVERT FILE (undo last iteration on a file)
  // ══════════════════════════════════════════════════════════════════════════

  const revertFile = useCallback((path: string) => {
    setFiles(prev => {
      const next = new Map(prev);
      const existing = next.get(path);
      if (existing?.previousContent) {
        next.set(path, {
          ...existing,
          content: existing.previousContent,
          previousContent: undefined,
          status: 'done',
        });

        // Write reverted content to disk
        const localPath = localPathRef.current;
        if (localPath) {
          const fullPath = `${localPath}/${path}`;
          fileSystemService.writeFile(fullPath, existing.previousContent).catch(() => {});
        }
      }
      return next;
    });
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // CANCEL / CLOSE
  // ══════════════════════════════════════════════════════════════════════════

  const cancel = useCallback(() => {
    projectGeneration.abort();
    setPhase('error');
    setErrorMessage('Génération annulée par l\'utilisateur');
  }, []);

  const close = useCallback(() => {
    if (phase === 'generating') {
      projectGeneration.abort();
    }
    setIsOpen(false);
    setPhase('planning');
    setPlan(null);
    setFiles(new Map());
    setAgents([]);
    setCurrentStep(null);
    setErrorMessage(undefined);
  }, [phase]);

  // ══════════════════════════════════════════════════════════════════════════
  // RETURN
  // ══════════════════════════════════════════════════════════════════════════

  const state: VibeCodingStudioState = {
    isOpen,
    phase,
    projectId,
    projectName,
    plan,
    files,
    agents,
    currentStep,
    activeGeneratingFile,
    errorMessage,
    isIterating,
    lastIterationResult,
  };

  const actions: VibeCodingStudioActions = {
    startGeneration,
    executePlan,
    iterate,
    updateFile,
    revertFile,
    cancel,
    cancelIteration: () => { iterateAbortRef.current?.abort(); },
    close,
    handleSSEEvent,
  };

  return [state, actions];
}
