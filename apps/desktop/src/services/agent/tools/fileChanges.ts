/**
 * Carte « fichiers modifiés » d'une réponse de l'agent.
 *
 * Avant la première modification d'un fichier, on garde son contenu d'origine ; à la fin du
 * tour, la comparaison avec le disque donne les fichiers créés, modifiés et supprimés, et le
 * nombre de lignes. C'est un **affichage**, pas un mécanisme de restauration : la restauration
 * d'un projet est le rôle de git (l'agent travaille dans le dépôt de l'utilisateur).
 *
 * Limite connue : seules les écritures passées par les outils de fichiers sont vues. Un
 * fichier modifié par une commande (`npm install`, un formateur, un script de génération)
 * n'apparaît pas — voir la feuille de route « changements calculés par git ».
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

/** Compare les originaux au disque et renvoie la liste triée des fichiers modifiés. */
export async function collectChanges(_messageId: string, root: string, snapshots: Snapshots): Promise<FileChange[]> {
  const changes: FileChange[] = [];
  for (const [rel, before] of snapshots) {
    const path = abs(root, rel);
    if (!path) continue;
    const after = await readOrNull(path);
    if (before === after) continue;
    if (before === null) {
      changes.push({ path: rel, kind: 'created', added: (after || '').split('\n').length, removed: 0 });
    } else if (after === null) {
      changes.push({ path: rel, kind: 'deleted', added: 0, removed: before.split('\n').length });
    } else {
      const [added, removed] = lineDelta(before, after);
      changes.push({ path: rel, kind: 'modified', added, removed });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export const FILES_CHANGED_EVENT = 'anzar:files-changed';
export const OPEN_FILE_EVENT = 'anzar:open-file';
