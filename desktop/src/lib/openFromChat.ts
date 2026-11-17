/**
 * openFromChat — Ouvrir un fichier mentionné dans le chat, quel que soit le contexte.
 *
 * - Projet ouvert → OPEN_FILE_EVENT (onglet éditeur / visionneuse média du workspace).
 * - Chat simple (espace ANZAR) → révèle le fichier dans le Finder/Explorateur,
 *   car il n'y a pas d'onglet Fichiers sans workspace.
 */
import { useProjectStore } from '@/stores/projectStore';
import { OPEN_FILE_EVENT } from '@/services/agent/fileChanges';
import { personalSpaceRoot } from '@/services/personalSpace';

/** Racine des fichiers de chat : projet ouvert, sinon espace ANZAR. */
export async function resolveChatRoot(): Promise<string | null> {
  const st = useProjectStore.getState();
  const project = st.projects.find((p) => p.id === st.activeProjectId);
  const projectRoot = (project?.metadata?.localPath as string | undefined) || null;
  if (projectRoot) return projectRoot;
  try {
    return await personalSpaceRoot();
  } catch {
    return null;
  }
}

/** Chemin absolu d'un fichier produit/mentionné dans le chat. */
export async function resolveChatAbsPath(relPath: string): Promise<string | null> {
  const root = await resolveChatRoot();
  if (!root) return null;
  return `${root.replace(/[\\/]+$/, '')}/${relPath.replace(/^([./\\])+/, '')}`;
}

/** Ouvre un fichier du chat : onglet workspace si projet, sinon Finder. */
export async function openFromChat(relPath: string): Promise<void> {
  const st = useProjectStore.getState();
  const project = st.projects.find((p) => p.id === st.activeProjectId);
  if (project?.metadata?.localPath) {
    window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: relPath }));
    return;
  }
  // Chat simple : pas d'onglet Fichiers → on révèle dans le dossier
  const abs = await resolveChatAbsPath(relPath);
  if (!abs) return;
  try {
    const { open } = await import('@tauri-apps/api/shell');
    await open(abs.substring(0, abs.lastIndexOf('/')));
  } catch {
    /* allowlist : silencieux */
  }
}
