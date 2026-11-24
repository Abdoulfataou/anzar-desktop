import { describe, expect, it } from 'vitest';
import { somme } from './somme';

describe('somme', () => {
  it('additionne deux nombres positifs', () => {
    expect(somme(2, 3)).toBe(5);
  });

  it('additionne un négatif', () => {
    expect(somme(-2, 3)).toBe(1);
  });
});
