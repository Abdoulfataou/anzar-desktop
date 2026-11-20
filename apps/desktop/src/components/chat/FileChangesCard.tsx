/**
 * Carte « fichiers modifiés » affichée sous une réponse de l'agent :
 * nombre de fichiers, lignes ajoutées / retirées, détail dépliable, annulation.
 */
import { useState } from 'react';
import { ChevronRight, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import {
  canUndo, undoChanges, FILES_CHANGED_EVENT, OPEN_FILE_EVENT, type FileChange,
} from '@/services/agent/tools/fileChanges';

export default function FileChangesCard({
  messageId, changes, undone,
}: { messageId: string; changes: FileChange[]; undone?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const { confirm, ConfirmDialog } = useConfirmModal();

  const added = changes.reduce((n, c) => n + c.added, 0);
  const removed = changes.reduce((n, c) => n + c.removed, 0);
  const undoable = !undone && canUndo(messageId);

  const undo = async () => {
    const ok = await confirm({
      title: 'Annuler les modifications',
      message: `Remettre ${changes.length} fichier${changes.length > 1 ? 's' : ''} dans l'état d'avant cette réponse ? Ce que tu as modifié à la main dans ces fichiers depuis sera perdu.`,
      confirmLabel: 'Annuler les modifications',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const n = await undoChanges(messageId);
      updateMessage(messageId, { changesUndone: true });
      window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT));
      toast.success(`${n} fichier${n > 1 ? 's' : ''} restauré${n > 1 ? 's' : ''}`);
    } catch (e: any) {
      toast.error(`Annulation incomplète — ${e?.message || 'erreur disque'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-border-medium bg-surface-default overflow-hidden">
      {ConfirmDialog}
      {/* En-tête : MessageChangeSummaryPanel de ZCode */}
      <div className="flex items-center justify-between gap-3 h-10 px-2 transition-colors hover:bg-hover-fill">
        <button onClick={() => setOpen((v) => !v)} className="flex h-full items-center gap-2 flex-1 min-w-0 px-1 text-left">
          <ChevronRight size={14} className={cn('flex-shrink-0 text-text-muted transition-transform', open && 'rotate-90')} />
          <span className={cn('min-w-0 truncate text-ui-base font-medium text-text-primary', undone && 'line-through text-text-muted')}>
            {changes.length} fichier{changes.length > 1 ? 's' : ''} modifié{changes.length > 1 ? 's' : ''}
          </span>
          <span className="flex-shrink-0 tabular-nums text-ui-base">
            <span className="text-diff-added">+{added}</span>{' '}
            <span className="text-diff-removed">-{removed}</span>
          </span>
        </button>
        {undone ? (
          <span className="text-ui-sm text-text-muted">Annulé</span>
        ) : (
          <button
            onClick={() => void undo()}
            disabled={!undoable || busy}
            title={undoable ? "Remettre les fichiers dans leur état précédent" : "Annulation indisponible pour cette réponse"}
            className={cn(
              'flex items-center gap-1.5 h-7 px-2 rounded-lg text-ui-base transition-colors',
              undoable && !busy ? 'text-text-secondary hover:text-text-primary' : 'text-text-muted cursor-not-allowed'
            )}
          >
            <Undo2 size={13} />
            Annuler
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-border-medium bg-bg-primary py-1 max-h-56 overflow-y-auto">
          {changes.map((c) => (
            <button
              key={c.path}
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: c.path }))}
              disabled={c.kind === 'deleted' || undone}
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
