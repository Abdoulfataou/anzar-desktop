import { describe, expect, it } from 'vitest';
import { BUILTIN_SKILLS } from './index';
import { parseSkill } from '../format';

describe('pack de skills intégré', () => {
  it('chaque skill a un nom unique, identique à son en-tête, et une description', () => {
    const noms = BUILTIN_SKILLS.map((s) => s.name);
    expect(new Set(noms).size).toBe(noms.length);
    for (const s of BUILTIN_SKILLS) {
      const lu = parseSkill(s.markdown, 'x');
      expect(lu.name).toBe(s.name);
      expect(lu.description.length).toBeGreaterThan(20);
    }
  });

  it('retouche-images : sharp, original préservé, orientation et vérification', () => {
    const md = BUILTIN_SKILLS.find((s) => s.name === 'retouche-images')!.markdown;
    expect(md).toContain('npm install sharp');
    expect(md).toContain('Ne modifie JAMAIS l\'original');
    expect(md).toContain('.rotate()');
    expect(md).toContain('metadata()');
    expect(md).toContain('${xml(t)}'); // texte échappé dans le SVG
  });
});
