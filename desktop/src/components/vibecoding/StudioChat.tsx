/**
 * StudioChat — Panneau de chat itératif dans le VibeCoding Studio.
 *
 * Deux modes :
 *  1. Pendant la génération : affiche la progression en temps réel
 *     (étapes, fichiers générés, agents)
 *  2. Après la génération : chat interactif pour itérer
 *     ("change la couleur du header", "ajoute un formulaire de contact")
 *
 * Envoie les messages d'itération au parent via onIterate().
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Loader2, CheckCircle2, Circle, AlertCircle,
  FileCode, Sparkles, ArrowDown, Zap,
  MessageSquare, Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StudioFile, StudioPhase } from './VibeCodingStudio';
import type { AgentUpdate, StepEvent } from '@/services/projectGeneration';

// ============================================================================
// TYPES
// ============================================================================

interface StudioChatProps {
  projectId: string;
  projectName: string;
  phase: StudioPhase;
  files: StudioFile[];
  agents: AgentUpdate[];
  currentStep: StepEvent | null;
  onIterate: (message: string, fileFocus?: string) => Promise<void>;
  errorMessage?: string;
  /** Iteration loading state from parent hook */
  isIteratingExternal?: boolean;
  /** Result of last iteration from parent hook */
  lastIterationResult?: { success: boolean; modifiedFiles: string[]; error?: string } | null;
  /** Currently selected file in the editor — sent as fileFocus to iterate */
  selectedFile?: string | null;
}

interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// ============================================================================
// STEP TIMELINE (pendant la génération)
// ============================================================================

const StepTimeline: React.FC<{
  files: StudioFile[];
  currentStep: StepEvent | null;
  agents: AgentUpdate[];
}> = ({ files, currentStep, agents }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll vers le bas
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [files.length, currentStep]);

  const doneFiles = files.filter(f => f.status === 'done');
  const generatingFiles = files.filter(f => f.status === 'generating');

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 scrollbar-thin">
      {/* Agents status */}
      <div className="mb-3 p-2.5 rounded-lg bg-bg-tertiary/50">
        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
          Agents
        </div>
        <div className="space-y-1.5">
          {agents.map(a => (
            <div key={a.name} className="flex items-center gap-2">
              {a.status === 'done' ? (
                <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
              ) : a.status === 'running' ? (
                <Loader2 size={13} className="text-accent-primary animate-spin flex-shrink-0" />
              ) : a.status === 'error' ? (
                <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
              ) : (
                <Circle size={13} className="text-text-muted/30 flex-shrink-0" />
              )}
              <span className={cn(
                'text-[12px] capitalize',
                a.status === 'done' && 'text-emerald-400',
                a.status === 'running' && 'text-text-primary',
                a.status === 'error' && 'text-red-400',
                a.status === 'pending' && 'text-text-muted',
              )}>
                {a.name}
              </span>
              {a.message && (
                <span className="text-[10px] text-text-muted ml-auto truncate max-w-[120px]">
                  {a.message}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Current step */}
      {currentStep && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-accent-primary/5 border border-accent-primary/10">
          <Loader2 size={12} className="text-accent-primary animate-spin flex-shrink-0" />
          <span className="text-[11px] text-text-primary truncate">
            {currentStep.label}
          </span>
        </div>
      )}

      {/* Files generated */}
      {doneFiles.map(f => (
        <div key={f.path} className="flex items-center gap-2 px-2 py-1">
          <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" />
          <FileCode size={12} className="text-text-muted flex-shrink-0" />
          <span className="text-[11px] text-text-secondary truncate">{f.path}</span>
        </div>
      ))}

      {/* Files in progress */}
      {generatingFiles.map(f => (
        <div key={f.path} className="flex items-center gap-2 px-2 py-1">
          <Loader2 size={12} className="text-accent-primary animate-spin flex-shrink-0" />
          <FileCode size={12} className="text-accent-primary flex-shrink-0" />
          <span className="text-[11px] text-text-primary truncate">{f.path}</span>
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// ITERATION SUGGESTIONS
// ============================================================================

const SUGGESTIONS = [
  "Change la couleur du thème en bleu foncé",
  "Ajoute un formulaire de contact",
  "Améliore le responsive mobile",
  "Ajoute une animation au chargement",
  "Corrige le style du footer",
  "Ajoute un mode sombre",
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const StudioChat: React.FC<StudioChatProps> = ({
  projectId,
  projectName,
  phase,
  files,
  agents,
  currentStep,
  onIterate,
  errorMessage,
  isIteratingExternal,
  lastIterationResult,
  selectedFile,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const isIterating = isIteratingExternal ?? false;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Add system message when generation completes
  useEffect(() => {
    if (phase === 'iterating' && messages.length === 0) {
      setMessages([{
        id: 'system-1',
        role: 'system',
        content: `Projet "${projectName}" généré avec succès ! ${files.length} fichiers créés. Tu peux maintenant demander des modifications.`,
        timestamp: Date.now(),
      }]);
    }
  }, [phase, files.length, projectName]);

  // React to iteration results from parent
  useEffect(() => {
    if (!lastIterationResult) return;

    if (lastIterationResult.success) {
      const count = lastIterationResult.modifiedFiles.length;
      const fileNames = lastIterationResult.modifiedFiles.map(f => f.split('/').pop()).join(', ');
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: count > 0
          ? `${count} fichier${count > 1 ? 's' : ''} modifié${count > 1 ? 's' : ''} : ${fileNames}`
          : 'Aucun fichier modifié. Essaie de reformuler ta demande.',
        timestamp: Date.now(),
      }]);
    } else {
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: `Erreur : ${lastIterationResult.error || 'Impossible d\'appliquer la modification'}`,
        timestamp: Date.now(),
      }]);
    }
  }, [lastIterationResult]);

  // Send iteration message
  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || isIterating) return;

    // Add user message
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    }]);

    setInput('');

    // Call parent (async — results come via lastIterationResult effect)
    onIterate(msg, selectedFile || undefined);
  }, [input, isIterating, onIterate, selectedFile]);

  // Handle Enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Handle suggestion click
  const handleSuggestion = useCallback((text: string) => {
    setInput(text);
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-2">
          {phase === 'generating' ? (
            <>
              <Terminal size={14} className="text-accent-primary" />
              <span className="text-[11px] font-bold text-text-primary uppercase tracking-wider">
                Progression
              </span>
            </>
          ) : (
            <>
              <MessageSquare size={14} className="text-accent-primary" />
              <span className="text-[11px] font-bold text-text-primary uppercase tracking-wider">
                Itérer
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── GENERATING MODE : timeline ── */}
      {(phase === 'generating' || phase === 'planning') && (
        <StepTimeline
          files={files}
          currentStep={currentStep}
          agents={agents}
        />
      )}

      {/* ── ERROR MODE ── */}
      {phase === 'error' && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <AlertCircle size={28} className="mx-auto mb-3 text-red-400" />
            <p className="text-sm font-medium text-red-400 mb-1">Erreur de génération</p>
            <p className="text-xs text-text-muted">{errorMessage || 'Une erreur est survenue'}</p>
          </div>
        </div>
      )}

      {/* ── ITERATING MODE : chat ── */}
      {phase === 'iterating' && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin">
            {messages.map(msg => (
              <div key={msg.id} className={cn(
                'flex',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}>
                <div className={cn(
                  'max-w-[85%] px-3 py-2 rounded-xl text-[13px] leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-accent-primary text-white rounded-br-md'
                    : msg.role === 'system'
                      ? 'bg-bg-tertiary/50 text-text-muted border border-border-subtle'
                      : 'bg-bg-tertiary text-text-primary rounded-bl-md'
                )}>
                  {msg.role === 'system' && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <Sparkles size={12} className="text-accent-primary" />
                      <span className="text-[10px] font-semibold text-accent-primary uppercase">Système</span>
                    </div>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}

            {isIterating && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-tertiary text-text-muted text-[13px]">
                  <Loader2 size={14} className="animate-spin text-accent-primary" />
                  Modification en cours...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions (only show if no messages yet from user) */}
          {messages.filter(m => m.role === 'user').length === 0 && (
            <div className="px-3 pb-2 flex-shrink-0">
              <p className="text-[10px] text-text-muted mb-1.5 uppercase tracking-wider font-medium">
                Suggestions
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.slice(0, 4).map(s => (
                  <button
                    key={s}
                    onClick={() => handleSuggestion(s)}
                    className="px-2.5 py-1 rounded-full text-[11px] text-text-secondary bg-bg-tertiary hover:bg-surface-hover hover:text-text-primary transition-colors border border-border-subtle"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-border-subtle flex-shrink-0">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Décris la modification..."
                  rows={1}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded-xl text-[13px] text-text-primary placeholder-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary/50 max-h-[100px]"
                  style={{ minHeight: '36px' }}
                />
              </div>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isIterating}
                className={cn(
                  'p-2 rounded-xl transition-all flex-shrink-0',
                  input.trim() && !isIterating
                    ? 'gradient-bg text-white hover:opacity-90'
                    : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                )}
              >
                {isIterating ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default StudioChat;
