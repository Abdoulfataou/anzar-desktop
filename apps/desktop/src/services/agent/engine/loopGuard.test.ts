import { describe, expect, it } from 'vitest';
import type { ToolCall } from '@/types';
import { callSignature, LoopGuard } from './loopGuard';

const call = (name: string, args: Record<string, unknown> = {}, id = 'c1'): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

describe('callSignature', () => {
  it('ignore l’ordre des clés', () => {
    const a = call('read_file', { path: 'a.ts', offset: 1 });
    const b = call('read_file', { offset: 1, path: 'a.ts' });
    expect(callSignature(a).key).toBe(callSignature(b).key);
  });

  it('distingue des arguments différents', () => {
    expect(callSignature(call('read_file', { path: 'a.ts' })).key)
      .not.toBe(callSignature(call('read_file', { path: 'b.ts' })).key);
  });

  it('distingue les outils', () => {
    expect(callSignature(call('read_file', { path: 'a.ts' })).key)
      .not.toBe(callSignature(call('list_dir', { path: 'a.ts' })).key);
  });

  it('produit un aperçu lisible', () => {
    expect(callSignature(call('read_file', { path: 'src/App.tsx' })).preview).toBe('read_file(src/App.tsx)');
  });
});

describe('LoopGuard', () => {
  it('laisse passer les premiers appels identiques puis bloque', () => {
    const guard = new LoopGuard({ maxIdentical: 3 });
    const c = call('read_file', { path: 'a.ts' });
    for (let i = 0; i < 3; i++) {
      expect(guard.before(c).action).toBe('allow');
      guard.after(c, {});
    }
    const verdict = guard.before(c);
    expect(verdict.action).toBe('block');
    if (verdict.action === 'block') {
      expect(verdict.stop).toBe(false);
      expect(verdict.message).toContain('mêmes arguments');
      expect(verdict.message).toContain("Change d'approche");
    }
  });

  it('bloque plus tôt un appel qui échoue déjà deux fois', () => {
    const guard = new LoopGuard();
    const c = call('edit_file', { path: 'a.ts', old_text: 'x', new_text: 'y' });
    for (let i = 0; i < 2; i++) {
      expect(guard.before(c).action).toBe('allow');
      guard.after(c, { isError: true });
    }
    const verdict = guard.before(c);
    expect(verdict.action).toBe('block');
  });

  it('arrête la session quand le modèle insiste après un blocage', () => {
    const guard = new LoopGuard();
    const c = call('list_dir', { path: '.' });
    for (let i = 0; i < 3; i++) { guard.before(c); guard.after(c, {}); }
    const blocked = guard.before(c);
    expect(blocked.action).toBe('block');
    guard.onBlocked(c);
    const stop = guard.before(c);
    expect(stop.action).toBe('block');
    if (stop.action === 'block') expect(stop.stop).toBe(true);
  });

  it('arrête après une série d’échecs avec des arguments différents', () => {
    const guard = new LoopGuard({ maxConsecutiveFailures: 8 });
    for (let i = 0; i < 7; i++) {
      const c = call('read_file', { path: `a${i}.ts` });
      expect(guard.before(c).action).toBe('allow');
      guard.after(c, { isError: true });
    }
    expect(guard.exhausted()).toBe(false);
    guard.after(call('read_file', { path: 'a7.ts' }), { isError: true });
    expect(guard.exhausted()).toBe(true);
    expect(guard.stopMessage()).toContain('8 échecs');
  });

  it('remet le compteur d’échecs à zéro après un succès', () => {
    const guard = new LoopGuard({ maxConsecutiveFailures: 3 });
    guard.after(call('read_file', { path: 'a.ts' }), { isError: true });
    guard.after(call('read_file', { path: 'b.ts' }), { isError: true });
    guard.after(call('read_file', { path: 'c.ts' }), {});
    guard.after(call('read_file', { path: 'd.ts' }), { isError: true });
    expect(guard.exhausted()).toBe(false);
  });

  it('ne compte pas un blocage comme un appel exécuté', () => {
    const guard = new LoopGuard();
    const c = call('run_command', { command: 'npm test' });
    for (let i = 0; i < 3; i++) { guard.before(c); guard.after(c, { isError: true }); }
    guard.onBlocked(c);
    expect(guard.blockedCalls).toBe(1);
    // Trois échecs comptés + un blocage : la série continue de monter.
    expect(guard.consecutiveErrors).toBe(4);
  });

  it('laisse passer des appels différents', () => {
    const guard = new LoopGuard();
    expect(guard.before(call('read_file', { path: 'a.ts' })).action).toBe('allow');
    expect(guard.before(call('read_file', { path: 'b.ts' })).action).toBe('allow');
    expect(guard.before(call('list_dir', { path: '' })).action).toBe('allow');
  });
});
