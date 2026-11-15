/**
 * Suivi des fichiers modifiés par l'agent pendant une réponse, et annulation.
 *
 * Avant la première modification d'un fichier, on garde son contenu d'origine.
 * À la fin, on compare avec le disque pour produire la carte « fichiers modifiés ».
 * L'annulation réécrit le contenu d'origine (ou supprime un fichier créé).
 * Les contenus d'origine sont aussi écrits sur le disque (store/undo/) :
 * l'annulation reste possible après un redémarrage de l'app.
 */
import { fileSystemService } from '@/services/filesystem/fileSystem';
import { listDir, readText, removeEntry, storeRoot, writeText } from '@/lib/fileStore';

export interface FileChange {
  path: string;
  kind: 'created' | 'modified' | 'deleted';
  added: number;
  removed: number;
}

/** Contenu d'origine par fichier (null = le fichier n'existait pas). */
export type Snapshots = Map<string, string | null>;

const snapshotsByMessage = new Map<string, { root: string; files: Snapshots }>();
const MAX_MEMORY_SNAPSHOTS = 20;
/** Messages dont les originaux sont sur le disque. */
const onDisk = new Set<string>();
const MAX_UNDO_BYTES = 5 * 1024 * 1024;
const MAX_UNDO_FILES = 200;
const undoFile = (messageId: string) => `undo/${messageId.replace(/[^\w-]/g, '_')}.json`;

/** Au démarrage : recense les annulations disponibles et supprime les plus anciennes. */
export async function initUndoIndex(): Promise<void> {
  try {
    if (!(await storeRoot())) return;
    // Les identifiants contiennent l'heure de création : le tri par nom est chronologique
    const names = (await listDir('undo')).filter((n) => n.endsWith('.json')).sort();
    const excess = names.slice(0, Math.max(0, names.length - MAX_UNDO_FILES));
    for (const n of excess) await removeEntry(`undo/${n}`);
    for (const n of names.slice(excess.length)) onDisk.add(n.replace(/\.json$/, ''));
  } catch { /* l'annulation restera limitée à la session */ }
}

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
  if (kept.size > 0) {
    snapshotsByMessage.set(messageId, { root, files: kept });
    // Copie sur disque pour survivre à un redémarrage (sauf si trop volumineux)
    const entries = [...kept.entries()];
    const bytes = entries.reduce((n, [, before]) => n + (before?.length || 0), 0);
    if (bytes <= MAX_UNDO_BYTES && (await storeRoot())) {
      try {
        await writeText(undoFile(messageId), JSON.stringify({ root, files: entries }));
        onDisk.add(messageId.replace(/[^\w-]/g, '_'));
        // Copie disque disponible : inutile de garder le contenu en mémoire (P4)
        snapshotsByMessage.delete(messageId);
      } catch { /* annulation disponible pour cette session seulement */ }
    }
    // Mémoire bornée : seules les dernières réponses non sauvegardées sur disque restent annulables
    while (snapshotsByMessage.size > MAX_MEMORY_SNAPSHOTS) {
      snapshotsByMessage.delete(snapshotsByMessage.keys().next().value as string);
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function canUndo(messageId: string): boolean {
  return snapshotsByMessage.has(messageId) || onDisk.has(messageId.replace(/[^\w-]/g, '_'));
}

/** Remet chaque fichier dans son état d'avant la réponse. Retourne le nombre de fichiers restaurés. */
export async function undoChanges(messageId: string): Promise<number> {
  let entry = snapshotsByMessage.get(messageId);
  if (!entry) {
    try {
      const raw = await readText(undoFile(messageId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.root && Array.isArray(parsed.files)) entry = { root: parsed.root, files: new Map(parsed.files) };
    } catch { /* fichier illisible */ }
  }
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
  onDisk.delete(messageId.replace(/[^\w-]/g, '_'));
  await removeEntry(undoFile(messageId));
  return restored;
}

/** Événements UI : le panneau de droite se rafraîchit / ouvre un fichier. */
export const FILES_CHANGED_EVENT = 'anzar:files-changed';
export const OPEN_FILE_EVENT = 'anzar:open-file';
