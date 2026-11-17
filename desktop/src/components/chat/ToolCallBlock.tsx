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
  Terminal, ChevronRight, ListChecks, Wand2, CheckCircle2, AlertCircle, Loader2, Brain, GitBranch, Sparkles, Globe, Link2, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolEvent } from '@/hooks/useAgentChat';
import { OPEN_FILE_EVENT } from '@/services/agent/fileChanges';

/** Ouvre un fichier du projet dans l'éditeur / la visionneuse média. */
function openProjectFile(path: string) {
  window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: path }));
}

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
  propose_plan: <ListChecks size={16} />,
  load_skill: <Wand2 size={16} />,
  web_search: <Globe size={16} />,
  read_url: <Link2 size={16} />,
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
  propose_plan: 'Plan proposé',
  load_skill: 'Skill',
  web_search: 'Recherche web',
  read_url: 'Page web',
};

/**
 * Ligne d'action de l'agent, sur le modèle de ToolSummaryRow de ZCode :
 * pas de cadre ; icône + type en gris, détail plus discret, chevron au survol,
 * sortie dépliée en dessous dans un bloc sans bordure.
 */
export default function ToolCallBlock({ event }: { event: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const isDone = event.name === 'task_done';
  const canToggle = !!event.output;

  return (
    <div>
      <button
        type="button"
        onClick={() => canToggle && setOpen((v) => !v)}
        aria-expanded={canToggle ? open : undefined}
        className={cn(
          'group/tool inline-flex max-w-full items-center gap-2 h-7 text-left text-ui-base transition-colors',
          canToggle ? 'cursor-pointer' : 'cursor-default'
        )}
      >
        {/* Icône / statut */}
        <span className="flex-shrink-0 text-text-secondary group-hover/tool:text-text-primary transition-colors">
          {event.status === 'running' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : event.status === 'error' ? (
            <AlertCircle size={16} className="text-accent-error" />
          ) : isDone ? (
            <CheckCircle2 size={16} className="text-accent-success" />
          ) : (
            ICONS[event.name] ?? <Terminal size={16} />
          )}
        </span>

        {/* Type d'action */}
        <span className={cn(
          'flex-shrink-0 transition-colors',
          event.status === 'error' ? 'text-accent-error' : 'text-text-secondary group-hover/tool:text-text-primary'
        )}>
          {LABELS[event.name] ?? event.name}
        </span>

        {/* Détail (chemin, commande…) — cliquable quand c'est un fichier du projet */}
        {event.argsSummary && (
          event.filePath ? (
            <span
              role="button"
              tabIndex={0}
              title={`Ouvrir ${event.filePath}`}
              onClick={(e) => { e.stopPropagation(); openProjectFile(event.filePath!); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); openProjectFile(event.filePath!); } }}
              className="min-w-0 truncate text-link underline decoration-transparent underline-offset-2 hover:decoration-current cursor-pointer transition-colors"
            >
              {event.argsSummary}
            </span>
          ) : (
            <span className="min-w-0 truncate text-text-muted group-hover/tool:text-text-secondary transition-colors">
              {event.argsSummary}
            </span>
          )
        )}

        {/* Bouton d'ouverture explicite au survol (fichiers uniquement) */}
        {event.filePath && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`Ouvrir ${event.filePath}`}
            title={`Ouvrir ${event.filePath}`}
            onClick={(e) => { e.stopPropagation(); openProjectFile(event.filePath!); }}
            className="flex-shrink-0 opacity-0 group-hover/tool:opacity-100 text-text-muted hover:text-text-primary transition-all cursor-pointer"
          >
            <ExternalLink size={12} />
          </span>
        )}

        {/* Lignes ajoutées / retirées */}
        {event.delta && (event.delta[0] > 0 || event.delta[1] > 0) && (
          <span className="flex-shrink-0 tabular-nums">
            {event.delta[0] > 0 && <span className="text-diff-added">+{event.delta[0]}</span>}
            {event.delta[0] > 0 && event.delta[1] > 0 && ' '}
            {event.delta[1] > 0 && <span className="text-diff-removed">-{event.delta[1]}</span>}
          </span>
        )}

        {canToggle && (
          <ChevronRight
            size={16}
            aria-hidden
            className={cn(
              'flex-shrink-0 text-text-muted transition-all duration-200',
              open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/tool:opacity-100'
            )}
          />
        )}
      </button>

      {/* Sortie dépliée */}
      {open && event.output && (
        <pre className="mt-1 mb-2 px-3 py-2 rounded-lg bg-input font-mono text-ui-sm leading-relaxed text-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
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
  web_search: ['recherche web', 'recherches web'],
  read_url: ['page lue', 'pages lues'],
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
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group/tool inline-flex items-center gap-2 h-7 text-ui-base text-text-secondary hover:text-text-primary transition-colors"
      >
        {live ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
        <span>{summary}</span>
        {errors > 0 && <span className="text-accent-error">{errors} en erreur</span>}
        <ChevronRight
          size={16}
          aria-hidden
          className={cn(
            'text-text-muted transition-all duration-200',
            open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/tool:opacity-100'
          )}
        />
      </button>
      {shown.length > 0 && (
        <div className={cn('ml-2 pl-4 border-l border-border-medium', open && 'max-h-72 overflow-y-auto')}>
          {shown.map((ev) => <ToolCallBlock key={ev.id} event={ev} />)}
        </div>
      )}
    </div>
  );
}
