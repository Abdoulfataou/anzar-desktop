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
import { FolderOpen, FolderPlus, FileEdit } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useAgentChat } from '@/hooks/useAgentChat';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import type { AIModel, Message } from '@/types';
import MessageList from '@/components/chat/MessageList';
import ChatInput from '@/components/chat/ChatInput';
import ResizableSplit from '@/components/ui/ResizableSplit';
import WorkspacePanel from './WorkspacePanel';
import { claimPendingPrompt } from '@/lib/pendingPrompt';

export default function WorkspaceView({ onlineStatus = true }: { onlineStatus?: boolean }) {
  const [selectedModel, setSelectedModel] = useState<AIModel>('fast');

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
  const { sendMessage, stop, isGenerating } = useAgentChat({
    workspacePath,
    workspaceName: activeProject?.name,
    model: selectedModel,
    onFileChanged,
  });

  // ── Ouverture de dossier (l'unique "mode" de l'app) ──
  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({ directory: true, multiple: false, title: 'Ouvrir un dossier de travail' });
      if (!selected || typeof selected !== 'string') return;

      const folderName = selected.split(/[/\\]/).pop() || 'workspace';
      const store = useProjectStore.getState();
      const project = store.createProject(folderName, `Workspace: ${selected}`, selectedModel);
      store.updateProject(project.id, {
        status: 'complete',
        metadata: { localPath: selected, imported: true },
      } as any);
      store.setActiveProject(project.id);
      setRefreshKey((k) => k + 1);
      setModifiedCount(0);
      toast.success(`Workspace « ${folderName} » ouvert`);
    } catch (err) {
      console.error('Open folder failed:', err);
      toast.error("Impossible d'ouvrir le dossier (fonction desktop).");
    }
  }, [selectedModel]);

  const handleNewFolder = useCallback(async () => {
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const selected = await save({ title: 'Nouveau projet — choisir un emplacement' });
      if (!selected || typeof selected !== 'string') return;
      const folderName = selected.split(/[/\\]/).pop() || 'nouveau-projet';
      const store = useProjectStore.getState();
      const project = store.createProject(folderName, `Workspace: ${selected}`, selectedModel);
      store.updateProject(project.id, {
        status: 'complete',
        metadata: { localPath: selected, imported: true },
      } as any);
      store.setActiveProject(project.id);
      setRefreshKey((k) => k + 1);
      setModifiedCount(0);
      toast.success(`Workspace « ${folderName} » créé — décris ton projet dans le chat`);
    } catch (err) {
      console.error('New folder failed:', err);
      toast.error('Impossible de créer le dossier.');
    }
  }, [selectedModel]);

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
    if (!activeConversationId) createConversation(undefined, selectedModel);
  }, [activeConversationId, createConversation, selectedModel]);
  const messages: Message[] = (activeConversation?.messages || []).filter((m) => m.role !== 'tool');

  const workspaceName = activeProject?.name || null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ── Split chat | workspace ── */}
      <ResizableSplit
        className="flex-1"
        initialLeftPct={38}
        minLeftPct={24}
        left={
          <div className="h-full min-h-0 flex flex-col border-r border-border-subtle">
            {/* Bandeau workspace au-dessus du chat */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle bg-bg-secondary/30 flex-shrink-0">
              {workspacePath ? (
                <>
                  <FolderOpen size={12} className="text-text-muted" />
                  <span className="text-[11px] font-mono text-text-secondary truncate flex-1" title={workspacePath}>
                    {workspaceName}
                  </span>
                  {modifiedCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-accent-success font-mono">
                      <FileEdit size={10} />
                      {modifiedCount}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-[11px] text-text-muted flex-1">Aucun dossier — l'agent répond sans outils</span>
                  <button
                    onClick={() => void handleOpenFolder()}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                  >
                    <FolderOpen size={11} />
                    Ouvrir
                  </button>
                </>
              )}
              <button
                onClick={() => void handleNewFolder()}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                title="Nouveau projet (dossier vierge)"
              >
                <FolderPlus size={12} />
              </button>
            </div>

            {/* Messages */}
            <MessageList messages={messages} isLoading={isGenerating} />

            {/* Composer */}
            <div className="flex-shrink-0">
              <ChatInput
                onSendMessage={async (msg) => { await sendMessage(msg); }}
                onStopGeneration={stop}
                isLoading={isGenerating}
                isOnline={onlineStatus}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
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
