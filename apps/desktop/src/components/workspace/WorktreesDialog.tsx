/**
 * Worktrees (façon ZCode) : création et gestion des copies de travail d'un dépôt.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, Plus, Trash2, FolderOpen, GitBranch, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAutomationStore } from '@/stores/automationStore';
import { activateWorktree } from '@/lib/openWorkspace';
import { startNewTask } from '@/lib/newTask';
import {
  listWorktrees, mainRepoPath, dirtyCount, startRefs, createWorktree, removeWorktree, pruneWorktrees,
  defaultWorktreeBranch, type Worktree,
} from '@/services/workspace/worktrees';
import { isValidBranchName } from '@/services/workspace/git';
import { useFocusTrap } from '@/hooks/useFocusTrap';

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const iconBtn = 'flex items-center justify-center size-7 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-40';
const primary = 'h-8 px-3 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 disabled:opacity-50';
const secondary = 'h-8 px-3 rounded-lg text-ui-base border border-border-medium text-text-primary hover:bg-hover-fill disabled:opacity-50';

function Shell({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const titleId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('max-h-[85vh] flex flex-col rounded-xl border border-border-medium bg-bg-primary shadow-xl', wide ? 'w-[min(640px,94vw)]' : 'w-[min(480px,92vw)]')}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border-subtle">
          <div className="min-w-0">
            <h3 id={titleId} className="text-ui-lg font-semibold text-text-primary">{title}</h3>
            {subtitle && <p className="text-ui-sm text-text-secondary truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Fermer" className={iconBtn} title="Fermer"><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** Retrouve le projet ANZAR d'un dossier */
const projectForPath = (path: string) =>
  useProjectStore.getState().projects.find((p) => typeof p.metadata?.localPath === 'string' && norm(p.metadata.localPath as string) === norm(path)) || null;

/* ── Création ── */

export function NewWorktreeDialog({ repoPath, onClose, onCreated }: {
  repoPath: string;
  onClose: () => void;
  /** Projet ANZAR créé pour la worktree */
  onCreated: (projectId: string) => void;
}) {
  const [branch, setBranch] = useState(defaultWorktreeBranch);
  const [refs, setRefs] = useState<{ current: string | null; local: string[]; remote: string[] } | null>(null);
  const [startRef, setStartRef] = useState('HEAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainPath, setMainPath] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const main = (await mainRepoPath(repoPath)) || repoPath;
      setMainPath(main);
      setRefs(await startRefs(repoPath));
    })();
  }, [repoPath]);

  const repoName = norm(mainPath || repoPath).split('/').pop() || 'projet';
  const create = async () => {
    const name = branch.trim();
    if (!isValidBranchName(name)) { setError('Nom de branche invalide (lettres, chiffres, - _ . /).'); return; }
    setBusy(true);
    setError(null);
    try {
      const main = mainPath || repoPath;
      const { path, copied } = await createWorktree(main, name, startRef);
      const parent = projectForPath(main);
      const id = activateWorktree(path, repoName, name, parent?.id ?? null);
      toast.success(`Worktree créée${copied.length ? ` · ${copied.length} fichier${copied.length > 1 ? 's' : ''} copié${copied.length > 1 ? 's' : ''} (.worktreeinclude)` : ''}`);
      onCreated(id);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Nouvelle worktree" subtitle={repoName} onClose={onClose}>
      <p className="text-ui-sm text-text-secondary">
        Une copie de travail séparée du projet, sur sa propre branche : l'agent y travaille sans toucher à ton dossier principal.
        Tu fusionnes la branche quand le résultat te convient.
      </p>
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Nouvelle branche</span>
        <input
          autoFocus
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
          className="mt-1 w-full h-9 px-3 rounded-lg bg-input border border-input-border font-mono text-ui-base text-text-primary outline-none focus:border-input-border-hover"
        />
      </label>
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Créer à partir de</span>
        <select
          value={startRef}
          onChange={(e) => setStartRef(e.target.value)}
          disabled={!refs}
          className="mt-1 w-full h-9 px-2 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none"
        >
          <option value="HEAD">HEAD actuel{refs?.current ? ` (${refs.current})` : ''}</option>
          {!!refs?.local.length && (
            <optgroup label="Branches locales">{refs.local.map((b) => <option key={b} value={b}>{b}</option>)}</optgroup>
          )}
          {!!refs?.remote.length && (
            <optgroup label="Branches distantes">{refs.remote.map((b) => <option key={b} value={b}>{b}</option>)}</optgroup>
          )}
        </select>
      </label>
      <p className="text-ui-sm text-text-muted">
        Les modifications non commitées ne sont pas copiées. Pour copier des fichiers ignorés par Git (ex. <span className="font-mono">.env</span>),
        liste-les dans un fichier <span className="font-mono">.worktreeinclude</span> à la racine du projet.
      </p>
      {error && <p className="text-ui-sm text-accent-error">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className={secondary}>Annuler</button>
        <button onClick={() => void create()} disabled={busy || !refs} className={primary}>
          {busy ? <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Création…</span> : 'Créer la worktree'}
        </button>
      </div>
    </Shell>
  );
}

/* ── Gestion ── */

export default function WorktreesDialog({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [list, setList] = useState<(Worktree & { dirty?: number })[] | null>(null);
  const [main, setMain] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const conversations = useChatStore((s) => s.conversations);
  const { confirm, ConfirmDialog } = useConfirmModal();

  const load = useCallback(async () => {
    const wts = await listWorktrees(cwd);
    setMain(wts[0]?.path ?? cwd);
    setList(wts);
    const withDirty = await Promise.all(wts.map(async (w) => ({ ...w, dirty: w.prunable ? 0 : await dirtyCount(w.path) })));
    setList(withDirty);
  }, [cwd]);
  useEffect(() => { void load(); }, [load]);

  const tasksFor = (path: string) => {
    const p = projectForPath(path);
    return p ? conversations.filter((c) => c.projectId === p.id && c.messages.length > 0) : [];
  };
  const isRunning = (path: string) => {
    const p = projectForPath(path);
    if (!p) return false;
    const chat = useChatStore.getState();
    const active = chat.conversations.find((c) => c.id === chat.activeConversationId);
    const autoConv = useAutomationStore.getState().runningConversationId;
    const auto = chat.conversations.find((c) => c.id === autoConv);
    return (chat.isGenerating && active?.projectId === p.id) || auto?.projectId === p.id;
  };

  const open = (w: Worktree) => {
    const repoName = norm(main || cwd).split('/').pop() || 'projet';
    const existing = projectForPath(w.path);
    const id = existing?.id ?? activateWorktree(w.path, repoName, w.branch || 'détachée', projectForPath(main || cwd)?.id ?? null);
    const last = tasksFor(w.path).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (last) {
      useChatStore.getState().setActiveConversation(last.id);
      useProjectStore.getState().setActiveProject(id);
    } else startNewTask(id);
    onClose();
    navigate('/');
  };

  const remove = async (w: Worktree & { dirty?: number }) => {
    if (isRunning(w.path)) { toast.error("Une tâche travaille dans cette worktree : attends qu'elle finisse."); return; }
    const tasks = tasksFor(w.path).length;
    const ok = await confirm({
      title: `Supprimer la worktree ${w.branch || ''}`,
      message:
        `Le dossier ${w.path} sera supprimé du disque. La branche ${w.branch || ''} reste dans le dépôt.` +
        (tasks ? ` ${tasks} tâche${tasks > 1 ? 's' : ''} perdront leur dossier (elles restent dans la liste).` : '') +
        (w.dirty ? `\n\n⚠ ${w.dirty} fichier${w.dirty > 1 ? 's' : ''} non commité${w.dirty > 1 ? 's' : ''} seront perdus.` : ''),
      confirmLabel: w.dirty ? 'Supprimer quand même' : 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(w.path);
    try {
      await removeWorktree(main || cwd, w.path, !!w.dirty);
      const p = projectForPath(w.path);
      if (p) useProjectStore.getState().deleteProject(p.id);
      toast.success('Worktree supprimée');
    } catch (e: any) {
      toast.error(e?.message || String(e), { duration: 6000 });
    } finally {
      setBusy(null);
      void load();
    }
  };

  const prune = async () => {
    setBusy('prune');
    try {
      await pruneWorktrees(main || cwd);
      for (const w of list || []) if (w.prunable) { const p = projectForPath(w.path); if (p) useProjectStore.getState().deleteProject(p.id); }
      toast.success('Entrées retirées');
    } finally {
      setBusy(null);
      void load();
    }
  };

  if (creating) {
    return (
      <NewWorktreeDialog
        repoPath={main || cwd}
        onClose={() => setCreating(false)}
        onCreated={(id) => { startNewTask(id); onClose(); navigate('/'); }}
      />
    );
  }

  const repoName = norm(main || cwd).split('/').pop();
  return (
    <Shell title="Worktrees" subtitle={`Copies de travail de ${repoName}`} onClose={onClose} wide>
      {ConfirmDialog}
      {!list ? (
        <div className="flex items-center gap-2 text-ui-sm text-text-muted"><Loader2 size={13} className="animate-spin" /> Chargement…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-medium divide-y divide-border-subtle">
          {list.map((w) => {
            const tasks = tasksFor(w.path).length;
            return (
              <div key={w.path} className="flex items-center gap-3 px-3 py-2.5">
                <GitBranch size={14} className="text-text-secondary flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-ui-base text-text-primary">
                    <span className="truncate font-medium">{w.branch || `détachée · ${w.head.slice(0, 7)}`}</span>
                    {w.main && <span className="rounded bg-tag px-1.5 text-ui-sm text-text-secondary">principal</span>}
                    {!!w.dirty && <span className="text-ui-sm text-accent-warning">Modifiée ({w.dirty})</span>}
                    {w.prunable && <span className="flex items-center gap-1 text-ui-sm text-accent-error"><AlertTriangle size={11} /> Dossier disparu</span>}
                  </div>
                  <div className="text-ui-sm text-text-muted truncate" title={w.path}>
                    {w.path} · {tasks ? `${tasks} tâche${tasks > 1 ? 's' : ''}` : 'Aucune tâche'}
                  </div>
                </div>
                {!w.prunable && (
                  <button onClick={() => open(w)} className={iconBtn} title={tasks ? 'Ouvrir la dernière tâche' : 'Ouvrir dans une nouvelle tâche'}>
                    <FolderOpen size={14} />
                  </button>
                )}
                {!w.main && !w.prunable && (
                  <button onClick={() => void remove(w)} disabled={!!busy} className={cn(iconBtn, 'hover:text-accent-error')} title="Supprimer la worktree">
                    {busy === w.path ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="flex justify-between gap-2 pt-1">
        {list?.some((w) => w.prunable)
          ? <button onClick={() => void prune()} disabled={!!busy} className={secondary}>Retirer les entrées disparues</button>
          : <span />}
        <button onClick={() => setCreating(true)} className={primary}>
          <span className="flex items-center gap-1.5"><Plus size={14} /> Nouvelle worktree</span>
        </button>
      </div>
    </Shell>
  );
}
