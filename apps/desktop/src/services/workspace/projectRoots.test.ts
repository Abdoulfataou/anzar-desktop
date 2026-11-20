import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async (..._a: unknown[]) => 2);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@/lib/utils', () => ({ isTauri: () => true }));
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({ projects: [
      { metadata: { localPath: '/Users/a/Desktop/ANZAR' } },
      { metadata: {} },
      { metadata: { localPath: '/Users/a/code/site' } },
    ] }),
    persist: { hasHydrated: () => true, onFinishHydration: vi.fn() },
  },
}));

import { importKnownProjectRoots } from './projectRoots';

describe('migration des dossiers de projet vers Rust', () => {
  it('envoie une fois les dossiers des projets connus', async () => {
    expect(await importKnownProjectRoots()).toBe(2);
    expect(invoke).toHaveBeenCalledWith('project_import_roots', { paths: ['/Users/a/Desktop/ANZAR', '/Users/a/code/site'] });
    await importKnownProjectRoots();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
