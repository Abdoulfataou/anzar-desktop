/**
 * Git du dossier de projet, pour le panneau Git (façon ZCode).
 * Tout passe par terminalService.execArgs : programme et arguments autorisés par Tauri.
 */
import { terminalService } from '@/services/terminal';
import { aiService } from '@/services/ai/ai';

export interface GitChange {
  path: string;
  /** Code court : M modifié, A ajouté, D supprimé, R renommé, ? nouveau (non suivi), U conflit */
  status: 'M' | 'A' | 'D' | 'R' | '?' | 'U';
  added: number;
  removed: number;
}

export interface GitState {
  isRepo: boolean;
  branch: string | null;
  hasCommits: boolean;
  /** null : pas de branche distante configurée */
  ahead: number | null;
  behind: number | null;
  changes: GitChange[];
}

const git = (cwd: string, ...args: string[]) => terminalService.execArgs('git', args, { cwd, timeout: 60_000 });

/** Message lisible à partir d'une erreur git */
export function gitError(stderr: string, fallback = 'Erreur git'): string {
  const s = stderr.trim();
  if (/Please tell me who you are|user\.email|user\.name/i.test(s)) {
    return "Git ne connaît pas ton nom : lance dans un terminal git config --global user.name \"Ton nom\" et git config --global user.email \"toi@exemple.com\".";
  }
  if (/could not read Username|Authentication failed|Permission denied \(publickey\)/i.test(s)) {
    return "Connexion au dépôt distant refusée : vérifie ta connexion GitHub (identifiants ou clé SSH) depuis un terminal.";
  }
  if (/no upstream branch|has no upstream/i.test(s)) return 'Aucune branche distante liée à cette branche.';
  if (/non-fast-forward|fetch first|rejected/i.test(s)) return 'Le dépôt distant a des changements que tu n\'as pas : fais d\'abord « Récupérer ».';
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

export function parsePorcelain(stdout: string): { path: string; status: GitChange['status'] }[] {
  const out: { path: string; status: GitChange['status'] }[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue;
    const x = line[0], y = line[1];
    let path = line.slice(3);
    if (path.includes(' -> ')) path = path.split(' -> ').pop()!;
    path = unquote(path);
    let status: GitChange['status'];
    if (x === '?' && y === '?') status = '?';
    else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) status = 'U';
    else if (x === 'R' || y === 'R') status = 'R';
    else if (x === 'A') status = 'A';
    else if (x === 'D' || y === 'D') status = 'D';
    else status = 'M';
    out.push({ path, status });
  }
  return out;
}

export function parseNumstat(stdout: string): Map<string, { added: number; removed: number }> {
  const map = new Map<string, { added: number; removed: number }>();
  for (const line of stdout.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    let path = m[3];
    // Renommage : « a => b » ou « dir/{a => b}/f »
    if (path.includes(' => ')) {
      path = path.replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/');
    }
    map.set(unquote(path), { added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]) });
  }
  return map;
}

export async function readGitState(cwd: string): Promise<GitState> {
  const inside = await git(cwd, 'rev-parse', '--is-inside-work-tree');
  if (!inside.success || !inside.stdout.includes('true')) {
    return { isRepo: false, branch: null, hasCommits: false, ahead: null, behind: null, changes: [] };
  }
  const [status, head, branch] = await Promise.all([
    git(cwd, 'status', '--porcelain=v1', '--untracked-files=all'),
    git(cwd, 'rev-parse', '--verify', 'HEAD'),
    git(cwd, 'branch', '--show-current'),
  ]);
  const hasCommits = head.success;
  const numstat = hasCommits ? await git(cwd, 'diff', '--numstat', 'HEAD') : await git(cwd, 'diff', '--numstat', '--cached');
  const counts = parseNumstat(numstat.stdout);
  const changes: GitChange[] = parsePorcelain(status.stdout).map((c) => ({
    ...c,
    added: counts.get(c.path)?.added ?? 0,
    removed: counts.get(c.path)?.removed ?? 0,
  }));

  let ahead: number | null = null;
  let behind: number | null = null;
  if (hasCommits) {
    const ab = await git(cwd, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD');
    const m = /^(\d+)\s+(\d+)/.exec(ab.stdout.trim());
    if (ab.success && m) { behind = Number(m[1]); ahead = Number(m[2]); }
  }
  return { isRepo: true, branch: branch.stdout.trim() || null, hasCommits, ahead, behind, changes };
}

/** Diff d'un fichier (pour un fichier nouveau : tout son contenu en ajout) */
export async function fileDiff(cwd: string, change: GitChange): Promise<string> {
  if (change.status === '?') {
    const r = await git(cwd, 'diff', '--no-index', '--', '/dev/null', change.path);
    return r.stdout; // code de sortie 1 = différences trouvées : c'est normal
  }
  const head = await git(cwd, 'rev-parse', '--verify', 'HEAD');
  const r = head.success
    ? await git(cwd, 'diff', 'HEAD', '--', change.path)
    : await git(cwd, 'diff', '--cached', '--', change.path);
  return r.stdout;
}

export async function initRepo(cwd: string) {
  const r = await git(cwd, 'init');
  if (!r.success) throw new Error(gitError(r.stderr, "Impossible d'initialiser Git"));
}

/** Annule les modifications d'un fichier (un fichier nouveau est supprimé) */
export async function discardChange(cwd: string, change: GitChange) {
  const r = change.status === '?'
    ? await git(cwd, 'clean', '-f', '--', change.path)
    : await git(cwd, 'checkout', 'HEAD', '--', change.path);
  if (!r.success) throw new Error(gitError(r.stderr, "Impossible d'annuler ce fichier"));
}

/** Ajoute tout et crée le commit. Première ligne = titre, le reste = description. */
export async function commitAll(cwd: string, message: string) {
  const lines = message.trim().split('\n');
  const subject = lines[0].trim().slice(0, 400);
  const body = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!subject) throw new Error('Écris un message de commit.');
  const add = await git(cwd, 'add', '-A');
  if (!add.success) throw new Error(gitError(add.stderr, "Impossible d'ajouter les fichiers"));
  const r = body ? await git(cwd, 'commit', '-m', subject, '-m', body) : await git(cwd, 'commit', '-m', subject);
  if (!r.success) throw new Error(gitError(r.stderr || r.stdout, 'Commit impossible'));
}

export async function push(cwd: string, branch: string | null, hasUpstream: boolean) {
  const r = hasUpstream || !branch
    ? await git(cwd, 'push')
    : await git(cwd, 'push', '-u', 'origin', branch);
  if (!r.success) throw new Error(gitError(r.stderr, 'Envoi impossible'));
}

export async function pull(cwd: string) {
  const r = await git(cwd, 'pull', '--ff-only');
  if (!r.success) throw new Error(gitError(r.stderr, 'Récupération impossible'));
}

export async function hasRemote(cwd: string): Promise<boolean> {
  const r = await git(cwd, 'remote');
  return r.success && r.stdout.trim().length > 0;
}

/** Message de commit proposé par l'IA à partir du diff (court, en français). */
export async function suggestCommitMessage(cwd: string, changes: GitChange[]): Promise<string> {
  const head = await git(cwd, 'rev-parse', '--verify', 'HEAD');
  const diff = head.success ? await git(cwd, 'diff', 'HEAD') : { stdout: '' };
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
    { model: 'fast', maxTokens: 200, temperature: 0.3 },
  );
  return (res.choices?.[0]?.message?.content || '').replace(/^```\w*\n?|```$/g, '').trim();
}
