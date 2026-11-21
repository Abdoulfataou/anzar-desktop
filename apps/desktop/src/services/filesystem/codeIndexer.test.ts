import { describe, expect, it } from 'vitest';
import { codeIndexer } from './codeIndexer';
import { pageRank, rankedFiles } from '../agent/context/repoRank';

/**
 * Le contexte de l'agent (carte du code + indices de tâche) repose sur cet index : une
 * résolution d'import cassée fait disparaître des arêtes du graphe, donc fausse le PageRank
 * et les fichiers proposés à l'agent. Ces tests figent le comportement.
 */
describe('codeIndexer — graphe d’imports', () => {
  const files: Record<string, string> = {
    'src/lib/store.ts': 'export const store = { count: 0 };\n',
    'src/lib/index.ts': "export * from './store';\n",
    'src/components/Card.tsx': "import { store } from '@/lib';\nexport function Card() { return store.count; }\n",
    'src/components/index.ts': "export { Card } from './Card';\n",
    'src/App.tsx': "import { Card } from './components';\nimport { store } from '@/lib/store';\nexport default function App() { return Card(); }\n",
    'src/deep/leaf.ts': "import { store } from '../lib/store';\nexport const leaf = store;\n",
    'scripts/tool.py': 'import os\n\ndef main():\n    pass\n',
  };

  it('résout les imports relatifs, les index et l’alias @/', () => {
    const index = codeIndexer.indexProject(files);
    const edges = new Set(index.dependencies.map((e) => `${e.from} -> ${e.to}`));

    expect(edges.has('src/components/Card.tsx -> src/lib/index.ts')).toBe(true); // alias @/lib → index
    expect(edges.has('src/App.tsx -> src/components/index.ts')).toBe(true);      // ./components → index
    expect(edges.has('src/App.tsx -> src/lib/store.ts')).toBe(true);             // alias profond
    expect(edges.has('src/deep/leaf.ts -> src/lib/store.ts')).toBe(true);        // ../lib/store
    expect(edges.has('src/lib/index.ts -> src/lib/store.ts')).toBe(true);        // ré-export
  });

  it('ignore les paquets externes', () => {
    const index = codeIndexer.indexProject({ 'src/a.ts': "import React from 'react';\n" });
    expect(index.dependencies).toEqual([]);
  });

  it('extrait les symboles utiles et marque les exports', () => {
    const index = codeIndexer.indexProject(files);
    const card = index.files.get('src/components/Card.tsx')!;
    const names = card.symbols.map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain('function:Card');
    expect(card.symbols.find((s) => s.name === 'Card')?.exported).toBe(true);

    const store = index.files.get('src/lib/store.ts')!;
    expect(store.symbols.length).toBeGreaterThan(0);
  });

  it('compte les dépendances inverses, barrel compris', () => {
    const index = codeIndexer.indexProject(files);
    // Card importe le barrel `@/lib`, qui ré-exporte store : c'est le barrel qui dépend de store.
    const storeImporters = index.reverseDependencies.get('src/lib/store.ts') || [];
    expect(storeImporters).toContain('src/lib/index.ts');
    expect(storeImporters).toContain('src/App.tsx');
    expect(storeImporters).toContain('src/deep/leaf.ts');
    expect(index.reverseDependencies.get('src/lib/index.ts') || []).toContain('src/components/Card.tsx');
  });
});

describe('codeIndexer + PageRank', () => {
  it('classe un utilitaire partagé avant une feuille', () => {
    const files: Record<string, string> = {
      'src/lib/store.ts': 'export const store = 1;\n',
      'src/a.ts': "import { store } from './lib/store';\nexport const a = store;\n",
      'src/b.ts': "import { store } from './lib/store';\nexport const b = store;\n",
      'src/c.ts': "import { a } from './a';\nexport const c = a;\n",
      'src/leaf.ts': 'export const leaf = 0;\n',
    };
    const index = codeIndexer.indexProject(files);
    const rank = pageRank([...index.files.keys()], index.dependencies);
    const order = rankedFiles(rank);

    expect(order.indexOf('src/lib/store.ts')).toBeLessThan(order.indexOf('src/leaf.ts'));
    expect(order.indexOf('src/lib/store.ts')).toBeLessThan(order.indexOf('src/c.ts'));
  });
});
