'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Sparkles, Brain, RefreshCw, ThumbsUp, ThumbsDown, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import CodeBlock from './CodeBlock';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '@/services/externalLinks';
import { useCommandStore } from '@/stores/commandStore';
import CommandCard from '@/components/chat/CommandCard';
import { useSettingsStore } from '@/stores/settingsStore';
import { commandCardService } from '@/services/commandCardService';
import { shouldAutoRunCommand } from '@/services/commandAutoPolicy';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  reasoning?: string[];
  model?: 'fast' | 'thinking';
  isError?: boolean;
  isStreaming?: boolean;
  thinking?: string;
}

interface MessageBubbleProps {
  message: Message;
  onCopy?: (text: string) => void;
  onRegenerate?: () => void;
  selectedProjectId?: string | null;
  selectedProjectPath?: string;
}

export default function MessageBubble({ message, onCopy, onRegenerate, selectedProjectId = null, selectedProjectPath }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const ensureCard = useCommandStore((s) => s.ensureCard);
  const commandOrder = useCommandStore((s) => s.order);
  const commandCards = useCommandStore((s) => s.cards);
  const settings = useSettingsStore((s) => s.settings);

  const cardsForThisMessage = useMemo(() => {
    return commandOrder
      .map((id) => commandCards[id])
      .filter(Boolean)
      .filter((c) => c.messageId === message.id)
      .map((c) => c.id);
  }, [commandOrder, commandCards, message.id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    onCopy?.(message.content);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // ===== USER MESSAGE =====
  if (message.type === 'user') {
    return (
      <div className="flex justify-end gap-3 group px-4">
        <div className="flex flex-col items-end max-w-[80%] sm:max-w-[70%]">
          <div className={cn(
            'rounded-2xl rounded-br-md px-4 py-3 message-enter',
            'bg-accent-primary/10 border border-accent-primary/20',
          )}>
            <p className="text-text-primary text-sm leading-relaxed break-words whitespace-pre-wrap">
              {message.content}
            </p>
          </div>
          <span className="text-[11px] text-text-muted mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(message.timestamp)}
          </span>
        </div>

        {/* User avatar */}
        <div className="flex-shrink-0 mt-1">
          <div className="w-7 h-7 rounded-lg bg-bg-tertiary flex items-center justify-center">
            <User size={14} className="text-text-secondary" />
          </div>
        </div>
      </div>
    );
  }

  // ===== AI MESSAGE =====
  return (
    <div className="flex gap-3 group px-4">
      {/* AI Avatar */}
      <div className="flex-shrink-0 mt-1">
        <div className="w-7 h-7 rounded-lg gradient-bg flex items-center justify-center shadow-sm">
          <Sparkles size={14} className="text-white" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-3xl space-y-2 min-w-0">
        {/* Thinking section */}
        {(message.thinking || message.reasoning) && (
          <div className="rounded-xl border border-border-subtle overflow-hidden bg-surface-default/50">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-surface-hover transition-colors"
            >
              <Brain size={14} className="text-accent-secondary" />
              <span className="text-xs font-medium text-text-secondary">Raisonnement</span>
              <div className="flex-1" />
              {showThinking ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
            </button>

            {showThinking && (
              <div className="px-3 py-2.5 border-t border-border-subtle space-y-2 bg-bg-primary/50">
                {message.reasoning?.map((step, idx) => (
                  <p key={idx} className="text-xs text-text-tertiary leading-relaxed">{step}</p>
                )) || (
                  <p className="text-xs text-text-tertiary leading-relaxed">{message.thinking}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Main message */}
        <div className={cn(
          'rounded-2xl rounded-tl-md px-4 py-3 message-enter',
          message.isError
            ? 'bg-accent-error/10 border border-accent-error/20'
            : 'bg-surface-default border border-border-subtle'
        )}>
          <div
            ref={textRef}
            className={cn(
              'prose prose-sm max-w-none',
              'prose-headings:text-text-primary prose-p:text-text-primary prose-strong:text-text-primary',
              'prose-a:text-accent-primary prose-a:no-underline hover:prose-a:underline',
              'prose-code:text-accent-primary prose-code:bg-bg-tertiary prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs',
              'prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0',
              message.isError && 'text-accent-error'
            )}
          >
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>,
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-accent-primary hover:underline"
                    onClick={(e) => {
                      // Grand public: empêcher la navigation interne, ouvrir via wrapper sécurisé
                      e.preventDefault();
                      if (href) void openExternalUrl(String(href));
                    }}
                  >
                    {children}
                  </a>
                ),
                code: ({ inline, className, children, ...props }: any) => {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : 'text';

                  if (inline) {
                    return (
                      <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-xs text-accent-primary font-mono" {...props}>
                        {children}
                      </code>
                    );
                  }

                  const raw = String(children).replace(/\n$/, '');
                  const isShell =
                    ['bash', 'sh', 'shell', 'zsh', 'cmd', 'powershell'].includes(language.toLowerCase());
                  if (isShell && raw.trim()) {
                    const cmdText = raw.trim();
                    const cardId = `${message.id}::cmd::${Math.abs(hashCode(cmdText))}`;
                    // Ensure a stable card exists (Trae/Claude cowork-style command card)
                    ensureCard({
                      id: cardId,
                      messageId: message.id,
                      command: cmdText,
                      title: 'Commande proposée',
                      projectId: selectedProjectId,
                      projectPath: selectedProjectPath,
                    });
                    // Auto-run mode (safe only)
                    if (selectedProjectPath) {
                      const auto = shouldAutoRunCommand(cmdText, settings);
                      if (auto.ok) void commandCardService.run(cardId);
                    }
                    // The card will be rendered below the message; keep markdown clean.
                    return <span className="hidden" />;
                  }

                  return (
                    <CodeBlock
                      language={language}
                      code={raw}
                    />
                  );
                },
                ul: ({ children }) => <ul className="list-disc list-inside text-sm mb-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside text-sm mb-2 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-3 border-accent-primary pl-3 my-2 text-sm italic text-text-secondary">{children}</blockquote>
                ),
                h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-4 first:mt-0">{children}</h1>,
                h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2 first:mt-0">{children}</h3>,
                table: ({ children }) => (
                  <div className="overflow-x-auto my-2 rounded-lg border border-border-subtle">
                    <table className="text-sm border-collapse w-full">{children}</table>
                  </div>
                ),
                td: ({ children }) => <td className="border-t border-border-subtle px-3 py-2">{children}</td>,
                th: ({ children }) => <th className="px-3 py-2 bg-bg-tertiary font-semibold text-left text-xs uppercase tracking-wide">{children}</th>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </div>

        {/* Command Cards docked under message (Trae/Claude cowork-like) */}
        {cardsForThisMessage.length > 0 && (
          <div className="space-y-2">
            {cardsForThisMessage.map((id) => (
              <CommandCard key={id} cardId={id} />
            ))}
          </div>
        )}

        {/* Actions bar */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {/* Copy */}
          <button
            onClick={handleCopy}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all duration-200',
              'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
            )}
          >
            {copied ? <Check size={13} className="text-accent-success" /> : <Copy size={13} />}
            <span>{copied ? 'Copié' : 'Copier'}</span>
          </button>

          {/* Regenerate */}
          <button
            onClick={onRegenerate}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-all duration-200"
          >
            <RefreshCw size={13} />
            <span>Régénérer</span>
          </button>

          {/* Separator */}
          <div className="w-px h-3 bg-border-subtle mx-1" />

          {/* Feedback */}
          <button
            onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
            className={cn(
              'p-1 rounded-lg transition-all duration-200',
              feedback === 'up' ? 'text-accent-success bg-accent-success/10' : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
            )}
          >
            <ThumbsUp size={13} />
          </button>
          <button
            onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
            className={cn(
              'p-1 rounded-lg transition-all duration-200',
              feedback === 'down' ? 'text-accent-error bg-accent-error/10' : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
            )}
          >
            <ThumbsDown size={13} />
          </button>

          {/* Timestamp */}
          <span className="ml-auto text-[11px] text-text-muted">
            {formatTime(message.timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
