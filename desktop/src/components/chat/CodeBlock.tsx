import React, { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
  language?: string;
  code: string;
  showLineNumbers?: boolean;
  filename?: string;
  collapsible?: boolean;
  /** Hide copy buttons (vibecoding mode) */
  hideActions?: boolean;
}

const LANG_COLORS: Record<string, string> = {
  typescript: '#3178C6',
  javascript: '#F7DF1E',
  python: '#3776AB',
  rust: '#DEA584',
  go: '#00ADD8',
  java: '#ED8B00',
  css: '#1572B6',
  html: '#E34F26',
  json: '#A1A1AA',
  bash: '#89E051',
  sql: '#336791',
  graphql: '#E10098',
  tsx: '#3178C6',
  jsx: '#61DAFB',
  ruby: '#CC342D',
  php: '#777BB4',
  c: '#A8B9CC',
  cpp: '#00599C',
  csharp: '#239120',
  sh: '#89E051',
  shell: '#89E051',
  text: '#A1A1AA',
};

const CodeBlock: React.FC<CodeBlockProps> = ({
  language = 'text',
  code,
  showLineNumbers = true,
  hideActions = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split('\n');
  const lineCount = lines.length;
  const isLongBlock = lineCount > 25;
  const isShortBlock = lineCount <= 3 && code.length < 120;
  const langColor = LANG_COLORS[language] || '#71717A';

  // Short blocks (1-3 lines, e.g. filenames, short snippets) get a compact style
  if (isShortBlock) {
    return (
      <div className="my-2 rounded-lg overflow-hidden border border-border-subtle bg-bg-tertiary/60">
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {language && language !== 'text' && (
              <span className="flex items-center gap-1 text-[10px] font-mono text-text-muted">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: langColor }} />
                {language}
              </span>
            )}
            <pre className="flex-1 overflow-x-auto">
              <code className="font-mono text-[13px] text-text-primary whitespace-pre">{code}</code>
            </pre>
          </div>
          {!hideActions && (
            <button
              onClick={handleCopy}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all ml-2 flex-shrink-0',
                copied
                  ? 'text-accent-success'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copie' : 'Copier'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-border-subtle bg-bg-tertiary/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-bg-tertiary/80">
        <div className="flex items-center gap-2 min-w-0">
          {language && language !== 'text' && (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-text-muted">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: langColor }} />
              {language}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isLongBlock && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 hover:bg-bg-secondary rounded-lg text-text-muted hover:text-text-secondary transition-colors"
              title={isExpanded ? 'Reduire' : 'Developper'}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}

          {!hideActions && (
            <button
              onClick={handleCopy}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-200',
                copied
                  ? 'text-accent-success bg-accent-success/10'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-secondary'
              )}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copie' : 'Copier'}
            </button>
          )}
        </div>
      </div>

      {/* Code content */}
      {(!isLongBlock || isExpanded) && (
        <div className="flex overflow-x-auto max-h-[500px]">
          {showLineNumbers && (
            <div className="flex-shrink-0 py-3 px-3 text-right select-none border-r border-border-subtle/50 bg-bg-tertiary/40">
              {Array.from({ length: lineCount }, (_, i) => i + 1).map((num) => (
                <div key={num} className="text-[11px] font-mono text-text-muted/40 leading-6 h-6">{num}</div>
              ))}
            </div>
          )}
          <pre className="flex-1 py-3 px-4 overflow-x-auto overflow-y-hidden">
            <code className="font-mono text-[13px] text-text-primary whitespace-pre leading-6">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-6 hover:bg-bg-secondary/30 -mx-4 px-4 transition-colors',
                    i === lineCount - 1 && line === '' && 'hidden'
                  )}
                >
                  {line || ' '}
                </div>
              ))}
            </code>
          </pre>
        </div>
      )}

      {/* Collapsed */}
      {isLongBlock && !isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full px-4 py-3 text-xs text-text-muted bg-bg-tertiary/30 hover:bg-bg-tertiary/60 transition-colors text-center"
        >
          {lineCount} lignes — cliquez pour developper
        </button>
      )}
    </div>
  );
};

export default CodeBlock;
