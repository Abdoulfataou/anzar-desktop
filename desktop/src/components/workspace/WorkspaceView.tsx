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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, FolderPlus, FileEdit, GitBranch } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useAgentChat, type PermissionMode } from '@/hooks/useAgentChat';
import { useAccountStore } from '@/stores/accountStore';
import RechargeModal from '@/components/billing/RechargeModal';
import { LOW_BALANCE_FCFA } from '@/lib/credits';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import type { AIModel, Message } from '@/types';
import MessageList from '@/components/chat/MessageList';
import ChatInput from '@/components/chat/ChatInput';
import ResizableSplit from '@/components/ui/ResizableSplit';
import WorkspacePanel from './WorkspacePanel';
import { claimPendingPrompt } from '@/lib/pendingPrompt';
import { openWorkspaceFolder, createWorkspaceFolder } from '@/lib/openWorkspace';
import { terminalService } from '@/services/terminal';

export default function WorkspaceView({ onlineStatus = true }: { onlineStatus?: boolean }) {
  const [selectedModel, setSelectedModel] = useState<AIModel>('fast');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    try {
      const saved = localStorage.getItem('anzar.permissionMode');
      return saved === 'ask' || saved === 'auto' || saved === 'plan' || saved === 'full' ? saved : 'full';
    } catch { return 'full'; }
  });
  const changePermission = useCallback((m: PermissionMode) => {
    setPermissionMode(m);
    try { localStorage.setItem('anzar.permissionMode', m); } catch { /* stockage indisponible */ }
  }, []);
  const balance = useAccountStore((s) => s.credits.remaining);
  const [showRecharge, setShowRecharge] = useState(false);

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

  // ── Agent chat ──
  const { sendMessage, stop, isGenerating, approval, resolveApproval } = useAgentChat({
    workspacePath,
    workspaceName: activeProject?.name,
    model: selectedModel,
    permissionMode,
    onFileChanged,
  });

  // ── Ouverture de dossier (point d'entrée unique, sans doublon) ──
  const handleOpenFolder = useCallback(async () => {
    const id = await openWorkspaceFolder();
    if (!id) return;
    setRefreshKey((k) => k + 1);
    setModifiedCount(0);
  }, []);

  const handleNewFolder = useCallback(async () => {
    const id = await createWorkspaceFolder();
    if (!id) return;
    setRefreshKey((k) => k + 1);
    setModifiedCount(0);
    toast.success('Dossier prêt — décris ton projet dans le chat');
  }, []);

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
    // Laisse la conversation s'initialiser avant l'envoi
    setTimeout(() => { void sendMessage(pending.prompt); }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Conversation ──
  const activeConversation = useActiveConversation();
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

  const workspaceName = activeProject?.name || null;

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* ── Split chat | workspace ── */}
      <ResizableSplit
        className="flex-1"
        initialLeftPct={38}
        minLeftPct={24}
        left={
          <div className="h-full min-h-0 flex flex-col border-r border-border-subtle">
            {/* En-tête de tâche : titre · projet · branche */}
            <div className="flex items-center gap-2 h-11 px-4 border-b border-border-subtle flex-shrink-0">
              <h1 className="text-[13.5px] font-semibold text-text-primary truncate min-w-0">
                {activeConversation?.title || 'Nouvelle tâche'}
              </h1>
              <button
                onClick={() => void handleOpenFolder()}
                title={workspacePath || 'Ouvrir un dossier pour que l\'agent puisse lire et modifier ton code'}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-bg-tertiary text-[12.5px] text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 max-w-[40%]"
              >
                <Folder size={12} className="flex-shrink-0" />
                <span className="truncate">{workspaceName || 'Ouvrir un dossier'}</span>
              </button>
              {branch && (
                <span className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-bg-tertiary text-[12.5px] text-text-secondary flex-shrink-0">
                  <GitBranch size={12} />
                  {branch}
                </span>
              )}
              <div className="flex-1" />
              {modifiedCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-accent-success font-mono flex-shrink-0">
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
            <MessageList messages={messages} isLoading={isGenerating} />

            {/* Demande d'accord (modes « Demander » et « Modifier automatiquement ») */}
            {approval && (
              <div className="mx-4 mb-1 flex items-center gap-3 px-3 py-2 rounded-xl border border-border-medium bg-surface-elevated flex-shrink-0">
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] text-text-primary">L'agent demande ton accord</p>
                  <p className="text-[11.5px] font-mono text-text-secondary truncate" title={approval.summary}>
                    {approval.name === 'run_command' ? '$ ' : `${approval.name}  `}{approval.summary}
                  </p>
                </div>
                <button
                  onClick={() => resolveApproval(false)}
                  className="h-7 px-3 rounded-lg text-[12.5px] text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  Refuser
                </button>
                <button
                  onClick={() => resolveApproval(true)}
                  className="h-7 px-3 rounded-lg text-[12.5px] font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity"
                >
                  Autoriser
                </button>
              </div>
            )}

            {/* Solde bas : la seule alerte de coût */}
            {balance < LOW_BALANCE_FCFA && (
              <div className="mx-4 mb-1 flex items-center gap-3 px-3 py-2 rounded-xl bg-credit-soft flex-shrink-0">
                <p className="flex-1 text-[12.5px] text-text-primary">
                  {balance <= 0 ? 'Solde épuisé' : 'Solde bas'} — il te reste{' '}
                  <span className="font-mono tabular-nums">{Math.max(0, Math.round(balance)).toLocaleString('fr-FR')} FCFA</span>
                </p>
                <button
                  onClick={() => setShowRecharge(true)}
                  className="h-7 px-3 rounded-lg text-[12.5px] font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity"
                >
                  Recharger
                </button>
              </div>
            )}
            {showRecharge && <RechargeModal onClose={() => setShowRecharge(false)} />}

            {/* Composer */}
            <div className="flex-shrink-0">
              <ChatInput
                onSendMessage={async (msg, attachments) => { await sendMessage(msg, attachments); }}
                onStopGeneration={stop}
                isLoading={isGenerating}
                isOnline={onlineStatus}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                permissionMode={permissionMode}
                onPermissionChange={workspacePath ? changePermission : undefined}
                placeholder={workspacePath ? 'Demande à l\'agent de lire, modifier ou exécuter…' : 'Pose une question, ou ouvre un dossier pour coder…'}
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
          />
        }
      />

      {/* ── StatusBar (ZCode) ── */}
      <div className="h-6 flex items-center gap-4 px-3 border-t border-border-subtle bg-bg-secondary/50 text-[10.5px] font-mono text-text-muted flex-shrink-0 select-none">
        <span className="truncate max-w-[280px]" title={workspacePath || ''}>
          {workspacePath ? workspacePath.split('/').pop() : 'aucun workspace'}
        </span>
        <span className={cn('w-1.5 h-1.5 rounded-full', isGenerating ? 'bg-accent-primary animate-pulse' : 'bg-accent-success')} />
        <span>{isGenerating ? 'agent au travail…' : 'prêt'}</span>
        {modifiedCount > 0 && <span className="text-accent-success">{modifiedCount} fichiers modifiés</span>}
        <span className="ml-auto capitalize">{selectedModel}</span>
      </div>
    </div>
  );
}
