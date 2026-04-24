/**
 * ChatView - Vue principale unifiée ANZAR
 * Accueil original + cartes fonctionnalités + chat
 * Routage intelligent: DeepSeek 80% / Kimi 20%
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  Code2, BarChart3, FolderOpen,
  Wand2, FileText,
} from 'lucide-react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { cn } from '@/lib/utils';
import { AIModel } from '@/types';
import { aiRouter } from '@/services/router';
import { useUsageStore } from '@/stores/usageStore';
import { useActivityStore } from '@/stores/activityStore';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  reasoning?: string[];
  model?: AIModel;
  isError?: boolean;
  isStreaming?: boolean;
  thinking?: string;
  activitySessionId?: string;  // Link to ActivityTimeline
  routingInfo?: {
    provider: string;
    taskType: string;
    wasFallback: boolean;
    reason: string;
  };
}

interface ChatViewProps {
  onlineStatus?: boolean;
  showWelcome?: boolean;
}

/* ===== Feature Cards ===== */
const FEATURES = [
  {
    title: 'Créer un projet',
    description: 'Une idée suffit. ANZAR structure, code et livre.',
    icon: Code2,
    color: 'from-violet-500 to-indigo-500',
  },
  {
    title: 'Analyser des données',
    description: 'Importe, explore, visualise. Résultats instantanés.',
    icon: BarChart3,
    color: 'from-emerald-500 to-teal-500',
  },
  {
    title: 'Organiser mes fichiers',
    description: 'Ouvre un dossier, ANZAR comprend et travaille dessus.',
    icon: FolderOpen,
    color: 'from-blue-500 to-cyan-500',
  },
  {
    title: 'Rédiger un document',
    description: 'Rapports, présentations, emails — prêts en secondes.',
    icon: FileText,
    color: 'from-orange-500 to-amber-500',
  },
];

/* ===== Suggested Prompts (quick start) ===== */
const QUICK_STARTS = [
  'Crée une application de gestion de stock avec React et SQLite',
  'Analyse ce code et trouve les bugs potentiels',
  'Génère un site vitrine moderne responsive',
  'Écris un script Python pour automatiser mes tâches',
];

export default function ChatView({ onlineStatus = true, showWelcome = true }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<AIModel>('fast');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const streamingRef = useRef<string>('');

  // Usage tracking
  const addUsageRecord = useUsageStore((s) => s.addRecord);

  // Activity tracking
  const { startSession, endSession, addStep, completeStep } = useActivityStore();

  const handleSendMessage = useCallback(async (content: string, hasImages = false) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      type: 'user',
      content,
      timestamp: new Date(),
      model: selectedModel,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    streamingRef.current = '';
    const startTime = Date.now();

    // ── Start activity session ──
    const sessionId = `chat-${Date.now()}`;
    const sessionLabel = content.length > 60 ? content.slice(0, 60) + '...' : content;
    startSession(sessionId, sessionLabel);

    // Step 1: Understanding
    const understandStepId = addStep(sessionId, {
      type: 'understanding',
      label: 'Compréhension de la demande',
    });

    // Build API messages — le routeur injecte le prompt système optimisé pour le cache
    const rawMessages = [
      ...messages.map((m) => ({
        role: (m.type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content },
    ];
    const apiMessages = aiRouter.prepareMessages(rawMessages);

    completeStep(sessionId, understandStepId);

    // Create placeholder AI message for streaming with activity link
    const aiMessageId = `msg_${Date.now() + 1}`;
    const placeholderMessage: Message = {
      id: aiMessageId,
      type: 'ai',
      content: '',
      timestamp: new Date(),
      model: selectedModel,
      isStreaming: true,
      activitySessionId: sessionId,
    };
    setMessages((prev) => [...prev, placeholderMessage]);

    // Routing info captured during stream
    let routingProvider = 'deepseek';
    let routingTaskType = 'chat';
    let routingReason = '';
    let routingWasFallback = false;

    try {
      let fullContent = '';
      let thinkingContent = '';
      let thinkingStepId: string | null = null;
      let writingStepId: string | null = null;
      let hasStartedWriting = false;

      // Step 2: Routing / Classification
      const routingStepId = addStep(sessionId, {
        type: 'analyzing',
        label: 'Classification de la tâche',
      });

      // ── ROUTAGE INTELLIGENT: le routeur décide DeepSeek ou Kimi ──
      for await (const delta of aiRouter.chatStream(apiMessages, {
        model: selectedModel,
        hasImages,
        enableFallback: true,
        onRouting: (classification) => {
          routingProvider = classification.provider;
          routingTaskType = classification.type;
          routingReason = classification.reason;

          // Complete routing step & show which provider is selected
          completeStep(sessionId, routingStepId);
          addStep(sessionId, {
            type: 'planning',
            label: `Routage → ${classification.provider === 'deepseek' ? 'DeepSeek' : 'Kimi'} (${classification.type})`,
          });
        },
      })) {
        // Thinking / Reasoning
        if (delta.reasoning_content) {
          thinkingContent += delta.reasoning_content;

          if (!thinkingStepId) {
            thinkingStepId = addStep(sessionId, {
              type: 'thinking',
              label: 'Raisonnement en cours...',
            });
          }
        }

        // Content generation
        if (delta.content) {
          fullContent += delta.content;

          // Transition from thinking to writing
          if (!hasStartedWriting) {
            hasStartedWriting = true;
            if (thinkingStepId) {
              completeStep(sessionId, thinkingStepId);
            }

            // Detect what kind of content is being generated
            const isCode = fullContent.includes('```') || routingTaskType.includes('code');
            writingStepId = addStep(sessionId, {
              type: isCode ? 'writing' : 'writing',
              label: isCode ? 'Génération du code' : 'Rédaction de la réponse',
            });
          }
        }

        // Update the streaming message in real-time
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMessageId
              ? { ...m, content: fullContent, thinking: thinkingContent || undefined }
              : m
          )
        );
      }

      // Complete writing step
      if (writingStepId) completeStep(sessionId, writingStepId);

      // Final step: Complete
      addStep(sessionId, {
        type: 'complete',
        label: `Terminé (${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
      });

      // End activity session
      endSession(sessionId, 'done');

      // Finalize the message with routing info
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessageId
            ? {
                ...m,
                content: fullContent,
                thinking: thinkingContent || undefined,
                isStreaming: false,
                activitySessionId: sessionId,
                routingInfo: {
                  provider: routingProvider,
                  taskType: routingTaskType,
                  wasFallback: routingWasFallback,
                  reason: routingReason,
                },
              }
            : m
        )
      );

      // Track usage for cost monitoring
      const inputTokens = Math.ceil(apiMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 4);
      const outputTokens = Math.ceil(fullContent.length / 4);
      const cost = aiRouter.estimateCost(
        routingProvider as any,
        selectedModel,
        inputTokens,
        outputTokens
      );

      addUsageRecord({
        timestamp: Date.now(),
        provider: routingProvider as any,
        model: selectedModel,
        taskType: routingTaskType,
        inputTokens,
        outputTokens,
        costUSD: cost.costUSD,
        costFCFA: cost.costFCFA,
        wasFallback: routingWasFallback,
        durationMs: Date.now() - startTime,
      });

    } catch (error: any) {
      // End activity session with error
      addStep(sessionId, {
        type: 'error',
        label: error.name === 'AbortError' ? 'Arrêté par l\'utilisateur' : `Erreur: ${error.message?.slice(0, 80) || 'Connexion échouée'}`,
      });
      endSession(sessionId, 'error');

      const errorContent = error.name === 'AbortError'
        ? '⏹ Génération arrêtée.'
        : `❌ Erreur: ${error.message || 'Connexion échouée. Vérifie ta connexion et la configuration API.'}`;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessageId
            ? { ...m, content: errorContent, isStreaming: false, isError: true, activitySessionId: sessionId }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedModel, messages, addUsageRecord, startSession, endSession, addStep, completeStep]);

  const handleStopGeneration = useCallback(() => {
    aiRouter.stopStream();
    setIsLoading(false);
  }, []);

  const handleQuickStart = useCallback((prompt: string) => {
    handleSendMessage(prompt);
  }, [handleSendMessage]);

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* Chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {messages.length === 0 && showWelcome ? (
          /* ===== WELCOME SCREEN ===== */
          <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto">
            {/* Hero section */}
            <div className="text-center mb-10 max-w-2xl">
              {/* Logo */}
              <div className="relative inline-block mb-6">
                <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center animate-float shadow-lg">
                  <Wand2 className="w-8 h-8 text-white" />
                </div>
                <div className="absolute inset-0 w-16 h-16 rounded-2xl gradient-bg opacity-25 blur-xl" />
              </div>

              {/* Title */}
              <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">
                Imagine. <span className="gradient-text">ANZAR</span> construit.
              </h1>

              <p className="text-base text-text-secondary max-w-md mx-auto">
                Dis ce que tu veux créer. Ton assistant IA transforme chaque idée en réalité.
              </p>
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full max-w-4xl mb-10">
              {FEATURES.map((feature, idx) => {
                const Icon = feature.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => handleQuickStart(QUICK_STARTS[idx] || feature.title)}
                    className={cn(
                      'group p-4 rounded-xl border border-border-subtle',
                      'bg-surface-default hover:bg-surface-hover',
                      'transition-all duration-300 text-left',
                      'hover:border-accent-primary/30 hover:shadow-lg',
                      'card-hover',
                    )}
                  >
                    <div className={cn(
                      'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3',
                      'group-hover:scale-110 transition-transform duration-300 shadow-md',
                      feature.color
                    )}>
                      <Icon size={20} className="text-white" />
                    </div>
                    <p className="text-sm font-semibold text-text-primary mb-1">
                      {feature.title}
                    </p>
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      {feature.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* ===== MESSAGE LIST ===== */
          <MessageList
            messages={messages}
            isLoading={isLoading}
          />
        )}
      </div>

      {/* ===== INPUT BAR ===== */}
      <ChatInput
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        isLoading={isLoading}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        placeholder="Décris ta tâche, ANZAR s'en occupe..."
      />
    </div>
  );
}
