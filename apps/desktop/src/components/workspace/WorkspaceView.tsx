/**
 * WorkspaceView — LE shell ANZAR (clone ZCode).
 *
 * ┌─────────┬───────────────────────┬────────────────────────────┐
 * │Sidebar  │  Chat agent           │ Workspace                  │
 * │sessions │  (❯ user, ◆ anzar,    │ Explorateur+Éditeur /      │
 * │+ dossier│   blocs outils)       │ Terminal / Preview         │
 * └─────────┴───────────────────────┴────────────────────────────┘
 * + StatusBar : workspace · fichiers modifiés · modèle
 *
 * Un seul flux : l'utilisateur parle, l'agent agit avec ses outils.
 * Aucune détection d'intention, aucun pipeline de génération.
 */
import { useSettingsStore } from '@/stores/settingsStore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderOpen, FolderPlus, FileEdit, GitBranch, AlertTriangle } from 'lucide-react';
import { conversationUsesPersonalSpace, openPersonalSpace } from '@/services/workspace/personalSpace';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useAgentChat, type PermissionMode } from '@/hooks/useAgentChat';
import { useAccountStore } from '@/stores/accountStore';
import RechargeModal from '@/components/billing/RechargeModal';
import { LOW_BALANCE_FCFA } from '@/lib/credits';
import { formatCredits } from '@/lib/money';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import type { AIModel, Message } from '@/types';
import MessageList from '@/components/chat/MessageList';
import ChatInput from '@/components/chat/ChatInput';
import ResizableSplit from '@/components/ui/ResizableSplit';
import WorkspacePanel from './WorkspacePanel';
import QuestionPanel from '@/components/chat/QuestionPanel';
import { claimPendingPrompt } from '@/lib/pendingPrompt';
import { openWorkspaceFolder, createWorkspaceFolder } from '@/lib/openWorkspace';
import ProjectPicker from './ProjectPicker';
import { OPEN_GIT_EVENT } from './GitPanel';
import { NewWorktreeDialog } from './WorktreesDialog';
import { terminalService } from '@/services/runtime/terminal';
import { FILES_CHANGED_EVENT } from '@/services/agent/tools/fileChanges';
import { APPROVE_PLAN_EVENT } from '@/components/chat/PlanView';
import { BUILTIN_COMMANDS, type SlashCommand } from '@/components/chat/composerSuggestions';
import { listSkills } from '@/services/skills';
import { fileSystemService } from '@/services/filesystem/fileSystem';
import type { ChatAttachment } from '@/types';

import { useOffline } from '@/hooks/useOffline';
import { platform } from '@/services/runtime/programs';

export default function WorkspaceView(_props: { onlineStatus?: boolean }) {
  // U1 : le statut réseau arrive directement ici — avant, la prop par défaut
  // `true` rendait le composer utilisable hors ligne (échec à l'envoi).
  const { isOnline: onlineStatus } = useOffline();
  // Modèle : celui des Paramètres, et un changement dans la saisie devient le nouveau défaut
  const [selectedModel, setSelectedModelState] = useState<AIModel>(() => useSettingsStore.getState().settings.model || 'auto');
  const setSelectedModel = useCallback((m: AIModel) => {
    setSelectedModelState(m);
    useSettingsStore.getState().updateSettings({ model: m });
  }, []);
  // Source unique : le store de réglages (plus de localStorage parallèle).
  const permissionMode = useSettingsStore((s) => s.settings.permissionMode ?? 'auto');
  const changePermission = useCallback((m: PermissionMode) => {
    useSettingsStore.getState().updateSettings({ permissionMode: m });
  }, []);
  const balance = useAccountStore((s) => s.credits.remaining);
  const [showRecharge, setShowRecharge] = useState(false);
  const [draft, setDraft] = useState<string | undefined>(undefined);

  // ── Workspace : path depuis le projet actif (persisté) ──
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const workspacePath: string | null =
    (activeProject?.metadata?.localPath as string | undefined) || null;

  // ── Refresh workspace quand l'agent touche un fichier ──
  const [refreshKey, setRefreshKey] = useState(0);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [modifiedCount, setModifiedCount] = useState(0);

  const onFileChanged = useCallback((relativePath: string, action: 'create' | 'edit' | 'delete') => {
    setRefreshKey((k) => k + 1);
    if (action !== 'delete') setFocusFile(relativePath);
    if (action !== 'delete') setModifiedCount((n) => n + 1);
  }, []);

  // ── Carte « fichiers modifiés » : après une annulation, on relit le dossier ──
  useEffect(() => {
    const onChanged = () => setRefreshKey((k) => k + 1);
    window.addEventListener(FILES_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(FILES_CHANGED_EVENT, onChanged);
    };
  }, []);

  // ── Suggestions de la saisie : fichiers (« @ ») et commandes du projet (« / ») ──
  const [mentionFiles, setMentionFiles] = useState<string[]>([]);
  const [projectCommands, setProjectCommands] = useState<SlashCommand[]>([]);
  useEffect(() => {
    setMentionFiles([]);
    setProjectCommands([]);
    if (!workspacePath) return;
    let alive = true;
    (async () => {
      // .anzar/commands/<nom>.md : une commande par fichier, le contenu est la demande
      const dir = `${workspacePath.replace(/[\\/]+$/, '')}/.anzar/commands`;
      try {
        const nodes = await fileSystemService.readDirectoryTree(dir, 1);
        const cmds: SlashCommand[] = [];
        for (const n of nodes) {
          if (n.type !== 'file' || !n.name.endsWith('.md')) continue;
          const prompt = (await fileSystemService.readFile(n.path).catch(() => '')).trim();
          if (!prompt) continue;
          const name = n.name.replace(/\.md$/, '').toLowerCase().replace(/[^\w-]+/g, '-');
          const firstLine = prompt.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') || '';
          cmds.push({ name, description: firstLine.slice(0, 90), prompt, custom: true });
        }
        // Chaque skill est aussi une commande : /nom-de-la-skill
        const skills = await listSkills(workspacePath).catch(() => []);
        for (const sk of skills) {
          if (cmds.some((c) => c.name === sk.name)) continue;
          cmds.push({
            name: sk.name,
            description: `Skill — ${sk.description}`,
            prompt: `Charge la skill « ${sk.name} » et suis-la pour : `,
            custom: true,
          });
        }
        if (alive) setProjectCommands(cmds);
      } catch { /* pas de commandes de projet */ }
    })();
    return () => { alive = false; };
  }, [workspacePath]);
  const commands = [
    ...projectCommands,
    ...BUILTIN_COMMANDS.filter((c) => !projectCommands.some((p) => p.name === c.name)),
  ];

  // ── Agent chat ──
  const { sendMessage, stop, isGenerating, approval, resolveApproval, question, resolveQuestion, resume, setModeNow, budget } = useAgentChat({
    workspacePath,
    workspaceName: activeProject?.name,
    model: selectedModel,
    permissionMode,
    onFileChanged,
  });

  // ── Projet de la tâche affichée ──
  // Tant que la tâche est vide, on choisit librement son projet ; après le premier message il est figé.
  const attachActiveTask = useCallback((projectId: string | null) => {
    const st = useChatStore.getState();
    const conv = st.conversations.find((c) => c.id === st.activeConversationId);
    if (conv && (!conv.messages.length || !conv.projectId)) {
      useChatStore.setState((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conv.id) return c;
          const { projectId: _old, ...rest } = c;
          return projectId ? { ...rest, projectId } : rest;
        }),
      }));
    }
    useProjectStore.getState().setActiveProject(projectId);
    setRefreshKey((k) => k + 1);
    setModifiedCount(0);
  }, []);

  // ── Nouvelle worktree pour la tâche vide (sélecteur de projet) ──
  const [worktreeRepo, setWorktreeRepo] = useState<string | null>(null);

  // ── Ouverture de dossier (point d'entrée unique, sans doublon) ──
  const handleOpenFolder = useCallback(async () => {
    const id = await openWorkspaceFolder();
    if (!id) return;
    attachActiveTask(id);
  }, [attachActiveTask]);

  const handleNewFolder = useCallback(async () => {
    const id = await createWorkspaceFolder();
    if (!id) return;
    attachActiveTask(id);
    toast.success('Dossier prêt — décris ton projet dans le chat');
  }, [attachActiveTask]);

  // ── Branche git du workspace (puce d'en-tête) ──
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setBranch(null);
    if (!workspacePath) return;
    terminalService
      .exec('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, silent: true })
      .then((r) => { if (alive && r.success && r.stdout.trim()) setBranch(r.stdout.trim()); })
      .catch(() => {});
    return () => { alive = false; };
  }, [workspacePath, refreshKey]);

  // ── Prompt-first : rejoue l'idée saisie avant login ──
  const replayedRef = useRef(false);
  useEffect(() => {
    if (replayedRef.current) return;
    const pending = claimPendingPrompt();
    if (!pending) return;
    replayedRef.current = true;
    // Sans crédit, l'envoi échouerait : l'idée reste dans le champ et la recharge s'ouvre.
    if (useAccountStore.getState().credits.remaining <= 0) {
      setDraft(pending.prompt);
      setShowRecharge(true);
      return;
    }
    // Laisse la conversation s'initialiser avant l'envoi
    setTimeout(() => { void sendMessage(pending.prompt); }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Conversation ──
  const activeConversation = useActiveConversation();

  // La tâche affichée appartient à un projet : son dossier doit être ouvert,
  // sinon l'agent répondrait sans outils (redémarrage, changement de tâche…).
  const taskProjectId = activeConversation?.projectId;
  useEffect(() => {
    if (!taskProjectId || taskProjectId === activeProjectId) return;
    if (useProjectStore.getState().projects.some((p) => p.id === taskProjectId)) {
      useProjectStore.getState().setActiveProject(taskProjectId);
    }
  }, [taskProjectId, activeProjectId]);
  const createConversation = useChatStore((s) => s.createConversation);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  useEffect(() => {
    if (activeConversationId) return;
    const conv = createConversation(undefined, selectedModel);
    if (activeProjectId) {
      useChatStore.setState((st) => ({
        conversations: st.conversations.map((c) => (c.id === conv.id ? { ...c, projectId: activeProjectId } : c)),
      }));
    }
  }, [activeConversationId, activeProjectId, createConversation, selectedModel]);
  const messages: Message[] = (activeConversation?.messages || []).filter((m) => m.role !== 'tool');

  // ── Plan : le plus récent de la tâche s'affiche dans l'onglet « Plan » ──
  const latestPlan = (() => {
    const all = activeConversation?.messages || [];
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].plan) return { messageId: all[i].id, plan: all[i].plan! };
    }
    return null;
  })();

  // Valider : on quitte le mode plan (retour au mode d'avant) et l'agent exécute le plan
  const modeBeforePlan = useRef<PermissionMode>('auto');
  useEffect(() => {
    if (permissionMode !== 'plan') modeBeforePlan.current = permissionMode;
  }, [permissionMode]);
  useEffect(() => {
    const onApprove = (e: Event) => {
      const messageId = (e as CustomEvent<string>).detail;
      const msg = (useChatStore.getState().conversations
        .find((c) => c.id === useChatStore.getState().activeConversationId)?.messages || [])
        .find((m) => m.id === messageId);
      if (!msg?.plan || msg.plan.status !== 'pending' || isGenerating) return;
      useChatStore.getState().updateMessage(messageId, { plan: { ...msg.plan, status: 'approved' } });
      const next = modeBeforePlan.current;
      changePermission(next);
      setModeNow(next);
      // Le plan part en pièce jointe : bulle courte à l'écran, plan complet pour l'agent
      void sendMessage('Plan validé : exécute-le maintenant, étape par étape, puis vérifie ton travail.', [{
        id: `plan_${messageId}`,
        name: `Plan — ${msg.plan.title}.md`,
        kind: 'text',
        sizeBytes: msg.plan.markdown.length,
        excerpt: msg.plan.markdown,
      }]);
    };
    window.addEventListener(APPROVE_PLAN_EVENT, onApprove);
    return () => window.removeEventListener(APPROVE_PLAN_EVENT, onApprove);
  }, [isGenerating, changePermission, setModeNow, sendMessage]);

  const workspaceName = activeProject?.name || null;

  // Fichiers touchés par l'agent à sa dernière réponse qui a modifié quelque chose (Git → Dernier tour)
  const lastTurnPaths = useMemo(() => {
    const all = activeConversation?.messages || [];
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i];
      if (m.role === 'assistant' && m.fileChanges?.length) return m.fileChanges.map((f) => f.path);
    }
    return [];
  }, [activeConversation?.messages]);

  /** « @chemin » dans le message : le fichier est joint (5 au maximum). */
  const withMentionedFiles = useCallback(async (text: string, attachments: ChatAttachment[]) => {
    if (!workspacePath || !text.includes('@')) return attachments;
    const known = new Set(mentionFiles);
    const paths = [...new Set([...text.matchAll(/(?:^|\s)@([^\s@]+)/g)].map((m) => m[1].replace(/[.,;:!?)]+$/, '')))]
      .filter((p) => known.has(p))
      .slice(0, 5);
    const extra: ChatAttachment[] = [];
    for (const p of paths) {
      try {
        const content = await fileSystemService.readFile(`${workspacePath.replace(/[\\/]+$/, '')}/${p}`);
        extra.push({ id: `mention_${p}`, name: p, kind: 'code', sizeBytes: content.length, excerpt: content });
      } catch { /* fichier disparu : la mention reste dans le texte */ }
    }
    return [...attachments, ...extra];
  }, [workspacePath, mentionFiles]);

  // Une tâche « a travaillé sur un projet » si elle y est rattachée ou si l'agent y a déjà utilisé ses outils
  const taskProject = activeConversation?.projectId
    ? projects.find((p) => p.id === activeConversation.projectId) || null
    : null;
  const taskStarted = (activeConversation?.messages.length || 0) > 0;
  const taskNeedsFolder = !!taskProject || (activeConversation?.messages || []).some((m) => (m.toolEvents?.length || 0) > 0);

  /** Rouvre le dossier de la tâche (ou en choisit un) et y rattache la tâche. */
  const reopenTaskFolder = useCallback(async () => {
    let projectId: string | null = taskProject?.id ?? null;
    if (projectId) useProjectStore.getState().setActiveProject(projectId);
    else projectId = await openWorkspaceFolder();
    if (!projectId || !activeConversation) return;
    const convId = activeConversation.id;
    useChatStore.setState((st) => ({
      conversations: st.conversations.map((c) => (c.id === convId ? { ...c, projectId: projectId! } : c)),
    }));
    setRefreshKey((k) => k + 1);
  }, [taskProject, activeConversation]);

  // Bouton sous une réponse en erreur : reprise à l'étape coupée si possible,
  // sinon on renvoie la demande d'origine.
  const handleRetry = useCallback((assistantMessageId: string) => {
    if (isGenerating) return;
    if (resume(assistantMessageId)) return;
    const all = activeConversation?.messages || [];
    const idx = all.findIndex((m) => m.id === assistantMessageId);
    const previousUser = all.slice(0, Math.max(idx, 0)).reverse().find((m) => m.role === 'user');
    if (previousUser?.content) void sendMessage(previousUser.content);
  }, [isGenerating, resume, activeConversation, sendMessage]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      {worktreeRepo && (
        <NewWorktreeDialog
          repoPath={worktreeRepo}
          onClose={() => setWorktreeRepo(null)}
          onCreated={(id) => { setWorktreeRepo(null); attachActiveTask(id); }}
        />
      )}
      {/* ── Split chat | workspace ── */}
      <ResizableSplit
        className="flex-1"
        initialLeftPct={55}
        minLeftPct={30}
        storageKey="anzar.split.chat"
        rightHidden={!workspacePath}
        left={
          <div className="h-full min-h-0 flex flex-col overflow-hidden rounded-xl border border-border-medium bg-bg-primary">
            {/* En-tête de tâche : titre · projet · branche */}
            <div className="flex items-center gap-2 h-12 px-4 border-b border-border-subtle flex-shrink-0">
              <h1 className="text-ui-base font-semibold text-text-primary truncate min-w-0">
                {activeConversation?.title || 'Nouvelle tâche'}
              </h1>
              <button
                onClick={() => {
                  if (taskStarted && taskProject) attachActiveTask(taskProject.id);
                  else void handleOpenFolder();
                }}
                title={taskStarted && taskProject
                  ? `${String(taskProject.metadata?.localPath || '')} — le projet d'une tâche commencée ne change plus`
                  : workspacePath || 'Ouvrir un dossier pour que l\'agent puisse lire et modifier ton code'}
                className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-ui-base text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors flex-shrink-0 max-w-[40%]"
              >
                <Folder size={12} className="flex-shrink-0" />
                <span className="truncate">{workspaceName || 'Ouvrir un dossier'}</span>
              </button>
              {!workspacePath && conversationUsesPersonalSpace(activeConversation) && (
                <button
                  onClick={() => { void openPersonalSpace().catch(() => toast.error("Impossible d'ouvrir le dossier Documents/ANZAR")); }}
                  title="Ouvrir le dossier Documents/ANZAR : fichiers joints et fichiers produits par ANZAR"
                  className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-ui-base text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors flex-shrink-0"
                >
                  <FolderOpen size={12} className="flex-shrink-0" />
                  <span className="whitespace-nowrap">Espace ANZAR</span>
                </button>
              )}
              {branch && (
                <button
                  onClick={() => window.dispatchEvent(new Event(OPEN_GIT_EVENT))}
                  title="Ouvrir le panneau Git"
                  className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-ui-base text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors flex-shrink-0"
                >
                  <GitBranch size={12} />
                  {branch}
                </button>
              )}
              <div className="flex-1" />
              {modifiedCount > 0 && (
                <span className="flex items-center gap-1 text-ui-sm text-accent-success font-mono flex-shrink-0">
                  <FileEdit size={11} />
                  {modifiedCount}
                </span>
              )}
              <button
                onClick={() => void handleNewFolder()}
                className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
                title="Nouveau projet (dossier vierge)"
              >
                <FolderPlus size={14} />
              </button>
            </div>

            {/* Messages */}
            <MessageList messages={messages} isLoading={isGenerating} onRegenerateMessage={handleRetry} />

            {/* Questions de l'agent (outil ask_user) */}
            {question && (
              <QuestionPanel key={question.id} request={question} onSubmit={(a) => resolveQuestion(a)} onSkip={() => resolveQuestion(null)} />
            )}

            {/* Demande d'accord (modes « Demander » et « Modifier automatiquement ») */}
            {approval && (
              <div className="mx-4 mb-1 flex items-center gap-3 px-3 py-2 rounded-xl border border-border-medium bg-surface-elevated flex-shrink-0">
                <div className="flex-1 min-w-0">
                  <p className="text-ui-caption text-text-primary">L'agent demande ton accord</p>
                  <p className="text-ui-sm font-mono text-text-secondary truncate" title={approval.summary}>
                    {approval.name === 'run_command' ? '$ ' : `${approval.name}  `}{approval.summary}
                  </p>
                  {approval.reason && (
                    <p className="mt-0.5 text-ui-sm text-accent-warning">Vérifie avant d'autoriser : {approval.reason}.</p>
                  )}
                  {approval.detail && (
                    <pre className="mt-1 max-h-24 overflow-auto rounded-md bg-hover-fill px-2 py-1 font-mono text-ui-sm text-text-primary whitespace-pre-wrap break-all">{approval.detail}</pre>
                  )}
                  {(approval.name === 'run_command' || approval.name === 'start_dev_server') && platform() === 'windows' && (
                    <p className="mt-0.5 text-ui-sm text-text-muted">
                      Sur Windows, les commandes ne sont pas isolées : celle-ci pourra modifier tous les fichiers de ton compte. Autorise seulement si tu sais ce qu'elle fait.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => resolveApproval(false)}
                  className="h-7 px-3 rounded-lg text-ui-caption text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  Refuser
                </button>
                <button
                  onClick={() => resolveApproval(true)}
                  className="h-7 px-3 rounded-lg text-ui-caption font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity"
                >
                  Autoriser
                </button>
              </div>
            )}

            {/* Tâche qui a travaillé sur un projet, mais aucun dossier ouvert : l'agent n'a pas d'outils.
                PAS dans l'espace ANZAR (personalSpace) : l'agent y travaille bel et bien. */}
            {!workspacePath && taskNeedsFolder && !activeConversation?.personalSpace && (
              <div className="mx-4 mb-1 flex items-center gap-3 px-3 py-2 rounded-xl border border-accent-warning/30 bg-accent-warning/10 flex-shrink-0">
                <AlertTriangle size={16} className="flex-shrink-0 text-accent-warning" />
                <p className="flex-1 text-ui-caption text-text-primary">
                  Aucun dossier ouvert : l'agent ne peut ni lire, ni lancer, ni modifier quoi que ce soit dans ce projet.
                </p>
                <button
                  onClick={() => void reopenTaskFolder()}
                  className="h-7 px-3 rounded-lg text-ui-caption font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity flex-shrink-0"
                >
                  {taskProject ? `Rouvrir ${taskProject.name}` : 'Ouvrir le dossier'}
                </button>
              </div>
            )}

            {/* Solde bas : la seule alerte de coût */}
            {balance < LOW_BALANCE_FCFA && (
              <div className="mx-4 mb-1 flex items-center gap-3 px-3 py-2 rounded-xl bg-credit-soft flex-shrink-0">
                <p className="flex-1 text-ui-caption text-text-primary">
                  {balance <= 0 ? 'Solde épuisé' : 'Solde bas'} — il te reste{' '}
                  <span className="font-mono tabular-nums">{formatCredits(Math.max(0, balance))}</span>
                </p>
                <button
                  onClick={() => setShowRecharge(true)}
                  className="h-7 px-3 rounded-lg text-ui-caption font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity"
                >
                  Recharger
                </button>
              </div>
            )}
            {showRecharge && <RechargeModal onClose={() => setShowRecharge(false)} />}

            {/* Composer (+ choix du projet tant que la tâche est vide) */}
            <div className="flex-shrink-0">
              {!taskStarted && (
                <ProjectPicker
                  currentProjectId={activeProjectId}
                  onPick={attachActiveTask}
                  onOpenFolder={() => void handleOpenFolder()}
                  onNewFolder={() => void handleNewFolder()}
                  onNewWorktree={setWorktreeRepo}
                />
              )}
              <ChatInput
                draft={draft}
                onSendMessage={async (msg, attachments) => { await sendMessage(msg, await withMentionedFiles(msg, attachments || [])); }}
                mentionFiles={mentionFiles}
                commands={workspacePath ? commands : []}
                onCommand={(cmd) => { if (cmd.action === 'plan') changePermission('plan'); }}
                onStopGeneration={stop}
                isLoading={isGenerating}
                isOnline={onlineStatus}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                permissionMode={permissionMode}
                onPermissionChange={workspacePath ? changePermission : undefined}
                budget={budget}
                placeholder={workspacePath ? 'Demande à l\'agent… (@ pour un fichier, / pour une commande)' : 'Pose une question, ou ouvre un dossier pour coder…'}
              />
            </div>
          </div>
        }
        right={
          <WorkspacePanel
            workspacePath={workspacePath}
            refreshKey={refreshKey}
            focusFile={focusFile}
            onOpenFolder={() => void handleOpenFolder()}
            plan={latestPlan}
            busy={isGenerating}
            onFileList={setMentionFiles}
            lastTurnPaths={lastTurnPaths}
          />
        }
      />

    </div>
  );
}
