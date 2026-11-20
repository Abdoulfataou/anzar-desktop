/**
 * Ouverture d'un dossier de travail — point d'entrée UNIQUE.
 * Un dossier déjà connu est réactivé (jamais de doublon dans la liste des projets).
 */
import toast from 'react-hot-toast';
import { useProjectStore } from '@/stores/projectStore';
import { showPathNotAllowedMessage } from '@/lib/allowedProjectRoots';

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

/** Active (ou crée) le projet lié à `path`. Retourne son id. */
export function activateWorkspace(path: string): string {
  const store = useProjectStore.getState();
  const existing = store.projects.find(
    (p) => typeof p.metadata?.localPath === 'string' && norm(p.metadata.localPath as string) === norm(path)
  );
  if (existing) {
    store.setActiveProject(existing.id);
    return existing.id;
  }
  const name = norm(path).split('/').pop() || 'workspace';
  const project = store.createProject(name, `Workspace: ${path}`, 'fast');
  store.updateProject(project.id, {
    status: 'complete',
    metadata: { localPath: path, imported: true },
  } as any);
  store.setActiveProject(project.id);
  return project.id;
}

/**
 * Les dossiers de projet sont choisis dans un sélecteur natif lancé par Rust : seul ce choix
 * de l'utilisateur ajoute un dossier à la liste autorisée (périmètre fichiers de la webview et
 * commandes de l'agent), enregistrée et ré-autorisée au démarrage.
 */
async function pickWithRust(command: 'project_pick_folder' | 'project_create_folder', failure: string): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const selected = await invoke<string | null>(command);
    return selected ? activateWorkspace(selected) : null;
  } catch (err) {
    console.error(`${command} failed:`, err);
    const reason = typeof err === 'string' ? err : '';
    if (reason) await showPathNotAllowedMessage(reason);
    else toast.error(failure);
    return null;
  }
}

/** Dialogue natif → dossier existant. Retourne l'id du projet, ou null si annulé/refusé. */
export function openWorkspaceFolder(): Promise<string | null> {
  return pickWithRust('project_pick_folder', "Impossible d'ouvrir le dossier (fonction desktop).");
}

/** Dialogue natif → nouvel emplacement (dossier vierge que l'agent remplira). */
export function createWorkspaceFolder(): Promise<string | null> {
  return pickWithRust('project_create_folder', 'Impossible de créer le dossier.');
}

/**
 * Projet ANZAR d'une worktree : « dépôt · branche », rattaché au projet du dépôt.
 * Réutilisé s'il existe déjà pour ce dossier. Retourne son id.
 */
export function activateWorktree(path: string, repoName: string, branch: string, parentProjectId: string | null): string {
  const id = activateWorkspace(path);
  useProjectStore.getState().updateProject(id, {
    name: `${repoName} · ${branch}`,
    metadata: {
      ...(useProjectStore.getState().projects.find((p) => p.id === id)?.metadata || {}),
      localPath: path,
      worktree: { branch, parentProjectId },
    },
  } as any);
  return id;
}
