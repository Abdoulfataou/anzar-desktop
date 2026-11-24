import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileNode } from '@/types/file-project';

const { readDirectoryTree } = vi.hoisted(() => ({ readDirectoryTree: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_command: string, args: any) => args?.path),
}));
vi.mock('@/services/filesystem/fileSystem', () => ({
  fileSystemService: { readDirectoryTree },
}));

import { execGlob, globToRegExp, globToRegExpSource } from './globTool';

const fileNode = (path: string): FileNode => ({
  id: path,
  name: path.split('/').pop() || path,
  path,
  type: 'file',
});

const dirNode = (path: string, children: FileNode[]): FileNode => ({
  id: path,
  name: path.split('/').pop() || path,
  path,
  type: 'directory',
  children,
});

/** Arborescence volontairement non triée : le tri est fait par glob. */
const tree: FileNode[] = [
  fileNode('/projet/README.md'),
  dirNode('/projet/src', [
    fileNode('/projet/src/b.ts'),
    dirNode('/projet/src/nested', [fileNode('/projet/src/nested/c.ts')]),
    fileNode('/projet/src/a.ts'),
    fileNode('/projet/src/b.tsx'),
  ]),
  fileNode('/projet/main.ts'),
];

const ctx = { projectRoot: '/projet' };

beforeEach(() => {
  readDirectoryTree.mockReset();
  readDirectoryTree.mockResolvedValue(tree);
});

describe('globToRegExp', () => {
  it('limite * à un segment et laisse ** traverser les dossiers', () => {
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/nested/a.ts')).toBe(false);
    expect(globToRegExp('**/*.ts').test('main.ts')).toBe(true);
    expect(globToRegExp('**/*.ts').test('src/nested/a.ts')).toBe(true);
    expect(globToRegExp('**/*.ts').test('src/a.tsx')).toBe(false);
  });

  it('gère ? et les alternatives {a,b}', () => {
    expect(globToRegExp('src/?.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/?.ts').test('src/ab.ts')).toBe(false);
    expect(globToRegExp('src/{a,b}.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/{a,b}.ts').test('src/b.ts')).toBe(true);
    expect(globToRegExp('src/{a,b}.ts').test('src/c.ts')).toBe(false);
    // Le motif est ancré : pas de correspondance partielle.
    expect(globToRegExp('*.ts').test('src/a.ts')).toBe(false);
  });

  it('échappe les caractères spéciaux de RegExp', () => {
    expect(globToRegExpSource('a.(b)+c')).toBe('a\\.\\(b\\)\\+c');
  });
});

describe('execGlob', () => {
  it('trouve les fichiers avec ** et les rend relatifs au projet, triés', async () => {
    const result = await execGlob({ pattern: '**/*.ts' }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output.split('\n')).toEqual([
      'main.ts',
      'src/a.ts',
      'src/b.ts',
      'src/nested/c.ts',
    ]);
    expect(readDirectoryTree).toHaveBeenCalledWith('/projet', 8, { throwOnError: true });
  });

  it('respecte la profondeur d’un motif à un seul segment', async () => {
    const result = await execGlob({ pattern: 'src/*.ts' }, ctx);
    expect(result.output.split('\n')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('préfixe les résultats avec le dossier demandé', async () => {
    // Le service lit réellement le sous-dossier : l’arbre rendu lui est relatif.
    readDirectoryTree.mockResolvedValueOnce(tree[1].children!);
    const result = await execGlob({ pattern: '**/*.ts', path: 'src' }, ctx);
    expect(result.output.split('\n')).toEqual(['src/a.ts', 'src/b.ts', 'src/nested/c.ts']);
  });

  it('accepte aussi un motif relatif au dossier demandé', async () => {
    readDirectoryTree.mockResolvedValueOnce(tree[1].children!);
    const result = await execGlob({ pattern: '*.ts', path: 'src' }, ctx);
    expect(result.output.split('\n')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('gère ? et {a,b}', async () => {
    expect((await execGlob({ pattern: 'src/?.ts' }, ctx)).output).toBe('src/a.ts\nsrc/b.ts');
    expect((await execGlob({ pattern: 'src/{a,b}.ts' }, ctx)).output).toBe('src/a.ts\nsrc/b.ts');
  });

  it('tronque selon limit avec un message actionnable', async () => {
    const result = await execGlob({ pattern: '**/*.ts', limit: 2 }, ctx);
    expect(result.output.split('\n')).toEqual([
      'main.ts',
      'src/a.ts',
      '… 2 autres fichiers (augmente limit ou précise path)',
    ]);
  });

  it('plafonne limit à 500 sans erreur', async () => {
    const result = await execGlob({ pattern: '**/*.ts', limit: 10_000 }, ctx);
    expect(result.output).not.toContain('augmente limit');
  });

  it('explique quand aucun fichier ne correspond', async () => {
    const result = await execGlob({ pattern: '**/*.rs' }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('Aucun fichier ne correspond à « **/*.rs »');
    expect(result.output).toContain('vérifie le motif ou le dossier');
  });

  it('signale un dossier absent au lieu de faire croire à un dossier vide', async () => {
    readDirectoryTree.mockRejectedValueOnce(new Error('dossier introuvable'));
    const result = await execGlob({ pattern: '**/*.ts', path: 'absent' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain('impossible de lire « absent »');
    expect(result.output).toContain('dossier introuvable');
  });

  it('exige un motif', async () => {
    const result = await execGlob({ pattern: '   ' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain('indique un motif glob');
  });
});
