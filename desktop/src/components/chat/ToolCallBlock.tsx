/**
 * ToolCallBlock — Rendu ZCode d'une action d'agent dans le chat.
 *
 * Chaque appel d'outil = une ligne repliable mono :
 *   ⚙ read_file  src/app.ts
 *   ✎ edit_file  Cart.tsx  +12 −3
 *   $ npm run dev   (sortie terminal)
 *   ✓ task_done  résumé
 *
 * États : running (spinner), ok, error. Clic → déplie la sortie tronquée.
 */
import React, { useState } from 'react';
import {
  FileText, FilePlus, FileEdit, FileMinus, FolderOpen, Search,
  Terminal, CheckCircle2, AlertCircle, Loader2, Brain, GitBranch, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolEvent } from '@/hooks/useAgentChat';

const ICONS: Record<string, React.ReactNode> = {
  read_file: <FileText size={16} />,
  write_file: <FilePlus size={16} />,
  edit_file: <FileEdit size={16} />,
  delete_file: <FileMinus size={16} />,
  list_dir: <FolderOpen size={16} />,
  search_files: <Search size={16} />,
  run_command: <Terminal size={16} />,
  spawn_subagents: <GitBranch size={16} />,
  remember: <Brain size={16} />,
  task_done: <Sparkles size={16} />,
};

/** Libellé lisible de chaque outil (le nom technique reste dans l'historique). */
const LABELS: Record<string, string> = {
  read_file: 'Lecture',
  write_file: 'Écriture',
  edit_file: 'Modification',
  delete_file: 'Suppression',
  list_dir: 'Exploration',
  search_files: 'Recherche',
  run_command: 'Commande',
  spawn_subagents: 'Sous-agents',
  remember: 'Mémoire',
  task_done: 'Terminé',
};

export default function ToolCallBlock({ event }: { event: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const isCommand = event.name === 'run_command';
  const isDone = event.name === 'task_done';

  return (
    <div className="rounded-md overflow-hidden">
      <button
        onClick={() => event.output && setOpen((v) => !v)}
        className={cn(
          'group/tool w-full flex items-center gap-2 h-7 text-left transition-colors text-ui-base rounded-md',
          event.output ? 'cursor-pointer' : 'cursor-default'
        )}
      >
        {/* Icône / statut */}
        {event.status === 'running' ? (
          <Loader2 size={16} className="animate-spin text-accent-primary flex-shrink-0" />
        ) : event.status === 'error' ? (
          <AlertCircle size={16} className="text-accent-error flex-shrink-0" />
        ) : isDone ? (
          <CheckCircle2 size={16} className="text-accent-success flex-shrink-0" />
        ) : (
          <span className="text-text-muted flex-shrink-0">{ICONS[event.name] ?? <Terminal size={16} />}</span>
        )}

        {/* Nom de l'outil */}
        <span className={cn(
          'flex-shrink-0 transition-colors',
          event.status === 'error' ? 'text-accent-error' : 'text-text-secondary group-hover/tool:text-text-primary'
        )}>
          {LABELS[event.name] ?? event.name}
        </span>

        {/* Argument principal */}
        <span className={cn(
          'truncate font-mono text-ui-sm text-text-muted group-hover/tool:text-text-secondary transition-colors'
        )}>
          {event.argsSummary}
        </span>

        {/* Delta +n/−n (éditions) */}
        {event.delta && (event.delta[0] > 0 || event.delta[1] > 0) && (
          <span className="flex-shrink-0 flex items-center gap-1 text-ui-xs font-semibold">
            {event.delta[0] > 0 && <span className="text-accent-success">+{event.delta[0]}</span>}
            {event.delta[1] > 0 && <span className="text-accent-error">−{event.delta[1]}</span>}
          </span>
        )}

        {/* Indicateur repli si sortie présente */}
        {event.output && (
          <span className="flex-shrink-0 text-text-muted/50 text-[9px]">{open ? '▲' : '▼'}</span>
        )}
      </button>

      {/* Sortie dépliable */}
      {open && event.output && (
        <pre className="mt-1 mb-2 px-3 py-2 rounded-lg bg-bg-tertiary font-mono text-ui-sm leading-relaxed text-text-tertiary whitespace-pre-wrap break-all max-h-52 overflow-y-auto">
          {event.output}
        </pre>
      )}
    </div>
  );
}

const VERBS: Record<string, [string, string]> = {
  read_file: ['fichier lu', 'fichiers lus'],
  list_dir: ['dossier listé', 'dossiers listés'],
  search_files: ['recherche', 'recherches'],
  run_command: ['commande', 'commandes'],
  edit_file: ['modification', 'modifications'],
  write_file: ['fichier écrit', 'fichiers écrits'],
  delete_file: ['fichier supprimé', 'fichiers supprimés'],
};

/**
 * Liste d'actions d'un message. Au-delà de 4 actions, elles sont repliées
 * derrière une ligne de résumé (« 37 fichiers lus · 2 commandes »).
 * Pendant le travail, les 3 dernières restent visibles.
 */
export function ToolEventList({ events, live }: { events: ToolEvent[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (events.length <= 4) {
    return <div className="mb-1.5">{events.map((ev) => <ToolCallBlock key={ev.id} event={ev} />)}</div>;
  }
  const counts = new Map<string, number>();
  for (const ev of events) counts.set(ev.name, (counts.get(ev.name) || 0) + 1);
  const summary = [...counts.entries()]
    .filter(([name]) => VERBS[name])
    .map(([name, n]) => `${n} ${VERBS[name][n > 1 ? 1 : 0]}`)
    .join(' · ') || `${events.length} actions`;
  const errors = events.filter((e) => e.status === 'error').length;
  const shown = open ? events : live ? events.slice(-3) : [];
  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-7 rounded-md text-ui-base text-text-secondary hover:text-text-primary transition-colors"
      >
        {live ? <Loader2 size={16} className="animate-spin text-accent-primary" /> : <CheckCircle2 size={16} className="text-text-muted" />}
        <span>{summary}</span>
        {errors > 0 && <span className="text-accent-error">· {errors} en erreur</span>}
        <span className="text-text-muted text-[9px]">{open ? '▲' : '▼'}</span>
      </button>
      {shown.length > 0 && (
        <div className={cn('ml-2 pl-3.5 border-l border-border-medium', open && 'max-h-72 overflow-y-auto')}>
          {shown.map((ev) => <ToolCallBlock key={ev.id} event={ev} />)}
        </div>
      )}
    </div>
  );
}
