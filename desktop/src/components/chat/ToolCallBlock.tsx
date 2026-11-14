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
  read_file: <FileText size={12} />,
  write_file: <FilePlus size={12} />,
  edit_file: <FileEdit size={12} />,
  delete_file: <FileMinus size={12} />,
  list_dir: <FolderOpen size={12} />,
  search_files: <Search size={12} />,
  run_command: <Terminal size={12} />,
  spawn_subagents: <GitBranch size={12} />,
  remember: <Brain size={12} />,
  task_done: <Sparkles size={12} />,
};

export default function ToolCallBlock({ event }: { event: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const isCommand = event.name === 'run_command';
  const isDone = event.name === 'task_done';

  return (
    <div className="rounded-md border border-border-subtle overflow-hidden my-0.5 bg-bg-secondary/40">
      <button
        onClick={() => event.output && setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors font-mono text-[11.5px]',
          event.output ? 'hover:bg-surface-hover' : 'cursor-default'
        )}
      >
        {/* Icône / statut */}
        {event.status === 'running' ? (
          <Loader2 size={12} className="animate-spin text-accent-primary flex-shrink-0" />
        ) : event.status === 'error' ? (
          <AlertCircle size={12} className="text-accent-error flex-shrink-0" />
        ) : isDone ? (
          <CheckCircle2 size={12} className="text-accent-success flex-shrink-0" />
        ) : (
          <span className="text-text-muted flex-shrink-0">{ICONS[event.name] ?? <Terminal size={12} />}</span>
        )}

        {/* Nom de l'outil */}
        <span className={cn(
          'flex-shrink-0',
          event.status === 'error' ? 'text-accent-error' : 'text-text-tertiary'
        )}>
          {isCommand ? '$' : event.name}
        </span>

        {/* Argument principal */}
        <span className={cn(
          'truncate flex-1',
          isCommand ? 'text-text-secondary' : 'text-text-secondary/90'
        )}>
          {event.argsSummary}
        </span>

        {/* Delta +n/−n (éditions) */}
        {event.delta && (event.delta[0] > 0 || event.delta[1] > 0) && (
          <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold">
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
        <pre className="px-3 py-2 border-t border-border-subtle bg-bg-primary/60 font-mono text-[10.5px] leading-relaxed text-text-tertiary whitespace-pre-wrap break-all max-h-52 overflow-y-auto">
          {event.output}
        </pre>
      )}
    </div>
  );
}
