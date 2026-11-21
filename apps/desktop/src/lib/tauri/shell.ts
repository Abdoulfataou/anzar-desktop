/**
 * Adaptateur Tauri 2 pour le shell et l'ouverture de liens.
 *
 * - L'exécution de commandes passe par le runner Rust (`tool_spawn`), pas par le plugin shell.
 * - `open` est conservé pour le code existant, mais passe par le plugin-opener
 *   (URL ou chemin), qui dispose de ses propres permissions de scope.
 */
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

export { openUrl };

/**
 * Ouvre un chemin du projet. Le renderer n'ouvre plus de chemin lui-même : Rust vérifie
 * qu'il appartient à un projet ouvert avant de le révéler (ou de l'ouvrir si c'est un dossier).
 */
export async function revealPath(path: string): Promise<void> {
  await invoke('reveal_path', { path });
}

const isUrl = (target: string) => /^(https?|mailto):/i.test(target);

/** Ouvre une URL (navigateur) ou un chemin (application par défaut). */
export async function open(target: string): Promise<void> {
  if (isUrl(target)) {
    await openUrl(target);
  } else {
    await revealPath(target);
  }
}
