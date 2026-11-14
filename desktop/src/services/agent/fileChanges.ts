/**
 * Suivi des fichiers modifiés par l'agent pendant une réponse, et annulation.
 *
 * Avant la première modification d'un fichier, on garde son contenu d'origine.
 * À la fin, on compare avec le disque pour produire la carte « fichiers modifiés ».
 * L'annulation réécrit le contenu d'origine (ou supprime un fichier créé).
 * Les contenus d'origine restent en mémoire : l'annulation n'est plus possible
 * après un redémarrage de l'app.
 */
import { fileSystemService } from '@/services/filesystem/fileSystem';

export interface FileChange {
  path: string;
  kind: 'created' | 'modified' | 'deleted';
  added: number;
  removed: number;
}

/** Contenu d'origine par fichier (null = le fichier n'existait pas). */
export type Snapshots = Map<string, string | null>;

const snapshotsByMessage = new Map<string, { root: string; files: Snapshots }>();

function abs(root: string, rel: string): string | null {
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!clean || clean.split('/').some((s) => s === '..')) return null;
  return `${root.replace(/[\\/]+$/, '')}/${clean}`;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    if (!(await fileSystemService.exists(path))) return null;
    return await fileSystemService.readFile(path);
  } catch {
    return null;
  }
}

/** À appeler AVANT qu'un outil modifie `rel` : mémorise l'original une seule fois. */
export async function snapshotBeforeChange(snapshots: Snapshots, root: string, rel: string | undefined): Promise<void> {
  if (!rel || snapshots.has(rel)) return;
  const path = abs(root, rel);
  if (!path) return;
  snapshots.set(rel, await readOrNull(path));
}

/** Lignes ajoutées / retirées (comparaison par multiensemble de lignes — rapide, approximative). */
function lineDelta(before: string, after: string): [number, number] {
  const counts = new Map<string, number>();
  for (const l of before.split('\n')) counts.set(l, (counts.get(l) || 0) + 1);
  let added = 0;
  for (const l of after.split('\n')) {
    const n = counts.get(l) || 0;
    if (n > 0) counts.set(l, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return [added, removed];
}

/** Compare les originaux au disque et enregistre de quoi annuler pour ce message. */
export async function collectChanges(messageId: string, root: string, snapshots: Snapshots): Promise<FileChange[]> {
  const changes: FileChange[] = [];
  const kept: Snapshots = new Map();
  for (const [rel, before] of snapshots) {
    const path = abs(root, rel);
    if (!path) continue;
    const after = await readOrNull(path);
    if (before === after) continue;
    kept.set(rel, before);
    if (before === null) {
      changes.push({ path: rel, kind: 'created', added: (after || '').split('\n').length, removed: 0 });
    } else if (after === null) {
      changes.push({ path: rel, kind: 'deleted', added: 0, removed: before.split('\n').length });
    } else {
      const [added, removed] = lineDelta(before, after);
      changes.push({ path: rel, kind: 'modified', added, removed });
    }
  }
  if (kept.size > 0) snapshotsByMessage.set(messageId, { root, files: kept });
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function canUndo(messageId: string): boolean {
  return snapshotsByMessage.has(messageId);
}

/** Remet chaque fichier dans son état d'avant la réponse. Retourne le nombre de fichiers restaurés. */
export async function undoChanges(messageId: string): Promise<number> {
  const entry = snapshotsByMessage.get(messageId);
  if (!entry) return 0;
  let restored = 0;
  for (const [rel, before] of entry.files) {
    const path = abs(entry.root, rel);
    if (!path) continue;
    if (before === null) {
      if (await fileSystemService.exists(path)) await fileSystemService.deleteFile(path);
    } else {
      await fileSystemService.writeFile(path, before);
    }
    restored++;
  }
  snapshotsByMessage.delete(messageId);
  return restored;
}

/** Événements UI : le panneau de droite se rafraîchit / ouvre un fichier. */
export const FILES_CHANGED_EVENT = 'anzar:files-changed';
export const OPEN_FILE_EVENT = 'anzar:open-file';
