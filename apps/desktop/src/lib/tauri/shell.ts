/**
 * Adaptateur Tauri 2 pour le shell et l'ouverture de liens.
 *
 * - L'exécution de commandes passe par le runner Rust (`tool_spawn`), pas par le plugin shell.
 * - Les URL passent par le plugin-opener (capacité `opener:allow-open-url`).
 * - Les chemins passent par la commande Rust `reveal_path`, qui vérifie qu'ils appartiennent
 *   à un projet ouvert : le renderer n'a plus de capacité d'ouverture de chemin.
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

/** Ouvre une URL (navigateur) ou révèle un chemin du projet (Finder / Explorateur). */
export async function open(target: string): Promise<void> {
  if (isUrl(target)) {
    await openUrl(target);
  } else {
    await revealPath(target);
  }
}
