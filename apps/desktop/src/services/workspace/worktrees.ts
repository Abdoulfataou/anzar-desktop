/**
 * Worktrees (façon ZCode) : une copie de travail séparée du dépôt, sur sa propre branche,
 * pour faire travailler une tâche sans toucher au dossier principal.
 * Emplacement : ~/Documents/ANZAR/worktrees/<dépôt>-<branche> (dans le périmètre de l'app).
 */
import { terminalService } from '@/services/runtime/terminal';
import { gitError, isValidBranchName } from '@/services/workspace/git';

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  /** Le dossier principal du dépôt (premier de la liste) */
  main: boolean;
  /** Dossier disparu du disque */
  prunable: boolean;
}

const git = (cwd: string, ...args: string[]) => terminalService.execArgs('git', args, { cwd, timeout: 120_000 });
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

export function parseWorktreeList(stdout: string): Worktree[] {
  const out: Worktree[] = [];
  let cur: Partial<Worktree> | null = null;
  const flush = () => { if (cur?.path) out.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? '', main: out.length === 0, prunable: !!cur.prunable }); cur = null; };
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) { flush(); cur = { path: norm(line.slice(9)) }; }
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line.startsWith('prunable')) cur.prunable = true;
    else if (line === '') flush();
  }
  flush();
  return out;
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const r = await git(cwd, 'worktree', 'list', '--porcelain');
  return r.success ? parseWorktreeList(r.stdout) : [];
}

/** Dossier principal du dépôt (même depuis une worktree) */
export async function mainRepoPath(cwd: string): Promise<string | null> {
  const list = await listWorktrees(cwd);
  return list[0]?.path ?? null;
}

export async function dirtyCount(path: string): Promise<number> {
  const r = await git(path, 'status', '--porcelain');
  return r.success ? r.stdout.split('\n').filter((l) => l.trim()).length : 0;
}

/** Points de départ possibles : HEAD, branches locales et distantes */
export async function startRefs(cwd: string): Promise<{ current: string | null; local: string[]; remote: string[] }> {
  const [cur, local, remote] = await Promise.all([
    git(cwd, 'branch', '--show-current'),
    git(cwd, 'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'),
    git(cwd, 'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/remotes'),
  ]);
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter((l) => l && !l.endsWith('/HEAD') && l !== 'origin');
  return { current: cur.stdout.trim() || null, local: lines(local.stdout), remote: lines(remote.stdout) };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'worktree';

/** Nom de branche proposé par défaut : anzar/<date-heure> */
export function defaultWorktreeBranch(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `anzar/${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Crée la worktree sur une nouvelle branche et copie les fichiers listés dans
 * .worktreeinclude (un chemin par ligne, ex. .env), absents d'un clone car non suivis.
 */
export async function createWorktree(repoPath: string, branch: string, startRef: string): Promise<{ path: string; copied: string[] }> {
  if (!isValidBranchName(branch)) throw new Error('Nom de branche invalide (lettres, chiffres, - _ . /).');
  const { documentDir, join } = await import('@tauri-apps/api/path');
  const { exists, readTextFile, writeTextFile, createDir } = await import('@/lib/tauri/fs');
  const repoName = slug(norm(repoPath).split('/').pop() || 'projet');
  const base = await join(await documentDir(), 'ANZAR', 'worktrees');
  await createDir(base, { recursive: true }).catch(() => {});
  let path = await join(base, `${repoName}-${slug(branch)}`);
  for (let i = 2; await exists(path); i++) path = await join(base, `${repoName}-${slug(branch)}-${i}`);

  const r = await git(repoPath, 'worktree', 'add', '-b', branch, path, startRef);
  if (!r.success) throw new Error(gitError(r.stderr, 'Création de la worktree impossible'));

  const copied: string[] = [];
  const includeFile = `${norm(repoPath)}/.worktreeinclude`;
  if (await exists(includeFile).catch(() => false)) {
    const list = (await readTextFile(includeFile)).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.includes('..'));
    for (const rel of list.slice(0, 50)) {
      try {
        const src = `${norm(repoPath)}/${rel}`;
        if (!(await exists(src))) continue;
        const dest = `${norm(path)}/${rel}`;
        const dir = dest.slice(0, dest.lastIndexOf('/'));
        await createDir(dir, { recursive: true }).catch(() => {});
        await writeTextFile(dest, await readTextFile(src));
        copied.push(rel);
      } catch { /* fichier binaire ou illisible : ignoré */ }
    }
  }
  return { path: norm(path), copied };
}

/** Supprime la worktree (dossier compris). `force` : même avec des modifications non commitées. */
export async function removeWorktree(repoPath: string, path: string, force: boolean) {
  const r = force
    ? await git(repoPath, 'worktree', 'remove', '--force', path)
    : await git(repoPath, 'worktree', 'remove', path);
  if (!r.success) throw new Error(gitError(r.stderr, 'Suppression de la worktree impossible'));
  await git(repoPath, 'worktree', 'prune');
}

/** Retire les worktrees dont le dossier a disparu */
export async function pruneWorktrees(repoPath: string) {
  await git(repoPath, 'worktree', 'prune');
}
