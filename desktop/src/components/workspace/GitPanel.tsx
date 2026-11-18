/**
 * Onglet Git, sur le modèle du panneau Git de ZCode :
 * - sources : non indexés · indexés · toutes les modifications de la branche · dernier tour
 * - cartes dépliables par fichier (diff), indexer / désindexer / annuler, filtre
 * - menu « Committer ou envoyer » : fenêtre de commit (message généré si vide, inclure
 *   les non indexés) et fenêtre d'envoi (branche, branche distante, état, détail des erreurs)
 * - sélecteur de branche : recherche, changement, création
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  GitBranch, RefreshCw, Loader2, ArrowUp, ArrowDown, Undo2, Sparkles, Check, ChevronRight, ChevronDown,
  Plus, Minus, Search, X, GitCommitHorizontal, FileText, Copy, AlertTriangle, FolderTree, List, Folder, Layers,
} from 'lucide-react';
import WorktreesDialog from './WorktreesDialog';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { terminalService } from '@/services/terminal';
import {
  readGitState, listChanges, fileDiff, initRepo, stage, unstage, discardChange, commit, push, pull,
  stageMany, unstageMany, discardMany,
  hasIdentity, suggestCommitMessage, listBranches, switchBranch, createBranch, isValidBranchName,
  type GitChange, type GitState, type GitSource,
} from '@/services/git';

export const OPEN_GIT_EVENT = 'anzar:open-git';

const STATUS: Record<GitChange['status'], { label: string; cls: string; title: string }> = {
  M: { label: 'M', cls: 'text-accent-warning', title: 'Modifié' },
  A: { label: 'A', cls: 'text-diff-added', title: 'Ajouté' },
  '?': { label: 'N', cls: 'text-diff-added', title: 'Nouveau fichier' },
  D: { label: 'S', cls: 'text-diff-removed', title: 'Supprimé' },
  R: { label: 'R', cls: 'text-link', title: 'Renommé' },
  U: { label: '!', cls: 'text-accent-error', title: 'En conflit' },
};

const SOURCE_LABEL: Record<GitSource, string> = {
  unstaged: 'Non indexés',
  staged: 'Indexés',
  branch: 'Toutes les modifications de la branche',
  'last-turn': 'Dernier tour',
};

const MAX_DIFF_LINES = 1500;

const iconBtn = 'flex items-center justify-center size-6 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-40';
const toolBtn = 'flex items-center gap-1 h-7 px-2 rounded-lg text-ui-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-40 transition-colors';
const primary = 'h-8 px-3 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 disabled:opacity-50';
const secondary = 'h-8 px-3 rounded-lg text-ui-base border border-border-medium text-text-primary hover:bg-hover-fill disabled:opacity-50';

interface Props {
  workspacePath: string;
  refreshKey: number;
  /** Fichiers touchés par l'agent à sa dernière réponse (source « Dernier tour ») */
  lastTurnPaths?: string[];
  onOpenFile?: (path: string) => void;
}

export default function GitPanel({ workspacePath, refreshKey, lastTurnPaths = [], onOpenFile }: Props) {
  const [state, setState] = useState<GitState | null>(null);
  const [source, setSource] = useState<GitSource>('unstaged');
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'commit' | 'push'>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [log, setLog] = useState<{ hash: string; subject: string; when: string }[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [tree, setTree] = useState<boolean>(() => { try { return localStorage.getItem('anzar.git.tree') === '1'; } catch { return false; } });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showWorktrees, setShowWorktrees] = useState(false);
  const { confirm, ConfirmDialog } = useConfirmModal();
  const lastTurnKey = lastTurnPaths.join('\n');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await readGitState(workspacePath);
      setState(s);
      if (!s.isRepo) { setChanges([]); return; }
      const list = await listChanges(workspacePath, s, source, lastTurnKey ? lastTurnKey.split('\n') : []);
      setChanges(list);
      setSelection((prev) => new Set([...prev].filter((p) => list.some((c) => c.path === p))));
      if (s.hasCommits) {
        const r = await terminalService.execArgs('git', ['log', '-n', '8', '--format=%h%x09%s%x09%cr'], { cwd: workspacePath });
        setLog(r.stdout.split('\n').filter(Boolean).map((l) => { const [hash, subject, when] = l.split('\t'); return { hash, subject, when }; }));
      } else setLog([]);
    } finally {
      setLoading(false);
    }
  }, [workspacePath, source, lastTurnKey]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  const counts = useMemo(() => ({
    unstaged: state?.entries.filter((e) => e.worktree).length ?? 0,
    staged: state?.entries.filter((e) => e.index).length ?? 0,
  }), [state]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? changes.filter((c) => c.path.toLowerCase().includes(q)) : changes;
  }, [changes, filter]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      return true;
    } catch (e: any) {
      toast.error(e?.message || String(e), { duration: 6000 });
      return false;
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const discard = async (c: GitChange) => {
    const ok = await confirm({
      title: c.status === '?' ? 'Supprimer le nouveau fichier' : 'Annuler les modifications',
      message: c.status === '?'
        ? `« ${c.path} » n'a jamais été commité : il sera supprimé du disque.`
        : `Remettre « ${c.path} » dans l'état du dernier commit ? Les modifications seront perdues.`,
      confirmLabel: c.status === '?' ? 'Supprimer' : 'Annuler les modifications',
      variant: 'danger',
    });
    if (ok) await run(`discard:${c.path}`, () => discardChange(workspacePath, c));
  };

  const selectedChanges = changes.filter((c) => selection.has(c.path));
  const toggleSelect = (path: string) => setSelection((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });
  const discardSelected = async () => {
    const list = selectedChanges.filter((c) => c.status !== 'U');
    const ok = await confirm({
      title: 'Annuler les modifications',
      message: `Annuler les modifications de ${list.length} fichier${list.length > 1 ? 's' : ''} ? Les nouveaux fichiers seront supprimés. C'est irréversible.`,
      confirmLabel: 'Annuler les modifications',
      variant: 'danger',
    });
    if (ok && await run('bulk', () => discardMany(workspacePath, list))) setSelection(new Set());
  };
  const toggleTree = () => setTree((v) => { try { localStorage.setItem('anzar.git.tree', v ? '0' : '1'); } catch { /* ignore */ } return !v; });

  if (!state) {
    return <div className="flex flex-1 items-center justify-center text-text-muted text-ui-caption"><Loader2 size={14} className="animate-spin mr-2" /> Lecture de Git…</div>;
  }

  if (!state.isRepo) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        {ConfirmDialog}
        <GitBranch size={22} className="text-text-muted" />
        <p className="text-ui-base font-medium text-text-primary">Ce dossier n'est pas un dépôt Git</p>
        <p className="text-ui-sm text-text-secondary max-w-sm">
          Git garde l'historique de tes modifications : revenir en arrière, travailler sur des branches, envoyer le code sur GitHub.
        </p>
        <button onClick={() => void run('init', () => initRepo(workspacePath), 'Git initialisé')} disabled={!!busy} className={primary}>
          Initialiser Git
        </button>
      </div>
    );
  }

  const dirtyCount = state.entries.length;
  const sources: GitSource[] = ['unstaged', 'staged', ...(state.base ? (['branch'] as GitSource[]) : []), 'last-turn'];

  return (
    <div className="relative flex flex-1 min-w-0 min-h-0 flex-col">
      {ConfirmDialog}

      {/* Ligne 1 : branche · état · actions */}
      <div className="flex items-center gap-1 px-2 h-10 border-b border-border-subtle flex-shrink-0">
        <BranchSwitcher
          cwd={workspacePath}
          current={state.branch}
          dirtyCount={dirtyCount}
          busy={!!busy}
          onSwitch={(name) => run('switch', () => switchBranch(workspacePath, name), `Branche ${name}`)}
          onCreate={(name) => run('create', () => createBranch(workspacePath, name), `Branche ${name} créée`)}
          onBlocked={(name) => { setPendingSwitch(name); setDialog('commit'); }}
        />
        {state.upstream && (state.ahead! > 0 || state.behind! > 0) && (
          <span className="text-ui-sm text-text-muted tabular-nums" title={`En avance de ${state.ahead} / en retard de ${state.behind} sur ${state.upstream}`}>
            {state.ahead! > 0 && `↑${state.ahead}`} {state.behind! > 0 && `↓${state.behind}`}
          </span>
        )}
        <div className="flex-1" />
        {state.hasRemote && (
          <button onClick={() => void run('pull', () => pull(workspacePath), 'Dépôt à jour')} disabled={!!busy} className={toolBtn} title="Récupérer les changements du dépôt distant (git pull)">
            {busy === 'pull' ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />} Récupérer
          </button>
        )}
        {state.hasCommits && (
          <button onClick={() => setShowWorktrees(true)} className={iconBtn} title="Worktrees de ce dépôt">
            <Layers size={13} />
          </button>
        )}
        <button onClick={() => void refresh()} className={iconBtn} title="Actualiser">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
        <ActionMenu
          canCommit={dirtyCount > 0}
          canPush={state.hasRemote && state.hasCommits}
          onCommit={() => setDialog('commit')}
          onPush={() => setDialog('push')}
        />
      </div>

      {/* Ligne 2 : source · filtre */}
      <div className="flex items-center gap-2 px-2 h-10 border-b border-border-subtle flex-shrink-0">
        <select
          aria-label="Source des modifications"
          value={source}
          onChange={(e) => { setSource(e.target.value as GitSource); setOpen(new Set()); }}
          className="h-7 px-2 rounded-lg bg-input border border-input-border text-ui-sm text-text-primary outline-none max-w-[55%]"
        >
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}{s === 'unstaged' ? ` (${counts.unstaged})` : s === 'staged' ? ` (${counts.staged})` : ''}
            </option>
          ))}
        </select>
        <div className="flex flex-1 items-center gap-1.5 h-7 px-2 rounded-lg bg-input border border-input-border min-w-0">
          <Search size={12} className="text-text-muted flex-shrink-0" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrer les fichiers"
            placeholder="Filtrer les fichiers…"
            className="flex-1 min-w-0 bg-transparent text-ui-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          {filter && <button onClick={() => setFilter('')} className="text-text-muted hover:text-text-primary" title="Effacer le filtre" aria-label="Effacer le filtre"><X size={12} /></button>}
        </div>
        <button onClick={toggleTree} className={iconBtn} title={tree ? 'Afficher en liste' : 'Grouper par dossier'} aria-label={tree ? 'Afficher en liste' : 'Grouper par dossier'}>
          {tree ? <List size={13} /> : <FolderTree size={13} />}
        </button>
      </div>

      {/* Sélection multiple */}
      {selection.size > 0 && (
        <div className="flex items-center gap-1 px-2 h-9 border-b border-border-subtle bg-hover-fill flex-shrink-0 text-ui-sm">
          <span className="px-1 text-text-primary">{selection.size} sélectionné{selection.size > 1 ? 's' : ''}</span>
          <button onClick={() => setSelection(new Set(shown.map((c) => c.path)))} className={toolBtn}>Tout</button>
          <button onClick={() => setSelection(new Set())} className={toolBtn}>Aucun</button>
          <div className="flex-1" />
          {source === 'unstaged' && (
            <>
              <button onClick={() => void discardSelected()} disabled={!!busy} className={cn(toolBtn, 'hover:text-accent-error')}><Undo2 size={12} /> Annuler</button>
              <button
                onClick={() => void run('bulk', () => stageMany(workspacePath, selectedChanges.map((c) => c.path))).then((ok) => ok && setSelection(new Set()))}
                disabled={!!busy}
                className={toolBtn}
              >
                {busy === 'bulk' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Indexer
              </button>
            </>
          )}
          {source === 'staged' && (
            <button
              onClick={() => void run('bulk', () => unstageMany(workspacePath, selectedChanges.map((c) => c.path), state.hasCommits)).then((ok) => ok && setSelection(new Set()))}
              disabled={!!busy}
              className={toolBtn}
            >
              {busy === 'bulk' ? <Loader2 size={12} className="animate-spin" /> : <Minus size={12} />} Désindexer
            </button>
          )}
        </div>
      )}

      {source === 'branch' && state.base && (
        <div className="px-3 py-1.5 text-ui-sm text-text-muted border-b border-border-subtle">Comparaison avec {state.base}, modifications non commitées comprises.</div>
      )}
      {source === 'last-turn' && (
        <div className="px-3 py-1.5 text-ui-sm text-text-muted border-b border-border-subtle">Fichiers modifiés par l'agent à sa dernière réponse, comparés au dernier commit.</div>
      )}

      {/* Cartes des fichiers */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {shown.length === 0 ? (
          <EmptyState source={source} filtered={!!filter.trim() && changes.length > 0} log={source === 'unstaged' && dirtyCount === 0 ? log : []} />
        ) : (
          groupByDir(shown, tree).map((g) => (
            <div key={g.dir || '·'} className="space-y-1.5">
              {tree && (
                <button
                  onClick={() => setCollapsed((prev) => { const n = new Set(prev); n.has(g.dir) ? n.delete(g.dir) : n.add(g.dir); return n; })}
                  className="flex items-center gap-1.5 w-full h-6 px-1 text-left text-ui-sm text-text-secondary hover:text-text-primary"
                >
                  {collapsed.has(g.dir) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <Folder size={12} />
                  <span className="truncate">{g.dir || '(racine)'}</span>
                  <span className="text-text-muted">{g.items.length}</span>
                </button>
              )}
              {!(tree && collapsed.has(g.dir)) && g.items.map((c) => (
            <ChangeCard
              key={c.path}
              cwd={workspacePath}
              change={c}
              source={source}
              state={state}
              refreshKey={refreshKey}
              expanded={open.has(c.path)}
              busy={busy}
              onToggle={() => setOpen((prev) => { const n = new Set(prev); n.has(c.path) ? n.delete(c.path) : n.add(c.path); return n; })}
              onStage={() => void run(`stage:${c.path}`, () => stage(workspacePath, c.path))}
              onUnstage={() => void run(`unstage:${c.path}`, () => unstage(workspacePath, c.path, state.hasCommits))}
              onDiscard={() => void discard(c)}
              onOpenFile={onOpenFile && c.status !== 'D' ? () => onOpenFile(c.path) : undefined}
              selected={selection.has(c.path)}
              onSelect={source === 'unstaged' || source === 'staged' ? () => toggleSelect(c.path) : undefined}
              indent={tree}
            />
              ))}
            </div>
          ))
        )}
      </div>

      {dialog === 'commit' && (
        <CommitDialog
          cwd={workspacePath}
          state={state}
          stagedCount={counts.staged}
          unstagedCount={counts.unstaged}
          pendingSwitch={pendingSwitch}
          onClose={() => { setDialog(null); setPendingSwitch(null); }}
          onDone={async (pushAfter) => {
            setDialog(null);
            if (pushAfter) {
              try {
                const s = await readGitState(workspacePath);
                const target = await push(workspacePath, s.branch, s.upstream);
                toast.success(`Commit créé et envoyé sur ${target}`);
              } catch (e: any) {
                toast.error(`Commit créé, mais l'envoi a échoué : ${e?.message || e}`, { duration: 7000 });
              }
            } else toast.success('Commit créé');
            if (pendingSwitch) {
              const name = pendingSwitch;
              setPendingSwitch(null);
              await run('switch', () => switchBranch(workspacePath, name), `Branche ${name}`);
            } else void refresh();
          }}
        />
      )}
      {showWorktrees && (
        <WorktreesDialog cwd={workspacePath} onClose={() => setShowWorktrees(false)} />
      )}
      {dialog === 'push' && (
        <PushDialog cwd={workspacePath} state={state} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void refresh(); }} />
      )}
    </div>
  );
}

/* ── Carte d'un fichier : en-tête + diff dépliable ── */

function ChangeCard({
  cwd, change, source, state, refreshKey, expanded, busy, onToggle, onStage, onUnstage, onDiscard, onOpenFile, selected, onSelect, indent,
}: {
  cwd: string; change: GitChange; source: GitSource; state: GitState; refreshKey: number; expanded: boolean; busy: string | null;
  onToggle: () => void; onStage: () => void; onUnstage: () => void; onDiscard: () => void; onOpenFile?: () => void;
  selected?: boolean; onSelect?: () => void; indent?: boolean;
}) {
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    if (!expanded) return;
    let alive = true;
    setDiff(null);
    void fileDiff(cwd, change, source, state).then((d) => { if (alive) setDiff(d); }).catch(() => { if (alive) setDiff(''); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, change.path, change.added, change.removed, source, refreshKey]);

  const st = STATUS[change.status];
  const slash = change.path.lastIndexOf('/');
  const isBusy = !!busy && busy.endsWith(`:${change.path}`);
  const lines = useMemo(() => {
    if (!diff) return [];
    return diff.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename (from|to))/.test(l));
  }, [diff]);
  const binary = !!diff && /^Binary files .* differ$/m.test(diff);

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-surface-default', selected ? 'border-text-secondary' : 'border-border-medium', indent && 'ml-4')}>
      <div className="group flex items-center gap-2 h-8 px-2 text-ui-sm hover:bg-hover-fill">
        {onSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onSelect}
            title={`Sélectionner ${change.path}`}
            aria-label={`Sélectionner ${change.path}`}
            className={cn('flex-shrink-0 cursor-pointer', !selected && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          />
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          title={change.path}
          className="flex flex-1 min-w-0 items-center gap-2 h-full text-left"
        >
          {expanded ? <ChevronDown size={13} className="text-text-muted flex-shrink-0" /> : <ChevronRight size={13} className="text-text-muted flex-shrink-0" />}
          <span className={cn('w-3 font-mono font-semibold flex-shrink-0', st.cls)} title={st.title}>{st.label}</span>
          <span className="truncate text-text-primary">{slash >= 0 ? change.path.slice(slash + 1) : change.path}</span>
          {slash >= 0 && !indent && <span className="truncate text-text-muted">{change.path.slice(0, slash)}</span>}
        </button>
        <span className="ml-auto flex items-center gap-1 flex-shrink-0 tabular-nums">
          {isBusy && <Loader2 size={12} className="animate-spin text-text-muted" />}
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            {onOpenFile && <button onClick={onOpenFile} className={iconBtn} title="Ouvrir le fichier" aria-label="Ouvrir le fichier"><FileText size={12} /></button>}
            {source === 'unstaged' && change.status !== 'U' && (
              <button onClick={onDiscard} disabled={!!busy} className={cn(iconBtn, 'hover:text-accent-error')} title={change.status === '?' ? 'Supprimer ce nouveau fichier' : 'Annuler les modifications'} aria-label={change.status === '?' ? 'Supprimer ce nouveau fichier' : 'Annuler les modifications'}>
                <Undo2 size={12} />
              </button>
            )}
            {source === 'unstaged' && <button onClick={onStage} disabled={!!busy} className={iconBtn} title="Indexer (inclure dans le prochain commit)" aria-label="Indexer le fichier"><Plus size={13} /></button>}
            {source === 'staged' && <button onClick={onUnstage} disabled={!!busy} className={iconBtn} title="Désindexer" aria-label="Désindexer le fichier"><Minus size={13} /></button>}
          </span>
          {change.added > 0 && <span className="text-diff-added">+{change.added}</span>}
          {change.removed > 0 && <span className="text-diff-removed">-{change.removed}</span>}
        </span>
      </div>
      {expanded && (
        <div className="border-t border-border-subtle overflow-x-auto font-mono text-ui-sm leading-5">
          {diff === null ? (
            <div className="px-3 py-2 text-text-muted"><Loader2 size={12} className="inline animate-spin mr-1" /> Chargement du diff…</div>
          ) : binary ? (
            <div className="px-3 py-2 text-text-muted">Fichier binaire : aperçu du diff indisponible.</div>
          ) : lines.length === 0 ? (
            <div className="px-3 py-2 text-text-muted">Pas de différence de contenu (fichier renommé ou mode changé).</div>
          ) : (
            <>
              {lines.slice(0, MAX_DIFF_LINES).map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    'px-3 whitespace-pre min-w-max',
                    l.startsWith('@@') ? 'text-text-muted bg-hover-fill'
                      : l.startsWith('+') ? 'bg-diff-added/10 text-text-primary'
                      : l.startsWith('-') ? 'bg-diff-removed/10 text-text-primary'
                      : 'text-text-secondary'
                  )}
                >
                  {l || ' '}
                </div>
              ))}
              {lines.length > MAX_DIFF_LINES && (
                <div className="px-3 py-2 text-text-muted">Diff tronqué : {lines.length - MAX_DIFF_LINES} lignes de plus. Ouvre le fichier pour tout voir.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Liste → groupes par dossier (un seul groupe sans dossier en mode liste) */
function groupByDir(changes: GitChange[], tree: boolean): { dir: string; items: GitChange[] }[] {
  if (!tree) return [{ dir: '', items: changes }];
  const map = new Map<string, GitChange[]>();
  for (const c of changes) {
    const i = c.path.lastIndexOf('/');
    const dir = i >= 0 ? c.path.slice(0, i) : '';
    map.set(dir, [...(map.get(dir) || []), c]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, items]) => ({ dir, items }));
}

function EmptyState({ source, filtered, log }: { source: GitSource; filtered: boolean; log: { hash: string; subject: string; when: string }[] }) {
  if (filtered) return <div className="px-2 py-6 text-center text-ui-sm text-text-muted">Aucun fichier ne correspond au filtre.</div>;
  const text = source === 'staged'
    ? "Aucun fichier indexé. Indexe des fichiers avec + dans « Non indexés », ou committe tout directement."
    : source === 'last-turn'
      ? "Aucun fichier modifié par l'agent à sa dernière réponse (ou déjà commité)."
      : source === 'branch'
        ? 'Aucune différence avec la branche de référence.'
        : 'Aucune modification : tout est commité.';
  return (
    <div>
      <div className="flex items-center gap-2 px-2 py-3 text-ui-base text-text-secondary">
        {source === 'unstaged' && <Check size={14} className="text-diff-added flex-shrink-0" />}
        {text}
      </div>
      {log.length > 0 && (
        <div className="px-2 pt-2">
          <div className="mb-1 text-ui-sm text-text-muted">Derniers commits</div>
          {log.map((l) => (
            <div key={l.hash} className="flex items-center gap-2 h-7 text-ui-sm">
              <GitCommitHorizontal size={12} className="text-text-muted flex-shrink-0" />
              <span className="font-mono text-text-muted flex-shrink-0">{l.hash}</span>
              <span className="truncate text-text-primary">{l.subject}</span>
              <span className="ml-auto text-text-muted flex-shrink-0">{l.when}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Menu « Committer ou envoyer » ── */

function ActionMenu({ canCommit, canPush, onCommit, onPush }: { canCommit: boolean; canPush: boolean; onCommit: () => void; onPush: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item = 'w-full flex items-center gap-2 h-8 px-2 rounded-md text-left text-ui-base text-text-primary hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-lg text-ui-sm font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90">
        Committer ou envoyer <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 p-1 rounded-lg border border-border-medium bg-surface-elevated shadow-md z-50">
          <button disabled={!canCommit} onClick={() => { setOpen(false); onCommit(); }} className={item}><GitCommitHorizontal size={13} /> Committer…</button>
          <button disabled={!canPush} onClick={() => { setOpen(false); onPush(); }} className={item}><ArrowUp size={13} /> Envoyer…</button>
        </div>
      )}
    </div>
  );
}

/* ── Fenêtres ── */

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
        className="w-[min(480px,92vw)] rounded-xl border border-border-medium bg-bg-primary shadow-xl"
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-border-subtle">
          <h3 id={titleId} className="text-ui-lg font-semibold text-text-primary">{title}</h3>
          <button onClick={onClose} className={iconBtn} title="Fermer" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-ui-base">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary text-right truncate">{children}</span>
    </div>
  );
}

function CommitDialog({
  cwd, state, stagedCount, unstagedCount, pendingSwitch, onClose, onDone,
}: {
  cwd: string; state: GitState; stagedCount: number; unstagedCount: number; pendingSwitch: string | null;
  onClose: () => void; onDone: (pushAfter: boolean) => void | Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(stagedCount === 0 || !!pendingSwitch);
  const [identity, setIdentity] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<null | 'generate' | 'commit' | 'push'>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void hasIdentity(cwd).then(setIdentity); }, [cwd]);

  // Rien d'indexé : on committe forcément tout ; pour changer de branche aussi
  const forced = stagedCount === 0 || !!pendingSwitch;
  const include = forced || includeUnstaged;
  const fileCount = include ? state.entries.length : stagedCount;

  const generate = async (): Promise<string> => {
    setBusy('generate');
    setError(null);
    try {
      const changes = await listChanges(cwd, state, include ? 'unstaged' : 'staged');
      const all = include ? [...changes, ...(await listChanges(cwd, state, 'staged'))] : changes;
      const m = await suggestCommitMessage(cwd, all, !include);
      if (!m) throw new Error("l'IA n'a pas proposé de message");
      setMessage(m);
      return m;
    } catch (e: any) {
      setError(`Génération impossible : ${e?.message || e}`);
      return '';
    } finally {
      setBusy(null);
    }
  };

  const submit = async (pushAfter: boolean) => {
    setError(null);
    let msg = message.trim();
    if (!msg) msg = await generate(); // message vide : généré, comme dans ZCode
    if (!msg) return;
    setBusy(pushAfter ? 'push' : 'commit');
    try {
      await commit(cwd, msg, include);
      await onDone(pushAfter);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title={pendingSwitch ? 'Committer puis changer de branche' : 'Committer les modifications'} onClose={onClose}>
      <InfoRow label="Branche actuelle">{state.branch || '(détachée)'}</InfoRow>
      {pendingSwitch && <InfoRow label="Branche cible">{pendingSwitch}</InfoRow>}
      <InfoRow label="Modifications">{fileCount} fichier{fileCount > 1 ? 's' : ''}</InfoRow>
      {identity === false && (
        <div className="flex gap-2 rounded-lg bg-accent-warning/10 px-3 py-2 text-ui-sm text-text-primary">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-accent-warning" />
          <span>Git ne connaît pas ton nom : lance dans un terminal <span className="font-mono">git config --global user.name "Ton nom"</span> et <span className="font-mono">git config --global user.email "toi@exemple.com"</span>.</span>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-ui-sm text-text-secondary">Message du commit</span>
          <button onClick={() => void generate()} disabled={!!busy} className="flex items-center gap-1 text-ui-sm text-link hover:underline disabled:opacity-50">
            {busy === 'generate' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {message ? 'Régénérer' : 'Générer le message'}
          </button>
        </div>
        <textarea
          autoFocus
          aria-label="Message du commit"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(false); }}
          rows={4}
          placeholder="Message du commit (laisse vide pour le générer)"
          className="w-full px-3 py-2 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none focus:border-input-border-hover resize-none"
        />
        <p className="mt-1 text-ui-sm text-text-muted">La génération utilise l'IA (quelques FCFA).</p>
      </div>
      {!forced && unstagedCount > 0 && (
        <label className="flex items-center gap-2 text-ui-base text-text-primary cursor-pointer">
          <input type="checkbox" checked={includeUnstaged} onChange={(e) => setIncludeUnstaged(e.target.checked)} />
          Inclure les modifications non indexées
        </label>
      )}
      {error && <p className="text-ui-sm text-accent-error">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        {state.hasRemote && (
          <button onClick={() => void submit(true)} disabled={!!busy || identity === false} className={secondary}>
            {busy === 'push' ? 'Envoi…' : 'Committer et envoyer'}
          </button>
        )}
        <button onClick={() => void submit(false)} disabled={!!busy || identity === false} className={primary}>
          {busy === 'commit' ? 'Commit…' : pendingSwitch ? 'Committer et changer' : 'Committer'}
        </button>
      </div>
    </Dialog>
  );
}

function PushDialog({ cwd, state, onClose, onDone }: { cwd: string; state: GitState; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ summary: string; details: string } | null>(null);
  const upToDate = !!state.upstream && state.ahead === 0;
  const doPush = async () => {
    setBusy(true);
    setError(null);
    try {
      const target = await push(cwd, state.branch, state.upstream);
      toast.success(`Envoyé sur ${target}`);
      onDone();
    } catch (e: any) {
      setError({ summary: e?.message || 'Envoi impossible', details: e?.details || e?.message || '' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Envoyer les modifications" onClose={onClose}>
      <p className="text-ui-sm text-text-secondary">
        {state.upstream
          ? `Les commits de ta branche seront envoyés sur ${state.upstream}.`
          : `Cette branche n'existe pas encore sur le dépôt distant : elle sera créée (origin/${state.branch}).`}
      </p>
      <InfoRow label="Branche">{state.branch || '(détachée)'}</InfoRow>
      <InfoRow label="Branche distante">{state.upstream || `origin/${state.branch} (sera créée)`}</InfoRow>
      {state.upstream && <InfoRow label="État">En avance de {state.ahead} · en retard de {state.behind}</InfoRow>}
      {upToDate && <p className="text-ui-sm text-text-muted">Aucun commit à envoyer sur cette branche.</p>}
      {state.behind! > 0 && <p className="text-ui-sm text-accent-warning">Le dépôt distant a {state.behind} commit{state.behind! > 1 ? 's' : ''} que tu n'as pas : fais d'abord « Récupérer ».</p>}
      {error && (
        <div className="space-y-1.5">
          <p className="text-ui-sm text-accent-error">{error.summary}</p>
          {error.details && error.details !== error.summary && (
            <>
              <pre className="max-h-32 overflow-auto rounded-lg bg-hover-fill p-2 font-mono text-ui-sm text-text-secondary whitespace-pre-wrap">{error.details}</pre>
              <button
                onClick={() => void navigator.clipboard.writeText(error.details).then(() => toast.success('Copié'), () => toast.error('Copie impossible'))}
                className="flex items-center gap-1 text-ui-sm text-link hover:underline"
              >
                <Copy size={12} /> Copier l'erreur
              </button>
            </>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className={secondary}>Annuler</button>
        <button onClick={() => void doPush()} disabled={busy || upToDate} className={primary}>{busy ? 'Envoi…' : 'Envoyer'}</button>
      </div>
    </Dialog>
  );
}

/* ── Sélecteur de branche ── */

function BranchSwitcher({
  cwd, current, dirtyCount, busy, onSwitch, onCreate, onBlocked,
}: {
  cwd: string; current: string | null; dirtyCount: number; busy: boolean;
  onSwitch: (name: string) => unknown; onCreate: (name: string) => unknown; onBlocked: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void listBranches(cwd).then(setBranches);
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setCreating(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, cwd]);
  const shown = branches.filter((b) => b.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = (name: string) => {
    setOpen(false);
    if (name === current) return;
    if (dirtyCount > 0) onBlocked(name);
    else void onSwitch(name);
  };
  const create = () => {
    const name = newName.trim();
    if (!isValidBranchName(name)) { toast.error('Nom de branche invalide (lettres, chiffres, - _ . /).'); return; }
    setOpen(false); setCreating(false); setNewName('');
    void onCreate(name); // les modifications en cours suivent la nouvelle branche
  };
  return (
    <div ref={ref} className="relative min-w-0">
      <button onClick={() => setOpen((v) => !v)} disabled={busy} aria-haspopup="menu" aria-expanded={open} aria-label={`Branche ${current || 'détachée'} — changer`} className="flex items-center gap-1.5 h-7 px-2 rounded-lg text-ui-base text-text-primary hover:bg-surface-hover min-w-0" title="Changer de branche">
        <GitBranch size={13} className="text-text-secondary flex-shrink-0" />
        <span className="truncate">{current || '(détachée)'}</span>
        <ChevronDown size={12} className="opacity-60 flex-shrink-0" />
      </button>
      {open && (
        <div role="menu" aria-label="Choisir une branche" className="absolute left-0 top-full mt-1 w-72 rounded-lg border border-border-medium bg-surface-elevated shadow-md z-50">
          <div className="p-1.5 border-b border-border-subtle">
            <input autoFocus value={query} aria-label="Rechercher une branche" onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une branche" className="w-full h-7 px-2 rounded-md bg-input border border-input-border text-ui-sm text-text-primary outline-none" />
          </div>
          {dirtyCount > 0 && <div className="px-3 pt-2 text-ui-sm text-accent-warning">Modifications non commitées : {dirtyCount} fichier{dirtyCount > 1 ? 's' : ''}</div>}
          <div className="px-3 pt-2 pb-1 text-ui-sm text-text-muted">Branches</div>
          <div className="max-h-56 overflow-y-auto px-1 pb-1">
            {shown.length === 0 && <div className="px-2 py-1.5 text-ui-sm text-text-muted">Aucune branche correspondante</div>}
            {shown.map((b) => (
              <button key={b} role="menuitem" onClick={() => pick(b)} className="w-full flex items-center gap-2 h-7 px-2 rounded-md text-left text-ui-sm text-text-primary hover:bg-surface-hover">
                <span className="flex-1 truncate">{b}</span>
                {b === current && <Check size={13} />}
              </button>
            ))}
          </div>
          <div className="border-t border-border-subtle p-1">
            {creating ? (
              <div className="flex gap-1 p-1">
                <input
                  autoFocus
                  value={newName}
                  aria-label="Nom de la nouvelle branche"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
                  placeholder="ex. feature/paiement-wave"
                  className="flex-1 h-7 px-2 rounded-md bg-input border border-input-border text-ui-sm font-mono text-text-primary outline-none"
                />
                <button onClick={create} className="h-7 px-2 rounded-md text-ui-sm font-medium bg-primary-btn text-primary-btn-fg">Créer</button>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 h-7 px-2 rounded-md text-left text-ui-sm text-text-primary hover:bg-surface-hover">
                <Plus size={13} /> Créer une nouvelle branche et y basculer…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
