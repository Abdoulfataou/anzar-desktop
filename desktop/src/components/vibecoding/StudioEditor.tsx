/**
 * StudioEditor — Éditeur de code avec tabs pour le VibeCoding Studio.
 *
 * Features :
 *  - Système de tabs (ouvrir/fermer/naviguer)
 *  - Syntax highlighting (réutilise le tokenizer de CodeEditor)
 *  - Indicateur "generating" quand le fichier est en cours de génération
 *  - Éditable en mode itération
 *  - Numéros de ligne, copy, word wrap
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  X, Copy, Check, FileCode, WrapText,
  Loader2, ChevronLeft, ChevronRight,
  GitCompare, Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StudioFile } from './VibeCodingStudio';

// ============================================================================
// SYNTAX HIGHLIGHTING (repris de CodeEditor — version compacte)
// ============================================================================

const KEYWORDS: Record<string, Set<string>> = {
  ts: new Set(['import','export','from','const','let','var','function','return','if','else','for','while','switch','case','break','continue','new','this','class','extends','implements','interface','type','enum','async','await','try','catch','finally','throw','default','typeof','instanceof','in','of','as','readonly','private','public','protected','static','abstract','void','null','undefined','true','false']),
  py: new Set(['import','from','def','class','return','if','elif','else','for','while','break','continue','try','except','finally','raise','with','as','pass','yield','lambda','and','or','not','in','is','None','True','False','async','await','global','nonlocal','del','assert']),
  go: new Set(['package','import','func','var','const','type','struct','interface','map','chan','go','select','case','default','if','else','for','range','switch','return','break','continue','defer','nil','true','false']),
  css: new Set([]),
  html: new Set([]),
  json: new Set(['true','false','null']),
};
KEYWORDS.tsx = KEYWORDS.ts;
KEYWORDS.jsx = KEYWORDS.ts;
KEYWORDS.js = KEYWORDS.ts;
KEYWORDS.java = KEYWORDS.ts;
KEYWORDS.rs = new Set(['fn','let','mut','const','static','struct','enum','impl','trait','pub','use','mod','crate','self','super','if','else','for','while','loop','match','return','break','continue','as','ref','move','async','await','where','type','true','false','unsafe']);

const TC: Record<string, string> = {
  kw: 'text-accent-secondary',
  str: 'text-accent-success',
  cmt: 'text-text-muted italic',
  num: 'text-accent-warning',
  fn: 'text-accent-info',
  tp: 'text-accent-primary',
  op: 'text-text-secondary',
  tag: 'text-accent-error',
};

function tokenize(line: string, lang: string): React.ReactNode[] {
  const kws = KEYWORDS[lang] || KEYWORDS.js || new Set();
  const out: React.ReactNode[] = [];
  let i = 0;

  while (i < line.length) {
    // Comments
    if (line.slice(i, i+2) === '//' || (lang === 'py' && line[i] === '#')) {
      out.push(<span key={i} className={TC.cmt}>{line.slice(i)}</span>);
      return out;
    }
    // Strings
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const q = line[i]; let j = i + 1;
      while (j < line.length && line[j] !== q) { if (line[j] === '\\') j++; j++; }
      j = Math.min(j + 1, line.length);
      out.push(<span key={i} className={TC.str}>{line.slice(i, j)}</span>);
      i = j; continue;
    }
    // Numbers
    if (/\d/.test(line[i]) && (i === 0 || /\W/.test(line[i-1]))) {
      let j = i; while (j < line.length && /[\d.xXa-fA-F_]/.test(line[j])) j++;
      out.push(<span key={i} className={TC.num}>{line.slice(i, j)}</span>);
      i = j; continue;
    }
    // Tags (HTML/JSX)
    if ((lang === 'html' || lang === 'tsx' || lang === 'jsx') && line[i] === '<') {
      let j = i + 1; if (line[j] === '/') j++;
      while (j < line.length && /[\w.-]/.test(line[j])) j++;
      if (j > i + 1) { out.push(<span key={i} className={TC.tag}>{line.slice(i, j)}</span>); i = j; continue; }
    }
    // Words
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i; while (j < line.length && /[\w$]/.test(line[j])) j++;
      const w = line.slice(i, j);
      if (kws.has(w)) out.push(<span key={i} className={TC.kw}>{w}</span>);
      else if (j < line.length && line[j] === '(') out.push(<span key={i} className={TC.fn}>{w}</span>);
      else if (w[0] === w[0].toUpperCase() && /[a-z]/.test(w.slice(1))) out.push(<span key={i} className={TC.tp}>{w}</span>);
      else out.push(<span key={i}>{w}</span>);
      i = j; continue;
    }
    // Operators
    if (/[+\-*/%=!<>&|^~?:]/.test(line[i])) {
      let j = i; while (j < line.length && /[+\-*/%=!<>&|^~?:]/.test(line[j])) j++;
      out.push(<span key={i} className={TC.op}>{line.slice(i, j)}</span>);
      i = j; continue;
    }
    out.push(<span key={i}>{line[i]}</span>);
    i++;
  }
  return out;
}

function detectLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const m: Record<string, string> = {
    ts:'ts',tsx:'tsx',js:'js',jsx:'jsx',py:'py',rs:'rs',go:'go',java:'java',
    css:'css',scss:'css',html:'html',htm:'html',json:'json',md:'json',
    yaml:'json',yml:'json',toml:'json',xml:'html',c:'java',cpp:'java',
    sh:'py',bash:'py',sql:'py',
  };
  return m[ext] || 'js';
}

// ============================================================================
// TYPES
// ============================================================================

interface StudioEditorProps {
  files: StudioFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  isGenerating?: boolean;
  /** Callback when user edits a file manually */
  onFileChange?: (path: string, newContent: string) => void;
  /** Callback to revert a file to its previous content */
  onFileRevert?: (path: string) => void;
}

// ============================================================================
// SIMPLE DIFF ENGINE (ligne par ligne, LCS-based)
// ============================================================================

interface DiffLine {
  type: 'same' | 'add' | 'remove';
  content: string;
  lineOld?: number;
  lineNew?: number;
}

/** Compute a simple line-level diff between two strings */
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Simple LCS for small files, fall back to naive for large ones
  const MAX_LCS = 500;
  if (oldLines.length > MAX_LCS || newLines.length > MAX_LCS) {
    return naiveDiff(oldLines, newLines);
  }

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'same', content: oldLines[i - 1], lineOld: i, lineNew: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'add', content: newLines[j - 1], lineNew: j });
      j--;
    } else {
      stack.push({ type: 'remove', content: oldLines[i - 1], lineOld: i });
      i--;
    }
  }

  while (stack.length) result.push(stack.pop()!);
  return result;
}

/** Fallback for large files: show removed then added blocks */
function naiveDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  // Find common prefix
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    result.push({ type: 'same', content: oldLines[prefix], lineOld: prefix + 1, lineNew: prefix + 1 });
    prefix++;
  }
  // Find common suffix
  let suffixOld = oldLines.length - 1;
  let suffixNew = newLines.length - 1;
  const suffixLines: DiffLine[] = [];
  while (suffixOld > prefix && suffixNew > prefix && oldLines[suffixOld] === newLines[suffixNew]) {
    suffixLines.unshift({ type: 'same', content: oldLines[suffixOld], lineOld: suffixOld + 1, lineNew: suffixNew + 1 });
    suffixOld--; suffixNew--;
  }
  // Middle: removed then added
  for (let i = prefix; i <= suffixOld; i++) {
    result.push({ type: 'remove', content: oldLines[i], lineOld: i + 1 });
  }
  for (let j = prefix; j <= suffixNew; j++) {
    result.push({ type: 'add', content: newLines[j], lineNew: j + 1 });
  }
  result.push(...suffixLines);
  return result;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const StudioEditor: React.FC<StudioEditorProps> = ({
  files,
  selectedFile,
  onSelectFile,
  isGenerating = false,
  onFileChange,
  onFileRevert,
}) => {
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-ajouter le fichier sélectionné aux tabs
  useEffect(() => {
    if (selectedFile && !openTabs.includes(selectedFile)) {
      setOpenTabs(prev => [...prev, selectedFile]);
    }
  }, [selectedFile]);

  // Fichier actif
  const activeFile = useMemo(() => {
    return files.find(f => f.path === selectedFile) || null;
  }, [files, selectedFile]);

  const lines = useMemo(() => {
    return (activeFile?.content || '').split('\n');
  }, [activeFile?.content]);

  const lang = useMemo(() => {
    return activeFile ? detectLang(activeFile.path) : 'js';
  }, [activeFile?.path]);

  // Close tab
  const handleCloseTab = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const next = prev.filter(t => t !== path);
      if (selectedFile === path) {
        onSelectFile(next[next.length - 1] || '');
      }
      return next;
    });
  }, [selectedFile, onSelectFile]);

  // Copy
  const handleCopy = useCallback(async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeFile]);

  // Sync scroll
  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const st = scrollRef.current.scrollTop;
      const sl = scrollRef.current.scrollLeft;
      if (lineNumRef.current) lineNumRef.current.scrollTop = st;
      if (highlightRef.current) {
        highlightRef.current.scrollTop = st;
        highlightRef.current.scrollLeft = sl;
      }
    }
  }, []);

  const fileName = selectedFile?.split('/').pop() || '';

  // Check if this file has a previous version (for diff)
  const hasPrevious = !!(activeFile?.previousContent && activeFile.previousContent !== activeFile.content);

  // Compute diff when in diff mode
  const diffLines = useMemo(() => {
    if (!showDiff || !activeFile?.previousContent) return [];
    return computeDiff(activeFile.previousContent, activeFile.content);
  }, [showDiff, activeFile?.previousContent, activeFile?.content]);

  // Diff stats
  const diffStats = useMemo(() => {
    if (!diffLines.length) return { added: 0, removed: 0 };
    return {
      added: diffLines.filter(d => d.type === 'add').length,
      removed: diffLines.filter(d => d.type === 'remove').length,
    };
  }, [diffLines]);

  // Auto-disable diff mode when switching files
  useEffect(() => { setShowDiff(false); }, [selectedFile]);

  const isEditable = !isGenerating && activeFile?.status !== 'generating' && activeFile?.status !== 'pending';

  // Handle text edit
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!activeFile || !onFileChange) return;
    onFileChange(activeFile.path, e.target.value);
  }, [activeFile, onFileChange]);

  // Sync textarea scroll with line numbers and highlight
  const handleTextareaScroll = useCallback(() => {
    if (textareaRef.current) {
      const st = textareaRef.current.scrollTop;
      const sl = textareaRef.current.scrollLeft;
      if (lineNumRef.current) lineNumRef.current.scrollTop = st;
      if (highlightRef.current) {
        highlightRef.current.scrollTop = st;
        highlightRef.current.scrollLeft = sl;
      }
    }
  }, []);

  // Handle tab key in textarea
  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const newVal = val.substring(0, start) + '  ' + val.substring(end);
      if (onFileChange && activeFile) {
        onFileChange(activeFile.path, newVal);
        // Restore cursor position
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    }
  }, [activeFile, onFileChange]);

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* ── Tab bar ── */}
      <div className="flex items-center bg-bg-secondary/50 border-b border-border-subtle flex-shrink-0 overflow-x-auto scrollbar-none">
        {openTabs.map(tabPath => {
          const f = files.find(x => x.path === tabPath);
          const isActive = tabPath === selectedFile;
          const tabName = tabPath.split('/').pop() || tabPath;
          return (
            <button
              key={tabPath}
              onClick={() => onSelectFile(tabPath)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-[12px] border-r border-border-subtle whitespace-nowrap transition-colors group min-w-0',
                isActive
                  ? 'bg-bg-primary text-text-primary border-b-2 border-b-accent-primary'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
              )}
            >
              {f?.status === 'generating' ? (
                <Loader2 size={12} className="text-accent-primary animate-spin flex-shrink-0" />
              ) : (
                <FileCode size={12} className={cn('flex-shrink-0', isActive ? 'text-accent-primary' : 'text-text-muted')} />
              )}
              <span className="truncate max-w-[120px]">{tabName}</span>
              {f?.status === 'modified' && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
              )}
              <span
                onClick={(e) => handleCloseTab(tabPath, e)}
                className="ml-1 p-0.5 rounded hover:bg-bg-tertiary text-text-muted/50 hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              >
                <X size={10} />
              </span>
            </button>
          );
        })}

        {/* Spacer + toolbar */}
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 px-2 flex-shrink-0">
          <button
            onClick={() => setWordWrap(!wordWrap)}
            className={cn(
              'p-1 rounded transition-colors',
              wordWrap ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted hover:bg-surface-hover'
            )}
            title="Retour à la ligne"
          >
            <WrapText size={13} />
          </button>
          <button
            onClick={handleCopy}
            className="p-1 rounded text-text-muted hover:bg-surface-hover transition-colors"
            title="Copier"
          >
            {copied ? <Check size={13} className="text-accent-success" /> : <Copy size={13} />}
          </button>
          {hasPrevious && (
            <>
              <button
                onClick={() => setShowDiff(!showDiff)}
                className={cn(
                  'p-1 rounded transition-colors',
                  showDiff ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted hover:bg-surface-hover'
                )}
                title="Voir les différences"
              >
                <GitCompare size={13} />
              </button>
              {onFileRevert && (
                <button
                  onClick={() => activeFile && onFileRevert(activeFile.path)}
                  className="p-1 rounded text-text-muted hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                  title="Revenir à la version précédente"
                >
                  <Undo2 size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Editor body ── */}
      {activeFile ? (
        <div className="flex-1 overflow-hidden relative font-mono text-[13px] leading-6">
          {/* Generating overlay */}
          {activeFile.status === 'generating' && (
            <div className="absolute top-2 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-primary/10 border border-accent-primary/20 text-[10px] text-accent-primary font-medium">
              <Loader2 size={10} className="animate-spin" />
              Génération en cours...
            </div>
          )}

          {/* ── DIFF VIEW ── */}
          {showDiff && diffLines.length > 0 ? (
            <div className="absolute inset-0 overflow-auto">
              <div className="py-3">
                {diffLines.map((dl, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex h-6 items-center',
                      dl.type === 'add' && 'bg-emerald-500/10',
                      dl.type === 'remove' && 'bg-red-500/10',
                    )}
                  >
                    {/* Old line number */}
                    <div className={cn(
                      'w-10 flex-shrink-0 text-right pr-2 text-[11px] select-none',
                      dl.type === 'add' ? 'text-transparent' : 'text-text-muted/40',
                    )}>
                      {dl.lineOld ?? ''}
                    </div>
                    {/* New line number */}
                    <div className={cn(
                      'w-10 flex-shrink-0 text-right pr-2 text-[11px] select-none',
                      dl.type === 'remove' ? 'text-transparent' : 'text-text-muted/40',
                    )}>
                      {dl.lineNew ?? ''}
                    </div>
                    {/* Gutter marker */}
                    <div className={cn(
                      'w-5 flex-shrink-0 text-center text-[12px] font-bold select-none',
                      dl.type === 'add' && 'text-emerald-400',
                      dl.type === 'remove' && 'text-red-400',
                      dl.type === 'same' && 'text-text-muted/20',
                    )}>
                      {dl.type === 'add' ? '+' : dl.type === 'remove' ? '−' : ' '}
                    </div>
                    {/* Code content */}
                    <div className={cn(
                      'flex-1 px-3 whitespace-pre overflow-hidden',
                      dl.type === 'add' && 'text-emerald-300',
                      dl.type === 'remove' && 'text-red-300 line-through opacity-70',
                      dl.type === 'same' && 'text-text-primary',
                    )}>
                      {dl.type === 'same' ? tokenize(dl.content, lang) : dl.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Line numbers */}
              <div
                ref={lineNumRef}
                className="absolute left-0 top-0 bottom-0 w-12 overflow-hidden bg-bg-secondary/20 border-r border-border-subtle select-none z-10"
              >
                <div className="py-3">
                  {lines.map((_, i) => (
                    <div key={i} className="h-6 flex items-center justify-end pr-3 text-[11px] text-text-muted/40">
                      {i + 1}
                    </div>
                  ))}
                </div>
              </div>

              {/* Syntax highlighted layer (behind textarea) */}
              <div
                ref={highlightRef}
                className="absolute left-12 top-0 right-0 bottom-0 overflow-hidden pointer-events-none"
                aria-hidden
              >
                <div className={cn(
                  'py-3 px-4 text-text-primary',
                  wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                )}>
                  {lines.map((line, i) => (
                    <div key={i} className="h-6">
                      {tokenize(line, lang)}
                    </div>
                  ))}
                </div>
              </div>

              {/* Editable textarea (on top, transparent text, visible caret) */}
              {isEditable ? (
                <textarea
                  ref={textareaRef}
                  value={activeFile.content}
                  onChange={handleTextChange}
                  onScroll={handleTextareaScroll}
                  onKeyDown={handleTextareaKeyDown}
                  className={cn(
                    'absolute left-12 top-0 right-0 bottom-0 py-3 px-4 bg-transparent text-transparent caret-text-primary resize-none outline-none font-mono text-[13px] leading-6 z-10 selection:bg-accent-primary/20',
                    wordWrap ? 'whitespace-pre-wrap break-all overflow-y-auto overflow-x-hidden' : 'whitespace-pre overflow-auto'
                  )}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              ) : (
                <div
                  ref={scrollRef}
                  className="absolute left-12 top-0 right-0 bottom-0 overflow-auto z-10"
                  onScroll={handleScroll}
                >
                  <div className={cn(
                    'py-3 px-4 text-transparent',
                    wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                  )}>
                    {/* Transparent layer for scroll sync in read-only mode */}
                    {lines.map((_, i) => (
                      <div key={i} className="h-6">&nbsp;</div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          Sélectionne un fichier pour voir le code
        </div>
      )}

      {/* ── Footer ── */}
      {activeFile && (
        <div className="flex items-center justify-between px-4 py-1 border-t border-border-subtle bg-bg-secondary/30 text-[11px] text-text-muted flex-shrink-0">
          <div className="flex items-center gap-3">
            <span>{lines.length} lignes</span>
            <span>{activeFile.content.length} car.</span>
            {showDiff && diffStats.added + diffStats.removed > 0 && (
              <>
                <span className="text-emerald-400">+{diffStats.added}</span>
                <span className="text-red-400">−{diffStats.removed}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="uppercase">{lang}</span>
            <span>UTF-8</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudioEditor;
