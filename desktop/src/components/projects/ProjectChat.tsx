/**
 * ProjectChat - Chat IA contextuel au projet
 * Panel latéral pour discuter du code avec l'IA
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Sparkles, Loader2, Bot, User, Code2,
  FileCode, Trash2, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { aiRouter } from '@/services/router';
import { getSystemPrompt } from '@/services/prompts';
import { ANZAR_TOOLS } from '@/types';
import { createChangeToolExecutor } from '@/services/aiToolChangeExecutor';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  context?: string; // Current file being discussed
}

interface ProjectChatProps {
  projectId: string;
  projectName: string;
  currentFile?: string;
  currentFileContent?: string;
  onApplyCode?: (code: string, filePath: string) => void;
}

/* ===== Message Bubble ===== */
function MessageBubble({
  message,
  onApplyCode,
}: {
  message: ChatMessage;
  onApplyCode?: (code: string) => void;
}) {
  const isUser = message.role === 'user';

  // Extract code blocks from content
  const renderContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('```')) {
        const lines = part.slice(3, -3).split('\n');
        const lang = lines[0]?.trim() || '';
        const code = lines.slice(1).join('\n');
        return (
          <div key={idx} className="my-2 rounded-lg overflow-hidden border border-border-subtle">
            <div className="flex items-center justify-between px-3 py-1.5 bg-bg-tertiary/50">
              <span className="text-[10px] font-medium text-text-muted uppercase">{lang || 'code'}</span>
              {onApplyCode && (
                <button
                  onClick={() => onApplyCode(code)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-accent-primary hover:bg-accent-primary/10 transition-colors"
                >
                  <Code2 size={10} />
                  Appliquer
                </button>
              )}
            </div>
            <pre className="p-3 text-xs font-mono bg-bg-tertiary/30 overflow-x-auto">
              <code className="text-text-primary">{code}</code>
            </pre>
          </div>
        );
      }
      return part ? <span key={idx} className="whitespace-pre-wrap">{part}</span> : null;
    });
  };

  return (
    <div className={cn('flex gap-2.5 px-4 py-2', isUser ? 'flex-row-reverse' : '')}>
      {/* Avatar */}
      <div
        className={cn(
          'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
          isUser ? 'bg-accent-primary/15' : 'gradient-bg'
        )}
      >
        {isUser ? (
          <User size={14} className="text-accent-primary" />
        ) : (
          <Sparkles size={14} className="text-white" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex-1 max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm',
          isUser
            ? 'bg-accent-primary/10 text-text-primary ml-auto'
            : 'bg-bg-tertiary/50 text-text-primary'
        )}
      >
        {message.context && (
          <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-text-muted">
            <FileCode size={10} />
            <span>{message.context}</span>
          </div>
        )}
        <div className="text-[13px] leading-relaxed">
          {renderContent(message.content)}
        </div>
      </div>
    </div>
  );
}

/* ===== Quick Actions ===== */
const QUICK_ACTIONS = [
  { label: 'Explique ce code', prompt: 'Explique-moi ce code en détail :' },
  { label: 'Trouve les bugs', prompt: 'Analyse ce code et trouve les bugs potentiels :' },
  { label: 'Optimise', prompt: 'Comment optimiser ce code ?' },
  { label: 'Ajoute des tests', prompt: 'Écris des tests unitaires pour ce code :' },
  { label: 'Documente', prompt: 'Ajoute des commentaires et de la documentation à ce code :' },
  { label: 'Refactorise', prompt: 'Refactorise ce code pour le rendre plus propre :' },
];

const ProjectChat: React.FC<ProjectChatProps> = ({
  projectId,
  projectName,
  currentFile,
  currentFileContent,
  onApplyCode,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [agentMode, setAgentMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
      context: currentFile,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setShowQuickActions(false);

    // Construire le contexte avec le fichier actuel
    const contextInfo = currentFile && currentFileContent
      ? `\n\n[Fichier ouvert: ${currentFile}]\n\`\`\`\n${currentFileContent.slice(0, 6000)}\n\`\`\``
      : '';

    // Messages API pour le routeur
    const apiMessages = aiRouter.prepareMessages([
      {
        role: 'system' as const,
        content: `${getSystemPrompt('code_review')}\n\nTu travailles sur le projet "${projectName}".${contextInfo}${
          agentMode
            ? "\n\nMODE AGENT (A-mode): quand tu veux créer/modifier/supprimer des fichiers, utilise les tools. Ne propose pas de commande shell. Les changements doivent être proposés via tools pour preview/apply par l'utilisateur."
            : ''
        }`,
      },
      ...messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: text },
    ], 'code_review');

    // Placeholder pour le streaming
    const aiMsgId = `msg-${Date.now() + 1}`;
    setMessages((prev) => [
      ...prev,
      { id: aiMsgId, role: 'assistant', content: '', timestamp: Date.now() },
    ]);

    try {
      if (agentMode) {
        const toolExecutor = createChangeToolExecutor(projectId);
        const resp = await aiRouter.chatWithTools(apiMessages as any, ANZAR_TOOLS as any, toolExecutor, {
          model: 'fast',
          enableFallback: true,
        } as any);

        const content = resp?.choices?.[0]?.message?.content || '';
        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? { ...m, content } : m)));
      } else {
        let fullContent = '';

        for await (const delta of aiRouter.chatStream(apiMessages, {
          model: 'fast',
          enableFallback: true,
        })) {
          if (delta.content) {
            fullContent += delta.content;
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMsgId ? { ...m, content: fullContent } : m))
            );
          }
        }

        // Finalize
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, content: fullContent } : m))
        );
      }
    } catch (error: any) {
      const errorContent = error.name === 'AbortError'
        ? 'Génération arrêtée.'
        : `Erreur: ${error.message || 'Connexion échouée. Vérifie ta connexion.'}`;

      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...m, content: errorContent } : m))
      );
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, currentFile, currentFileContent, messages, projectName, agentMode, projectId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleQuickAction = (prompt: string) => {
    const fullPrompt = currentFile
      ? `${prompt}\n\nFichier: ${currentFile}`
      : prompt;
    sendMessage(fullPrompt);
  };

  const clearChat = () => {
    setMessages([]);
    setShowQuickActions(true);
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary border-l border-border-subtle">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg gradient-bg flex items-center justify-center">
            <Bot size={14} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Chat IA</h3>
            <p className="text-[10px] text-text-muted truncate max-w-[160px]">{projectName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAgentMode((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all',
              agentMode
                ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary'
                : 'border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-hover'
            )}
            title="Mode Agent: l’IA propose des changements via Preview/Apply (A-mode)"
          >
            <Wrench size={12} />
            Mode Agent
          </button>

          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="p-1.5 rounded-lg text-text-muted hover:bg-surface-hover hover:text-accent-error transition-colors"
              title="Effacer le chat"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-14 h-14 rounded-2xl gradient-bg flex items-center justify-center mb-4 shadow-lg">
              <Sparkles size={24} className="text-white" />
            </div>
            <h4 className="text-sm font-semibold text-text-primary mb-1">
              Assistant de projet
            </h4>
            <p className="text-xs text-text-muted mb-6 max-w-[200px]">
              Pose des questions sur ton code, demande des améliorations ou des explications.
            </p>

            {/* Quick actions */}
            {showQuickActions && (
              <div className="flex flex-wrap gap-2 justify-center max-w-[280px]">
                {QUICK_ACTIONS.slice(0, 4).map((action) => (
                  <button
                    key={action.label}
                    onClick={() => handleQuickAction(action.prompt)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-bg-tertiary text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-all border border-border-subtle"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="py-3 space-y-1">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onApplyCode={
                  msg.role === 'assistant' && onApplyCode && currentFile
                    ? (code) => onApplyCode(code, currentFile)
                    : undefined
                }
              />
            ))}
            {isLoading && (
              <div className="flex gap-2.5 px-4 py-2">
                <div className="w-7 h-7 rounded-lg gradient-bg flex items-center justify-center flex-shrink-0">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div className="bg-bg-tertiary/50 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-accent-primary" />
                    <span className="text-xs text-text-muted">Réflexion en cours...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Current file context indicator */}
      {currentFile && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border-subtle bg-bg-secondary/30 text-[11px] text-text-muted">
          <FileCode size={10} />
          <span className="truncate">Contexte: {currentFile}</span>
        </div>
      )}

      {/* Input area */}
      <div className="p-3 border-t border-border-subtle flex-shrink-0">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pose une question sur ton code..."
            rows={2}
            className={cn(
              'w-full px-4 py-3 pr-12 rounded-xl text-sm resize-none',
              'bg-bg-tertiary border border-border-subtle',
              'text-text-primary placeholder-text-muted',
              'focus:outline-none focus:ring-1 focus:ring-accent-primary',
              'transition-all'
            )}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className={cn(
              'absolute right-2.5 bottom-2.5 p-2 rounded-lg transition-all',
              input.trim() && !isLoading
                ? 'gradient-bg text-white hover:opacity-90'
                : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
            )}
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectChat;
