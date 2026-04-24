import React from 'react';
import { Sparkles, Copy, Check } from 'lucide-react';
import CodeBlock from './CodeBlock';

interface MessageAIProps {
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}

const MessageAI: React.FC<MessageAIProps> = ({
  content,
  timestamp,
  isStreaming = false,
  onCopy,
  copied = false,
}) => {
  // Simple detection of code blocks (for demo)
  const hasCode = content.includes('```');
  
  return (
    <div className="message-enter flex gap-4 max-w-3xl mx-auto px-8 py-6">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
          <Sparkles size={16} className="text-white" />
        </div>
      </div>

      {/* Message bubble */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium text-[var(--anzar-text)]">
            ANZAR
          </span>
          {timestamp && (
            <span className="text-xs text-[var(--anzar-text-muted)]">
              {timestamp}
            </span>
          )}
          {isStreaming && (
            <div className="typing-indicator">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>

        <div className="bg-[var(--anzar-surface)] border border-[var(--anzar-border)] rounded-2xl rounded-tl-sm p-5">
          {/* Content */}
          <div className="prose prose-invert max-w-none">
            <p className="text-[var(--anzar-text)] text-sm leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
            
            {/* Example code block (static for demo) */}
            {hasCode && (
              <div className="mt-4">
                <CodeBlock
                  language="typescript"
                  code={`const greet = (name: string) => {
  console.log(\`Hello \${name}!\`);
};`}
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[var(--anzar-border)]">
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:bg-[var(--anzar-elevated)] transition-colors text-sm"
              onClick={onCopy}
            >
              {copied ? (
                <>
                  <Check size={14} />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy
                </>
              )}
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:bg-[var(--anzar-elevated)] transition-colors text-sm">
              <Sparkles size={14} />
              Improve
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[var(--anzar-text-secondary)] hover:text-[var(--anzar-text)] hover:bg-[var(--anzar-elevated)] transition-colors text-sm">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              </svg>
              Explain
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageAI;