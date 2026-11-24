import { beforeEach, describe, expect, it, vi } from 'vitest';

const fausseMaj = {
  version: '9.9.9', date: '2026-11-24', body: '- Nouveauté',
  downloadAndInstall: vi.fn(async (cb: (e: unknown) => void) => {
    cb({ event: 'Started', data: { contentLength: 200 } });
    cb({ event: 'Progress', data: { chunkLength: 50 } });
    cb({ event: 'Progress', data: { chunkLength: 150 } });
    cb({ event: 'Finished' });
  }),
  close: vi.fn(async () => {}),
};
let disponible: typeof fausseMaj | null = fausseMaj;
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn(async () => disponible) }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), isTauri: () => true }));

import { checkForUpdates, dismissUpdate, installUpdateAndRelaunch, useUpdateStore } from './updateService';

describe('mises à jour dans l’app', () => {
  beforeEach(() => { disponible = fausseMaj; useUpdateStore.setState({ phase: 'idle', progress: null, dismissedVersion: undefined }); });

  it('annonce la version trouvée avec ses nouveautés', async () => {
    await checkForUpdates();
    expect(useUpdateStore.getState()).toMatchObject({ phase: 'available', version: '9.9.9', notes: '- Nouveauté' });
    dismissUpdate();
    expect(useUpdateStore.getState().dismissedVersion).toBe('9.9.9');
  });

  it('suit la progression du téléchargement puis passe à l’installation', async () => {
    const etats: Array<number | null> = [];
    const off = useUpdateStore.subscribe((s) => etats.push(s.progress));
    await checkForUpdates();
    await installUpdateAndRelaunch();
    off();
    expect(etats).toContain(25);
    expect(useUpdateStore.getState()).toMatchObject({ phase: 'installing', progress: 100 });
  });

  it('revient à l’état normal quand il n’y a rien de neuf', async () => {
    disponible = null;
    await checkForUpdates();
    expect(useUpdateStore.getState().phase).toBe('idle');
  });
});
