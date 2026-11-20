/**
 * Migration unique vers la liste de dossiers tenue par Rust (src-tauri/src/roots.rs) :
 * au premier lancement de cette version, les projets déjà connus de l'app y sont importés.
 * Ensuite, Rust ignore cet appel (seul le sélecteur natif ajoute un dossier).
 */
import { useProjectStore } from '@/stores/projectStore';
import { isTauri } from '@/lib/utils';

let done = false;

export async function importKnownProjectRoots(): Promise<number> {
  if (done || !isTauri()) return 0;
  const run = async () => {
    const paths = useProjectStore.getState().projects
      .map((p) => p.metadata?.localPath)
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
    const { invoke } = await import('@tauri-apps/api/core');
    done = true;
    return invoke<number>('project_import_roots', { paths }).catch(() => 0);
  };
  if (useProjectStore.persist.hasHydrated()) return run();
  return new Promise((resolve) => {
    const unsub = useProjectStore.persist.onFinishHydration(() => { unsub(); void run().then(resolve); });
  });
}
