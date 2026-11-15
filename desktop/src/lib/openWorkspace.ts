/**
 * Ouverture d'un dossier de travail — point d'entrée UNIQUE.
 * Un dossier déjà connu est réactivé (jamais de doublon dans la liste des projets).
 */
import toast from 'react-hot-toast';
import { useProjectStore } from '@/stores/projectStore';
import { isAllowedProjectRoot, showPathNotAllowedMessage } from '@/lib/allowedProjectRoots';

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

/** Dialogue natif → dossier existant. Retourne l'id du projet, ou null si annulé/refusé. */
export async function openWorkspaceFolder(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/api/dialog');
    const selected = await open({ directory: true, multiple: false, title: 'Ouvrir un dossier de travail' });
    if (!selected || typeof selected !== 'string') return null;
    if (!(await isAllowedProjectRoot(selected))) {
      await showPathNotAllowedMessage();
      return null;
    }
    return activateWorkspace(selected);
  } catch (err) {
    console.error('Open folder failed:', err);
    toast.error("Impossible d'ouvrir le dossier (fonction desktop).");
    return null;
  }
}

/** Dialogue natif → nouvel emplacement (dossier vierge que l'agent remplira). */
export async function createWorkspaceFolder(): Promise<string | null> {
  try {
    const { save } = await import('@tauri-apps/api/dialog');
    const selected = await save({ title: 'Nouveau projet — choisir un emplacement' });
    if (!selected || typeof selected !== 'string') return null;
    if (!(await isAllowedProjectRoot(selected))) {
      await showPathNotAllowedMessage();
      return null;
    }
    return activateWorkspace(selected);
  } catch (err) {
    console.error('New folder failed:', err);
    toast.error('Impossible de créer le dossier.');
    return null;
  }
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
