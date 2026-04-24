/**
 * CodeEditor - Éditeur de code intégré au workspace
 * Coloration syntaxique, numéros de ligne, édition en temps réel
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Save, Copy, Check, X, FileCode,
  WrapText, Sparkles, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFIMCompletion } from '@/hooks/useFIMCompletion';

interface CodeEditorProps {
  filePath: string;
  content: string;
  language: string;
  onSave?: (content: string) => void;
  onChange?: (content: string) => void;
  readOnly?: boolean;
}

/* ===== Syntax token colors by language ===== */
const TOKEN_COLORS: Record<string, string> = {
  keyword: 'text-accent-secondary',
  string: 'text-accent-success',
  comment: 'text-text-muted italic',
  number: 'text-accent-warning',
  function: 'text-accent-info',
  type: 'text-accent-primary',
  operator: 'text-text-secondary',
  tag: 'text-accent-error',
  attribute: 'text-accent-warning',
  punctuation: 'text-text-muted',
};

/* ===== Language keyword sets ===== */
const KEYWORDS: Record<string, Set<string>> = {
  ts: new Set(['import', 'export', 'from', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'implements', 'interface', 'type', 'enum', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'default', 'typeof', 'instanceof', 'in', 'of', 'as', 'readonly', 'private', 'public', 'protected', 'static', 'abstract', 'void', 'null', 'undefined', 'true', 'false']),
  tsx: new Set(['import', 'export', 'from', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'implements', 'interface', 'type', 'enum', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'default', 'typeof', 'instanceof', 'in', 'of', 'as', 'readonly', 'private', 'public', 'protected', 'static', 'abstract', 'void', 'null', 'undefined', 'true', 'false']),
  js: new Set(['import', 'export', 'from', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'default', 'typeof', 'instanceof', 'in', 'of', 'void', 'null', 'undefined', 'true', 'false']),
  jsx: new Set(['import', 'export', 'from', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'default', 'typeof', 'instanceof', 'in', 'of', 'void', 'null', 'undefined', 'true', 'false']),
  py: new Set(['import', 'from', 'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'try', 'except', 'finally', 'raise', 'with', 'as', 'pass', 'yield', 'lambda', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'async', 'await', 'global', 'nonlocal', 'del', 'assert']),
  rs: new Set(['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'if', 'else', 'for', 'while', 'loop', 'match', 'return', 'break', 'continue', 'as', 'ref', 'move', 'async', 'await', 'where', 'type', 'true', 'false', 'unsafe']),
  go: new Set(['package', 'import', 'func', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'select', 'case', 'default', 'if', 'else', 'for', 'range', 'switch', 'return', 'break', 'continue', 'defer', 'nil', 'true', 'false']),
  java: new Set(['import', 'package', 'public', 'private', 'protected', 'static', 'final', 'abstract', 'class', 'interface', 'extends', 'implements', 'new', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'void', 'null', 'true', 'false', 'this', 'super', 'instanceof']),
  css: new Set([]),
  html: new Set([]),
  json: new Set(['true', 'false', 'null']),
  md: new Set([]),
};

/* ===== Simple tokenizer for syntax highlighting ===== */
function tokenizeLine(line: string, lang: string): React.ReactNode[] {
  const keywords = KEYWORDS[lang] || KEYWORDS['js'] || new Set();
  const tokens: React.ReactNode[] = [];
  let i = 0;

  while (i < line.length) {
    // Comments
    if (line.slice(i, i + 2) === '//' || (lang === 'py' && line[i] === '#')) {
      tokens.push(
        <span key={i} className={TOKEN_COLORS.comment}>{line.slice(i)}</span>
      );
      return tokens;
    }

    // Strings
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, line.length);
      tokens.push(
        <span key={i} className={TOKEN_COLORS.string}>{line.slice(i, j)}</span>
      );
      i = j;
      continue;
    }

    // Numbers
    if (/\d/.test(line[i]) && (i === 0 || /\W/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[\d.xXa-fA-F_]/.test(line[j])) j++;
      tokens.push(
        <span key={i} className={TOKEN_COLORS.number}>{line.slice(i, j)}</span>
      );
      i = j;
      continue;
    }

    // HTML/JSX tags
    if ((lang === 'html' || lang === 'tsx' || lang === 'jsx') && line[i] === '<') {
      let j = i + 1;
      if (line[j] === '/') j++;
      while (j < line.length && /[\w.-]/.test(line[j])) j++;
      if (j > i + 1) {
        tokens.push(
          <span key={i} className={TOKEN_COLORS.tag}>{line.slice(i, j)}</span>
        );
        i = j;
        continue;
      }
    }

    // Words (keywords, identifiers)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[\w$]/.test(line[j])) j++;
      const word = line.slice(i, j);

      if (keywords.has(word)) {
        tokens.push(
          <span key={i} className={TOKEN_COLORS.keyword}>{word}</span>
        );
      } else if (j < line.length && line[j] === '(') {
        tokens.push(
          <span key={i} className={TOKEN_COLORS.function}>{word}</span>
        );
      } else if (word[0] === word[0].toUpperCase() && /[a-z]/.test(word.slice(1))) {
        tokens.push(
          <span key={i} className={TOKEN_COLORS.type}>{word}</span>
        );
      } else {
        tokens.push(<span key={i}>{word}</span>);
      }
      i = j;
      continue;
    }

    // Operators & punctuation
    if (/[+\-*/%=!<>&|^~?:]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[+\-*/%=!<>&|^~?:]/.test(line[j])) j++;
      tokens.push(
        <span key={i} className={TOKEN_COLORS.operator}>{line.slice(i, j)}</span>
      );
      i = j;
      continue;
    }

    // Everything else
    tokens.push(<span key={i}>{line[i]}</span>);
    i++;
  }

  return tokens;
}

/* ===== Detect language from file extension ===== */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx',
    py: 'py', rs: 'rs', go: 'go', java: 'java',
    css: 'css', scss: 'css', html: 'html', htm: 'html',
    json: 'json', md: 'md', txt: 'md',
    yaml: 'json', yml: 'json', toml: 'json', xml: 'html',
    c: 'java', cpp: 'java', h: 'java', hpp: 'java',
    sh: 'py', bash: 'py', zsh: 'py',
    sql: 'py', graphql: 'js', gql: 'js',
  };
  return map[ext] || 'js';
}

const CodeEditor: React.FC<CodeEditorProps> = ({
  filePath,
  content,
  language,
  onSave,
  onChange,
  readOnly = false,
}) => {
  const [editedContent, setEditedContent] = useState(content);
  const [hasChanges, setHasChanges] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [fimEnabled, setFimEnabled] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const lang = useMemo(() => detectLanguage(filePath), [filePath]);

  // FIM autocompletion (DeepSeek)
  const {
    suggestion: fimSuggestion,
    isLoading: fimLoading,
    requestCompletion,
    acceptSuggestion,
    dismissSuggestion,
  } = useFIMCompletion({ enabled: fimEnabled && !readOnly });

  // Sync content when file changes
  useEffect(() => {
    setEditedContent(content);
    setHasChanges(false);
  }, [content, filePath]);

  const lines = useMemo(() => editedContent.split('\n'), [editedContent]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setEditedContent(newContent);
    setHasChanges(newContent !== content);
    onChange?.(newContent);

    // Déclencher l'autocomplétion FIM après chaque frappe
    dismissSuggestion();
    if (fimEnabled && textareaRef.current) {
      requestCompletion(newContent, textareaRef.current.selectionStart);
    }
  }, [content, onChange, fimEnabled, requestCompletion, dismissSuggestion]);

  const handleSave = useCallback(() => {
    onSave?.(editedContent);
    setHasChanges(false);
  }, [editedContent, onSave]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(editedContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [editedContent]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  }, [handleSave]);

  // Sync scroll between textarea and line numbers / highlight
  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      const scrollTop = textareaRef.current.scrollTop;
      const scrollLeft = textareaRef.current.scrollLeft;
      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = scrollTop;
      }
      if (highlightRef.current) {
        highlightRef.current.scrollTop = scrollTop;
        highlightRef.current.scrollLeft = scrollLeft;
      }
    }
  }, []);

  // Tab support + FIM accept
  const handleTab = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      // Si une suggestion FIM est active, l'accepter avec Tab
      if (fimSuggestion?.isVisible) {
        e.preventDefault();
        const result = acceptSuggestion(editedContent);
        if (result) {
          setEditedContent(result.newContent);
          setHasChanges(result.newContent !== content);
          onChange?.(result.newContent);
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = result.newCursorPosition;
              textareaRef.current.selectionEnd = result.newCursorPosition;
            }
          }, 0);
        }
        return;
      }

      // Sinon, insérer une tabulation
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = editedContent.substring(0, start) + '  ' + editedContent.substring(end);
      setEditedContent(newContent);
      setHasChanges(newContent !== content);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }

    // Escape pour rejeter la suggestion FIM
    if (e.key === 'Escape' && fimSuggestion?.isVisible) {
      dismissSuggestion();
    }
  }, [editedContent, content, fimSuggestion, acceptSuggestion, dismissSuggestion, onChange]);

  const fileName = filePath.split('/').pop() || filePath;

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-bg-secondary/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FileCode size={14} className="text-accent-primary" />
            <span className="text-sm font-medium text-text-primary truncate max-w-[300px]">
              {fileName}
            </span>
          </div>
          {hasChanges && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-accent-warning/15 text-accent-warning">
              Modifié
            </span>
          )}
          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-bg-tertiary text-text-muted uppercase">
            {lang}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {!readOnly && (
            <button
              onClick={() => setFimEnabled(!fimEnabled)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors',
                fimEnabled ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-muted hover:bg-surface-hover'
              )}
              title="Autocomplétion IA (DeepSeek FIM)"
            >
              {fimLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              IA
            </button>
          )}
          <button
            onClick={() => setWordWrap(!wordWrap)}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              wordWrap ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-muted hover:bg-surface-hover'
            )}
            title="Retour à la ligne"
          >
            <WrapText size={14} />
          </button>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg text-text-muted hover:bg-surface-hover transition-colors"
            title="Copier"
          >
            {copied ? <Check size={14} className="text-accent-success" /> : <Copy size={14} />}
          </button>
          {!readOnly && hasChanges && (
            <>
              <button
                onClick={() => { setEditedContent(content); setHasChanges(false); }}
                className="p-1.5 rounded-lg text-text-muted hover:bg-surface-hover transition-colors"
                title="Annuler les modifications"
              >
                <X size={14} />
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium gradient-bg text-white hover:opacity-90 transition-all"
                title="Sauvegarder (Ctrl+S)"
              >
                <Save size={12} />
                Sauvegarder
              </button>
            </>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden relative font-mono text-[13px] leading-6">
        {/* Line numbers */}
        <div
          ref={lineNumbersRef}
          className="absolute left-0 top-0 bottom-0 w-12 overflow-hidden bg-bg-secondary/30 border-r border-border-subtle select-none z-10"
        >
          <div className="py-3">
            {lines.map((_, i) => (
              <div
                key={i}
                className="h-6 flex items-center justify-end pr-3 text-[11px] text-text-muted/50"
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Syntax highlighted overlay */}
        <div
          ref={highlightRef}
          className="absolute left-12 top-0 right-0 bottom-0 overflow-hidden pointer-events-none z-[1]"
        >
          <div className={cn('py-3 px-4 text-text-primary', wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>
            {lines.map((line, i) => (
              <div key={i} className="h-6">
                {tokenizeLine(line, lang)}
              </div>
            ))}
          </div>
        </div>

        {/* Actual textarea (transparent text, handles input) */}
        <textarea
          ref={textareaRef}
          value={editedContent}
          onChange={handleChange}
          onKeyDown={(e) => { handleKeyDown(e); handleTab(e); }}
          onScroll={handleScroll}
          readOnly={readOnly}
          spellCheck={false}
          className={cn(
            'absolute left-12 top-0 right-0 bottom-0 z-[2]',
            'py-3 px-4 bg-transparent text-transparent caret-accent-primary',
            'resize-none outline-none border-none',
            'selection:bg-accent-primary/20',
            wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-auto',
            readOnly && 'cursor-default'
          )}
        />
      </div>

      {/* Footer info bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border-subtle bg-bg-secondary/30 text-[11px] text-text-muted flex-shrink-0">
        <div className="flex items-center gap-3">
          <span>{lines.length} lignes</span>
          <span>{editedContent.length} caractères</span>
        </div>
        <div className="flex items-center gap-3">
          <span>UTF-8</span>
          <span>Espaces: 2</span>
          {fimSuggestion?.isVisible && (
            <span className="text-accent-primary/80 font-medium">
              Tab pour accepter · Esc pour rejeter
            </span>
          )}
          {!fimSuggestion?.isVisible && !readOnly && (
            <span className="text-text-muted/70">Ctrl+S pour sauvegarder</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default CodeEditor;
