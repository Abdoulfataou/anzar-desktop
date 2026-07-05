/**
 * ChatView — Hub principal ANZAR (vibecoding uniquement)
 *
 * Logique métier extraite dans des hooks autonomes :
 * - useChatEngine : envoi de messages, intent detection, streaming, retry
 * - useProjectPipeline : génération de projets, import dossier, dialog
 */
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import WelcomeScreen from './WelcomeScreen';
import { AIModel, type Message } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { useActiveConversation, useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useActivityStore } from '@/stores/activityStore';
import GenerationPanel from './GenerationPanel';
import ProjectProgressCard from './ProjectProgressCard';
import ProjectActivityPanel from './ProjectActivityPanel';
import { VibeCodingStudio } from '@/components/vibecoding';
import { useVibeCodingStudio } from '@/hooks/useVibeCodingStudio';
import { useChatEngine } from '@/hooks/useChatEngine';
import { useProjectPipeline } from '@/hooks/useProjectPipeline';

interface ChatViewProps {
  onlineStatus?: boolean;
  showWelcome?: boolean;
}

export default function ChatView({ onlineStatus = true, showWelcome = true }: ChatViewProps) {
  const [selectedModel, setSelectedModel] = useState<AIModel>('fast');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // ── Flux chat-first : le studio ne s'affiche QUE si l'utilisateur clique
  //    sur "Voir le projet" (la génération continue dans le chat sinon) ──
  const [studioVisible, setStudioVisible] = useState(false);

  // Track sidebar "Nouvelle tache" clearing the project
  const storeActiveProjectId = useProjectStore((s) => s.activeProjectId);
  const prevStoreRef = useRef(storeActiveProjectId);
  const isChatGenerating = useChatStore((s) => s.isGenerating);
  const isProjectGenerating = useChatStore((s) => s.isProjectGenerating);
  const isLoading = isChatGenerating || isProjectGenerating;
  useEffect(() => {
    if (prevStoreRef.current !== null && storeActiveProjectId === null && !isLoading) {
      setSelectedProjectId(null);
    }
    prevStoreRef.current = storeActiveProjectId;
  }, [storeActiveProjectId, isLoading]);

  // ── VibeCoding Studio hook ──
  const [studioState, studioActions] = useVibeCodingStudio();

  // Panneau d'activité droit (todo + contexte) — masquable
  const [activityPanelHidden, setActivityPanelHidden] = useState(false);

  // Nouvelle session studio → on repart dans le chat (carte + panneau visibles)
  const prevStudioOpenRef = useRef(false);
  useEffect(() => {
    if (!prevStudioOpenRef.current && studioState.isOpen) {
      setStudioVisible(false);
      setActivityPanelHidden(false);
    }
    prevStudioOpenRef.current = studioState.isOpen;
  }, [studioState.isOpen]);

  // ── FIX navigation : le studio plein écran "avalait" les clics sidebar.
  //    Toute navigation (Nouvelle tâche, historique, projet) ramène au chat. ──
  const location = useLocation();
  const activeConvIdForNav = useChatStore((s) => s.activeConversationId);
  useEffect(() => {
    setStudioVisible(false);
  }, [location.key, activeConvIdForNav]);

  // ── FIX /projects/:id ignoré : ouvrir un projet depuis la sidebar
  //    sélectionne maintenant réellement ce projet dans le chat ──
  const { id: routeProjectId } = useParams<{ id: string }>();
  const setActiveProjectStore = useProjectStore((s) => s.setActiveProject);
  useEffect(() => {
    if (routeProjectId) {
      setSelectedProjectId(routeProjectId);
      setActiveProjectStore(routeProjectId);
    }
  }, [routeProjectId, setActiveProjectStore]);

  // ── Activity panel ──
  const generationPanelSessionId = useActivityStore((s) => s.generationPanelSessionId);
  const setGenerationPanelSessionId = useActivityStore((s) => s.setGenerationPanelSessionId);

  // ── Shared refs for cross-hook communication ──
  const forceProjectGenerationOnceRef = useRef(false);
  const wizardMetaRef = useRef<{ projectType: string; techs: string[] } | null>(null);

  // ── Network state ──
  const settings = useSettingsStore((s) => s.settings);
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() => globalThis.navigator?.onLine ?? true);
  useEffect(() => {
    const onOnline = () => setIsBrowserOnline(true);
    const onOffline = () => setIsBrowserOnline(false);
    globalThis.addEventListener?.('online', onOnline);
    globalThis.addEventListener?.('offline', onOffline);
    return () => {
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.removeEventListener?.('offline', onOffline);
    };
  }, []);
  const isEffectivelyOnline = onlineStatus && isBrowserOnline && !settings.offlineMode;

  // ── Conversation state ──
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const activeConversation = useActiveConversation();
  const createConversation = useChatStore((s) => s.createConversation);
  const messages: Message[] = (activeConversation?.messages || []).filter((m) => m.role !== 'tool');
  const projects = useProjectStore((s) => s.projects);
  const selectedProjectPath = projects.find((p) => p.id === selectedProjectId)?.metadata?.localPath as string | undefined;

  // Auto-init conversation
  useEffect(() => {
    if (!activeConversationId) {
      createConversation(undefined, selectedModel);
    }
  }, [activeConversationId, createConversation, selectedModel]);

  // ── Project pipeline hook ──
  const projectPipeline = useProjectPipeline({
    selectedModel,
    setSelectedProjectId,
    wizardMetaRef,
  });

  // ── Chat engine hook ──
  const chatEngine = useChatEngine({
    selectedModel,
    selectedProjectId,
    isEffectivelyOnline,
    forceProjectGenerationOnceRef,
    wizardMetaRef,
    studioActions,
    onProjectGeneration: projectPipeline.handleProjectGeneration,
    setGenerationPanelSessionId,
    setSelectedProjectId,
  });

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="h-full min-h-0 flex bg-bg-primary">
      {/* Main chat column */}
      <div className="flex-1 min-h-0 flex flex-col bg-bg-primary">
      {/* Chat area — visible tant que l'utilisateur n'a pas OUVERT le studio */}
      {!(studioState.isOpen && studioVisible) && (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {!isEffectivelyOnline && (
          <div className="px-4 pt-3">
            <div className="max-w-4xl mx-auto rounded-xl border border-border-subtle bg-surface-default/70 backdrop-blur px-4 py-2 flex items-center gap-2 text-xs text-text-secondary">
              <WifiOff size={14} className="text-text-muted" />
              <span>
                {settings.offlineMode ? 'Mode hors ligne activé.' : 'Hors ligne.'} Certaines fonctionnalités réseau sont désactivées.
              </span>
            </div>
          </div>
        )}
        {messages.length === 0 && showWelcome ? (
          <WelcomeScreen
            onGenerate={chatEngine.quickStart}
            onChat={(msg) => { void chatEngine.sendMessage(msg); }}
            onImportFolder={projectPipeline.handleImportFolder}
            isLoading={isLoading}
          />
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            selectedProjectId={selectedProjectId}
            selectedProjectPath={selectedProjectPath}
            onRegenerateMessage={chatEngine.regenerateMessage}
          />
        )}
      </div>
      )}

      {/* ── Carte de progression du projet (flux chat-first) ──
          Masquée sur l'écran d'accueil (Nouvelle tâche = repartir à neuf) */}
      {studioState.isOpen && !studioVisible && !(messages.length === 0 && showWelcome) && (
        <ProjectProgressCard
          projectName={studioState.projectName}
          phase={studioState.phase}
          files={studioState.files}
          currentStep={studioState.currentStep}
          errorMessage={studioState.errorMessage}
          onOpenStudio={() => setStudioVisible(true)}
          onCancel={studioActions.cancel}
        />
      )}

      {/* ===== VIBECODING STUDIO (ouvert uniquement sur clic) ===== */}
      {studioState.isOpen && studioVisible && (
        <div className="flex-1 min-h-0">
          <VibeCodingStudio
            projectId={studioState.projectId}
            projectName={studioState.projectName}
            phase={studioState.phase}
            plan={studioState.plan}
            files={studioState.files}
            agents={studioState.agents}
            currentStep={studioState.currentStep}
            onExecutePlan={studioActions.executePlan}
            onIterate={studioActions.iterate}
            onFileChange={studioActions.updateFile}
            onFileRevert={studioActions.revertFile}
            onCancel={studioActions.cancel}
            onClose={() => { setStudioVisible(false); studioActions.close(); }}
            onMinimize={() => setStudioVisible(false)}
            activeGeneratingFile={studioState.activeGeneratingFile}
            errorMessage={studioState.errorMessage}
            isIterating={studioState.isIterating}
            lastIterationResult={studioState.lastIterationResult}
            projectPath={studioState.projectPath}
            autoFix={studioState.autoFix}
            onStopAutoFix={studioActions.stopAutoFix}
            git={studioState.git}
            onRollback={studioActions.rollback}
            ckg={studioState.ckg}
            deploy={studioState.deploy}
            onDeploy={studioActions.deploy}
          />
        </div>
      )}

      {/* ===== INPUT BAR (hidden on welcome screen — it has its own input) ===== */}
      {!(studioState.isOpen && studioVisible) && !(messages.length === 0 && showWelcome) && (
      <div className="flex-shrink-0">
        <ChatInput
          onSendMessage={async (msg, attachments) => { await chatEngine.sendMessage(msg, false, { attachments }); }}
          onStopGeneration={chatEngine.stopGeneration}
          isLoading={isLoading}
          isOnline={isEffectivelyOnline}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          placeholder="Pose une question ou continue la discussion…"
        />
      </div>
      )}

      </div>
      {/* ── Panneau d'activité projet : todo réelle + contexte fichiers ── */}
      {studioState.isOpen && !studioVisible && !activityPanelHidden && (
        <ProjectActivityPanel
          projectName={studioState.projectName}
          phase={studioState.phase}
          files={studioState.files}
          currentStep={studioState.currentStep}
          onClose={() => setActivityPanelHidden(true)}
        />
      )}

      {/* ── Generation Panel (right sidebar — flux import/audit uniquement) ── */}
      {generationPanelSessionId && !studioState.isOpen && (
        <GenerationPanel
          sessionId={generationPanelSessionId}
          onClose={() => setGenerationPanelSessionId(null)}
        />
      )}
    </div>
  );
}
