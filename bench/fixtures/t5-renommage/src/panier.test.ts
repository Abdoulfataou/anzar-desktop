import { describe, expect, it } from 'vitest';
import { totalPanier } from './panier';

describe('panier', () => {
  it('calcule le total', () => {
    expect(totalPanier([{ nom: 'x', prix: 2, quantite: 3 }])).toBe(6);
  });
});
