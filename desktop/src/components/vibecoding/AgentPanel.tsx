/**
 * AgentPanel — Mode Agent autonome dans le VibeCoding Studio (Phase 1)
 *
 * L'utilisateur décrit une tâche; l'agent explore, modifie, exécute et
 * vérifie en boucle (moteur runAgentSession). Timeline temps réel des
 * tool calls, streaming du raisonnement, annulation.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send, Loader2, CheckCircle2, AlertCircle, Square,
  FileCode, FilePlus2, FileX2, FolderTree, Search,
  TerminalSquare, Eye, Flag, GitCommitHorizontal, Bot, ChevronDown, ChevronRight,
  ShieldCheck, ShieldAlert, Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentSession, AgentLogEntry } from '@/hooks/useAgentSession';
import type { StudioFile } from './VibeCodingStudio';

// ============================================================================
// TYPES
// ============================================================================

interface AgentPanelProps {
  projectName: string;
  /** Racine locale absolue du projet (obligatoire pour agir sur le disque) */
  projectRoot?: string;
  files: StudioFile[];
  /** Notifie l'éditeur qu'un fichier a changé sur disque */
  onFileChange?: (path: string, newContent: string) => void;
}

// ============================================================================
// HELPERS D'AFFICHAGE
// ============================================================================

const TOOL_ICONS: Record<string, React.ReactNode> = {
  read_file: <Eye size={12} />,
  write_file: <FilePlus2 size={12} />,
  edit_file: <FileCode size={12} />,
  delete_file: <FileX2 size={12} />,
  list_dir: <FolderTree size={12} />,
  search_files: <Search size={12} />,
  run_command: <TerminalSquare size={12} />,
  remember: <Bot size={12} />,
  task_done: <Flag size={12} />,
};

function toolLabel(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'read_file': return `Lecture ${args.path ?? ''}`;
    case 'write_file': return `Écriture ${args.path ?? ''}`;
    case 'edit_file': return `Modification ${args.path ?? ''}`;
    case 'delete_file': return `Suppression ${args.path ?? ''}`;
    case 'list_dir': return `Exploration ${args.path || 'racine'}`;
    case 'search_files': return `Recherche /${args.pattern ?? ''}/`;
    case 'run_command': return `$ ${args.command ?? ''}`;
    case 'remember': return `Mémorisation [${args.category ?? 'note'}]`;
    case 'task_done': return 'Tâche terminée';
    default: return name;
  }
}

// ============================================================================
// TIMELINE ENTRY
// ============================================================================

const EventRow: React.FC<{ entry: AgentLogEntry }> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const e = entry.event;

  if (e.type === 'checkpoint') {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-text-muted">
        <GitCommitHorizontal size={11} className="flex-shrink-0 text-amber-400" />
        <span className="truncate">Checkpoint git créé (rollback possible)</span>
      </div>
    );
  }

  if (e.type === 'context_ready') {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-text-muted">
        <FolderTree size={11} className="flex-shrink-0 text-accent-primary" />
        <span className="truncate">
          Projet indexé : {e.totalFiles} fichiers, {e.totalSymbols} symboles ({e.indexMs}ms)
          {e.hasMemory && ' · mémoire ANZAR.md chargée'}
        </span>
      </div>
    );
  }

  if (e.type === 'verify_start') {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 mt-1 rounded-md bg-accent-primary/5 border border-accent-primary/10">
        <ShieldCheck size={12} className="flex-shrink-0 text-accent-primary" />
        <span className="text-[11px] text-text-primary font-medium">
          Vérification automatique ({e.attempt}/{e.maxAttempts})
        </span>
      </div>
    );
  }

  if (e.type === 'verify_command') {
    return (
      <div className="flex items-center gap-2 px-2 py-1 pl-4">
        <Loader2 size={11} className="flex-shrink-0 text-accent-primary animate-spin" />
        <span className="text-[10px] text-text-muted font-mono truncate">$ {e.command}</span>
      </div>
    );
  }

  if (e.type === 'verify_result') {
    return (
      <div className="pl-4">
        <button
          onClick={() => setExpanded(v => !v)}
          className={cn(
            'flex items-center gap-1.5 px-2 py-0.5 w-full text-left rounded transition-colors hover:bg-bg-tertiary/60',
            e.skipped ? 'text-text-muted' : e.passed ? 'text-emerald-400' : 'text-red-400'
          )}
        >
          {expanded ? <ChevronDown size={10} className="flex-shrink-0" /> : <ChevronRight size={10} className="flex-shrink-0" />}
          {e.skipped
            ? <Circle size={11} className="flex-shrink-0" />
            : e.passed
              ? <ShieldCheck size={11} className="flex-shrink-0" />
              : <ShieldAlert size={11} className="flex-shrink-0" />}
          <span className="text-[10px] font-mono truncate">
            {e.label} — {e.skipped ? 'ignoré' : e.passed ? 'OK' : 'ÉCHEC'}
          </span>
        </button>
        {expanded && e.output && (
          <pre className="mx-2 my-1 p-2 rounded-md bg-bg-tertiary/70 text-[10px] text-text-secondary overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {e.output.slice(0, 4000)}
          </pre>
        )}
      </div>
    );
  }

  if (e.type === 'tool_call') {
    return (
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-accent-primary flex-shrink-0">{TOOL_ICONS[e.name] ?? <Bot size={12} />}</span>
        <span className="text-[11px] text-text-primary truncate font-mono">{toolLabel(e.name, e.args)}</span>
      </div>
    );
  }

  if (e.type === 'tool_result') {
    const preview = e.output.split('\n')[0].slice(0, 90);
    return (
      <div className="pl-4">
        <button
          onClick={() => setExpanded(v => !v)}
          className={cn(
            'flex items-center gap-1.5 px-2 py-0.5 w-full text-left rounded transition-colors hover:bg-bg-tertiary/60',
            e.isError ? 'text-red-400' : 'text-text-muted'
          )}
        >
          {expanded ? <ChevronDown size={10} className="flex-shrink-0" /> : <ChevronRight size={10} className="flex-shrink-0" />}
          {e.isError
            ? <AlertCircle size={11} className="flex-shrink-0" />
            : <CheckCircle2 size={11} className="flex-shrink-0 text-emerald-400" />}
          <span className="text-[10px] truncate font-mono">{preview}</span>
        </button>
        {expanded && (
          <pre className="mx-2 my-1 p-2 rounded-md bg-bg-tertiary/70 text-[10px] text-text-secondary overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {e.output.slice(0, 4000)}
          </pre>
        )}
      </div>
    );
  }

  return null;
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const AgentPanel: React.FC<AgentPanelProps> = ({
  projectName,
  projectRoot,
  files,
  onFileChange,
}) => {
  const [agent, actions] = useAgentSession();
  const [task, setTask] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Aperçu d'arborescence pour le system prompt (évite un list_dir initial)
  const fileTree = useMemo(
    () => files.slice(0, 120).map(f => f.path).join('\n'),
    [files]
  );

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent.events.length, agent.streamingText]);

  const handleStart = useCallback(() => {
    const t = task.trim();
    if (!t || agent.isRunning || !projectRoot) return;
    setTask('');
    actions.start({
      projectRoot,
      projectName,
      task: t,
      fileTree,
      onFileChanged: (path, content, action) => {
        if (action !== 'delete') onFileChange?.(path, content);
      },
    });
  }, [task, agent.isRunning, projectRoot, projectName, fileTree, actions, onFileChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStart();
    }
  }, [handleStart]);

  if (!projectRoot) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center">
          <Bot size={28} className="mx-auto mb-3 text-text-muted" />
          <p className="text-xs text-text-muted">
            Le mode Agent nécessite un projet enregistré sur le disque.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 scrollbar-thin">
        {agent.events.length === 0 && !agent.isRunning && (
          <div className="px-3 py-6 text-center">
            <Bot size={24} className="mx-auto mb-2 text-accent-primary" />
            <p className="text-[12px] text-text-secondary mb-1 font-medium">Mode Agent autonome</p>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Décris une tâche complète : l'agent explore le code, modifie les fichiers,
              exécute les commandes et vérifie son travail jusqu'au succès.
            </p>
          </div>
        )}

        {agent.events.map(entry => <EventRow key={entry.id} entry={entry} />)}

        {/* Texte assistant en streaming */}
        {agent.streamingText && (
          <div className="mx-2 my-1.5 px-3 py-2 rounded-xl bg-bg-tertiary text-[12px] text-text-primary leading-relaxed whitespace-pre-wrap">
            {agent.streamingText}
          </div>
        )}

        {/* Statut de fin */}
        {agent.stopReason && !agent.isRunning && (
          <div className={cn(
            'mx-2 my-2 px-3 py-2 rounded-xl text-[12px] leading-relaxed border',
            agent.stopReason === 'task_done'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : agent.stopReason === 'error' || agent.stopReason === 'verify_failed'
                ? 'bg-red-500/10 border-red-500/20 text-red-300'
                : 'bg-bg-tertiary/60 border-border-subtle text-text-secondary'
          )}>
            <div className="flex items-center gap-1.5 mb-1">
              {agent.stopReason === 'task_done'
                ? <CheckCircle2 size={13} />
                : agent.stopReason === 'verify_failed'
                  ? <ShieldAlert size={13} />
                  : agent.stopReason === 'error'
                    ? <AlertCircle size={13} />
                    : <Flag size={13} />}
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {agent.stopReason === 'task_done' ? 'Terminé et vérifié'
                  : agent.stopReason === 'final_answer' ? 'Réponse'
                  : agent.stopReason === 'max_steps' ? 'Budget épuisé'
                  : agent.stopReason === 'verify_failed' ? 'Vérification en échec'
                  : agent.stopReason === 'aborted' ? 'Annulé'
                  : 'Erreur'}
              </span>
            </div>
            <span className="whitespace-pre-wrap">{agent.summary || agent.error}</span>
            {agent.filesChanged.length > 0 && (
              <div className="mt-1.5 text-[10px] text-text-muted">
                {agent.filesChanged.length} fichier{agent.filesChanged.length > 1 ? 's' : ''} modifié{agent.filesChanged.length > 1 ? 's' : ''} : {agent.filesChanged.join(', ')}
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Barre de progression */}
      {agent.isRunning && (
        <div className="px-3 py-1.5 flex items-center gap-2 border-t border-border-subtle flex-shrink-0">
          <Loader2 size={12} className="animate-spin text-accent-primary flex-shrink-0" />
          <span className="text-[10px] text-text-muted">
            Étape {agent.currentStep}/{agent.maxSteps}
          </span>
          <button
            onClick={actions.abort}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Square size={10} /> Stop
          </button>
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-border-subtle flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={task}
            onChange={e => setTask(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Décris la tâche à accomplir…"
            rows={1}
            disabled={agent.isRunning}
            className="flex-1 px-3 py-2 bg-bg-tertiary border border-border-subtle rounded-xl text-[13px] text-text-primary placeholder-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary/50 max-h-[100px] disabled:opacity-50"
            style={{ minHeight: '36px' }}
          />
          <button
            onClick={handleStart}
            disabled={!task.trim() || agent.isRunning}
            className={cn(
              'p-2 rounded-xl transition-all flex-shrink-0',
              task.trim() && !agent.isRunning
                ? 'gradient-bg text-white hover:opacity-90'
                : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
            )}
          >
            {agent.isRunning ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </>
  );
};

export default AgentPanel;
