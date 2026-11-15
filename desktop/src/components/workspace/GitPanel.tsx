/**
 * Onglet Git (façon ZCode) : fichiers modifiés, diff, annulation par fichier,
 * commit (message proposé par l'IA si on veut), envoi et récupération.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitBranch, RefreshCw, Loader2, ArrowUp, ArrowDown, Undo2, Sparkles, Check, GitCommitHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import { terminalService } from '@/services/terminal';
import {
  readGitState, fileDiff, initRepo, discardChange, commitAll, push, pull, hasRemote, suggestCommitMessage,
  type GitChange, type GitState,
} from '@/services/git';

export const OPEN_GIT_EVENT = 'anzar:open-git';

const STATUS_STYLE: Record<GitChange['status'], { label: string; cls: string; title: string }> = {
  M: { label: 'M', cls: 'text-accent-warning', title: 'Modifié' },
  A: { label: 'A', cls: 'text-diff-added', title: 'Ajouté' },
  '?': { label: 'N', cls: 'text-diff-added', title: 'Nouveau fichier' },
  D: { label: 'S', cls: 'text-diff-removed', title: 'Supprimé' },
  R: { label: 'R', cls: 'text-link', title: 'Renommé' },
  U: { label: '!', cls: 'text-accent-error', title: 'En conflit' },
};

interface LogEntry { hash: string; subject: string; when: string }

export default function GitPanel({ workspacePath, refreshKey }: { workspacePath: string; refreshKey: number }) {
  const [state, setState] = useState<GitState | null>(null);
  const [remote, setRemote] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<null | 'commit' | 'push' | 'pull' | 'suggest' | 'init'>(null);
  const { confirm, ConfirmDialog } = useConfirmModal();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await readGitState(workspacePath);
      setState(s);
      if (s.isRepo) {
        setRemote(await hasRemote(workspacePath));
        if (s.hasCommits) {
          const r = await terminalService.execArgs('git', ['log', '-n', '8', '--format=%h%x09%s%x09%cr'], { cwd: workspacePath });
          setLog(r.stdout.split('\n').filter(Boolean).map((l) => {
            const [hash, subject, when] = l.split('\t');
            return { hash, subject, when };
          }));
        } else setLog([]);
      }
      setSelected((cur) => (cur && s.changes.some((c) => c.path === cur) ? cur : null));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  const selectedChange = useMemo(() => state?.changes.find((c) => c.path === selected) || null, [state, selected]);
  useEffect(() => {
    if (!selectedChange) { setDiff(''); return; }
    let alive = true;
    setDiffLoading(true);
    void fileDiff(workspacePath, selectedChange)
      .then((d) => { if (alive) setDiff(d); })
      .finally(() => { if (alive) setDiffLoading(false); });
    return () => { alive = false; };
  }, [selectedChange, workspacePath]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>, ok?: string) => {
    setBusy(kind);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e: any) {
      toast.error(e?.message || String(e), { duration: 6000 });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const doCommit = (andPush: boolean) => run('commit', async () => {
    await commitAll(workspacePath, message);
    setMessage('');
    if (andPush) {
      setBusy('push');
      await push(workspacePath, state?.branch ?? null, state?.ahead !== null);
    }
  }, andPush ? 'Commit créé et envoyé' : 'Commit créé');

  const suggest = () => run('suggest', async () => {
    if (!state?.changes.length) return;
    const m = await suggestCommitMessage(workspacePath, state.changes);
    if (!m) throw new Error("L'IA n'a pas proposé de message. Réessaie.");
    setMessage(m);
  });

  const discard = async (c: GitChange) => {
    const ok = await confirm({
      title: c.status === '?' ? 'Supprimer le nouveau fichier' : 'Annuler les modifications',
      message: c.status === '?'
        ? `« ${c.path} » n'a jamais été commité : il sera supprimé du disque.`
        : `Remettre « ${c.path} » dans l'état du dernier commit ? Les modifications seront perdues.`,
      confirmLabel: c.status === '?' ? 'Supprimer' : 'Annuler les modifications',
      variant: 'danger',
    });
    if (ok) await run('commit', () => discardChange(workspacePath, c));
  };

  if (!state) {
    return <div className="flex flex-1 items-center justify-center text-text-muted text-ui-caption"><Loader2 size={14} className="animate-spin mr-2" /> Lecture de Git…</div>;
  }

  if (!state.isRepo) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        {ConfirmDialog}
        <GitBranch size={22} className="text-text-muted" />
        <p className="text-ui-base text-text-secondary max-w-sm">
          Ce dossier n'utilise pas Git. Git garde l'historique de tes modifications et permet de revenir en arrière ou d'envoyer le code sur GitHub.
        </p>
        <button
          onClick={() => void run('init', () => initRepo(workspacePath), 'Git initialisé')}
          disabled={!!busy}
          className="h-8 px-3 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 disabled:opacity-50"
        >
          Initialiser Git
        </button>
      </div>
    );
  }

  const changes = state.changes;
  const hasUpstream = state.ahead !== null;
  const btn = 'flex items-center gap-1 h-7 px-2 rounded-lg text-ui-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-40 transition-colors';

  return (
    <div className="flex flex-1 min-w-0 min-h-0 flex-col">
      {ConfirmDialog}
      {/* Branche · envoi · récupération */}
      <div className="flex items-center gap-1 px-3 h-10 border-b border-border-subtle flex-shrink-0">
        <GitBranch size={13} className="text-text-secondary flex-shrink-0" />
        <span className="text-ui-base text-text-primary truncate">{state.branch || '(détachée)'}</span>
        {hasUpstream && (state.ahead! > 0 || state.behind! > 0) && (
          <span className="text-ui-sm text-text-muted tabular-nums ml-1">
            {state.ahead! > 0 && `↑${state.ahead}`} {state.behind! > 0 && `↓${state.behind}`}
          </span>
        )}
        <div className="flex-1" />
        {remote && (
          <>
            <button onClick={() => void run('pull', () => pull(workspacePath), 'Dépôt à jour')} disabled={!!busy} className={btn} title="Récupérer les changements du dépôt distant (git pull)">
              {busy === 'pull' ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />} Récupérer
            </button>
            <button
              onClick={() => void run('push', () => push(workspacePath, state.branch, hasUpstream), 'Commits envoyés')}
              disabled={!!busy || !state.hasCommits || (hasUpstream && state.ahead === 0)}
              className={btn}
              title="Envoyer les commits (git push)"
            >
              {busy === 'push' ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />} Envoyer
            </button>
          </>
        )}
        <button onClick={() => void refresh()} className={btn} title="Actualiser">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>

      {changes.length === 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center gap-2 px-4 py-4 text-ui-base text-text-secondary">
            <Check size={14} className="text-diff-added" /> Aucune modification : tout est commité.
          </div>
          {log.length > 0 && (
            <div className="px-4 pb-4">
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
      ) : (
        <>
          {/* Fichiers modifiés */}
          <div className={cn('overflow-y-auto border-b border-border-subtle py-1', selected ? 'max-h-[35%] flex-shrink-0' : 'flex-1 min-h-0')}>
            {changes.map((c) => {
              const st = STATUS_STYLE[c.status];
              const slash = c.path.lastIndexOf('/');
              return (
                <div
                  key={c.path}
                  onClick={() => setSelected(selected === c.path ? null : c.path)}
                  className={cn(
                    'group flex items-center gap-2 h-7 px-3 cursor-pointer text-ui-sm',
                    selected === c.path ? 'bg-selected' : 'hover:bg-hover-fill'
                  )}
                >
                  <span className={cn('w-3 font-mono font-semibold flex-shrink-0', st.cls)} title={st.title}>{st.label}</span>
                  <span className="truncate text-text-primary">{slash >= 0 ? c.path.slice(slash + 1) : c.path}</span>
                  {slash >= 0 && <span className="truncate text-text-muted">{c.path.slice(0, slash)}</span>}
                  <span className="ml-auto flex items-center gap-1.5 flex-shrink-0 tabular-nums">
                    {c.added > 0 && <span className="text-diff-added">+{c.added}</span>}
                    {c.removed > 0 && <span className="text-diff-removed">-{c.removed}</span>}
                    <button
                      onClick={(e) => { e.stopPropagation(); void discard(c); }}
                      disabled={!!busy || c.status === 'U'}
                      className="hidden group-hover:flex p-0.5 rounded text-text-muted hover:text-accent-error"
                      title={c.status === '?' ? 'Supprimer ce nouveau fichier' : 'Annuler les modifications de ce fichier'}
                    >
                      <Undo2 size={12} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Diff du fichier choisi */}
          {selected && (
            <div className="flex-1 min-h-0 overflow-auto font-mono text-ui-sm leading-5">
              {diffLoading ? (
                <div className="p-3 text-text-muted"><Loader2 size={12} className="inline animate-spin mr-1" /> Diff…</div>
              ) : !diff.trim() ? (
                <div className="p-3 text-text-muted">Pas de différence affichable (fichier binaire ou seulement renommé).</div>
              ) : (
                diff.split('\n')
                  .filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to))/.test(l))
                  .slice(0, 3000)
                  .map((l, i) => (
                    <div
                      key={i}
                      className={cn(
                        'px-3 whitespace-pre',
                        l.startsWith('@@') ? 'text-text-muted bg-hover-fill mt-1'
                          : l.startsWith('+') ? 'bg-diff-added/10 text-text-primary'
                          : l.startsWith('-') ? 'bg-diff-removed/10 text-text-primary'
                          : 'text-text-secondary'
                      )}
                    >
                      {l || ' '}
                    </div>
                  ))
              )}
            </div>
          )}

          {/* Commit */}
          <div className="flex-shrink-0 border-t border-border-subtle p-3 space-y-2">
            <div className="relative">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && message.trim()) void doCommit(false); }}
                rows={3}
                placeholder={`Message du commit (${changes.length} fichier${changes.length > 1 ? 's' : ''})`}
                className="w-full px-3 py-2 pr-9 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none focus:border-input-border-hover resize-none"
              />
              <button
                onClick={() => void suggest()}
                disabled={!!busy}
                className="absolute right-2 top-2 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-40"
                title="Proposer un message (IA, coûte quelques FCFA)"
              >
                {busy === 'suggest' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void doCommit(false)}
                disabled={!!busy || !message.trim()}
                className="flex-1 h-8 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 disabled:opacity-50"
              >
                {busy === 'commit' ? 'Commit…' : 'Committer'}
              </button>
              {remote && (
                <button
                  onClick={() => void doCommit(true)}
                  disabled={!!busy || !message.trim()}
                  className="flex-1 h-8 rounded-lg text-ui-base border border-border-medium text-text-primary hover:bg-hover-fill disabled:opacity-50"
                >
                  {busy === 'push' ? 'Envoi…' : 'Committer et envoyer'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
