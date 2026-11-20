/**
 * Git du dossier de projet, pour le panneau Git (façon ZCode).
 * Tout passe par terminalService.execArgs : programme et arguments autorisés par Tauri.
 */
import { terminalService } from '@/services/runtime/terminal';
import { aiService } from '@/services/ai/ai';

export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | '?' | 'U';

export interface GitChange {
  path: string;
  /** M modifié, A ajouté, D supprimé, R renommé, ? nouveau (non suivi), U conflit */
  status: ChangeStatus;
  added: number;
  removed: number;
}

/** Une ligne de `git status` : état dans l'index (indexé) et dans le dossier (non indexé) */
export interface StatusEntry {
  path: string;
  index: ChangeStatus | null;
  worktree: ChangeStatus | null;
}

/** Sources de modifications, comme dans ZCode */
export type GitSource = 'unstaged' | 'staged' | 'branch' | 'last-turn';

export interface GitState {
  isRepo: boolean;
  branch: string | null;
  hasCommits: boolean;
  /** Branche distante suivie (ex. origin/main), null si aucune */
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  hasRemote: boolean;
  /** Branche de référence pour « toutes les modifications de la branche » (ex. origin/main) */
  base: string | null;
  entries: StatusEntry[];
  /** Compteurs +/- des modifications non indexées et indexées */
  unstagedCounts: Map<string, { added: number; removed: number }>;
  stagedCounts: Map<string, { added: number; removed: number }>;
}

const git = (cwd: string, ...args: string[]) => terminalService.execArgs('git', args, { cwd, timeout: 60_000 });

/** Message lisible à partir d'une erreur git */
export function gitError(stderr: string, fallback = 'Erreur git'): string {
  const s = stderr.trim();
  if (/Please tell me who you are|user\.email|user\.name|empty ident/i.test(s)) {
    return "Git ne connaît pas ton nom : lance dans un terminal git config --global user.name \"Ton nom\" et git config --global user.email \"toi@exemple.com\".";
  }
  if (/could not read Username|Authentication failed|Permission denied \(publickey\)/i.test(s)) {
    return "Connexion au dépôt distant refusée : vérifie ta connexion GitHub (identifiants ou clé SSH) depuis un terminal.";
  }
  if (/no upstream branch|has no upstream/i.test(s)) return 'Aucune branche distante liée à cette branche.';
  if (/non-fast-forward|fetch first|rejected/i.test(s)) return "Le dépôt distant a des changements que tu n'as pas : fais d'abord « Récupérer ».";
  if (/would be overwritten by checkout|Please commit your changes or stash them/i.test(s)) {
    return 'Des modifications non commitées seraient écrasées : committe-les avant de changer de branche.';
  }
  if (/contains modified or untracked files/i.test(s)) return 'La worktree contient des modifications non commitées.';
  if (/is already (checked out|used by worktree)/i.test(s)) return 'Cette branche est déjà ouverte dans une autre worktree.';
  if (/already exists/i.test(s)) return 'Une branche porte déjà ce nom.';
  return (s.split('\n').filter(Boolean).slice(-2).join(' ') || fallback).slice(0, 300);
}

/** Chemin tel que git l'écrit (entre guillemets avec échappements si caractères spéciaux) */
function unquote(p: string): string {
  if (!p.startsWith('"')) return p;
  const inner = p.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && /[0-7]{3}/.test(inner.slice(i + 1, i + 4))) {
      bytes.push(parseInt(inner.slice(i + 1, i + 4), 8)); i += 3;
    } else if (ch === '\\' && i + 1 < inner.length) {
      const n = inner[++i];
      bytes.push((n === 't' ? '\t' : n === 'n' ? '\n' : n).charCodeAt(0));
    } else {
      bytes.push(...new TextEncoder().encode(ch));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const codeOf = (c: string): ChangeStatus | null =>
  c === ' ' ? null : c === 'M' || c === 'T' ? 'M' : c === 'A' ? 'A' : c === 'D' ? 'D' : c === 'R' || c === 'C' ? 'R' : 'M';

export function parsePorcelain(stdout: string): StatusEntry[] {
  const out: StatusEntry[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue;
    const x = line[0], y = line[1];
    let path = line.slice(3);
    if (path.includes(' -> ')) path = path.split(' -> ').pop()!;
    path = unquote(path);
    if (x === '?' && y === '?') { out.push({ path, index: null, worktree: '?' }); continue; }
    if (x === '!' ) continue;
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      out.push({ path, index: null, worktree: 'U' }); continue;
    }
    out.push({ path, index: codeOf(x), worktree: codeOf(y) });
  }
  return out;
}

export function parseNumstat(stdout: string): Map<string, { added: number; removed: number }> {
  const map = new Map<string, { added: number; removed: number }>();
  for (const line of stdout.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    let path = m[3];
    if (path.includes(' => ')) {
      path = path.replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/');
    }
    map.set(unquote(path), { added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]) });
  }
  return map;
}

/** `git diff --name-status` → statut par fichier */
function parseNameStatus(stdout: string): Map<string, ChangeStatus> {
  const map = new Map<string, ChangeStatus>();
  for (const line of stdout.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    map.set(unquote(parts[parts.length - 1]), codeOf(parts[0][0]) || 'M');
  }
  return map;
}

async function findBase(cwd: string, branch: string | null, upstream: string | null): Promise<string | null> {
  const candidates: string[] = [];
  const originHead = await git(cwd, 'rev-parse', '--abbrev-ref', 'origin/HEAD');
  if (originHead.success && originHead.stdout.trim() && originHead.stdout.trim() !== 'origin/HEAD') candidates.push(originHead.stdout.trim());
  candidates.push('origin/main', 'origin/master', 'main', 'master');
  for (const c of candidates) {
    if (c === branch || c === upstream) continue; // comparer la branche à elle-même n'a pas de sens
    const r = await git(cwd, 'rev-parse', '--verify', '--quiet', c);
    if (r.success) return c;
  }
  return null;
}

export async function readGitState(cwd: string): Promise<GitState> {
  const empty = new Map<string, { added: number; removed: number }>();
  const inside = await git(cwd, 'rev-parse', '--is-inside-work-tree');
  if (!inside.success || !inside.stdout.includes('true')) {
    return {
      isRepo: false, branch: null, hasCommits: false, upstream: null, ahead: null, behind: null,
      hasRemote: false, base: null, entries: [], unstagedCounts: empty, stagedCounts: empty,
    };
  }
  const [status, head, branchR, remoteR, unstagedNs, stagedNs] = await Promise.all([
    git(cwd, 'status', '--porcelain=v1', '--untracked-files=all'),
    git(cwd, 'rev-parse', '--verify', 'HEAD'),
    git(cwd, 'branch', '--show-current'),
    git(cwd, 'remote'),
    git(cwd, 'diff', '--numstat'),
    git(cwd, 'diff', '--numstat', '--cached'),
  ]);
  const hasCommits = head.success;
  const branch = branchR.stdout.trim() || null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  if (hasCommits) {
    const up = await git(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
    if (up.success && up.stdout.trim()) {
      upstream = up.stdout.trim();
      const ab = await git(cwd, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD');
      const m = /^(\d+)\s+(\d+)/.exec(ab.stdout.trim());
      if (ab.success && m) { behind = Number(m[1]); ahead = Number(m[2]); }
    }
  }
  return {
    isRepo: true, branch, hasCommits, upstream, ahead, behind,
    hasRemote: remoteR.success && remoteR.stdout.trim().length > 0,
    base: hasCommits ? await findBase(cwd, branch, upstream) : null,
    entries: parsePorcelain(status.stdout),
    unstagedCounts: parseNumstat(unstagedNs.stdout),
    stagedCounts: parseNumstat(stagedNs.stdout),
  };
}

/** Modifications d'une source. `lastTurnPaths` : fichiers touchés par l'agent à sa dernière réponse. */
export async function listChanges(cwd: string, state: GitState, source: GitSource, lastTurnPaths: string[] = []): Promise<GitChange[]> {
  const zero = { added: 0, removed: 0 };
  if (source === 'unstaged') {
    return state.entries.filter((e) => e.worktree).map((e) => ({ path: e.path, status: e.worktree!, ...(state.unstagedCounts.get(e.path) || zero) }));
  }
  if (source === 'staged') {
    return state.entries.filter((e) => e.index).map((e) => ({ path: e.path, status: e.index!, ...(state.stagedCounts.get(e.path) || zero) }));
  }
  if (source === 'branch') {
    if (!state.base) return [];
    const mb = await git(cwd, 'merge-base', 'HEAD', state.base);
    if (!mb.success) return [];
    const ref = mb.stdout.trim();
    const [ns, nameStatus] = await Promise.all([git(cwd, 'diff', '--numstat', ref), git(cwd, 'diff', '--name-status', ref)]);
    const counts = parseNumstat(ns.stdout);
    return [...parseNameStatus(nameStatus.stdout)].map(([path, status]) => ({ path, status, ...(counts.get(path) || zero) }));
  }
  // Dernier tour : les fichiers que l'agent a touchés, comparés au dernier commit
  const wanted = new Set(lastTurnPaths);
  const byPath = new Map(state.entries.map((e) => [e.path, e]));
  const out: GitChange[] = [];
  for (const path of wanted) {
    const e = byPath.get(path);
    if (!e) continue; // déjà commité ou annulé depuis
    const st = state.unstagedCounts.get(path) || zero;
    const sg = state.stagedCounts.get(path) || zero;
    out.push({ path, status: e.worktree === '?' ? '?' : (e.worktree || e.index || 'M'), added: st.added + sg.added, removed: st.removed + sg.removed });
  }
  return out;
}

/** Diff d'un fichier pour une source (un fichier nouveau : tout son contenu en ajout) */
export async function fileDiff(cwd: string, change: GitChange, source: GitSource, state: GitState): Promise<string> {
  if (change.status === '?') {
    return (await git(cwd, 'diff', '--no-index', '--', '/dev/null', change.path)).stdout; // code 1 = différences : normal
  }
  if (source === 'staged') return (await git(cwd, 'diff', '--cached', '--', change.path)).stdout;
  if (source === 'unstaged') return (await git(cwd, 'diff', '--', change.path)).stdout;
  if (source === 'branch' && state.base) {
    const mb = await git(cwd, 'merge-base', 'HEAD', state.base);
    if (mb.success) return (await git(cwd, 'diff', mb.stdout.trim(), '--', change.path)).stdout;
  }
  return state.hasCommits
    ? (await git(cwd, 'diff', 'HEAD', '--', change.path)).stdout
    : (await git(cwd, 'diff', '--cached', '--', change.path)).stdout;
}

export async function initRepo(cwd: string) {
  const r = await git(cwd, 'init');
  if (!r.success) throw new Error(gitError(r.stderr, "Impossible d'initialiser Git"));
}

export async function stage(cwd: string, path: string) {
  const r = await git(cwd, 'add', '-A', '--', path);
  if (!r.success) throw new Error(gitError(r.stderr, "Impossible d'indexer ce fichier"));
}

export async function unstage(cwd: string, path: string, hasCommits: boolean) {
  const r = hasCommits
    ? await git(cwd, 'reset', '-q', 'HEAD', '--', path)
    : await git(cwd, 'rm', '--cached', '-q', '--', path);
  if (!r.success) throw new Error(gitError(r.stderr, 'Impossible de désindexer ce fichier'));
}

/** Indexe / désindexe / annule plusieurs fichiers (un appel par fichier : 8 arguments au plus) */
export async function stageMany(cwd: string, paths: string[]) {
  for (const p of paths) await stage(cwd, p);
}
export async function unstageMany(cwd: string, paths: string[], hasCommits: boolean) {
  for (const p of paths) await unstage(cwd, p, hasCommits);
}
export async function discardMany(cwd: string, changes: GitChange[]) {
  for (const c of changes) await discardChange(cwd, c);
}

/** Annule les modifications d'un fichier (un fichier nouveau est supprimé) */
export async function discardChange(cwd: string, change: GitChange) {
  const r = change.status === '?'
    ? await git(cwd, 'clean', '-f', '--', change.path)
    : await git(cwd, 'checkout', 'HEAD', '--', change.path);
  if (!r.success) throw new Error(gitError(r.stderr, "Impossible d'annuler ce fichier"));
}

/** Identité git configurée ? (sinon le commit échoue) */
export async function hasIdentity(cwd: string): Promise<boolean> {
  const [n, e] = await Promise.all([git(cwd, 'config', 'user.name'), git(cwd, 'config', 'user.email')]);
  return n.success && !!n.stdout.trim() && e.success && !!e.stdout.trim();
}

/**
 * Crée le commit. Sans rien d'indexé, ou si `includeUnstaged`, tout est ajouté d'abord.
 * Première ligne du message = titre, le reste = description.
 */
export async function commit(cwd: string, message: string, includeUnstaged: boolean) {
  const lines = message.trim().split('\n');
  const subject = lines[0].trim().slice(0, 400);
  const body = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!subject) throw new Error('Écris un message de commit.');
  if (includeUnstaged) {
    const add = await git(cwd, 'add', '-A');
    if (!add.success) throw new Error(gitError(add.stderr, "Impossible d'ajouter les fichiers"));
  }
  const r = body ? await git(cwd, 'commit', '-m', subject, '-m', body) : await git(cwd, 'commit', '-m', subject);
  if (!r.success) throw new Error(gitError(r.stderr || r.stdout, 'Commit impossible'));
}

/** Envoie la branche ; la crée sur le distant la première fois. Retourne la cible. */
export async function push(cwd: string, branch: string | null, upstream: string | null): Promise<string> {
  const r = upstream || !branch ? await git(cwd, 'push') : await git(cwd, 'push', '-u', 'origin', branch);
  if (!r.success) throw Object.assign(new Error(gitError(r.stderr, 'Envoi impossible')), { details: r.stderr });
  return upstream || `origin/${branch}`;
}

export async function pull(cwd: string) {
  const r = await git(cwd, 'pull', '--ff-only');
  if (!r.success) throw new Error(gitError(r.stderr, 'Récupération impossible'));
}

export async function listBranches(cwd: string): Promise<string[]> {
  const r = await git(cwd, 'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads');
  return r.success ? r.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
}

export const isValidBranchName = (name: string) =>
  /^[A-Za-z0-9][\w./-]*$/.test(name) && !name.includes('..') && !name.endsWith('/') && !name.endsWith('.lock') && name.length <= 100;

export async function switchBranch(cwd: string, name: string) {
  const r = await git(cwd, 'checkout', name);
  if (!r.success) throw new Error(gitError(r.stderr, 'Changement de branche impossible'));
}

export async function createBranch(cwd: string, name: string) {
  if (!isValidBranchName(name)) throw new Error('Nom de branche invalide (lettres, chiffres, - _ . /).');
  const r = await git(cwd, 'checkout', '-b', name);
  if (!r.success) throw new Error(gitError(r.stderr, 'Création de la branche impossible'));
}

/** Message de commit proposé par l'IA à partir du diff (court, en français). */
export async function suggestCommitMessage(cwd: string, changes: GitChange[], stagedOnly = false): Promise<string> {
  const head = await git(cwd, 'rev-parse', '--verify', 'HEAD');
  const diff = stagedOnly
    ? await git(cwd, 'diff', '--cached')
    : head.success ? await git(cwd, 'diff', 'HEAD') : { stdout: '' };
  const list = changes.map((c) => `${c.status} ${c.path} (+${c.added} -${c.removed})`).join('\n');
  const excerpt = diff.stdout.slice(0, 12_000);
  const res = await aiService.chat(
    [
      {
        role: 'system',
        content:
          "Tu écris des messages de commit git. Réponds UNIQUEMENT avec le message : une première ligne de 72 caractères maximum " +
          "à l'impératif, en français (ex. « Ajoute l'export des tâches »), puis si utile une ligne vide et 1 à 3 lignes de détail. " +
          'Pas de guillemets, pas de Markdown, pas de préfixe.',
      },
      { role: 'user', content: `Fichiers modifiés :\n${list}\n\nDiff (extrait) :\n${excerpt}` },
    ],
    { model: 'fast', maxTokens: 200, temperature: 0.3, reasoningEffort: 'none' },
  );
  return (res.choices?.[0]?.message?.content || '').replace(/^```\w*\n?|```$/g, '').trim();
}
