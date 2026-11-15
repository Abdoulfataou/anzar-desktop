import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, ChevronRight, Sparkles, Brain, RefreshCw, FileDown, FileText, Presentation, FileCheck, ExternalLink, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import { ToolEventList } from './ToolCallBlock';
import FileChangesCard from './FileChangesCard';
import { MermaidBlock, SvgBlock, getVisualKind } from './VisualBlock';
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

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    onCopy?.(message.content);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const LONG_THRESHOLD = 25000;
  // Never truncate audit reports or structured reports — they need full context
  const isStructuredReport = /^#\s/.test(message.content.trim());
  const isLong = message.content.length > LONG_THRESHOLD && !message.isStreaming && !isStructuredReport;
  const displayContent = useMemo(() => {
    if (!isLong) return message.content;
    if (expandedLong) return message.content;
    const head = message.content.slice(0, 12000);
    const tail = message.content.slice(-4000);
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
    } catch (err: any) {
      console.error('Export DOCX failed:', err);
      const msg = err?.message?.includes('scope')
        ? 'Emplacement non autorisé — choisis Documents ou Bureau'
        : 'Export Word échoué — vérifie les permissions';
      toast.error(msg);
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
    } catch (err: any) {
      console.error('Export PDF failed:', err);
      const msg = err?.message?.includes('scope')
        ? 'Emplacement non autorisé — choisis Documents ou Bureau'
        : 'Export PDF échoué — vérifie les permissions';
      toast.error(msg);
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

  // ===== MESSAGE UTILISATEUR — bulle alignée à droite =====
  if (message.role === 'user') {
    return (
      <div className="group px-4 py-2">
        <div className="max-w-3xl mx-auto flex flex-col items-end">
          <div className="max-w-[80%] rounded-lg rounded-tr-[4px] bg-user-bubble px-4 py-3">
            <p className="text-ui-base leading-relaxed text-text-primary break-words whitespace-pre-wrap">
              {message.content}
            </p>
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {message.attachments.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-ui-sm font-mono border border-border-subtle bg-bg-primary/60 text-text-secondary"
                    title={a.name}
                  >
                    <span className="text-accent-primary font-semibold">{a.ref || ''}</span>
                    <span className="truncate max-w-[220px]">{a.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <span className="text-ui-xs text-text-muted mt-1 mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(message.timestamp)}
          </span>
        </div>
      </div>
    );
  }

  // Rendu Markdown partagé par tous les morceaux de texte de la réponse
  const mdComponents: Components = {
    p: ({ children }) => <p className="text-ui-base leading-[1.7] my-3 first:mt-0 last:mb-0">{children}</p>,
    a: ({ href, children }) => (
      <a
        href={href}
        className="font-medium text-link no-underline decoration-dotted underline-offset-4 hover:underline"
        onClick={(e) => {
          // Grand public: empêcher la navigation interne, ouvrir via wrapper sécurisé
          e.preventDefault();
          if (href) void openExternalUrl(String(href));
        }}
      >
        {children}
      </a>
    ),
    // Un bloc ``` est rendu par CodeBlock : <pre> ne doit rien ajouter autour.
    pre: ({ children }) => <div className="my-3 first:mt-0 last:mb-0">{children}</div>,
    code: ({ className, children, node: _node, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : 'text';

      // react-markdown 9 ne transmet plus `inline` : un code sans langage
      // et sur une seule ligne est du code en ligne (`comme ceci`).
      const isInline = !match && !String(children).includes('\n');
      if (isInline) {
        return (
          <code className="mx-0.5 rounded-md bg-inline-code px-1.5 py-0.5 font-mono text-ui-sm text-text-primary" {...props}>
            {children}
          </code>
        );
      }

      const raw = String(children).replace(/\n$/, '');

      // ── Visuels : les blocs mermaid/svg sont DESSINÉS, pas affichés en code ──
      const visualKind = getVisualKind(language, raw);
      if (visualKind === 'mermaid') return <MermaidBlock code={raw} />;
      if (visualKind === 'svg') return <SvgBlock code={raw} />;

      return (
        <CodeBlock
          language={language}
          code={raw}
          hideActions={isVibecoding}
        />
      );
    },
    ul: ({ children }) => <ul className="my-3 first:mt-0 last:mb-0 list-outside list-disc space-y-1.5 pl-5 marker:text-text-muted [&_ul]:my-1.5 [&_ol]:my-1.5">{children}</ul>,
    ol: ({ children }) => <ol className="my-3 first:mt-0 last:mb-0 list-inside list-decimal space-y-1.5 pl-0 marker:text-text-muted [&_ul]:my-1.5 [&_ol]:my-1.5">{children}</ol>,
    li: ({ children }) => <li className="pl-1 leading-[1.7] [&>p]:my-0 [&>p]:inline">{children}</li>,
    hr: () => <hr className="my-6 border-border-medium" />,
    strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
    blockquote: ({ children }) => (
      <blockquote className="my-4 border-l-2 border-border-strong pl-3 text-text-secondary [&_p]:my-0 [&_p+p]:mt-2">{children}</blockquote>
    ),
    h1: ({ children }) => <h1 className="mt-6 mb-4 first:mt-0 text-ui-xl font-semibold text-text-primary">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-6 mb-4 first:mt-0 text-ui-lg font-semibold text-text-primary">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-6 mb-4 first:mt-0 text-ui-base font-semibold text-text-primary">{children}</h3>,
    h4: ({ children }) => <h4 className="mt-6 mb-4 first:mt-0 text-ui-base font-semibold text-text-primary">{children}</h4>,
    h5: ({ children }) => <h5 className="mt-6 mb-4 first:mt-0 text-ui-base font-medium text-text-primary">{children}</h5>,
    h6: ({ children }) => <h6 className="mt-6 mb-4 first:mt-0 text-ui-base font-normal text-text-primary">{children}</h6>,
    table: ({ children }) => (
      <div className="my-3 first:mt-0 last:mb-0 w-full overflow-hidden rounded-xl border border-border-medium">
        <div className="w-full overflow-x-auto">
          <table className="w-max min-w-full border-separate border-spacing-0 text-ui-base">{children}</table>
        </div>
      </div>
    ),
    tr: ({ children }) => <tr className="transition-colors last:[&>td]:border-b-0 hover:bg-hover-fill">{children}</tr>,
    th: ({ children }) => <th className="border-b border-border-medium px-3 py-2 text-left font-normal text-text-muted min-w-16 max-w-md whitespace-normal break-words">{children}</th>,
    td: ({ children }) => <td className="border-b border-border-medium px-3 py-2 align-top text-text-primary min-w-16 max-w-md whitespace-normal break-words">{children}</td>,
  };

  // ===== RÉPONSE DE L'AGENT — à gauche, sans bulle, même colonne que l'utilisateur =====
  return (
    <div className="group px-4 py-2">
      {/* Content */}
      <div className="max-w-3xl mx-auto min-w-0">
        {/* Actions d'outils de l'agent — rendu ZCode (read/edit/bash…) */}
        {!message.timeline?.length && message.toolEvents && message.toolEvents.length > 0 && (
          <ToolEventList events={message.toolEvents} live={message.isStreaming} />
        )}

        {/* Raisonnement : ligne repliable, même langage que les outils (ZCode) */}
        {(message.thinking || message.reasoning) && (
          <div className="mb-1.5">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="group/think inline-flex items-center gap-2 h-7 text-ui-base text-text-secondary hover:text-text-primary transition-colors"
            >
              <Brain size={16} className="flex-shrink-0" />
              <span>{message.isStreaming ? 'Réflexion en cours…' : 'Réflexion'}</span>
              <ChevronRight
                size={16}
                className={cn(
                  'text-text-muted transition-all duration-200',
                  showThinking ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/think:opacity-100'
                )}
              />
            </button>
            {showThinking && (
              <div className="mt-1 ml-2 pl-4 border-l border-border-medium space-y-2 max-h-80 overflow-y-auto">
                {message.reasoning?.map((step, idx) => (
                  <p key={`step-${idx}-${step.slice(0, 20)}`} className="text-ui-sm text-text-tertiary leading-relaxed whitespace-pre-wrap">{step}</p>
                )) || (
                  <p className="text-ui-sm text-text-tertiary leading-relaxed whitespace-pre-wrap">{message.thinking}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Main message — pas de bulle (ZCode) ; erreur = filet gauche danger */}
        <div className={cn(
          'px-0 py-0.5 message-enter',
          message.isError && !message.timeline?.length && 'border-l-2 border-accent-error/60 pl-3'
        )}>
          <div
            ref={textRef}
            className={cn(
              'max-w-none text-ui-base text-text-primary break-words',
              message.isError && !message.timeline?.length && 'text-accent-error'
            )}
          >
            {message.timeline?.length ? (
              // Texte et actions dans l'ordre où l'agent les a produits (comme ZCode)
              message.timeline.map((item, idx) => {
                const isLast = idx === message.timeline!.length - 1;
                if (item.kind === 'tools') {
                  const byId = new Map((message.toolEvents || []).map((e) => [e.id, e]));
                  const evs = item.ids.map((id) => byId.get(id)).filter(Boolean) as NonNullable<Message['toolEvents']>;
                  return evs.length ? (
                    <div key={`t${idx}`} className="my-2 first:mt-0">
                      <ToolEventList events={evs} live={message.isStreaming && isLast} />
                    </div>
                  ) : null;
                }
                const isErrorNote = message.isError && isLast;
                return (
                  <div
                    key={`x${idx}`}
                    className={cn(
                      'my-3 first:mt-0 last:mb-0',
                      isErrorNote && 'rounded-lg bg-accent-error/10 px-3 py-2 text-accent-error [&_strong]:text-accent-error'
                    )}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {item.text}
                    </ReactMarkdown>
                  </div>
                );
              })
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={mdComponents}
              >
                {displayContent}
              </ReactMarkdown>
            )}
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

        {/* État temporaire (nouvelle tentative réseau) */}
        {message.isStreaming && message.notice && (
          <p className="mt-1 text-ui-sm text-text-muted">{message.notice}</p>
        )}

        {/* Erreur : reprise là où l'agent s'est arrêté (ou nouvel essai) */}
        {/* « Reprendre » si la reprise est possible ; « Réessayer » seulement si rien n'a été fait
            (renvoyer la demande referait un travail déjà accompli). */}
        {message.isError && !message.isStreaming && onRegenerate &&
          (message.resumable || (!message.toolEvents?.length && !message.fileChanges?.length)) && (
          <button
            onClick={onRegenerate}
            className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-caption font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity"
          >
            <RefreshCw size={13} />
            {message.resumable ? 'Reprendre' : 'Réessayer'}
          </button>
        )}

        {/* Fichiers modifiés par l'agent + annulation */}
        {!message.isStreaming && message.fileChanges && message.fileChanges.length > 0 && (
          <FileChangesCard messageId={message.id} changes={message.fileChanges} undone={message.changesUndone} />
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
                      'text-text-muted hover:text-accent-warning hover:bg-accent-warning/10'
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

          {/* Timestamp */}
          <span className="ml-auto text-ui-sm text-text-muted">
            {message.model === 'thinking' ? 'Réflexion · ' : ''}{formatTime(message.timestamp)}
            {typeof message.costFCFA === 'number' && !message.isStreaming && (
              <> · {message.costFCFA < 1 ? '< 1' : Math.round(message.costFCFA).toLocaleString('fr-FR')} FCFA</>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
