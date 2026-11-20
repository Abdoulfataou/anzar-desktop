import { describe, expect, it } from 'vitest';
import { pageRank, rankedFiles } from './repoRank';

const files = ['src/main.tsx', 'src/App.tsx', 'src/pages/Cart.tsx', 'src/pages/Home.tsx', 'src/stores/cart.ts', 'src/lib/utils.ts', 'README.md'];
const edges = [
  { from: 'src/main.tsx', to: 'src/App.tsx' },
  { from: 'src/App.tsx', to: 'src/pages/Cart.tsx' },
  { from: 'src/App.tsx', to: 'src/pages/Home.tsx' },
  { from: 'src/pages/Cart.tsx', to: 'src/stores/cart.ts' },
  { from: 'src/pages/Cart.tsx', to: 'src/lib/utils.ts' },
  { from: 'src/pages/Home.tsx', to: 'src/lib/utils.ts' },
  { from: 'src/stores/cart.ts', to: 'src/lib/utils.ts' },
];

describe('pageRank (carte du code)', () => {
  it('met en tête le fichier le plus importé par des fichiers importants', () => {
    const order = rankedFiles(pageRank(files, edges));
    expect(order[0]).toBe('src/lib/utils.ts');
    expect(order.indexOf('README.md')).toBeGreaterThan(order.indexOf('src/stores/cart.ts'));
  });

  it('les scores somment à 1', () => {
    const total = [...pageRank(files, edges).values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('avec la tâche, remonte le fichier visé et ses dépendances', () => {
    const rank = pageRank(files, edges, { personalization: new Map([['src/pages/Cart.tsx', 1]]) });
    const order = rankedFiles(rank);
    expect(order.slice(0, 3)).toEqual(expect.arrayContaining(['src/pages/Cart.tsx', 'src/stores/cart.ts', 'src/lib/utils.ts']));
    expect(order.indexOf('src/pages/Home.tsx')).toBeGreaterThan(order.indexOf('src/stores/cart.ts'));
  });

  it('est déterministe et tolère arêtes inconnues, doublons et boucles', () => {
    const noisy = [...edges, ...edges, { from: 'x', to: 'src/App.tsx' }, { from: 'src/App.tsx', to: 'src/App.tsx' }];
    expect(rankedFiles(pageRank(files, noisy))).toEqual(rankedFiles(pageRank([...files].reverse(), edges)));
  });

  it('projet vide', () => {
    expect(pageRank([], []).size).toBe(0);
  });
});
