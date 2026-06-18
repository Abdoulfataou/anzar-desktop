/**
 * useProjectPipeline — Hook autonome pour la génération de projets.
 *
 * Extrait de ChatView.tsx pour isolation complète.
 * Gère : prepareProjectGeneration (dialog), handleImportFolder, handleProjectGeneration
 * (create project, SSE pipeline, file writing, terminal instructions).
 */
import { useCallback, useRef } from 'react';
import { AIModel, type Message } from '@/types';
import { projectGeneration, type PlanResult, type ExecutionEvent, type StepEvent, type AgentsEvent, type FileEvent } from '@/services/projectGeneration';
import { extractProjectName } from '@/services/ai/intentDetection';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { useActivityStore } from '@/stores/activityStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { documentDir } from '@tauri-apps/api/path';
import { isAllowedProjectRoot } from '@/lib/allowedProjectRoots';
import { generationTracker } from '@/services/ai/generationTracker';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

interface ProjectPipelineParams {
  selectedModel: AIModel;
  setSelectedProjectId: (id: string | null) => void;
  /** Ref for wizard metadata (projectType, techs) */
  wizardMetaRef: React.MutableRefObject<{ projectType: string; techs: string[] } | null>;
}

export function useProjectPipeline(params: ProjectPipelineParams) {
  const { selectedModel, setSelectedProjectId, wizardMetaRef } = params;
  const navigate = useNavigate();

  // ── Refs ──
  const projectBaseDirOverrideRef = useRef<string | null>(null);
  const lastProjectGenerationWasUserActionRef = useRef(false);

  // ── Store selectors ──
  const createProject = useProjectStore((s) => s.createProject);
  const updateAgentStatus = useProjectStore((s) => s.updateAgentStatus);
  const setProjectStatus = useProjectStore((s) => s.setProjectStatus);
  const setProjectProgress = useProjectStore((s) => s.setProjectProgress);
  const updateProject = useProjectStore((s) => s.updateProject);
  const addFile = useProjectStore((s) => s.addFile);
  const loadProjectFromDisk = useProjectStore((s) => s.loadProjectFromDisk);

  const addConversationMessage = useChatStore((s) => s.addMessage);
  const updateConversationMessage = useChatStore((s) => s.updateMessage);
  const setIsProjectGenerating = useChatStore((s) => s.setIsProjectGenerating);


  const startSession = useActivityStore((s) => s.startSession);
  const endSession = useActivityStore((s) => s.endSession);
  const addStep = useActivityStore((s) => s.addStep);
  const completeStep = useActivityStore((s) => s.completeStep);
  const setTodos = useActivityStore((s) => s.setTodos);
  const updateTodo = useActivityStore((s) => s.updateTodo);
  const addContextFile = useActivityStore((s) => s.addContextFile);
  const setContextPercent = useActivityStore((s) => s.setContextPercent);
  const incrementStat = useActivityStore((s) => s.incrementStat);
  const setGenerationPanelSessionId = useActivityStore((s) => s.setGenerationPanelSessionId);

  // ── Ensure active conversation helper (shared via store) ──
  const ensureActiveConversation = useCallback(() => {
    useChatStore.getState().ensureActiveConversation(selectedModel);
  }, [selectedModel]);

  // ── Prepare project generation (directory dialog) ──
  const prepareProjectGeneration = useCallback(async () => {
    lastProjectGenerationWasUserActionRef.current = true;
    projectBaseDirOverrideRef.current = null;

    try {
      const docsDir = await documentDir();
      const defaultBase = `${docsDir}ANZAR/Projects`;
      try {
        await fileSystemService.createDirectory(defaultBase);
      } catch {
        // ignore
      }

      try {
        const { confirm, open } = await import('@tauri-apps/api/dialog');
        const okDefault = await confirm(
          `Où veux-tu créer le projet ?\n\nPar défaut:\n${defaultBase}\n\nUtiliser cet emplacement ?`,
          { title: 'Emplacement du projet', type: 'info' as any }
        );
        if (okDefault) {
          projectBaseDirOverrideRef.current = defaultBase;
          return;
        }
        const selected = await open({
          directory: true,
          multiple: false,
          title: 'Choisir le dossier de sortie (dans ANZAR)',
        });
        if (selected && typeof selected === 'string') {
          const allowed = await isAllowedProjectRoot(selected);
          if (!allowed) {
            toast.error('Dossier non autorisé. Choisis un dossier dans ton répertoire personnel.');
            projectBaseDirOverrideRef.current = defaultBase;
            return;
          }
          projectBaseDirOverrideRef.current = selected.replace(/\\/g, '/').replace(/\/+$/, '');
          return;
        }
      } catch {
        // ignore - fallback default
      }

      projectBaseDirOverrideRef.current = defaultBase;
    } catch {
      projectBaseDirOverrideRef.current = null;
    }
  }, []);

  // ── Import existing folder as project ──
  const handleImportFolder = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Importer un dossier (projet existant)',
      });

      if (!selected || typeof selected !== 'string') return;

      const allowed = await isAllowedProjectRoot(selected);
      if (!allowed) {
        toast.error('Dossier non autorisé. Choisis un dossier dans ton répertoire personnel.');
        return;
      }

      const folderName = selected.split(/[/\\]/).pop() || 'Projet importé';
      const project = useProjectStore.getState().createProject(folderName, `Projet importé: ${selected}`, selectedModel);
      useProjectStore.getState().updateProject(project.id, {
        status: 'complete',
        metadata: { localPath: selected, imported: true },
      } as any);
      useProjectStore.getState().setActiveProject(project.id);
      setSelectedProjectId(project.id);
      toast.success(`Projet importé : ${folderName}`);

      try {
        const { confirm } = await import('@tauri-apps/api/dialog');
        const ok = await confirm(
          `Projet importé : ${folderName}\n\nChemin:\n${selected}\n\nOuvrir le projet maintenant ?`,
          { title: 'Projet importé', type: 'info' as any }
        );
        if (ok) navigate(`/projects/${project.id}`);
      } catch {
        // Fallback web
      }
    } catch (err) {
      console.error('Import folder failed:', err);
      ensureActiveConversation();
      const msgId = `msg_${Date.now()}`;
      const content = `Impossible d'ouvrir le selecteur de dossier. (Fonction disponible sur l'app desktop Tauri.)`;
      addConversationMessage({
        id: msgId,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        model: selectedModel,
        isError: true,
      });
      toast.error("Impossible d'importer le dossier");
    }
  }, [selectedModel, ensureActiveConversation, addConversationMessage, navigate, setSelectedProjectId]);

  // ── Main project generation handler ──
  const handleProjectGeneration = useCallback(async (
    content: string,
    userMessageId: string,
    sessionId: string,
  ) => {
    setIsProjectGenerating(true);
    const projectName = extractProjectName(content);

    setGenerationPanelSessionId(sessionId);

    const project = createProject(projectName, content, selectedModel);
    const projectId = project.id;

    // ── Create local directory ──
    let localPath: string | undefined;
    try {
      const docsDir = await documentDir();
      console.log('[ANZAR] documentDir() =', JSON.stringify(docsDir));
      const base = projectBaseDirOverrideRef.current || `${docsDir}ANZAR/Projects`;
      try {
        await fileSystemService.createDirectory(base);
      } catch {
        // ignore
      }
      localPath = `${base}/${projectName}`;
      console.log('[ANZAR] Creating project dir:', localPath);
      await fileSystemService.createDirectory(localPath);
      updateProject(projectId, { metadata: { ...project.metadata, localPath } });
      console.log('[ANZAR] Project dir created OK:', localPath);
    } catch (fsErr) {
      console.warn('[ANZAR] Could not create local project directory:', fsErr, 'localPath was:', localPath);
    }

    // AI placeholder message
    const aiMessageId = `msg_${Date.now() + 1}`;
    ensureActiveConversation();
    addConversationMessage({
      id: aiMessageId,
      role: 'assistant',
      content: `**${projectName}** - Preparation en cours...`,
      timestamp: Date.now(),
      model: selectedModel,
      isStreaming: true,
      activitySessionId: sessionId,
    });

    const startTime = Date.now();

    try {
      const planStepId = addStep(sessionId, {
        type: 'planning',
        label: 'Architecture du projet',
      });

      let lastPlan: PlanResult | null = null;
      const addedSteps = new Set<string>();
      const writtenFiles = new Set<string>();
      const receivedFiles = new Map<string, string>();

      const wizardMeta = wizardMetaRef.current;
      wizardMetaRef.current = null;

      const plan = await projectGeneration.generate(
        {
          description: content,
          project_name: projectName,
          project_type: wizardMeta?.projectType || 'other',
          tech_stack: wizardMeta?.techs || [],
        },
        {
          onPhaseChange: (phase, message) => {
            if (phase === 'planning') {
              addStep(sessionId, { type: 'planning', label: 'Planification de l\'architecture' });
              updateConversationMessage(aiMessageId, { content: `**${projectName}**\n\nPlanification de l'architecture...` });
            } else if (phase === 'planned') {
              updateConversationMessage(aiMessageId, { content: `**${projectName}**\n\n${message || 'Plan pret.'}` });
            } else if (phase === 'executing') {
              updateConversationMessage(aiMessageId, { content: `**${projectName}**\n\nGeneration du code en cours...` });
            }
          },

          onPlanReady: (p) => {
            lastPlan = p;
            completeStep(sessionId, planStepId);
            updateAgentStatus(projectId, 'planner', { status: 'done', progress: 100, message: p.files.length + ' fichiers planifies' });
            setProjectProgress(projectId, 30);

            updateProject(projectId, {
              metadata: { ...(project.metadata as any), localPath, backendProjectId: p.project_id },
            });

            generationTracker.track(projectId, p.project_id, p.title || projectName);

            const todoItems: { label: string; status: 'pending' | 'active' | 'done' }[] = [
              { label: 'Analyser la demande', status: 'done' },
              { label: 'Planifier l\'architecture', status: 'done' },
              { label: 'Generer le code (' + p.files.length + ' fichiers)', status: 'active' },
            ];
            if (p.phases && p.phases.length > 0) {
              for (const phase of p.phases) {
                todoItems.push({ label: phase.name, status: 'pending' });
              }
            }
            todoItems.push(
              { label: 'Tester et valider', status: 'pending' },
              { label: 'Ecrire les fichiers sur le PC', status: 'pending' },
            );
            setTodos(sessionId, todoItems);

            setContextPercent(sessionId, 25);
            for (const f of p.files) {
              addContextFile(sessionId, {
                path: f.path,
                type: 'file',
                status: 'reading',
              });
            }

            addStep(sessionId, { type: 'complete', label: 'Architecture: ' + p.files.length + ' fichiers planifies' });
            addStep(sessionId, { type: 'writing', label: 'Generation du code' });

            const nextContent =
              '**' + (p.title || projectName) + '**\n\n' +
              'Architecture validee - ' + p.files.length + ' fichiers prevus.\n\n' +
              'Generation du code en cours...';
            updateConversationMessage(aiMessageId, { content: nextContent });

            updateAgentStatus(projectId, 'coder', { status: 'working', progress: 10, message: 'Generation du code...' });
          },

          onAgentUpdate: (event: ExecutionEvent) => {
            // ── Handle file content events ──
            if (event.type === 'file') {
              const fileEvt = event as FileEvent;
              if (fileEvt.path && typeof fileEvt.content === 'string') {
                receivedFiles.set(fileEvt.path, fileEvt.content);
                // Immediately add file to projectStore so the Studio can display it
                // even before disk write completes
                addFile(projectId, {
                  path: fileEvt.path,
                  content: fileEvt.content,
                  language: fileEvt.path.split('.').pop() || 'text',
                  size: fileEvt.content.length,
                });
                addContextFile(sessionId, { path: fileEvt.path, type: 'file', status: 'writing' });
              }
              return;
            }

            // ── Handle step events ──
            if (event.type === 'step') {
              const step = event as StepEvent;
              const actionMap: Record<string, string> = {
                reading: 'reading',
                thinking: 'thinking',
                writing: 'writing',
                creating: 'creating',
                testing: 'testing',
                complete: 'complete',
                error: 'error',
              };
              const stepType = actionMap[step.action] || 'thinking';
              const stepKey = 'step:' + step.action + ':' + step.label;
              if (!addedSteps.has(stepKey)) {
                addedSteps.add(stepKey);
                addStep(sessionId, {
                  type: stepType as any,
                  label: step.label,
                  filePath: step.file || undefined,
                });
              }

              if (step.file) {
                if (step.action === 'writing' || step.action === 'creating') {
                  addContextFile(sessionId, { path: step.file, type: 'file', status: 'writing' });
                  incrementStat(sessionId, 'filesCreated');
                } else if (step.action === 'reading') {
                  addContextFile(sessionId, { path: step.file, type: 'file', status: 'reading' });
                }
              }
              if (step.action === 'testing') {
                updateTodo(sessionId, 'todo-' + (lastPlan ? lastPlan.phases.length + 2 : 4), 'active');
              }

              const totalFiles = lastPlan?.files.length || 10;
              const writtenCount = [...addedSteps].filter((k) => k.startsWith('step:writing:') || k.startsWith('step:creating:')).length;
              setContextPercent(sessionId, Math.min(90, 25 + Math.round((writtenCount / totalFiles) * 65)));

              if (step.action !== 'complete') {
                const nextContent =
                  '**' + (lastPlan?.title || projectName) + '**\n\n' +
                  step.label;
                updateConversationMessage(aiMessageId, { content: nextContent });
              }
              return;
            }

            // ── Handle agent status events ──
            const agentsEvent = event as AgentsEvent;
            for (const agent of agentsEvent.agents) {
              updateAgentStatus(projectId, agent.name, {
                status: agent.status === 'done' ? 'done' : agent.status === 'error' ? 'error' : agent.status === 'running' ? 'working' : 'idle',
                progress: agent.progress,
                message: agent.message || '',
              });

              if (agent.name === 'coder' && agent.status === 'done') {
                updateTodo(sessionId, 'todo-2', 'done');
              }
            }

            const totalProgress = agentsEvent.agents.reduce((sum, a) => sum + a.progress, 0);
            const overallProgress = Math.round(30 + (totalProgress / agentsEvent.agents.length) * 0.7);
            setProjectProgress(projectId, overallProgress);

            const doneAgents = agentsEvent.agents.filter((a) => a.status === 'done');
            const runningAgent = agentsEvent.agents.find((a) => a.status === 'running');
            const total = agentsEvent.agents.length;

            const statusLine = runningAgent
              ? (runningAgent.message || runningAgent.name)
              : doneAgents.length === total ? 'Finalisation...' : 'En cours...';

            const nextContent =
              '**' + (lastPlan?.title || projectName) + '**\n\n' +
              statusLine;
            updateConversationMessage(aiMessageId, { content: nextContent });
          },

          onComplete: async (backendProjectId: string) => {
            generationTracker.untrack(projectId);

            const writeTodoIdx = lastPlan ? lastPlan.phases.length + 3 : 5;

            if (localPath && backendProjectId) {
              try {
                updateTodo(sessionId, 'todo-' + writeTodoIdx, 'active');
                console.log(`[ANZAR] Batch write: ${receivedFiles.size} files, localPath=${localPath}`);
                addStep(sessionId, { type: 'writing', label: `Ecriture de ${receivedFiles.size} fichier(s) recu(s) via SSE...` });

                let filesToWrite = new Map(receivedFiles);

                if (filesToWrite.size === 0) {
                  addStep(sessionId, { type: 'reading', label: 'Aucun fichier recu via SSE — telechargement depuis le serveur...' });
                  try {
                    const serverFiles = await projectGeneration.downloadFiles(backendProjectId);
                    for (const [path, content] of Object.entries(serverFiles)) {
                      filesToWrite.set(path, content);
                    }
                    addStep(sessionId, { type: 'complete', label: `${filesToWrite.size} fichier(s) telecharge(s)` });
                  } catch (dlErr: any) {
                    const dlMsg = typeof dlErr === 'string' ? dlErr : (dlErr?.message || String(dlErr));
                    addStep(sessionId, { type: 'error', label: `Echec telechargement: ${dlMsg.slice(0, 80)}` });
                  }
                }

                let writeSuccess = 0;
                let writeErrors = 0;
                for (const [filePath, content] of filesToWrite) {
                  const fullPath = `${localPath}/${filePath}`;
                  try {
                    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
                    await fileSystemService.createDirectory(parentDir).catch(() => {});
                    await fileSystemService.writeFile(fullPath, content);
                    writtenFiles.add(filePath);
                    writeSuccess++;
                    addContextFile(sessionId, { path: filePath, type: 'file', status: 'done' });
                  } catch (writeErr: any) {
                    writeErrors++;
                    const errMsg = typeof writeErr === 'string' ? writeErr : (writeErr?.message || JSON.stringify(writeErr));
                    console.error(`[ANZAR] File write FAILED: ${fullPath}`, writeErr);
                    addStep(sessionId, { type: 'error', label: `Erreur ecriture ${filePath}: ${String(errMsg).slice(0, 80)}` });
                  }
                }

                if (writeSuccess > 0) {
                  incrementStat(sessionId, 'filesCreated', writeSuccess);
                  addStep(sessionId, { type: 'complete', label: `${writeSuccess} fichier(s) ecrit(s) sur le PC` });
                }
                if (writeErrors > 0) {
                  addStep(sessionId, { type: 'error', label: `${writeErrors} fichier(s) en erreur` });
                }
                if (writeSuccess === 0 && filesToWrite.size === 0) {
                  addStep(sessionId, { type: 'error', label: 'Aucun fichier a ecrire — le serveur n\'a rien envoye' });
                }

                updateTodo(sessionId, 'todo-' + writeTodoIdx, writeErrors === 0 ? 'done' : 'error');
                setContextPercent(sessionId, 100);

                try {
                  await loadProjectFromDisk(projectId);
                } catch {
                  // non-blocking
                }
              } catch (syncErr: any) {
                const syncMsg = typeof syncErr === 'string' ? syncErr : (syncErr?.message || String(syncErr));
                console.warn('[ANZAR] Could not sync project files:', syncErr);
                addStep(sessionId, { type: 'error', label: `Erreur sync: ${syncMsg.slice(0, 80)}` });
              }
            }
          },

          onError: (errorMsg) => {
            generationTracker.untrack(projectId);
            throw new Error(errorMsg);
          },
        },
        localPath
      );

      if (!plan) throw new Error('Erreur lors de la génération');

      // Done
      setProjectStatus(projectId, 'complete');
      setProjectProgress(projectId, 100);
      updateProject(projectId, {
        name: plan.title || projectName,
        description: plan.overview || content,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      addStep(sessionId, { type: 'complete', label: `Projet genere en ${elapsed}s` });
      endSession(sessionId, 'done');

      // Detect project type + extract dependencies
      const fileNames = plan.files.map((f: any) => f.path || f.name || '').join(' ');
      const hasPackageJson = fileNames.includes('package.json');
      const hasRequirements = fileNames.includes('requirements.txt') || fileNames.includes('Pipfile');
      const hasCargo = fileNames.includes('Cargo.toml');
      const hasIndexHtml = fileNames.includes('index.html') && !hasPackageJson;

      let depsInfo = '';
      if (hasPackageJson) {
        const pkgEntry = [...receivedFiles.entries()].find(([p]) => p.endsWith('package.json'));
        if (pkgEntry) {
          try {
            const pkg = JSON.parse(pkgEntry[1]);
            const deps = Object.keys(pkg.dependencies || {});
            const devDeps = Object.keys(pkg.devDependencies || {});
            if (deps.length > 0) {
              depsInfo += `\n\n**Dependances** (${deps.length}) : ${deps.join(', ')}`;
            }
            if (devDeps.length > 0) {
              depsInfo += `\n**Dev dependencies** (${devDeps.length}) : ${devDeps.join(', ')}`;
            }
          } catch { /* ignore */ }
        }
      } else if (hasRequirements) {
        const reqEntry = [...receivedFiles.entries()].find(([p]) => p.endsWith('requirements.txt'));
        if (reqEntry) {
          const lines = reqEntry[1].split('\n').filter((l: string) => l.trim() && !l.startsWith('#'));
          if (lines.length > 0) {
            depsInfo += `\n\n**Dependances Python** (${lines.length}) : ${lines.map((l: string) => l.split('==')[0].split('>=')[0].trim()).join(', ')}`;
          }
        }
      }

      let runCmd = 'npm run dev';
      if (hasPackageJson) {
        const pkgEntry = [...receivedFiles.entries()].find(([p]) => p.endsWith('package.json'));
        if (pkgEntry) {
          try {
            const pkg = JSON.parse(pkgEntry[1]);
            const scripts = pkg.scripts || {};
            if (scripts.dev) runCmd = 'npm run dev';
            else if (scripts.start) runCmd = 'npm start';
            else if (scripts.serve) runCmd = 'npm run serve';
          } catch { /* ignore */ }
        }
      }

      let pyEntryPoint = 'python main.py';
      if (hasRequirements) {
        if (receivedFiles.has('app.py') || [...receivedFiles.keys()].some(k => k.endsWith('/app.py'))) {
          pyEntryPoint = 'python app.py';
        } else if (receivedFiles.has('manage.py') || [...receivedFiles.keys()].some(k => k.endsWith('/manage.py'))) {
          pyEntryPoint = 'python manage.py runserver';
        }
      }

      let terminalInstructions = '';
      if (localPath) {
        if (hasPackageJson) {
          terminalInstructions =
            depsInfo +
            `\n\nInstallation et lancement automatiques en cours...`;
        } else if (hasRequirements) {
          terminalInstructions =
            depsInfo +
            `\n\n**Pour lancer le projet** :\n` +
            `\`\`\`bash\ncd "${localPath}"\npip install -r requirements.txt\n${pyEntryPoint}\n\`\`\``;
        } else if (hasCargo) {
          terminalInstructions =
            `\n\n**Pour lancer le projet** :\n` +
            `\`\`\`bash\ncd "${localPath}"\ncargo run\n\`\`\``;
        } else if (hasIndexHtml) {
          terminalInstructions =
            `\n\nOuvre \`${localPath}/index.html\` dans ton navigateur.`;
        } else {
          terminalInstructions =
            `\n\n**Emplacement** : \`${localPath}\``;
        }
      }

      const nextContent =
        `**${plan.title || projectName}** — Projet pret !\n\n` +
        `${plan.files.length} fichiers crees en ${elapsed}s.` +
        terminalInstructions;
      updateConversationMessage(aiMessageId, {
        content: nextContent,
        isStreaming: false,
        actionProjectId: projectId,
        activitySessionId: sessionId,
        routingInfo: {
          provider: 'deepseek',
          taskType: 'project_generation',
          wasFallback: false,
          reason: 'multi-agent pipeline',
        },
      });

      useProjectStore.getState().setActiveProject(projectId);
      setSelectedProjectId(projectId);
      lastProjectGenerationWasUserActionRef.current = false;

    } catch (error: any) {
      const isAbort = error?.name === 'AbortError';
      const errorMsg = error?.message || 'Erreur lors de la generation';

      generationTracker.untrack(projectId);

      addStep(sessionId, { type: 'error', label: errorMsg.slice(0, 80) });
      endSession(sessionId, 'error');
      setProjectStatus(projectId, 'error', errorMsg);

      const isCredit = /solde|insuffisant|credit|402|epuis/i.test(errorMsg);
      const nextContent = isAbort
        ? 'Generation annulee.'
        : isCredit
          ? 'Credits insuffisants. Recharge ton compte pour continuer.'
          : 'Une erreur est survenue. Verifie ta connexion et reessaie.';
      updateConversationMessage(aiMessageId, {
        content: nextContent,
        isStreaming: false,
        isError: true,
        activitySessionId: sessionId,
      });
    } finally {
      projectBaseDirOverrideRef.current = null;
      setIsProjectGenerating(false);
    }
  }, [
    selectedModel,
    createProject,
    updateAgentStatus,
    setProjectStatus,
    setProjectProgress,
    updateProject,
    loadProjectFromDisk,
    addStep,
    completeStep,
    endSession,
    setTodos,
    updateTodo,
    addContextFile,
    setContextPercent,
    incrementStat,
    ensureActiveConversation,
    addConversationMessage,
    updateConversationMessage,
    setIsProjectGenerating,
    navigate,
    setSelectedProjectId,
    setGenerationPanelSessionId,
    wizardMetaRef,
  ]);

  return {
    prepareProjectGeneration,
    handleImportFolder,
    handleProjectGeneration,
    projectBaseDirOverrideRef,
    lastProjectGenerationWasUserActionRef,
    ensureActiveConversation,
  };
}
