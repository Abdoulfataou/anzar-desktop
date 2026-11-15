/**
 * Sélecteur de projet d'une tâche vide (au-dessus de la saisie), à la façon de Claude Code :
 * pré-rempli avec le dernier projet utilisé, modifiable en un clic tant que rien n'est envoyé.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderOpen, FolderPlus, ChevronDown, Check, Ban } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';

const MAX_RECENT = 5;

export default function ProjectPicker({
  currentProjectId, onPick, onOpenFolder, onNewFolder,
}: {
  currentProjectId: string | null;
  onPick: (projectId: string | null) => void;
  onOpenFolder: () => void;
  onNewFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const projects = useProjectStore((s) => s.projects);
  const conversations = useChatStore((s) => s.conversations);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  // Projets avec dossier, du plus récemment utilisé au plus ancien
  const recent = useMemo(() => {
    const lastUse = new Map<string, number>();
    for (const c of conversations) {
      if (c.projectId && c.messages.length) lastUse.set(c.projectId, Math.max(lastUse.get(c.projectId) || 0, c.updatedAt));
    }
    return projects
      .filter((p) => typeof p.metadata?.localPath === 'string')
      .sort((a, b) => (lastUse.get(b.id) || b.updatedAt) - (lastUse.get(a.id) || a.updatedAt))
      .slice(0, MAX_RECENT);
  }, [projects, conversations]);

  const current = projects.find((p) => p.id === currentProjectId) || null;
  // Le projet affiché reste dans la liste même s'il n'est pas parmi les plus récents
  const list = current && !recent.some((p) => p.id === current.id) ? [current, ...recent.slice(0, MAX_RECENT - 1)] : recent;

  const item = 'w-full flex items-center gap-2 px-2 h-8 rounded-md text-left text-ui-base hover:bg-surface-hover transition-colors';

  return (
    <div ref={ref} className="relative z-50 max-w-3xl mx-auto px-4 sm:px-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={current ? String(current.metadata?.localPath) : "Sans projet, l'agent ne peut ni lire ni modifier de fichiers"}
        className="flex items-center gap-1.5 h-7 px-2 -ml-2 rounded-lg text-ui-base text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors max-w-full"
      >
        <Folder size={13} className="flex-shrink-0" />
        <span className="truncate">{current ? current.name : 'Aucun projet'}</span>
        <ChevronDown size={12} className="opacity-60 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-2 sm:left-4 w-72 p-1 flex flex-col gap-0.5 rounded-lg border border-border-medium bg-surface-elevated shadow-md">
          {list.length > 0 && <div className="px-2 pt-1 pb-0.5 text-ui-sm text-text-muted">Projets récents</div>}
          {list.map((p) => (
            <button key={p.id} type="button" className={item} onClick={() => { onPick(p.id); setOpen(false); }}>
              <Folder size={13} className="flex-shrink-0 text-text-secondary" />
              <span className="flex-1 min-w-0 truncate text-text-primary" title={String(p.metadata?.localPath)}>{p.name}</span>
              {p.id === currentProjectId && <Check size={14} className="flex-shrink-0 text-text-primary" />}
            </button>
          ))}
          {list.length > 0 && <div className="my-0.5 h-px bg-border-subtle" />}
          <button type="button" className={item} onClick={() => { setOpen(false); onOpenFolder(); }}>
            <FolderOpen size={13} className="flex-shrink-0 text-text-secondary" />
            <span className="text-text-primary">Ouvrir un dossier…</span>
          </button>
          <button type="button" className={item} onClick={() => { setOpen(false); onNewFolder(); }}>
            <FolderPlus size={13} className="flex-shrink-0 text-text-secondary" />
            <span className="text-text-primary">Nouveau projet (dossier vierge)…</span>
          </button>
          <button type="button" className={item} onClick={() => { onPick(null); setOpen(false); }}>
            <Ban size={13} className="flex-shrink-0 text-text-secondary" />
            <span className="flex-1 text-text-primary">Aucun projet</span>
            {!currentProjectId && <Check size={14} className="flex-shrink-0 text-text-primary" />}
          </button>
        </div>
      )}
    </div>
  );
}
