/**
 * Adaptateur Tauri 2 pour le shell et l'ouverture de liens.
 *
 * - L'exécution de commandes passe par le runner Rust (`tool_spawn`), pas par le plugin shell.
 * - `open` est conservé pour le code existant, mais passe par le plugin-opener
 *   (URL ou chemin), qui dispose de ses propres permissions de scope.
 */
import { openUrl, openPath, revealItemInDir } from '@tauri-apps/plugin-opener';

export { openUrl, openPath, revealItemInDir };

const isUrl = (target: string) => /^(https?|mailto):/i.test(target);

/** Ouvre une URL (navigateur) ou un chemin (application par défaut). */
export async function open(target: string): Promise<void> {
  if (isUrl(target)) {
    await openUrl(target);
  } else {
    await openPath(target);
  }
}
