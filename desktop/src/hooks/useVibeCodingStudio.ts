/**
 * useVibeCodingStudio — Hook qui pilote le VibeCodingStudio depuis ChatView.
 *
 * Encapsule :
 *  - L'état du studio (phase, plan, fichiers, agents)
 *  - La gestion du cycle de vie : planning → reviewing → generating → iterating
 *  - La réception des événements SSE pour peupler les fichiers en temps réel
 *  - L'itération par chat (modif de fichiers existants)
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { StudioPhase, StudioFile } from '@/components/vibecoding/VibeCodingStudio';
import type { PlanResult, ExecutionEvent, StepEvent, FileEvent, AgentsEvent, AgentUpdate } from '@/services/projectGeneration';
import { projectGeneration } from '@/services/projectGeneration';
import { extractProjectName } from '@/services/ai/intentDetection';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { documentDir } from '@tauri-apps/api/path';
import { terminalService, onTerminalError, type TerminalErrorEvent } from '@/services/terminal';
import { codeIndexer, type ProjectIndex } from '@/services/filesystem/codeIndexer';
import { lintResolver } from '@/services/filesystem/lintResolver';
import { iterationMemory } from '@/services/studio/iterationMemory';
import { studioTodoManager } from '@/services/studio/studioTodoManager';
import { iterationRouter } from '@/services/studio/iterationRouter';
import type { IterationMode } from '@/services/studio/iterationRouter';

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
  /** Chemin local du projet */
  projectPath: string | undefined;
  /** Auto-fix state */
  autoFix: {
    isRunning: boolean;
    attempt: number;
    maxAttempts: number;
    lastError: string | null;
  };
  /** Git state */
  git: {
    initialized: boolean;
    commitCount: number;
    canRollback: boolean;
  };
  /** Code Knowledge Graph stats */
  ckg: {
    indexed: boolean;
    totalSymbols: number;
    totalFiles: number;
    languages: Record<string, number>;
  };
  /** Deploy (build) state */
  deploy: {
    status: 'idle' | 'building' | 'success' | 'error';
    output: string;
    durationMs: number;
    bundleSize: string | null;
  };
}

/** Résultat d'une itération renvoyé au StudioChat */
export interface IterationResult {
  success: boolean;
  modifiedFiles: string[];
  /** Files that depend on modified files and may need attention */
  affectedFiles?: string[];
  error?: string;
}

export interface VibeCodingStudioActions {
  /** Ouvre le studio et lance la planification */
  startGeneration: (description: string, meta?: { projectType?: string; techs?: string[] }) => Promise<void>;
  /** Valide le plan et lance l'exécution */
  executePlan: () => Promise<void>;
  /** Envoie un message d'itération (retourne quand terminé) */
  iterate: (message: string, fileFocus?: string, mode?: IterationMode) => Promise<void>;
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
  /** Arrêter l'auto-fix loop */
  stopAutoFix: () => void;
  /** Rollback: annuler la dernière itération (git reset --hard HEAD~1) */
  rollback: () => Promise<void>;
  /** Lancer npm run build et capturer le résultat */
  deploy: () => Promise<void>;
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

      // Create todo list from plan
      studioTodoManager.fromPlan(planResult, name);
      // Mark "Analyser le plan" as done immediately
      const todoItems = studioTodoManager.getItems();
      if (todoItems.length > 0) {
        studioTodoManager.updateTask(todoItems[0].id, 'done');
      }

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

      // Done! End todo session for generation
      studioTodoManager.endSession();
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
      // Todo: mark file as done
      studioTodoManager.markDoneByFile(fe.path);
      return;
    }

    if (event.type === 'step') {
      const step = event as StepEvent;
      setCurrentStep(step);

      if (step.file && (step.action === 'writing' || step.action === 'creating')) {
        setActiveGeneratingFile(step.file);
        // Todo: mark file as running
        studioTodoManager.markRunningByFile(step.file);
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
  // iterationMemory handles history + auto-compaction (replaces raw ref)
  const projectIndexRef = useRef<ProjectIndex | null>(null);

  const iterate = useCallback(async (message: string, fileFocus?: string, mode: IterationMode = 'iterate') => {
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

    // ── Todo: create iteration tasks ──
    const todoIds = studioTodoManager.fromIteration(message, fileFocus || undefined);
    // Mark "Analyser la demande" as running
    if (todoIds.length > 0) studioTodoManager.updateTask(todoIds[0], 'running');

    // ── Git: snapshot before iteration ──
    await gitSnapshotBeforeIterate();

    // Build current files dict for context — filter empty/placeholder files
    const allFiles: Record<string, string> = {};
    files.forEach((f, path) => {
      if (f.content && f.content.trim().length > 5) {
        allFiles[path] = f.content;
      }
    });

    // ── CKG: index project and build smart context ──
    // Only send relevant files to the backend (saves tokens on large projects)
    let currentFiles = allFiles;
    let projectMap = '';
    try {
      const idx = codeIndexer.indexProject(allFiles);
      projectIndexRef.current = idx;
      const smart = codeIndexer.buildSmartContext(idx, message, allFiles);
      projectMap = smart.projectMap;

      // Filter to relevant files only (CKG-selected + fileFocus + config files)
      if (smart.relevantFiles.length > 0) {
        const relevantSet = new Set(smart.relevantFiles);
        // Always include fileFocus if specified
        if (fileFocus) relevantSet.add(fileFocus);
        // Always include key config files
        for (const key of Object.keys(allFiles)) {
          if (/^(package\.json|tsconfig\.json|vite\.config\.\w+|tailwind\.config\.\w+|\.env|next\.config\.\w+)$/i.test(key.split('/').pop() || '')) {
            relevantSet.add(key);
          }
        }
        const filtered: Record<string, string> = {};
        for (const path of relevantSet) {
          if (allFiles[path]) filtered[path] = allFiles[path];
        }
        // Only use filtered set if it's meaningfully smaller (>30% reduction)
        if (Object.keys(filtered).length < Object.keys(allFiles).length * 0.7) {
          currentFiles = filtered;
          console.log(`[CKG] Smart context: ${Object.keys(filtered).length}/${Object.keys(allFiles).length} files sent`);
        }
      }

      // Prefix the message with the project map for better AI context
      if (projectMap) {
        message = `[Project Map]\n${codeIndexer.generateProjectMap(idx)}\n\n[User Request]\n${message}`;
      }
    } catch {
      // CKG failure is non-blocking — fallback to raw context
    }

    // ── Multi-Agent Routing: auto-detect optimal mode ──
    const isAutoFix = message.startsWith('🔧') || message.includes('auto-fix') || message.includes('LINT AUTO-FIX');
    const routeResult = iterationRouter.route(message, false, isAutoFix);
    const effectiveMode: IterationMode = mode !== 'iterate' ? mode as IterationMode : routeResult.mode;

    const modifiedPaths: string[] = [];
    let encounteredError = false;
    let errorMsg = '';

    // Record user message in memory (auto-compacts if needed)
    iterationMemory.push('user', message);

    // Todo: mark analysis done, modifications running
    if (todoIds.length > 0) studioTodoManager.updateTask(todoIds[0], 'done');
    if (todoIds.length > 1) studioTodoManager.updateTask(todoIds[1], 'running');
    // "Appliquer les modifications" is at index 2 (or 1 if no fileFocus)
    const applyIdx = fileFocus ? 2 : 1;
    if (todoIds.length > applyIdx) studioTodoManager.updateTask(todoIds[applyIdx], 'running');

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
        iterationMemory.getHistoryWithoutLast(), // Send compacted history WITHOUT current message
        effectiveMode,
      );

      // Record assistant response summary in history
      if (modifiedPaths.length > 0) {
        iterationMemory.push('assistant', `Fichiers modifiés: ${modifiedPaths.join(', ')}`);
      }

      if (encounteredError) {
        setLastIterationResult({ success: false, modifiedFiles: modifiedPaths, error: errorMsg });
      } else {
        // ── CKG: detect affected files (dependents of modified files) ──
        let affectedFiles: string[] = [];
        if (projectIndexRef.current && modifiedPaths.length > 0) {
          const affectedSet = new Set<string>();
          for (const modPath of modifiedPaths) {
            const deps = codeIndexer.findAffectedFiles(projectIndexRef.current, modPath, 1);
            deps.forEach(d => {
              if (!modifiedPaths.includes(d)) affectedSet.add(d);
            });
          }
          affectedFiles = Array.from(affectedSet);
        }
        setLastIterationResult({ success: true, modifiedFiles: modifiedPaths, affectedFiles });
        studioTodoManager.endSession();
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
  // AUTO-FIX LOOP — capture terminal errors → AI fix → re-run
  // ══════════════════════════════════════════════════════════════════════════

  const MAX_AUTOFIX_ATTEMPTS = 3;
  const [autoFixState, setAutoFixState] = useState({
    isRunning: false,
    attempt: 0,
    maxAttempts: MAX_AUTOFIX_ATTEMPTS,
    lastError: null as string | null,
  });
  const autoFixEnabledRef = useRef(true);
  const autoFixAttemptRef = useRef(0);

  const stopAutoFix = useCallback(() => {
    autoFixEnabledRef.current = false;
    autoFixAttemptRef.current = 0;
    setAutoFixState(prev => ({ ...prev, isRunning: false, attempt: 0, lastError: null }));
  }, []);

  // Listen to terminal errors and trigger auto-fix
  useEffect(() => {
    if (!isOpen || phase !== 'iterating') return;

    const unsub = onTerminalError(async (error: TerminalErrorEvent) => {
      // Guards
      if (!autoFixEnabledRef.current) return;
      if (isIterating) return; // Already iterating, don't stack
      if (autoFixAttemptRef.current >= MAX_AUTOFIX_ATTEMPTS) {
        setAutoFixState(prev => ({
          ...prev,
          isRunning: false,
          lastError: `Max ${MAX_AUTOFIX_ATTEMPTS} tentatives atteint. Corrige manuellement.`,
        }));
        return;
      }

      // ── Lint Resolver: parse structured errors from terminal output ──
      const lintResult = lintResolver.parse(error.errorOutput);

      // Fallback: check for actionable errors even if lint resolver found nothing
      if (lintResult.errorCount === 0) {
        const errorLower = error.errorOutput.toLowerCase();
        const isActionable =
          /error|failed|cannot find|module not found|syntaxerror|typeerror|referenceerror|importerror|modulenotfounderror|enoent|eacces|unexpected token|compilation failed/i.test(errorLower);
        if (!isActionable) return;
      }

      // Start auto-fix
      autoFixAttemptRef.current += 1;
      const attempt = autoFixAttemptRef.current;

      setAutoFixState({
        isRunning: true,
        attempt,
        maxAttempts: MAX_AUTOFIX_ATTEMPTS,
        lastError: lintResult.errorCount > 0
          ? `${lintResult.errorCount} erreur(s) dans ${lintResult.affectedFiles.length} fichier(s)`
          : error.errorOutput.slice(0, 200),
      });

      // Build fix prompt — use structured lint summary if available
      let fixPrompt: string;
      let fixMode: 'iterate' | 'patch' = 'iterate';

      if (lintResult.errorCount > 0) {
        // Structured errors detected → use patch mode for precise, token-efficient fixes
        fixPrompt = lintResolver.buildFixPrompt(lintResult, attempt, MAX_AUTOFIX_ATTEMPTS, error.command);
        fixMode = 'patch';
      } else {
        // Fallback: raw error output (no structured parsing possible)
        fixPrompt = [
          `🔧 AUTO-FIX (tentative ${attempt}/${MAX_AUTOFIX_ATTEMPTS})`,
          '',
          `La commande \`${error.command}\` a échoué (code ${error.exitCode}).`,
          '',
          'Voici l\'erreur complète:',
          '```',
          error.errorOutput.slice(-3000),
          '```',
          '',
          'Analyse cette erreur et corrige les fichiers concernés.',
          'Corrige UNIQUEMENT ce qui cause l\'erreur, ne modifie rien d\'autre.',
        ].join('\n');
      }

      try {
        // Focus on first affected file if detected
        const focusFile = lintResult.affectedFiles[0] || undefined;
        await iterate(fixPrompt, focusFile, fixMode);

        setAutoFixState(prev => ({
          ...prev,
          isRunning: false,
          lastError: null,
        }));
      } catch {
        setAutoFixState(prev => ({
          ...prev,
          isRunning: false,
          lastError: 'Échec de l\'auto-fix',
        }));
      }
    });

    return unsub;
  }, [isOpen, phase, isIterating, iterate]);

  // Reset auto-fix counter + iteration memory when generation completes (new project = fresh state)
  useEffect(() => {
    if (phase === 'iterating') {
      autoFixAttemptRef.current = 0;
      autoFixEnabledRef.current = true;
      iterationMemory.clear();
    }
  }, [phase]);

  // ══════════════════════════════════════════════════════════════════════════
  // GIT INTEGRATION — auto-commit before iterations, rollback
  // ══════════════════════════════════════════════════════════════════════════

  const [gitState, setGitState] = useState({
    initialized: false,
    commitCount: 0,
    canRollback: false,
  });

  /** Initialize git repo + first commit when generation completes */
  useEffect(() => {
    if (phase !== 'iterating' || !localPathRef.current || gitState.initialized) return;

    const initGit = async () => {
      const path = localPathRef.current!;
      try {
        // Check if already a git repo
        const isRepo = await terminalService.gitIsRepo(path);
        if (!isRepo) {
          await terminalService.gitInit(path);
        }
        // Initial commit with all generated files
        await terminalService.gitCommit(path, 'ANZAR: generation initiale');
        const count = await terminalService.gitCommitCount(path);
        setGitState({ initialized: true, commitCount: count, canRollback: count > 1 });
      } catch {
        // Git not available or failed — non-blocking
        setGitState({ initialized: false, commitCount: 0, canRollback: false });
      }
    };

    initGit();
  }, [phase, gitState.initialized]);

  /** Auto-snapshot before each iterate — called inside iterate() */
  const gitSnapshotBeforeIterate = useCallback(async () => {
    const path = localPathRef.current;
    if (!path || !gitState.initialized) return;
    try {
      const result = await terminalService.gitCommit(path, `ANZAR: avant iteration ${Date.now()}`);
      if (result.success) {
        const count = await terminalService.gitCommitCount(path);
        setGitState(prev => ({ ...prev, commitCount: count, canRollback: count > 1 }));
      }
    } catch {
      // non-blocking
    }
  }, [gitState.initialized]);

  /** Rollback: git reset --hard HEAD~1 + reload files from disk */
  const rollback = useCallback(async () => {
    const path = localPathRef.current;
    if (!path || !gitState.canRollback) return;

    try {
      const result = await terminalService.gitRollback(path);
      if (result.success) {
        // Reload files from disk into studio state
        const diskFiles = await fileSystemService.readProjectFiles(path);
        const newFiles = new Map<string, StudioFile>();
        for (const pf of diskFiles) {
          newFiles.set(pf.path, {
            path: pf.path,
            content: pf.content,
            language: pf.path.split('.').pop() || 'txt',
            status: 'done',
          });
        }
        setFiles(newFiles);

        const count = await terminalService.gitCommitCount(path);
        setGitState(prev => ({ ...prev, commitCount: count, canRollback: count > 1 }));
      }
    } catch {
      // non-blocking
    }
  }, [gitState.canRollback]);

  // ══════════════════════════════════════════════════════════════════════════
  // DEPLOY — npm run build + bundle aperçu
  // ══════════════════════════════════════════════════════════════════════════

  const [deployState, setDeployState] = useState({
    status: 'idle' as 'idle' | 'building' | 'success' | 'error',
    output: '',
    durationMs: 0,
    bundleSize: null as string | null,
  });

  const deployProject = useCallback(async () => {
    const path = localPathRef.current;
    if (!path || deployState.status === 'building') return;

    setDeployState({ status: 'building', output: '', durationMs: 0, bundleSize: null });

    try {
      // Use exec() to get structured result (stdout/stderr + exit code)
      const result = await terminalService.exec('npm run build', { cwd: path, timeout: 120_000 });

      if (result.success) {
        // Try to extract bundle size from build output
        let bundleSize: string | null = null;
        const sizeMatch = result.stdout.match(/(?:total|bundle|gzip|dist|build)\s*[:\-]?\s*([\d.]+\s*[KMG]?B)/i);
        if (sizeMatch) {
          bundleSize = sizeMatch[1];
        }

        setDeployState({
          status: 'success',
          output: result.stdout || 'Build réussi.',
          durationMs: result.durationMs,
          bundleSize,
        });
      } else {
        setDeployState({
          status: 'error',
          output: result.stderr || result.stdout || 'Build échoué.',
          durationMs: result.durationMs,
          bundleSize: null,
        });
      }
    } catch (err: any) {
      setDeployState({
        status: 'error',
        output: err?.message || 'Erreur lors du build.',
        durationMs: 0,
        bundleSize: null,
      });
    }
  }, [deployState.status]);

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
    projectPath: localPathRef.current,
    autoFix: autoFixState,
    git: gitState,
    ckg: {
      indexed: projectIndexRef.current !== null,
      totalSymbols: projectIndexRef.current?.stats.totalSymbols || 0,
      totalFiles: projectIndexRef.current?.stats.totalFiles || 0,
      languages: projectIndexRef.current?.stats.languages || {},
    },
    deploy: deployState,
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
    stopAutoFix,
    rollback,
    deploy: deployProject,
  };

  return [state, actions];
}
