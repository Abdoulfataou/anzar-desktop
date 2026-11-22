import { describe, expect, it } from 'vitest';
import { parseNumstat, parseStatus } from './gitChanges';

/**
 * Le format porcelain v1 en mode -z est la source de vérité de la carte : il inclut ce que
 * les commandes ont modifié. Les analyseurs sont testés sur les cas réels (nouveaux fichiers,
 * suppressions, binaires, chemins avec espaces).
 */
describe('parseStatus', () => {
  it('classe créés, modifiés et supprimés', () => {
    const out = parseStatus('?? src/a.ts\0 M src/b.ts\0 D src/c.ts\0');
    expect(out).toEqual([
      { path: 'src/a.ts', kind: 'created' },
      { path: 'src/b.ts', kind: 'modified' },
      { path: 'src/c.ts', kind: 'deleted' },
    ]);
  });

  it('ignore les entrées vides et garde les espaces', () => {
    expect(parseStatus('\0\0')).toEqual([]);
    expect(parseStatus(' M dossier/fichier avec espace.ts\0')).toEqual([
      { path: 'dossier/fichier avec espace.ts', kind: 'modified' },
    ]);
  });
});

describe('parseNumstat', () => {
  it('lit ajouts et suppressions', () => {
    const map = parseNumstat('3\t1\tsrc/a.ts\0');
    expect(map.get('src/a.ts')).toEqual({ added: 3, removed: 1 });
  });

  it('traite les binaires comme zéro ligne', () => {
    const map = parseNumstat('-\t-\tpublic/logo.png\0');
    expect(map.get('public/logo.png')).toEqual({ added: 0, removed: 0 });
  });
});
