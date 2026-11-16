/**
 * Git pour les tickets du super-agent : chaque ticket travaille dans sa worktree, sur
 * sa branche anzar/ticket-…, à partir de l'état actuel du projet. Rien n'arrive dans
 * le dossier du projet sans la validation de l'utilisateur (fusion).
 */
import { terminalService } from '@/services/terminal';
import { gitError } from '@/services/git';
import { createWorktree, removeWorktree } from '@/services/worktrees';

/** Remplaçables pour les tests. */
export const hooks = {
  git: (cwd: string, ...args: string[]) => terminalService.execArgs('git', args, { cwd, timeout: 120_000 }),
  createWorktree,
  removeWorktree,
  registerPath: (p: string) => terminalService.registerProjectPath(p),
};

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'ticket';

export async function isGitRepo(path: string): Promise<boolean> {
  const r = await hooks.git(path, 'rev-parse', '--is-inside-work-tree');
  return r.success && r.stdout.trim() === 'true';
}

/** Modifications non commitées dans le dossier du projet (elles ne partent pas dans la worktree). */
export async function uncommittedCount(path: string): Promise<number> {
  const r = await hooks.git(path, 'status', '--porcelain');
  return r.success ? r.stdout.split('\n').filter((l) => l.trim()).length : 0;
}

export async function prepareWorktree(repo: string, ticket: { id: string; title: string }): Promise<{ path: string; branch: string }> {
  const branch = `anzar/ticket-${slug(ticket.title)}-${ticket.id.slice(-4).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  const { path } = await hooks.createWorktree(repo, branch, 'HEAD');
  hooks.registerPath(path); // les commandes de l'agent y sont autorisées
  return { path, branch };
}

/** Commite tout le travail de l'exécutant. Renvoie le résumé des fichiers, ou null si rien n'a changé. */
export async function commitAll(path: string, message: string): Promise<string | null> {
  const add = await hooks.git(path, 'add', '-A');
  if (!add.success) throw new Error(gitError(add.stderr, 'git add impossible'));
  const staged = await hooks.git(path, 'diff', '--cached', '--stat');
  if (!staged.stdout.trim()) return null;
  const commit = await hooks.git(path, 'commit', '-m', message.slice(0, 200));
  if (!commit.success) throw new Error(gitError(commit.stderr, 'git commit impossible'));
  return staged.stdout.trim();
}

/** Changements de la branche du ticket par rapport au projet. */
export async function ticketDiff(repo: string, branch: string, maxChars = 60_000): Promise<{ stat: string; diff: string }> {
  const [stat, diff] = await Promise.all([
    hooks.git(repo, 'diff', '--stat', `HEAD...${branch}`),
    hooks.git(repo, 'diff', `HEAD...${branch}`),
  ]);
  const d = diff.stdout;
  return {
    stat: stat.stdout.trim(),
    diff: d.length > maxChars ? `${d.slice(0, maxChars)}\n… [diff tronqué : ${d.length.toLocaleString('fr-FR')} caractères]` : d,
  };
}

/**
 * Fusionne la branche du ticket dans la branche actuelle du projet. En cas de conflit,
 * la fusion est annulée : le projet reste exactement comme avant.
 */
export async function mergeTicket(repo: string, branch: string, title: string): Promise<void> {
  if (await uncommittedCount(repo) > 0) {
    throw new Error('Le projet a des modifications non commitées : commite-les ou mets-les de côté avant de fusionner.');
  }
  const r = await hooks.git(repo, 'merge', '--no-ff', '-m', `ANZAR : ${title}`.slice(0, 200), branch);
  if (!r.success) {
    const conflicts = await hooks.git(repo, 'diff', '--name-only', '--diff-filter=U');
    await hooks.git(repo, 'merge', '--abort');
    const files = conflicts.stdout.split('\n').filter(Boolean);
    throw new Error(files.length
      ? `Conflit avec des changements faits entre-temps dans : ${files.slice(0, 8).join(', ')}. Fusion annulée, rien n'a changé. Relance le ticket pour qu'il reparte de l'état actuel.`
      : gitError(r.stderr, 'Fusion impossible'));
  }
}

/** Supprime la worktree et la branche du ticket. */
export async function discardTicket(repo: string, worktreePath: string | undefined, branch: string | undefined): Promise<void> {
  if (worktreePath) await hooks.removeWorktree(repo, worktreePath, true).catch(() => {});
  if (branch) await hooks.git(repo, 'branch', '-D', branch);
}

/** Après fusion : la worktree ne sert plus, la branche fusionnée peut partir. */
export async function cleanupMerged(repo: string, worktreePath: string | undefined, branch: string | undefined): Promise<void> {
  if (worktreePath) await hooks.removeWorktree(repo, worktreePath, true).catch(() => {});
  if (branch) await hooks.git(repo, 'branch', '-d', branch);
}
