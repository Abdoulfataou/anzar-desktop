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

  it('développement par sous-agents : interfaces figées, lots, revue, corrections, consolidation', () => {
    const md = BUILTIN_SKILLS.find((s) => s.name === 'developpement-par-sous-agents')!.markdown;
    for (const attendu of ['spawn_agent', 'wait_agent', 'send_message', 'Fige d', 'lots', 'revue', 'verification-avant-de-conclure']) {
      expect(md, attendu).toContain(attendu);
    }
  });

  it('cause racine et attente par condition : méthode et exemple exécutable', () => {
    const racine = BUILTIN_SKILLS.find((s) => s.name === 'cause-racine')!.markdown;
    expect(racine).toContain('new Error().stack');
    expect(racine).toContain('Corrige à la source');
    const attente = BUILTIN_SKILLS.find((s) => s.name === 'attente-par-condition')!.markdown;
    // L'exemple garde ses gabarits (backticks et ${…}) une fois sorti du code source
    expect(attente).toContain('`Délai dépassé (${timeoutMs} ms) en attendant ${quoi}`');
    expect(attente).toContain('vi.useFakeTimers');
    // La skill de débogage y renvoie
    const debug = BUILTIN_SKILLS.find((s) => s.name === 'debogage-systematique')!.markdown;
    expect(debug).toContain('cause-racine');
    expect(debug).toContain('attente-par-condition');
  });

  it('les nouvelles skills tiennent dans la limite de lecture', () => {
    for (const name of ['developpement-par-sous-agents', 'cause-racine', 'attente-par-condition']) {
      const md = BUILTIN_SKILLS.find((s) => s.name === name)!.markdown;
      expect(md.length, name).toBeLessThan(20_000);
    }
  });

  it('commandes longues : arrière-plan, pas de filtre, tests bornés par outil, pas d’invite', () => {
    const md = BUILTIN_SKILLS.find((s) => s.name === 'commandes-longues')!.markdown;
    for (const attendu of ['run_in_background', 'job_output', '| tail', 'set -o pipefail;', '--timeout 30s', '--detectOpenHandles', 'CI=true', 'git commit -m', 'EADDRINUSE']) {
      expect(md, attendu).toContain(attendu);
    }
  });

  it('débogage : un test qui expire peut bloquer dans son nettoyage (cas du flux Dart jamais écouté)', () => {
    const md = BUILTIN_SKILLS.find((s) => s.name === 'debogage-systematique')!.markdown;
    expect(md).toContain('tearDown');
    expect(md).toContain('`await controller.close()`');
    const racine = BUILTIN_SKILLS.find((s) => s.name === 'cause-racine')!.markdown;
    expect(racine).toContain('doit d\'abord compiler');
  });
});
