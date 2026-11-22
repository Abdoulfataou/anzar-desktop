import { describe, expect, it, vi } from 'vitest';
import type { VerifyReport } from './agentVerifier';
import {
  BASELINE_TTL_MS, parseStoredBaseline,
  diffAgainstBaseline, getCachedBaseline, NO_MESSAGE_FAILURE, normalizeFailureLines,
  resetBaselineCache, setCachedBaseline, summarizeVerifyDiff, toBaseline,
} from './baseline';

const report = (entries: { command: string; passed: boolean; output?: string; skipped?: boolean; label?: string }[]): VerifyReport => ({
  passed: entries.every((e) => e.passed || e.skipped),
  nothingToVerify: false,
  results: entries.map((e) => ({
    label: e.label || e.command.split(' ').pop() || e.command,
    command: e.command,
    passed: e.passed,
    skipped: !!e.skipped,
    exitCode: e.passed ? 0 : 1,
    output: e.output || '',
    durationMs: 5,
  })),
  failureSummary: '',
});

const BUILD_FAILED = 'npm run build';
const BUILD_OK = { command: BUILD_FAILED, passed: true };
const TS1 = 'error TS2304: Cannot find name "toto".';
const TS2 = 'error TS2322: Type string is not assignable to number.';

describe('normalizeFailureLines', () => {
  it('garde les lignes d’erreur et retire le bruit', () => {
    const output = [
      '> projet@1.0.0 build',
      'vite v6 building for production...',
      'npm ERR! code ELIFECYCLE',
      'src/App.tsx:12:5 - error TS2304: Cannot find name "toto".',
      '    at Object.<anonymous> (/tmp/x.js:1:1)',
    ].join('\n');
    const lines = normalizeFailureLines(output);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('TS2304');
  });

  it('neutralise chemins absolus, numéros de ligne et durées', () => {
    const a = normalizeFailureLines('/tmp/projet/src/App.tsx:12:5 - error TS1', '/tmp/projet');
    const b = normalizeFailureLines('/tmp/projet/src/App.tsx:40:2 - error TS1', '/tmp/projet');
    expect(a).toEqual(b);
    expect(normalizeFailureLines('tests: 1 failed (2500ms)', '')[0]).toContain('<durée>');
  });

  it('dédoublonne et dégrade proprement', () => {
    const lines = normalizeFailureLines(`error A\nerror A\nerror B`);
    expect(lines).toEqual(['error A', 'error B']);
    expect(normalizeFailureLines('Compilation terminée')).toEqual([]);
  });
});

describe('toBaseline', () => {
  it('ne garde que les commandes exécutées et leurs échecs', () => {
    const baseline = toBaseline(report([
      { ...BUILD_OK },
      { command: 'npm test', passed: false, output: TS1 },
      { command: 'npm run lint', passed: false, skipped: true },
    ]), '/tmp/projet');

    expect(baseline.commands.map((c) => c.command)).toEqual([BUILD_FAILED, 'npm test']);
    expect(baseline.commands[0].failures).toEqual([]);
    expect(baseline.commands[1].failures).toHaveLength(1);
  });

  it('marque un échec sans message exploitable', () => {
    const baseline = toBaseline(report([{ command: 'npm test', passed: false, output: '' }]), '/tmp');
    expect(baseline.commands[0].failures).toEqual([NO_MESSAGE_FAILURE]);
  });
});

describe('diffAgainstBaseline', () => {
  it('sans référence, tous les échecs sont nouveaux', () => {
    const diff = diffAgainstBaseline(report([{ command: BUILD_FAILED, passed: false, output: TS1 }]), null);
    expect(diff.newFailures).toHaveLength(1);
    expect(diff.preexisting).toBe(0);
  });

  it('ignore un échec identique à celui d’avant les modifications', () => {
    const baseline = toBaseline(report([{ command: BUILD_FAILED, passed: false, output: TS1 }]), '/tmp');
    const diff = diffAgainstBaseline(report([{ command: BUILD_FAILED, passed: false, output: TS1 }]), baseline);
    expect(diff.newFailures).toEqual([]);
    expect(diff.preexisting).toBe(1);
  });

  it('détecte une erreur qui apparaît en plus d’une erreur déjà présente', () => {
    const baseline = toBaseline(report([{ command: BUILD_FAILED, passed: false, output: TS1 }]), '/tmp');
    const diff = diffAgainstBaseline(report([{ command: BUILD_FAILED, passed: false, output: `${TS1}\n${TS2}` }]), baseline);
    expect(diff.newFailures).toHaveLength(1);
    expect(diff.newFailures[0].lines).toEqual([expect.stringContaining('TS2322')]);
    expect(diff.preexisting).toBe(1);
  });

  it('compte comme nouveau un échec sur une commande qui passait', () => {
    const baseline = toBaseline(report([{ ...BUILD_OK }]), '/tmp');
    const diff = diffAgainstBaseline(report([{ command: BUILD_FAILED, passed: false, output: TS1 }]), baseline);
    expect(diff.newFailures).toHaveLength(1);
  });

  it('compte une régression corrigée', () => {
    const baseline = toBaseline(report([{ command: BUILD_FAILED, passed: false, output: TS1 }]), '/tmp');
    const diff = diffAgainstBaseline(report([{ ...BUILD_OK }]), baseline);
    expect(diff.resolved).toBe(1);
    expect(diff.newFailures).toEqual([]);
  });

  it('ignore les commandes non exécutées', () => {
    const diff = diffAgainstBaseline(
      report([{ command: 'npm test', passed: false, skipped: true }]),
      toBaseline(report([]), '/tmp'),
    );
    expect(diff.newFailures).toEqual([]);
  });

  it('considère comme nouvelle une commande inconnue de la référence', () => {
    const baseline = toBaseline(report([{ ...BUILD_OK }]), '/tmp');
    const diff = diffAgainstBaseline(report([{ command: 'npm run lint', passed: false, output: TS2 }]), baseline);
    expect(diff.newFailures[0].command).toBe('npm run lint');
  });
});

describe('diffAgainstBaseline — vérification ciblée', () => {
  it('reconnaît une commande ciblée comme le même contrôle que la référence complète', () => {
    const baseline = toBaseline(report([{ command: 'npm run lint', passed: false, output: TS1, label: 'lint' }]), '/tmp');
    const diff = diffAgainstBaseline(
      report([{ command: 'npm run lint -- src/a.ts', passed: false, output: TS1, label: 'lint' }]),
      baseline,
    );
    expect(diff.newFailures).toEqual([]);
    expect(diff.preexisting).toBe(1);
  });
});

describe('summarizeVerifyDiff', () => {
  it('ne réinjecte que les nouveaux échecs', () => {
    const baseline = toBaseline(report([{ command: BUILD_FAILED, passed: false, output: TS1 }]), '/tmp');
    const diff = diffAgainstBaseline(report([{ command: BUILD_FAILED, passed: false, output: `${TS1}\n${TS2}` }]), baseline);
    const text = summarizeVerifyDiff(diff);
    expect(text).toContain('1 commande en échec après tes modifications');
    expect(text).toContain('TS2322');
    expect(text).not.toContain('TS2304');
  });

  it('explique qu’il n’y a aucun nouvel échec', () => {
    const baseline = toBaseline(report([{ command: BUILD_FAILED, passed: false, output: TS1 }]), '/tmp');
    const diff = diffAgainstBaseline(report([{ command: BUILD_FAILED, passed: false, output: TS1 }]), baseline);
    expect(summarizeVerifyDiff(diff)).toContain('déjà présents');
  });

  it('reste vide quand tout passe', () => {
    const diff = diffAgainstBaseline(report([{ ...BUILD_OK }]), toBaseline(report([{ ...BUILD_OK }]), '/tmp'));
    expect(summarizeVerifyDiff(diff)).toBe('');
  });
});

describe('cache de référence', () => {
  it('rend la référence déjà capturée pour le projet', () => {
    resetBaselineCache();
    const baseline = toBaseline(report([{ ...BUILD_OK }]), '/tmp/projet');
    expect(getCachedBaseline('/tmp/projet')).toBeNull();
    setCachedBaseline(baseline);
    expect(getCachedBaseline('/tmp/projet')).toBe(baseline);
    resetBaselineCache();
    expect(getCachedBaseline('/tmp/projet')).toBeNull();
  });

  it('oublie une référence trop vieille', () => {
    resetBaselineCache();
    const baseline = toBaseline(report([{ ...BUILD_OK }]), '/tmp/vieux');
    setCachedBaseline(baseline);
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 3 * 60 * 60_000);
    expect(getCachedBaseline('/tmp/vieux')).toBeNull();
    spy.mockRestore();
    resetBaselineCache();
  });

describe('parseStoredBaseline', () => {
  const now = 1_700_000_000_000;
  const stored = (extra: Record<string, unknown> = {}) => JSON.stringify({
    at: now, root: '/p', commands: [{ command: 'npm test', label: 'test', passed: false, failures: ['x'] }], ...extra,
  });

  it('relit une référence persistée valide', () => {
    const b = parseStoredBaseline(stored(), '/p', now);
    expect(b?.commands).toHaveLength(1);
    expect(b?.commands[0].failures).toEqual(['x']);
  });

  it('refuse un autre projet, une référence périmée ou un JSON illisible', () => {
    expect(parseStoredBaseline(stored(), '/autre', now)).toBeNull();
    expect(parseStoredBaseline(stored({ at: now - BASELINE_TTL_MS - 1 }), '/p', now)).toBeNull();
    expect(parseStoredBaseline('{', '/p', now)).toBeNull();
    expect(parseStoredBaseline(stored({ commands: [] }), '/p', now)).toBeNull();
  });

  it('refuse une date dans le futur (horloge modifiée)', () => {
    expect(parseStoredBaseline(stored({ at: now + 5 * 60_000 }), '/p', now)).toBeNull();
  });
});
});
