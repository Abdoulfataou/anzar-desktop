import { beforeEach, describe, expect, it, vi } from 'vitest';

const { disk, fs } = vi.hoisted(() => {
  const disk = new Map<string, string>();
  const fs = {
    exists: vi.fn(async (path: string) => disk.has(path)),
    readFile: vi.fn(async (path: string) => {
      if (!disk.has(path)) throw new Error(`ENOENT: ${path}`);
      return disk.get(path)!;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      disk.set(path, content);
    }),
    deleteFile: vi.fn(async (path: string) => {
      if (!disk.has(path)) throw new Error(`ENOENT: ${path}`);
      disk.delete(path);
    }),
    renameFile: vi.fn(async (from: string, to: string) => {
      if (!disk.has(from)) throw new Error(`ENOENT: ${from}`);
      disk.set(to, disk.get(from)!);
      disk.delete(from);
    }),
    createDirectory: vi.fn(async () => undefined),
  };
  return { disk, fs };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_command: string, args: any) => args?.path),
}));
vi.mock('@/services/filesystem/fileSystem', () => ({ fileSystemService: fs }));

import { execApplyPatch, isProtectedPatchPath, parsePatch } from './patchTool';
import { invoke } from '@tauri-apps/api/core';

const onFileChanged = vi.fn();
const ctx = { projectRoot: '/projet', onFileChanged };

const run = (patch: string) => execApplyPatch({ patch }, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  disk.clear();
  fs.writeFile.mockImplementation(async (path: string, content: string) => {
    disk.set(path, content);
  });
});

describe('apply_patch — opérations', () => {
  it('ajoute un fichier et signale la création', async () => {
    const result = await run([
      '*** Begin Patch',
      '*** Add File: src/nouveau.ts',
      '+const a = 1;',
      '+const b = 2;',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBeUndefined();
    expect(disk.get('/projet/src/nouveau.ts')).toBe('const a = 1;\nconst b = 2;');
    expect(onFileChanged).toHaveBeenCalledWith('src/nouveau.ts', 'const a = 1;\nconst b = 2;', 'create');
    expect(result.output).toContain('1 fichier : +2 −0');
    expect(result.output).toContain('A src/nouveau.ts');
  });

  it('met à jour un fichier avec un hunk simple', async () => {
    disk.set('/projet/a.ts', 'ligne 1\nligne 2\nligne 3\n');
    const result = await run([
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      ' ligne 1',
      '-ligne 2',
      '+ligne 2 modifiée',
      ' ligne 3',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBeUndefined();
    expect(disk.get('/projet/a.ts')).toBe('ligne 1\nligne 2 modifiée\nligne 3\n');
    expect(result.output).toContain('1 fichier : +1 −1');
    expect(onFileChanged).toHaveBeenCalledWith('a.ts', 'ligne 1\nligne 2 modifiée\nligne 3\n', 'edit');
  });

  it('préserve les fins de ligne CRLF d’un fichier Windows', async () => {
    disk.set('/projet/win.ts', 'a\r\nb\r\n');
    const result = await run([
      '*** Begin Patch',
      '*** Update File: win.ts',
      '@@',
      ' a',
      '-b',
      '+B',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBeUndefined();
    expect(disk.get('/projet/win.ts')).toBe('a\r\nB\r\n');
  });

  it('applique plusieurs hunks dans l’ordre sur le contenu courant', async () => {
    disk.set('/projet/a.ts', 'a\nb\nc\nd\ne\nf\n');
    const result = await run([
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      ' a',
      '-b',
      '+B',
      '@@',
      ' e',
      '-f',
      '+F',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBeUndefined();
    expect(disk.get('/projet/a.ts')).toBe('a\nB\nc\nd\ne\nF\n');
    expect(result.output).toContain('+2 −2');
  });

  it('supprime un fichier', async () => {
    disk.set('/projet/old.ts', 'x\ny\n');
    const result = await run([
      '*** Begin Patch',
      '*** Delete File: old.ts',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBeUndefined();
    expect(disk.has('/projet/old.ts')).toBe(false);
    expect(result.output).toContain('D old.ts');
    expect(onFileChanged).toHaveBeenCalledWith('old.ts', '', 'delete');
  });

  it('déplace et modifie un fichier en un seul patch', async () => {
    disk.set('/projet/src/a.ts', 'un\ndeux\n');
    const result = await run([
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '*** Move to: lib/a.ts',
      '@@',
      ' un',
      '-deux',
      '+deux modifié',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBeUndefined();
    expect(disk.has('/projet/src/a.ts')).toBe(false);
    expect(disk.get('/projet/lib/a.ts')).toBe('un\ndeux modifié\n');
    expect(result.output).toContain('R src/a.ts → lib/a.ts');
    expect(onFileChanged).toHaveBeenCalledWith('src/a.ts', '', 'delete');
    expect(onFileChanged).toHaveBeenCalledWith('lib/a.ts', 'un\ndeux modifié\n', 'create');
  });

  it('crée plusieurs fichiers dans un même patch', async () => {
    const result = await run([
      '*** Begin Patch',
      '*** Add File: a.ts',
      '+a',
      '*** Add File: b.ts',
      '+b',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBeUndefined();
    expect(disk.get('/projet/a.ts')).toBe('a');
    expect(disk.get('/projet/b.ts')).toBe('b');
    expect(result.output).toContain('2 fichiers : +2 −0');
  });
});

describe('apply_patch — validation avant écriture', () => {
  it('échoue si le contexte est introuvable, sans toucher au fichier', async () => {
    disk.set('/projet/a.ts', 'foo\n');
    const result = await run([
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      '-absent',
      '+remplacé',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBe(true);
    expect(result.output).toContain('contexte introuvable');
    expect(result.output).toContain('a.ts');
    expect(result.output).toContain('ligne 3');
    expect(result.output).toContain('read_file');
    expect(disk.get('/projet/a.ts')).toBe('foo\n');
    expect(onFileChanged).not.toHaveBeenCalled();
  });

  it('échoue si le contexte est ambigu, sans toucher au fichier', async () => {
    disk.set('/projet/a.ts', 'foo\nfoo\n');
    const result = await run([
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      '-foo',
      '+bar',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBe(true);
    expect(result.output).toContain('contexte ambigu');
    expect(result.output).toContain('2 occurrences');
    expect(disk.get('/projet/a.ts')).toBe('foo\nfoo\n');
  });

  it('refuse un Update File sans hunk', async () => {
    disk.set('/projet/a.ts', 'foo\n');
    const result = await run([
      '*** Begin Patch',
      '*** Update File: a.ts',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Update File sans hunk');
    expect(result.output).toContain('ligne 2');
    expect(disk.get('/projet/a.ts')).toBe('foo\n');
  });

  it('signale une ligne de format invalide avec son numéro', async () => {
    disk.set('/projet/a.ts', 'foo\n');
    const result = await run([
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      '-foo',
      '+bar',
      'ligne invalide',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBe(true);
    expect(result.output).toContain('ligne 6');
    expect(result.output).toContain('préfixe de ligne inattendu');
    expect(disk.get('/projet/a.ts')).toBe('foo\n');
  });

  it('refuse un Update sur un fichier absent et un Add sur un fichier existant', async () => {
    disk.set('/projet/existe.ts', 'déjà\n');
    const update = await run([
      '*** Begin Patch',
      '*** Update File: absent.ts',
      '@@',
      '-x',
      '+y',
      '*** End Patch',
    ].join('\n'));
    expect(update.isError).toBe(true);
    expect(update.output).toContain('introuvable');

    const add = await run([
      '*** Begin Patch',
      '*** Add File: existe.ts',
      '+écrasé',
      '*** End Patch',
    ].join('\n'));
    expect(add.isError).toBe(true);
    expect(add.output).toContain('existe déjà');
    expect(disk.get('/projet/existe.ts')).toBe('déjà\n');
  });
});

describe('apply_patch — chemins du projet', () => {
  it.each(['.env', '.git/config', '.git/hooks/pre-commit', 'config/server.key'])(
    'autorise %s comme Harness, dans la frontière du projet',
    async (path) => {
      const result = await run([
        '*** Begin Patch',
        `*** Add File: ${path}`,
        '+contenu',
        '*** End Patch',
      ].join('\n'));

      expect(result.isError).toBeFalsy();
      expect(disk.has(`/projet/${path}`)).toBe(true);
    },
  );

  it('refuse .. et un chemin absolu', async () => {
    for (const path of ['../secret.txt', '/etc/passwd']) {
      const result = await run([
        '*** Begin Patch',
        `*** Add File: ${path}`,
        '+x',
        '*** End Patch',
      ].join('\n'));
      expect(result.isError).toBe(true);
    }
    expect(disk.size).toBe(0);
  });

  it('refuse un chemin qui sort du projet par lien symbolique', async () => {
    vi.mocked(invoke).mockImplementation(async (_command: string, args: any) => (
      String(args?.path).includes('/link/') ? '/hors-projet/x.ts' : args?.path
    ));
    try {
      const result = await run([
        '*** Begin Patch',
        '*** Add File: link/x.ts',
        '+x',
        '*** End Patch',
      ].join('\n'));
      expect(result.isError).toBe(true);
      expect(result.output).toContain('hors du projet');
      expect(disk.size).toBe(0);
    } finally {
      vi.mocked(invoke).mockImplementation(async (_command: string, args: any) => args?.path);
    }
  });

});

describe('apply_patch — rollback', () => {
  it('restaure le premier fichier quand l’écriture du second échoue', async () => {
    disk.set('/projet/a.ts', 'ancien\n');
    fs.writeFile.mockImplementation(async (path: string, content: string) => {
      if (path.endsWith('/b.ts')) throw new Error('disque plein');
      disk.set(path, content);
    });

    const result = await run([
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      '-ancien',
      '+nouveau',
      '*** Add File: b.ts',
      '+ligne',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBe(true);
    expect(result.output).toContain('b.ts');
    expect(result.output).toContain('disque plein');
    expect(result.output).toContain('Aucune modification conservée');
    expect(disk.get('/projet/a.ts')).toBe('ancien\n');
    expect(disk.has('/projet/b.ts')).toBe(false);
    expect(onFileChanged).not.toHaveBeenCalled();
  });

  it('restaure aussi après un déplacement réussi puis un échec', async () => {
    disk.set('/projet/a.ts', 'contenu\n');
    fs.writeFile.mockImplementation(async (path: string, content: string) => {
      if (path.endsWith('/c.ts')) throw new Error('erreur disque');
      disk.set(path, content);
    });

    const result = await run([
      '*** Begin Patch',
      '*** Update File: a.ts',
      '*** Move to: b.ts',
      '@@',
      '-contenu',
      '+contenu modifié',
      '*** Add File: c.ts',
      '+x',
      '*** End Patch',
    ].join('\n'));

    expect(result.isError).toBe(true);
    expect(disk.get('/projet/a.ts')).toBe('contenu\n');
    expect(disk.has('/projet/b.ts')).toBe(false);
    expect(disk.has('/projet/c.ts')).toBe(false);
  });
});

describe('parsePatch', () => {
  it('parse les sections et hunks', () => {
    const sections = parsePatch([
      '*** Begin Patch',
      '*** Update File: a.ts',
      '@@',
      ' x',
      '-y',
      '+z',
      '*** End Patch',
    ].join('\n'));
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ kind: 'update', path: 'a.ts', added: 1, removed: 1 });
    expect(sections[0].hunks[0].oldLines).toEqual(['x', 'y']);
    expect(sections[0].hunks[0].newLines).toEqual(['x', 'z']);
  });
});
