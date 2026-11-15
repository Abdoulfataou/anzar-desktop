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
} from '@/services/agent/fileChanges';

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
    <div className="mt-2 rounded-xl border border-border-subtle bg-bg-secondary/50 overflow-hidden">
      {ConfirmDialog}
      <div className="flex items-center gap-2 h-10 px-3">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ChevronRight size={13} className={cn('text-text-muted transition-transform', open && 'rotate-90')} />
          <span className={cn('text-[13px] text-text-primary', undone && 'line-through text-text-muted')}>
            {changes.length} fichier{changes.length > 1 ? 's' : ''} modifié{changes.length > 1 ? 's' : ''}
          </span>
          <span className="text-[12.5px] font-mono tabular-nums text-accent-success">+{added}</span>
          <span className="text-[12.5px] font-mono tabular-nums text-accent-error">−{removed}</span>
        </button>
        {undone ? (
          <span className="text-[12px] text-text-muted">Annulé</span>
        ) : (
          <button
            onClick={() => void undo()}
            disabled={!undoable || busy}
            title={undoable ? "Remettre les fichiers dans leur état précédent" : "Annulation indisponible pour cette réponse"}
            className={cn(
              'flex items-center gap-1.5 h-7 px-2 rounded-lg text-[12.5px] transition-colors',
              undoable && !busy ? 'text-text-secondary hover:bg-surface-hover hover:text-text-primary' : 'text-text-muted/50 cursor-not-allowed'
            )}
          >
            <Undo2 size={13} />
            Annuler
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-border-subtle py-1 max-h-56 overflow-y-auto">
          {changes.map((c) => (
            <button
              key={c.path}
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: c.path }))}
              disabled={c.kind === 'deleted' || undone}
              className="w-full flex items-center gap-2 h-7 px-3 text-left font-mono text-[11.5px] hover:bg-surface-hover disabled:hover:bg-transparent transition-colors"
            >
              <span className={cn('flex-1 min-w-0 truncate text-text-secondary', c.kind === 'deleted' && 'line-through')}>{c.path}</span>
              {c.kind === 'created' && <span className="text-text-muted">nouveau</span>}
              {c.kind === 'deleted' && <span className="text-text-muted">supprimé</span>}
              {c.added > 0 && <span className="text-accent-success tabular-nums">+{c.added}</span>}
              {c.removed > 0 && <span className="text-accent-error tabular-nums">−{c.removed}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
