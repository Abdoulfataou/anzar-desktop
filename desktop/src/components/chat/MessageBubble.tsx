'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Sparkles, Brain, RefreshCw, ThumbsUp, ThumbsDown, User, FileDown, FileText, Presentation, FileCheck, ExternalLink, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '@/services/infra/externalLinks';
import { exportToDocx, exportToPdf, isCorrection, cleanCorrectionForExport } from '@/services/export/documentExport';
import { exportToPptx } from '@/services/export/presentationExport';
import toast from 'react-hot-toast';
import type { Message } from '@/types';

interface MessageBubbleProps {
  message: Message;
  onCopy?: (text: string) => void;
  onRegenerate?: () => void;
  selectedProjectId?: string | null;
  selectedProjectPath?: string;
}

export default function MessageBubble({ message, onCopy, onRegenerate, selectedProjectId = null, selectedProjectPath }: MessageBubbleProps) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [expandedLong, setExpandedLong] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    onCopy?.(message.content);
    setTimeout(() => setCopied(false), 2000);
  };

  const LONG_THRESHOLD = 12000;
  const isLong = message.content.length > LONG_THRESHOLD && !message.isStreaming;
  const displayContent = useMemo(() => {
    if (!isLong) return message.content;
    if (expandedLong) return message.content;
    const head = message.content.slice(0, 6000);
    const tail = message.content.slice(-2000);
    const omitted = message.content.length - head.length - tail.length;
    return `${head}\n\n[... ${omitted} caractères masqués ...]\n\n${tail}`;
  }, [message.content, isLong, expandedLong, message.isStreaming]);

  // Detect correction content → export propre par défaut (sans annotations)
  const contentIsCorrection = useMemo(() => isCorrection(message.content), [message.content]);

  const handleExportDocx = async (annotated = false) => {
    if (exporting) return;
    setExporting('docx');
    try {
      const content = (!annotated && contentIsCorrection)
        ? cleanCorrectionForExport(message.content)
        : message.content;
      const suffix = (!annotated && contentIsCorrection) ? '_corrige' : '';
      await exportToDocx(content, `anzar_document${suffix}_${Date.now()}.docx`);
    } catch (err) {
      console.error('Export DOCX failed:', err);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async (annotated = false) => {
    if (exporting) return;
    setExporting('pdf');
    try {
      const content = (!annotated && contentIsCorrection)
        ? cleanCorrectionForExport(message.content)
        : message.content;
      const suffix = (!annotated && contentIsCorrection) ? '_corrige' : '';
      await exportToPdf(content, `anzar_document${suffix}_${Date.now()}.pdf`);
    } catch (err) {
      console.error('Export PDF failed:', err);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPptx = async () => {
    if (exporting || exportingPptx) return;
    setExportingPptx(true);
    const t = toast.loading('Structuration IA + generation PowerPoint…');
    try {
      await exportToPptx(message.content);
      toast.success('PowerPoint exporté avec succes', { id: t });
    } catch (err: any) {
      console.error('Export PPTX failed:', err);
      const msg = err?.message?.includes('scope')
        ? 'Emplacement non autorise — choisis Documents ou Bureau'
        : 'Export PowerPoint echoue — verifie les permissions';
      toast.error(msg, { id: t });
    } finally {
      setExportingPptx(false);
    }
  };

  // En contexte vibecoding (projet sélectionné), on masque les exports document
  const isVibecoding = !!selectedProjectId;

  /** Show export buttons only for substantial document-like content — NEVER in vibecoding */
  const looksLikeDocument = (() => {
    if (isVibecoding) return false; // Pas d'export Word/PPTX/PDF en vibecoding
    const c = message.content;
    if (c.length < 500) return false; // Réponses courtes = pas d'export
    const hasHeadings = /(^|\n)#{1,3}\s/m.test(c);
    const hasLists = /(^|\n)[-*•]\s/m.test(c) || /(^|\n)\d+[.)]\s/m.test(c);
    const hasCodeBlocks = /```[\s\S]*?```/m.test(c);
    const hasMultipleParagraphs = (c.match(/\n\n/g) || []).length >= 2;
    // Au moins 2 indicateurs de structure documentaire
    const structureScore = [hasHeadings, hasLists, hasCodeBlocks, hasMultipleParagraphs].filter(Boolean).length;
    return structureScore >= 2 || c.length > 2000;
  })();

  const showExportButtons = looksLikeDocument && !message.isStreaming && !message.isError;

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // ===== USER MESSAGE =====
  if (message.role === 'user') {
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
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {message.attachments.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] border border-border-subtle bg-bg-tertiary/60 text-text-secondary"
                    title={a.name}
                  >
                    <span className="font-semibold">{a.ref || ''}</span>
                    <span className="truncate max-w-[220px]">{a.name}</span>
                  </span>
                ))}
              </div>
            )}
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
              remarkPlugins={[remarkGfm]}
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

                  return (
                    <CodeBlock
                      language={language}
                      code={raw}
                      hideActions={isVibecoding}
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
              {displayContent}
            </ReactMarkdown>
          </div>
          {isLong && (
            <button
              onClick={() => setExpandedLong((v) => !v)}
              className="mt-2 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              {expandedLong ? 'Afficher moins' : 'Afficher tout'}
            </button>
          )}
        </div>

        {/* Project action button — "Open & Run" after generation */}
        {message.actionProjectId && !message.isStreaming && (
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => navigate(`/projects/${message.actionProjectId}`)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 gradient-bg text-white shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
            >
              <Play size={15} />
              <span>Ouvrir et Lancer le projet</span>
              <ExternalLink size={13} className="opacity-60" />
            </button>
          </div>
        )}

        {/* Actions bar */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {/* Copy — masqué en vibecoding */}
          {!isVibecoding && (
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
          )}

          {/* Regenerate / Retry */}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-all duration-200"
            >
              <RefreshCw size={13} />
              <span>{message.isError ? 'Réessayer' : 'Régénérer'}</span>
            </button>
          )}

          {/* Rapport d'erreur retiré — inutile pour l'utilisateur final */}

          {/* Export buttons — only for substantial responses */}
          {showExportButtons && (
            <>
              <div className="w-px h-3 bg-border-subtle mx-1" />

              {/* Correction → 2 boutons Word (propre + annoté) */}
              {contentIsCorrection ? (
                <>
                  <button
                    onClick={() => handleExportDocx(false)}
                    disabled={exporting !== null}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all duration-200',
                      exporting === 'docx'
                        ? 'text-accent-primary bg-accent-primary/10'
                        : 'text-text-muted hover:text-accent-primary hover:bg-accent-primary/10'
                    )}
                    title="Exporter le texte corrigé propre (sans annotations)"
                  >
                    <FileCheck size={13} />
                    <span>{exporting === 'docx' ? 'Export...' : 'Word propre'}</span>
                  </button>
                  <button
                    onClick={() => handleExportDocx(true)}
                    disabled={exporting !== null}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all duration-200',
                      'text-text-muted hover:text-amber-500 hover:bg-amber-500/10'
                    )}
                    title="Exporter avec les annotations et explications"
                  >
                    <FileText size={13} />
                    <span>Word annoté</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleExportDocx(false)}
                  disabled={exporting !== null}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all duration-200',
                    exporting === 'docx'
                      ? 'text-accent-primary bg-accent-primary/10'
                      : 'text-text-muted hover:text-accent-primary hover:bg-accent-primary/10'
                  )}
                >
                  <FileText size={13} />
                  <span>{exporting === 'docx' ? 'Export...' : 'Word'}</span>
                </button>
              )}

              <button
                onClick={handleExportPptx}
                disabled={exporting !== null || exportingPptx}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all duration-200',
                  exportingPptx
                    ? 'text-accent-secondary bg-accent-secondary/10'
                    : 'text-text-muted hover:text-accent-secondary hover:bg-accent-secondary/10'
                )}
              >
                <Presentation size={13} />
                <span>{exportingPptx ? 'Export...' : 'PPTX'}</span>
              </button>
              <button
                onClick={() => handleExportPdf(false)}
                disabled={exporting !== null}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all duration-200',
                  exporting === 'pdf'
                    ? 'text-accent-error bg-accent-error/10'
                    : 'text-text-muted hover:text-accent-error hover:bg-accent-error/10'
                )}
              >
                <FileDown size={13} />
                <span>{exporting === 'pdf' ? 'Export...' : 'PDF'}</span>
              </button>
            </>
          )}

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
