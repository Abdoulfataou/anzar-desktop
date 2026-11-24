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

describe('LoopGuard — rappels, jamais de blocage', () => {
  it('ne rappelle rien avant le premier seuil', () => {
    const guard = new LoopGuard();
    const c = call('read_file', { path: 'a.ts' });
    expect(guard.after(c)).toBeNull();
    expect(guard.after(c)).toBeNull();
  });

  it('rappelle doucement au seuil 3, puis avec les arguments au seuil 5', () => {
    const guard = new LoopGuard();
    const c = call('read_file', { path: 'a.ts' });
    guard.after(c);
    guard.after(c);
    const first = guard.after(c);
    expect(first).toContain('même appel');
    expect(first).toContain('change d’approche'.replace('’', "'"));

    guard.after(c);
    const second = guard.after(c);
    expect(second).toContain('read_file');
    expect(second).toContain('5');
    expect(second).toContain('"path":"a.ts"');
  });

  it('rappelle aussi après des échecs répétés, sans jamais lever', () => {
    const guard = new LoopGuard();
    const c = call('edit_file', { path: 'a.ts', old_text: 'x', new_text: 'y' });
    for (let i = 0; i < 2; i++) expect(guard.after(c, { isError: true })).toBeNull();
    const reminder = guard.after(c, { isError: true });
    expect(reminder).not.toBeNull();
    expect(guard.consecutiveFailures).toBe(3);
  });

  it('change de chaîne dès que l’appel change', () => {
    const guard = new LoopGuard();
    const a = call('read_file', { path: 'a.ts' });
    guard.after(a);
    guard.after(a);
    // Un appel différent remet le compteur à un : pas de rappel.
    expect(guard.after(call('read_file', { path: 'b.ts' }))).toBeNull();
    expect(guard.after(a)).toBeNull();
  });

  it('reset() remet la chaîne à zéro après une consigne utilisateur', () => {
    const guard = new LoopGuard();
    const c = call('read_file', { path: 'a.ts' });
    guard.after(c);
    guard.after(c);
    guard.reset();
    expect(guard.after(c)).toBeNull();
  });

  it('borne l’aperçu des arguments sans changer la détection', () => {
    const guard = new LoopGuard({ thresholds: [2, 3], argumentsPreviewChars: 10 });
    const c = call('write_file', { path: 'a.ts', content: 'x'.repeat(5_000) });
    guard.after(c);
    guard.after(c);
    const reminder = guard.after(c);
    expect(reminder).toContain('caractères');
    expect(reminder!.length).toBeLessThan(1_000);
  });

  it('refuse une configuration de seuils invalide', () => {
    expect(() => new LoopGuard({ thresholds: [] })).toThrow();
    expect(() => new LoopGuard({ thresholds: [1] })).toThrow();
    expect(() => new LoopGuard({ thresholds: [3, 3] })).toThrow();
  });
});
