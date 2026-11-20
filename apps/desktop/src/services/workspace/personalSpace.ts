/**
 * « Espace ANZAR » : dossier de travail du chat simple (Documents/ANZAR).
 *
 * Sans projet ouvert, l'agent n'a normalement aucun outil sur les fichiers. Dès qu'un fichier
 * est joint (ou que la conversation a déjà utilisé l'espace), ANZAR lui ouvre ce dossier :
 * les pièces jointes y sont copiées dans fichiers/, l'agent les transforme (découper un PDF,
 * convertir un Excel…) et range les résultats au même endroit. Il reste enfermé dans ce dossier.
 */
import { createDir, exists, writeTextFile } from '@/lib/tauri/fs';
import type { Conversation } from '@/types';

export const PERSONAL_SUBDIR = 'fichiers';

/** Outils sur les fichiers ouverts dans l'espace (pas de serveur de dev, de navigateur ni d'exploration de code). */
export const PERSONAL_SPACE_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'delete_file', 'list_dir', 'search_files', 'run_command',
  // Visuels et vidéos : le moteur de rendu ouvre directement les fichiers HTML du dossier
  'capture_page', 'export_animation',
]);

let cached: string | null = null;

export async function personalSpaceRoot(): Promise<string> {
  if (cached) return cached;
  const { documentDir, join } = await import('@tauri-apps/api/path');
  cached = await join(await documentDir(), 'ANZAR');
  return cached;
}

/** Crée le dossier au premier besoin (avec un mot d'explication pour l'utilisateur). */
export async function ensurePersonalSpace(): Promise<string> {
  const root = await personalSpaceRoot();
  const { join } = await import('@tauri-apps/api/path');
  const files = await join(root, PERSONAL_SUBDIR);
  if (!(await exists(files))) await createDir(files, { recursive: true });
  const readme = await join(root, 'LISEZMOI.txt');
  if (!(await exists(readme))) {
    await writeTextFile(readme,
      "Espace ANZAR\n\nQuand tu joins un fichier dans une conversation sans projet ouvert, ANZAR en place une copie\n"
      + "dans le dossier « fichiers » et y range ce qu'il produit (PDF découpés, fichiers convertis…).\n"
      + "Tes fichiers d'origine ne sont jamais modifiés. Tu peux supprimer ce dossier quand tu veux.\n");
  }
  return root;
}

/** La conversation (sans projet) a-t-elle déjà travaillé dans l'espace ANZAR ? */
export function conversationUsesPersonalSpace(conv: Pick<Conversation, 'messages' | 'projectId' | 'personalSpace'> | undefined | null): boolean {
  if (!conv || conv.projectId) return false;
  return !!conv.personalSpace || conv.messages.some((m) => m.attachments?.some((a) => a.projectCopy?.startsWith(`${PERSONAL_SUBDIR}/`)));
}

export async function openPersonalSpace(): Promise<void> {
  await ensurePersonalSpace();
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_personal_space');
}

export function personalSpaceContext(root: string): string {
  return `\n\n---\n# Espace ANZAR (dossier de travail de cette conversation)\n`
    + `Aucun projet n'est ouvert, mais ANZAR t'ouvre le dossier \`${root}\`. Tu y as des outils sur les fichiers `
    + `(read_file, write_file, edit_file, delete_file, list_dir, search_files, run_command, et capture_page / export_animation avec file pour voir un visuel et l'exporter en vidéo), avec des chemins `
    + `relatifs à ce dossier, et seulement dans ce dossier. Les fichiers joints sont copiés dans \`${PERSONAL_SUBDIR}/\`. `
    + `Range ce que tu produis dans \`${PERSONAL_SUBDIR}/\`, sans jamais écraser un fichier existant. `
    + `Pour transformer un fichier, écris un script (.mjs) avec write_file puis lance-le avec run_command ; jamais de \`node -e\` ni de \`python -c\` `
    + `(les guillemets cassent selon le système). Les vidéos et images exportées s'affichent d'elles-mêmes dans la conversation, `
    + `avec un bouton pour ouvrir le dossier : à la fin, donne juste les noms des fichiers créés, en une ou deux phrases.`;
}
