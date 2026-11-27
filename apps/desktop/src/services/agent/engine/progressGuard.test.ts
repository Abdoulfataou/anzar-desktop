import { describe, expect, it } from 'vitest';
import { commandFamily, ProgressGuard } from './progressGuard';

const bash = (command: string, id = 'c') => ({
  id, type: 'function' as const, function: { name: 'bash', arguments: JSON.stringify({ command }) },
});
const ALL = new Set(['bash', 'load_skill', 'spawn_agent', 'wait_agent', 'explore']);
const failed = { output: 'exit_code: 1', failed: true };
const timedOut = { output: 'exit_code: 130\n\n[délai dépassé] arrêtée après 300 s.', failed: true };
const ok = { output: 'exit_code: 0' };

describe('famille d’une commande', () => {
  it('garde programme et sous-commande, sans fichiers, options ni filtres', () => {
    expect(commandFamily('cd /Users/a/Key && flutter test test/application/_diag_test.dart --timeout 300s 2>&1 | tail -40')).toBe('flutter test');
    expect(commandFamily('flutter test test/x_test.dart --plain-name "2. ouverture"')).toBe('flutter test');
    expect(commandFamily('set -o pipefail; npm run build 2>&1 | tail -20')).toBe('npm run build');
    expect(commandFamily('CI=true npx vitest run src/a.test.ts')).toBe('vitest run');
    expect(commandFamily('python3 -m pytest -x tests/')).toBe('python -m pytest');
    expect(commandFamily('timeout 60 ./tool/check.sh')).toBe('check.sh');
    expect(commandFamily('node scripts/verifier.mjs')).toBe('node verifier.mjs');
    expect(commandFamily('pnpm test')).toBe('pnpm test');
    expect(commandFamily('pytest -k test_ouverture -x')).toBe('pytest');
    expect(commandFamily('go test -run TestOpen ./...')).toBe('go test');
  });

  it('ignore l’exploration (grep sans résultat rend 1 sans être un échec)', () => {
    expect(commandFamily('grep -rn "close" lib/')).toBeNull();
    expect(commandFamily('cd lib && sed -n 150,250p a.dart')).toBeNull();
    expect(commandFamily('git status --short')).toBeNull();
  });
});

describe('point d’étape', () => {
  it('cas réel Key : deux délais dépassés sur flutter test → point d’étape avec regard neuf', () => {
    const guard = new ProgressGuard();
    expect(guard.after(bash('flutter test test/application/message_flow_test.dart | tail -40'), timedOut, ALL)).toBeNull();
    const point = guard.after(bash('cd /k && flutter test test/application/_diag_test.dart 2>&1 | tail -60'), timedOut, ALL)!;
    expect(point).not.toBeNull();
    expect(point.family).toBe('flutter test');
    expect(point.timeouts).toBe(2);
    expect(point.message).toContain("[Point d'étape] « flutter test » : 2 échecs de suite, 2 délais dépassés");
    expect(point.message).toContain('hypothèses déjà écartées');
    expect(point.message).toContain('préparation ou son nettoyage');
    expect(point.message).toContain('spawn_agent, rôle revue');
    expect(point.message).toContain('load_skill');
  });

  it('trois échecs, puis six : deux niveaux, chacun une seule fois', () => {
    const guard = new ProgressGuard();
    const results = Array.from({ length: 7 }, (_, i) => guard.after(bash(`npm run build -- --x${i}`), failed, ALL));
    expect(results.map((r) => r?.level ?? null)).toEqual([null, null, 1, null, null, 2, null]);
    expect(results[5]!.message).toContain('Tu piétines toujours');
  });

  it('une réussite remet à zéro, un refus de lancement ne compte pas, l’exploration non plus', () => {
    const guard = new ProgressGuard();
    guard.after(bash('pytest'), failed, ALL);
    guard.after(bash('pytest'), failed, ALL);
    guard.after(bash('pytest'), ok, ALL);
    expect(guard.after(bash('pytest'), failed, ALL)).toBeNull();
    expect(guard.after(bash('pytest'), { output: 'refus', isError: true }, ALL)).toBeNull();
    for (let i = 0; i < 5; i++) expect(guard.after(bash(`grep -rn x${i} src`), failed, ALL)).toBeNull();
    expect(guard.after(bash('pytest -k a'), failed, ALL)).toBeNull();
    expect(guard.after(bash('pytest -k b'), failed, ALL)?.level).toBe(1);
  });

  it('ne cite que les outils disponibles (sous-agent sans délégation)', () => {
    const guard = new ProgressGuard({ failureThresholds: [2, 4] });
    guard.after(bash('cargo test'), failed, new Set(['bash']));
    const point = guard.after(bash('cargo test a'), failed, new Set(['bash']))!;
    expect(point.message).not.toContain('spawn_agent');
    expect(point.message).not.toContain('load_skill');
    expect(point.message).not.toContain('explore');
    expect(point.message).toContain('termine proprement');
  });

  it('les autres outils ne comptent pas', () => {
    const guard = new ProgressGuard({ failureThresholds: [1, 2] });
    const read = { id: 'r', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"a"}' } };
    expect(guard.after(read, failed, ALL)).toBeNull();
  });
});
