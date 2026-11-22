/**
 * Changements d'un tour, calculés par **git** — y compris ceux qu'une commande a faits
 * (`npm install` réécrit `package.json`, un formateur réécrit dix fichiers).
 *
 * Principe, calqué sur les checkpoints de Cursor/Cline : au premier geste d'écriture du tour,
 * on fige l'état de départ ; à la fin, on demande à git ce qui a changé. Pour un projet qui
 * n'est pas un dépôt, un **shadow git** est créé dans les données de l'app (`store/shadow/…`) :
 * il ne touche ni au projet ni à l'historique de l'utilisateur.
 *
 * La restauration reste le rôle de git : ce module ne fait que constater.
 */
import { ensureDir, storeRoot, writeText } from '@/lib/fileStore';
import { terminalService } from '@/services/runtime/terminal';
import type { FileChange } from '@/services/agent/tools/fileChanges';

/** Dossiers jamais copiés dans le shadow repo (volume inutile). */
const EXCLUDES = ['node_modules/', 'dist/', 'build/', '.next/', 'target/', '.venv/', 'coverage/', '*.log'];

function hashRoot(root: string): string {
  let h = 2166136261;
  for (let i = 0; i < root.length; i++) h = Math.imul(h ^ root.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const started = new Set<string>();

interface GitResult { success: boolean; stdout: string; stderr: string }

/** Exécute git sur le shadow repo du projet. */
async function git(root: string, args: string[]): Promise<GitResult> {
  const store = await storeRoot();
  if (!store) throw new Error('stockage local indisponible');
  const dir = `${store.replace(/[\\/]+$/, '')}/shadow/${hashRoot(root)}`;
  const r = await terminalService.execArgs('git', ['--git-dir', dir, '--work-tree', root, ...args], { cwd: root });
  return { success: r.success, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Fige l'état de départ du tour. À appeler **avant** la première écriture.
 * Sans stockage local, la fonction échoue : l'appelant garde la carte par snapshots.
 */
export async function beginTurn(root: string): Promise<void> {
  const store = await storeRoot();
  if (!store) throw new Error('stockage local indisponible');
  const key = `${hashRoot(root)}`;
  if (!started.has(key)) {
    await ensureDir(`shadow/${key}`);
    const init = await git(root, ['init', '--quiet']);
    if (!init.success) throw new Error(init.stderr || 'shadow git indisponible');
    await writeText(`shadow/${key}/info/exclude`, EXCLUDES.join('\n'));
    await git(root, ['config', 'user.email', 'agent@anzar.local']);
    await git(root, ['config', 'user.name', 'ANZAR']);
    await git(root, ['config', 'commit.gpgsign', 'false']);
    started.add(key);
  }
  // Tout est déjà indexé après le tour précédent ; le commit fige le point de départ.
  const add = await git(root, ['add', '-A', '.']);
  if (!add.success) throw new Error(add.stderr || 'index git indisponible');
  const commit = await git(root, ['commit', '--allow-empty', '-m', 'ANZAR début de tour']);
  if (!commit.success) throw new Error(commit.stderr || 'commit git impossible');
}

/** `XY chemin\0` (porcelain v1, -z) → fichiers créés / modifiés / supprimés. */
export function parseStatus(output: string): { path: string; kind: FileChange['kind'] }[] {
  const out: { path: string; kind: FileChange['kind'] }[] = [];
  for (const entry of String(output || '').split('\0')) {
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3).trim();
    if (!path) continue;
    const kind: FileChange['kind'] = code === '??' || code[0] === 'A'
      ? 'created'
      : code[0] === 'D' || code[1] === 'D' ? 'deleted' : 'modified';
    out.push({ path, kind });
  }
  return out;
}

/** `ajoutés\tretirés\tchemin\0` (--numstat -z) → lignes par fichier. */
export function parseNumstat(output: string): Map<string, { added: number; removed: number }> {
  const map = new Map<string, { added: number; removed: number }>();
  for (const entry of String(output || '').split('\0')) {
    const [a, r, ...rest] = entry.split('\t');
    const path = rest.join('\t').trim();
    if (!path) continue;
    map.set(path, {
      added: a === '-' ? 0 : Number(a) || 0,
      removed: r === '-' ? 0 : Number(r) || 0,
    });
  }
  return map;
}

/**
 * Changements depuis le début du tour. Lève si le tour n'a pas été ouvert (`beginTurn`).
 * Les commandes sont comprises : c'est tout l'intérêt par rapport aux snapshots d'outils.
 */
export async function endTurn(root: string): Promise<FileChange[]> {
  const status = await git(root, ['status', '--porcelain', '-z']);
  if (!status.success) throw new Error(status.stderr || 'git status impossible');
  if (!status.stdout) return [];
  const entries = parseStatus(status.stdout);

  // Indexer puis compter : --numstat ne voit pas les fichiers non suivis.
  const add = await git(root, ['add', '-A', '.']);
  const diff = await git(root, ['diff', '--cached', '--numstat', '-z']);
  const counts = add.success && diff.success ? parseNumstat(diff.stdout) : new Map();
  return entries
    .map((e) => ({ ...e, ...(counts.get(e.path) || { added: 0, removed: 0 }) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
