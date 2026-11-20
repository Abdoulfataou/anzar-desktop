/**
 * Fermeture de la fenêtre pendant un travail de fond : au lieu de couper un ticket ou une
 * automatisation en plein travail, l'app propose de réduire la fenêtre (le travail continue)
 * ou de quitter quand même (le ticket sera repris au prochain lancement).
 */
import { isTauri } from '@/lib/utils';
import { hasBackgroundWork } from './status';

export function installCloseGuard(): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  let disposed = false;
  void (async () => {
    const [{ getCurrentWindow }, { ask }] = await Promise.all([
      import('@tauri-apps/api/window'),
      import('@tauri-apps/plugin-dialog'),
    ]);
    const win = getCurrentWindow();
    const off = await win.onCloseRequested(async (event) => {
      if (!hasBackgroundWork()) return;
      event.preventDefault();
      const quit = await ask(
        "Un ticket ou une automatisation est en cours.\n\nRéduis la fenêtre pour que le travail continue. Si tu quittes, il s'arrête et reprendra au prochain lancement.",
        { title: 'ANZAR travaille encore', kind: 'warning', okLabel: 'Quitter quand même', cancelLabel: 'Réduire la fenêtre' },
      ).catch(() => false);
      if (quit) await win.destroy();
      else await win.minimize();
    });
    if (disposed) off(); else unlisten = off;
  })().catch(() => {});
  return () => { disposed = true; unlisten?.(); };
}
