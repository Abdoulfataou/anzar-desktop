import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/services/filesystem/fileSystem', () => ({
  fileSystemService: { readFile: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { resolvePath } from './index';

describe('resolvePath — liens symboliques', () => {
  it('canonicalise un chemin normal sous la racine', async () => {
    vi.mocked(invoke).mockImplementation(async (_cmd, args: any) => args.path);
    await expect(resolvePath('/Users/u/proj', 'src/a.ts')).resolves.toBe('/Users/u/proj/src/a.ts');
  });

  it('refuse un symlink qui sort du projet', async () => {
    vi.mocked(invoke).mockImplementation(async (_cmd, args: any) => {
      if (String(args.path).includes('/link/')) return '/Users/u/outside';
      return args.path;
    });
    await expect(resolvePath('/Users/u/proj', 'link/secret.txt')).rejects.toThrow(/hors du projet/);
  });

  it('refuse toujours ..', async () => {
    await expect(resolvePath('/Users/u/proj', '../secret')).rejects.toThrow(/sortie du projet/);
  });
});
