/**
 * ChatView — Hub/routeur léger ANZAR
 *
 * Toute la logique métier est extraite dans des hooks autonomes :
 * - useChatEngine : envoi de messages, intent detection, streaming, retry
 * - useProjectPipeline : génération de projets, import dossier, dialog
 *
 * Le composant ne fait que du routage de rendu et du câblage de props.
 */
import React, { useEffect, useState, useRef, Suspense, lazy } from 'react';
import { WifiOff } from 'lucide-react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import WelcomeScreen, { type ActiveFeature } from './WelcomeScreen';
import { cn } from '@/lib/utils';
import { AIModel, type Message } from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { useActiveConversation, useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useActivityStore } from '@/stores/activityStore';
import ProjectWizardModal from './ProjectWizardModal';
import GenerationPanel from './GenerationPanel';
import { VibeCodingStudio } from '@/components/vibecoding';
import { useVibeCodingStudio } from '@/hooks/useVibeCodingStudio';
import { useChatEngine } from '@/hooks/useChatEngine';
import { useProjectPipeline } from '@/hooks/useProjectPipeline';
const StudentAssistant = lazy(() => import('@/components/features/StudentAssistant'));
const FeatureAssistant = lazy(() => import('@/components/features/FeatureAssistant'));
import { DATA_CONFIG, SEARCH_CONFIG, DOCUMENT_CONFIG } from '@/components/features/featureConfigs';
import FeatureErrorBoundary from '@/components/features/FeatureErrorBoundary';

// Lightweight fallback shown while lazy chunks load
const FeatureLoadingFallback = () => (
  <div className="flex-1 flex items-center justify-center bg-bg-primary">
    <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

interface ChatViewProps {
  onlineStatus?: boolean;
  showWelcome?: boolean;
}

export default function ChatView({ onlineStatus = true, showWelcome = true }: ChatViewProps) {
  const [selectedModel, setSelectedModel] = useState<AIModel>('fast');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

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

  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [activeFeature, setActiveFeature] = useState<ActiveFeature>(null);

  // ── VibeCoding Studio hook ──
  const [studioState, studioActions] = useVibeCodingStudio();

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
      {/* Chat area (hidden when studio or autonomous feature is active) */}
      {!studioState.isOpen && !activeFeature && (
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
            onSetActiveFeature={setActiveFeature}
            onImportFolder={projectPipeline.handleImportFolder}
            onShowProjectWizard={() => setShowProjectWizard(true)}
            onQuickStart={chatEngine.quickStart}
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

      {/* ===== VIBECODING STUDIO ===== */}
      {studioState.isOpen && (
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
            onClose={studioActions.close}
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
          />
        </div>
      )}

      {/* ===== AUTONOMOUS FEATURES (lazy-loaded + error-isolated) ===== */}
      {activeFeature && !studioState.isOpen && (
        <Suspense fallback={<FeatureLoadingFallback />}>
          {activeFeature === 'student' && (
            <FeatureErrorBoundary featureName="Assistant Étudiant" onClose={() => setActiveFeature(null)}>
              <div className="flex-1 min-h-0">
                <StudentAssistant onClose={() => setActiveFeature(null)} />
              </div>
            </FeatureErrorBoundary>
          )}
          {activeFeature === 'data' && (
            <FeatureErrorBoundary featureName="Analyse de données" onClose={() => setActiveFeature(null)}>
              <div className="flex-1 min-h-0">
                <FeatureAssistant config={DATA_CONFIG} onClose={() => setActiveFeature(null)} />
              </div>
            </FeatureErrorBoundary>
          )}
          {activeFeature === 'search' && (
            <FeatureErrorBoundary featureName="Recherche intelligente" onClose={() => setActiveFeature(null)}>
              <div className="flex-1 min-h-0">
                <FeatureAssistant config={SEARCH_CONFIG} onClose={() => setActiveFeature(null)} />
              </div>
            </FeatureErrorBoundary>
          )}
          {activeFeature === 'document' && (
            <FeatureErrorBoundary featureName="Rédaction" onClose={() => setActiveFeature(null)}>
              <div className="flex-1 min-h-0">
                <FeatureAssistant config={DOCUMENT_CONFIG} onClose={() => setActiveFeature(null)} />
              </div>
            </FeatureErrorBoundary>
          )}
        </Suspense>
      )}

      {/* ===== INPUT BAR ===== */}
      {!studioState.isOpen && !activeFeature && (
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
          placeholder="Décris ta tâche, ANZAR s'en occupe..."
        />
      </div>
      )}

      {/* ===== PROJECT WIZARD (modal) ===== */}
      {showProjectWizard && (
        <ProjectWizardModal
          onClose={() => setShowProjectWizard(false)}
          onGenerate={async (prompt, projectName, projectType, techs) => {
            setShowProjectWizard(false);
            await projectPipeline.prepareProjectGeneration();
            forceProjectGenerationOnceRef.current = true;
            wizardMetaRef.current = { projectType, techs };

            const displayMessage = `Genere le projet "${projectName}"`;
            chatEngine.ensureActiveConversation();
            const userMsgId = `msg_${Date.now()}`;
            useChatStore.getState().addMessage({
              id: userMsgId,
              content: displayMessage,
              role: 'user',
              timestamp: Date.now(),
              model: selectedModel,
            });

            chatEngine.sendMessage(prompt, false, { skipUserMessage: true, userMessageId: userMsgId });
          }}
        />
      )}

      </div>
      {/* ── Generation Panel (right sidebar) ── */}
      {generationPanelSessionId && !studioState.isOpen && (
        <GenerationPanel
          sessionId={generationPanelSessionId}
          onClose={() => setGenerationPanelSessionId(null)}
        />
      )}
    </div>
  );
}
