/**
 * Carte « fichiers modifiés » affichée sous une réponse de l'agent :
 * nombre de fichiers, lignes ajoutées / retirées, détail dépliable.
 * La restauration d'un projet passe par git, pas par l'application.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OPEN_FILE_EVENT, type FileChange } from '@/services/agent/tools/fileChanges';

export default function FileChangesCard({ changes }: { changes: FileChange[] }) {
  const [open, setOpen] = useState(false);

  const added = changes.reduce((n, c) => n + c.added, 0);
  const removed = changes.reduce((n, c) => n + c.removed, 0);

  return (
    <div className="mt-3 rounded-xl border border-border-medium bg-surface-default overflow-hidden">
      {/* En-tête : MessageChangeSummaryPanel de ZCode */}
      <div className="flex items-center justify-between gap-3 h-10 px-2 transition-colors hover:bg-hover-fill">
        <button onClick={() => setOpen((v) => !v)} className="flex h-full items-center gap-2 flex-1 min-w-0 px-1 text-left">
          <ChevronRight size={14} className={cn('flex-shrink-0 text-text-muted transition-transform', open && 'rotate-90')} />
          <span className="min-w-0 truncate text-ui-base font-medium text-text-primary">
            {changes.length} fichier{changes.length > 1 ? 's' : ''} modifié{changes.length > 1 ? 's' : ''}
          </span>
          <span className="flex-shrink-0 tabular-nums text-ui-base">
            <span className="text-diff-added">+{added}</span>{' '}
            <span className="text-diff-removed">-{removed}</span>
          </span>
        </button>
      </div>
      {open && (
        <div className="border-t border-border-medium bg-bg-primary py-1 max-h-56 overflow-y-auto">
          {changes.map((c) => (
            <button
              key={c.path}
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: c.path }))}
              disabled={c.kind === 'deleted'}
              className="w-full flex items-center gap-2 h-8 px-3 text-left text-ui-base hover:bg-hover-fill disabled:hover:bg-transparent transition-colors"
            >
              <span className={cn('flex-1 min-w-0 truncate text-text-secondary', c.kind === 'deleted' && 'line-through')}>{c.path}</span>
              {c.kind === 'created' && <span className="text-text-muted">nouveau</span>}
              {c.kind === 'deleted' && <span className="text-text-muted">supprimé</span>}
              {c.added > 0 && <span className="text-diff-added tabular-nums">+{c.added}</span>}
              {c.removed > 0 && <span className="text-diff-removed tabular-nums">-{c.removed}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
