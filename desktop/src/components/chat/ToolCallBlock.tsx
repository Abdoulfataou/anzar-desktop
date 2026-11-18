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
import React, { useEffect, useState } from 'react';
import {
  FileText, FilePlus, FileEdit, FileMinus, FolderOpen, Search,
  Terminal, ChevronRight, ListChecks, Wand2, CheckCircle2, AlertCircle, Loader2, Brain, GitBranch, Sparkles, Globe, Link2, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolEvent } from '@/hooks/useAgentChat';
import { OPEN_FILE_EVENT } from '@/services/agent/fileChanges';
import { useProjectStore } from '@/stores/projectStore';
import { resolveChatAbsPath, openFromChat } from '@/lib/openFromChat';

/** Ouvre un fichier du chat : onglet workspace (projet) ou Finder (espace ANZAR). */
function openProjectFile(path: string) {
  void openFromChat(path);
}

/** Ouvre le dossier contenant un fichier dans le Finder / Explorateur. */
async function revealFolder(absPath: string) {
  try {
    const { open } = await import('@/lib/tauriShell');
    await open(absPath.substring(0, absPath.lastIndexOf('/')));
  } catch {
    // allowlist Tauri : fallback silencieux, l'onglet interne reste disponible
  }
}

/**
 * Lecteur média INLINE sous la ligne d'outil (vidéo export/export_animation,
 * visuel PNG) : la vidéo s'affiche dans la conversation, avec un lecteur et
 * un bouton pour ouvrir le dossier — sans quitter le chat.
 */
function InlineExportMedia({ relPath }: { relPath: string }) {
  // Racine : projet ouvert, sinon espace ANZAR (chat simple) — résolu async
  const [absPath, setAbsPath] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void resolveChatAbsPath(relPath).then((p) => { if (alive) setAbsPath(p); });
    return () => { alive = false; };
  }, [relPath]);
  const name = relPath.split('/').pop() || relPath;
  const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(name);
  const version = 0;

  const [url, setSize] = useObjectUrl(absPath, name, version);
  if (!absPath || !url) {
    return (
      <div className="mt-1 mb-2 flex items-center gap-2 text-ui-caption text-text-muted">
        <Loader2 size={12} className="animate-spin" /> Chargement de {name}…
      </div>
    );
  }
  return (
    <div className="mt-1.5 mb-2 max-w-md rounded-lg border border-border-subtle overflow-hidden bg-bg-secondary/40">
      {isVideo ? (
        <video src={url} controls loop muted playsInline className="w-full max-h-72 bg-black" />
      ) : (
        <img src={url} alt={name} className="w-full max-h-72 object-contain bg-black/20" />
      )}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-border-subtle">
        <span className="text-ui-caption font-mono text-text-secondary truncate flex-1" title={relPath}>{name}</span>
        <button
          onClick={() => openProjectFile(relPath)}
          className="text-[10.5px] px-2 py-0.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          Ouvrir
        </button>
        <button
          onClick={() => void revealFolder(absPath)}
          className="text-[10.5px] px-2 py-0.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          Dossier
        </button>
      </div>
    </div>
  );
}

/** Charge un fichier binaire du projet en URL d'objet (image/vidéo), avec révocation. */
function useObjectUrl(absPath: string | null, name: string, version: number): [string | null, number] {
  const [state, setState] = useState<{ url: string | null; size: number }>({ url: null, size: 0 });
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    if (!absPath) return;
    (async () => {
      try {
        const { readBinaryFile } = await import('@/lib/tauriFs');
        const bytes = await readBinaryFile(absPath);
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const MIME: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
          mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
        };
        objectUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: MIME[ext] || 'application/octet-stream' }));
        if (alive) setState({ url: objectUrl, size: bytes.byteLength });
      } catch {
        if (alive) setState({ url: null, size: 0 });
      }
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [absPath, name, version]);
  return [state.url, state.size];
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

      {/* Sous-agents en parallèle : une ligne par agent, action courante (style ZCode) */}
      {event.subagents && event.subagents.length > 0 && (
        <div className="mt-1 mb-1.5 ml-1 pl-3 border-l border-border-medium space-y-1">
          {event.subagents.map((sa, i) => (
            <div key={i} className="flex items-start gap-2 font-mono text-ui-sm leading-snug">
              {sa.status === 'running' ? (
                <Loader2 size={12} className="animate-spin mt-0.5 text-accent-primary flex-shrink-0" />
              ) : sa.status === 'done' ? (
                <CheckCircle2 size={12} className="mt-0.5 text-accent-success flex-shrink-0" />
              ) : (
                <AlertCircle size={12} className="mt-0.5 text-accent-error flex-shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn(
                  'block truncate',
                  sa.status === 'done' ? 'text-text-muted line-through decoration-text-muted/40' : 'text-text-secondary'
                )}>
                  {sa.role === 'motion-designer' && (
                    <span className="mr-1.5 px-1.5 py-px rounded text-ui-xs font-semibold text-accent-secondary bg-accent-secondary/10 border border-accent-secondary/20">
                      motion designer
                    </span>
                  )}
                  {sa.role === 'redaction' && (
                    <span className="mr-1.5 px-1.5 py-px rounded text-ui-xs font-semibold text-text-secondary bg-surface-hover border border-border-subtle">
                      rédaction
                    </span>
                  )}
                  {sa.task}
                </span>
                {sa.status === 'running' && sa.current && (
                  <span className="block truncate text-text-muted/80 text-ui-xs">{sa.current}</span>
                )}
              </span>
              <span className="text-ui-xs text-text-muted tabular-nums flex-shrink-0">{sa.steps}</span>
            </div>
          ))}
        </div>
      )}

      {/* Média exporté : lecteur INLINE dès la fin de l'export (vidéo/visuel) */}
      {event.status === 'ok' && event.name === 'export_animation' && event.filePath && /\.(mp4|webm|mov|m4v|gif|png|jpe?g|webp)$/i.test(event.filePath) && (
        <InlineExportMedia relPath={event.filePath} />
      )}

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
