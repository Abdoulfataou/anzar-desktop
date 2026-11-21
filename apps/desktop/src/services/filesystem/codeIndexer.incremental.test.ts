import { beforeEach, describe, expect, it } from 'vitest';
import { codeIndexer } from './codeIndexer';

/**
 * L'indexation incrémentale ne doit jamais changer le résultat — seulement éviter de
 * re-parser. Ces tests comparent les deux chemins et vérifient le graphe recalculé.
 */
const base = {
  'src/lib/store.ts': 'export const store = 1;\n',
  'src/a.ts': "import { store } from './lib/store';\nexport const a = store;\n",
  'src/b.ts': "import { a } from './a';\nexport const b = a;\n",
};

beforeEach(() => codeIndexer.resetIncrementalCache());

describe('indexProjectIncremental', () => {
  it('reprend les fichiers inchangés et ne re-parse que les modifiés', () => {
    const first = codeIndexer.indexProjectIncremental('/p', base);
    expect(first.incremental).toEqual({ reused: 0, parsed: 3, removed: 0 });

    const second = codeIndexer.indexProjectIncremental('/p', base);
    expect(second.incremental).toEqual({ reused: 3, parsed: 0, removed: 0 });

    const changed = { ...base, 'src/a.ts': "import { store } from './lib/store';\nexport const a = store + 1;\n" };
    const third = codeIndexer.indexProjectIncremental('/p', changed);
    expect(third.incremental).toEqual({ reused: 2, parsed: 1, removed: 0 });
  });

  it('produit un index identique au parsing complet', () => {
    const incremental = codeIndexer.indexProjectIncremental('/p', base);
    const full = codeIndexer.indexProject(base);
    expect([...incremental.files.keys()].sort()).toEqual([...full.files.keys()].sort());
    expect(incremental.dependencies).toEqual(full.dependencies);
    expect(incremental.stats).toEqual(full.stats);
    expect(incremental.files.get('src/a.ts')?.symbols).toEqual(full.files.get('src/a.ts')?.symbols);
  });

  it('signale les fichiers supprimés', () => {
    codeIndexer.indexProjectIncremental('/p', base);
    const { 'src/b.ts': _gone, ...rest } = base;
    const after = codeIndexer.indexProjectIncremental('/p', rest);
    expect(after.incremental.removed).toBe(1);
    expect(after.files.has('src/b.ts')).toBe(false);
  });

  it('recalcule le graphe quand un nouveau fichier résout un import existant', () => {
    const dangling = { 'src/a.ts': "import { b } from './b';\nexport const a = b;\n" };
    const before = codeIndexer.indexProjectIncremental('/p', dangling);
    expect(before.dependencies).toEqual([]);

    // b.ts apparaît : a.ts est inchangé (symboles en cache) mais l'arête doit exister.
    const withB = { ...dangling, 'src/b.ts': 'export const b = 2;\n' };
    const after = codeIndexer.indexProjectIncremental('/p', withB);
    expect(after.incremental).toEqual({ reused: 1, parsed: 1, removed: 0 });
    expect(after.dependencies).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);
  });

  it('isole les caches par projet', () => {
    codeIndexer.indexProjectIncremental('/projet-1', base);
    const other = codeIndexer.indexProjectIncremental('/projet-2', base);
    expect(other.incremental).toEqual({ reused: 0, parsed: 3, removed: 0 });
  });
});
