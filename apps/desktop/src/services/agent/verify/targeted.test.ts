import { describe, expect, it } from 'vitest';
import type { VerifyCommand } from './agentVerifier';
import {
  candidateTestPaths, collectRelatedTests, MAX_TARGETED_FILES, planVerification,
} from './targeted';

const commands: VerifyCommand[] = [
  { label: 'lint', command: 'npm run lint' },
  { label: 'typecheck', command: 'npm run typecheck' },
  { label: 'build', command: 'npm run build' },
  { label: 'test', command: 'npm test' },
];

const scripts = { lint: 'eslint .', build: 'vite build', test: 'vitest run' };

const plan = (changedFiles: string[], extra: Record<string, unknown> = {}) =>
  planVerification(commands, { scripts, changedFiles, ...extra });

describe('planVerification', () => {
  it('ne change rien sans fichier modifié (vérification de référence)', () => {
    const result = planVerification(commands, { scripts, changedFiles: [] });
    expect(result.commands).toEqual(commands);
    expect(result.notes).toEqual([]);
  });

  it('ne vérifie rien quand seuls des documents changent', () => {
    const result = plan(['README.md', 'docs/guide.md', 'public/logo.png']);
    expect(result.commands).toEqual([]);
    expect(result.skipped).toHaveLength(commands.length);
    expect(result.notes[0]).toContain('aucun fichier de code');
  });

  it('vérifie tout quand un fichier de configuration change', () => {
    const result = plan(['src/a.ts', 'package.json']);
    expect(result.commands).toEqual(commands);
    expect(result.notes[0]).toContain('vérification complète');
  });

  it('garde le build mais écarte tests et typecheck pour des styles seuls', () => {
    const result = plan(['src/styles.css']);
    expect(result.commands.map((c) => c.label)).toEqual(['lint', 'build']);
    expect(result.skipped.map((s) => s.label)).toEqual(['typecheck', 'test']);
  });

  it('cible lint et tests sur les fichiers modifiés', () => {
    const result = plan(['src/a.ts', 'src/b.ts'], { relatedTests: ['src/a.test.ts'] });
    expect(result.commands).toContainEqual({ label: 'test', command: 'npm test -- src/a.test.ts' });
    expect(result.commands).toContainEqual({ label: 'lint', command: 'npm run lint -- src/a.ts src/b.ts' });
    // Le build reste complet : il ne se cible pas.
    expect(result.commands).toContainEqual({ label: 'build', command: 'npm run build' });
    expect(result.notes).toContain('tests limités à 1 fichier');
  });

  it('garde la commande de test complète sans test associé', () => {
    const result = plan(['src/a.ts']);
    expect(result.commands).toContainEqual({ label: 'test', command: 'npm test' });
  });

  it('n’ajoute pas d’arguments à un script inconnu', () => {
    const result = planVerification(commands, {
      scripts: { lint: 'tsc --noEmit', test: 'node scripts/run-tests.js' },
      changedFiles: ['src/a.ts'],
      relatedTests: ['src/a.test.ts'],
    });
    expect(result.commands).toContainEqual({ label: 'lint', command: 'npm run lint' });
    expect(result.commands).toContainEqual({ label: 'test', command: 'npm test' });
  });

  it('plafonne le nombre de fichiers passés en arguments', () => {
    const files = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`);
    const result = plan(files);
    const lint = result.commands.find((c) => c.label === 'lint')!;
    // Le lanceur de commandes plafonne à 8 arguments après le programme.
    expect(lint.command.split(' ').length - 1).toBeLessThanOrEqual(8);
    expect(lint.command).toContain('src/f4.ts');
    expect(lint.command).not.toContain('src/f5.ts');
  });

  it('conserve les labels (la référence complète doit rester comparable)', () => {
    const result = plan(['src/a.ts'], { relatedTests: ['src/a.test.ts'] });
    expect(result.commands.map((c) => c.label)).toEqual(['lint', 'typecheck', 'build', 'test']);
  });
});

describe('candidateTestPaths', () => {
  it('applique les conventions courantes', () => {
    expect(candidateTestPaths('src/foo.ts')[0]).toBe('src/foo.test.ts');
    expect(candidateTestPaths('src/foo.tsx')).toContain('src/__tests__/foo.test.tsx');
    expect(candidateTestPaths('src/deep/foo.ts')).toContain('src/deep/foo.spec.ts');
  });

  it('renvoie le fichier lui-même pour un test', () => {
    expect(candidateTestPaths('src/foo.test.ts')).toEqual(['src/foo.test.ts']);
  });

  it('ignore les chemins sans extension', () => {
    expect(candidateTestPaths('Makefile')).toEqual([]);
  });
});

describe('collectRelatedTests', () => {
  it('ne garde que les fichiers qui existent', async () => {
    const existing = new Set(['src/a.test.ts']);
    const found = await collectRelatedTests(['src/a.ts', 'src/b.ts'], async (p) => existing.has(p));
    expect(found).toEqual(['src/a.test.ts']);
  });

  it('inclut un test modifié directement, s’il existe', async () => {
    expect(await collectRelatedTests(['src/a.test.ts'], async () => true)).toEqual(['src/a.test.ts']);
    // Test supprimé : on ne peut pas le lancer, la vérification complète prendra le relais.
    expect(await collectRelatedTests(['src/a.test.ts'], async () => false)).toEqual([]);
  });

  it('plafonne le nombre de fichiers', async () => {
    const files = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
    const found = await collectRelatedTests(files, async () => true);
    expect(found).toHaveLength(MAX_TARGETED_FILES);
  });
});
