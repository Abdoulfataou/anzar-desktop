import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, ChevronRight, Brain, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolEventList } from './ToolCallBlock';
import FileChangesCard from './FileChangesCard';
import { markdownComponents } from './markdownComponents';
import { PlanCard } from './PlanView';
import { cn } from '@/lib/utils';
import type { Message } from '@/types';
import { ROUTE_LABELS as AUTO_LABELS } from '@/services/ai/autoRouter';

interface MessageBubbleProps {
  message: Message;
  onCopy?: (text: string) => void;
  onRegenerate?: (messageId: string) => void;
  selectedProjectId?: string | null;
  selectedProjectPath?: string;
}


// P1 : deux variantes construites UNE SEULE fois (avant : l'objet était recréé
// à chaque render, et chaque flush de streaming re-parseait TOUTES les bulles).
const MD_COMPONENTS_FULL = markdownComponents({ hideCodeActions: false });
const MD_COMPONENTS_HIDE_ACTIONS = markdownComponents({ hideCodeActions: true });
// Pendant le streaming : les widgets incomplets → shimmer (pas de code brut)
const MD_COMPONENTS_STREAMING = markdownComponents({ hideCodeActions: true, streaming: true });

function MessageBubbleImpl({ message, onCopy, onRegenerate, selectedProjectId = null, selectedProjectPath }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
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

  // Les blocs de code n'ont pas de barre d'actions dans un projet ouvert (comportement existant)
  const isVibecoding = !!selectedProjectId;

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

  // Rendu Markdown partagé (chat, onglet Plan)
  const mdComponents = message.isStreaming
    ? MD_COMPONENTS_STREAMING
    : isVibecoding ? MD_COMPONENTS_HIDE_ACTIONS : MD_COMPONENTS_FULL;

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
            onClick={() => onRegenerate(message.id)}
            className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-caption font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity"
          >
            <RefreshCw size={13} />
            {message.resumable ? 'Reprendre' : 'Réessayer'}
          </button>
        )}

        {/* Plan proposé (mode plan) */}
        {message.plan && !message.isStreaming && (
          <PlanCard messageId={message.id} plan={message.plan} />
        )}

        {/* Fichiers modifiés par l'agent + annulation */}
        {!message.isStreaming && message.fileChanges && message.fileChanges.length > 0 && (
          <FileChangesCard changes={message.fileChanges} />
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

          {/* Separator */}
          <div className="w-px h-3 bg-border-subtle mx-1" />

          {/* Timestamp */}
          <span className="ml-auto text-ui-sm text-text-muted">
            {message.autoRoute ? (
              <span title={`Choisi par le mode Auto : ${message.autoRoute.reason}`}>
                Auto · {AUTO_LABELS[message.autoRoute.mode]}{message.autoRoute.escalated ? ' ↑' : ''} ·{' '}
              </span>
            ) : message.model === 'thinking' ? 'Réflexion · ' : message.model === 'max' ? 'Max · ' : message.model === 'pro' ? 'Pro · ' : ''}{formatTime(message.timestamp)}
            {typeof message.costFCFA === 'number' && !message.isStreaming && (
              <> · {message.costFCFA < 1 ? '< 1' : Math.round(message.costFCFA).toLocaleString('fr-FR')} FCFA</>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export default React.memo(MessageBubbleImpl);
