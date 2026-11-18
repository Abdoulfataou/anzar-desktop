/**
 * Adaptateur Tauri 2 pour le shell et l'ouverture de liens.
 *
 * - `Command` vient du plugin-shell v2 (`Command.create` au lieu de `new Command`).
 * - `open` est conservé pour le code existant, mais passe par le plugin-opener
 *   (URL ou chemin), qui dispose de ses propres permissions de scope.
 */
import { Command } from '@tauri-apps/plugin-shell';
import { openUrl, openPath, revealItemInDir } from '@tauri-apps/plugin-opener';

export { Command, openUrl, openPath, revealItemInDir };

const isUrl = (target: string) => /^(https?|mailto):/i.test(target);

/** Ouvre une URL (navigateur) ou un chemin (application par défaut). */
export async function open(target: string): Promise<void> {
  if (isUrl(target)) {
    await openUrl(target);
  } else {
    await openPath(target);
  }
}
