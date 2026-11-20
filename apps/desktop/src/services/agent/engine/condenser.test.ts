import { describe, expect, it, vi } from 'vitest';
import { CONDENSED_MARK, condenseHistory, cutIndex, transcript } from './condenser';
import type { APIMessage } from '@/types';

function session(turns: number): APIMessage[] {
  const m: APIMessage[] = [{ role: 'system', content: 'SYSTEM' }];
  for (let i = 0; i < turns; i++) {
    m.push({ role: 'user', content: `Demande ${i}` });
    m.push({ role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: `{"path":"f${i}.ts"}` } }] });
    m.push({ role: 'tool', tool_call_id: `c${i}`, content: 'x'.repeat(5_000) });
    m.push({ role: 'assistant', content: `Fait ${i}` });
  }
  return m;
}

/** Chaque tool_call doit avoir sa réponse juste après, sinon l'API refuse l'historique. */
function valid(messages: APIMessage[]): boolean {
  for (let i = 0; i < messages.length; i++) {
    const calls = messages[i].tool_calls || [];
    const answered = new Set(messages.slice(i + 1, i + 1 + calls.length).map((m) => m.tool_call_id));
    if (calls.some((c) => !answered.has(c.id))) return false;
    if (messages[i].role === 'tool' && !messages.slice(0, i).some((m) => m.tool_calls?.some((c) => c.id === messages[i].tool_call_id))) return false;
  }
  return true;
}

describe('condenser', () => {
  it('remplace le début par un résumé, garde le récent et un historique valide', async () => {
    const m = session(10);
    const summarize = vi.fn(async () => '## Demandes\nAjouter un panier');
    expect(await condenseHistory(m, { keepRecent: 8, summarize })).toBe(true);
    expect(m[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(m[1].role).toBe('user');
    expect(String(m[1].content)).toContain(CONDENSED_MARK);
    expect(String(m[1].content)).toContain('Ajouter un panier');
    expect(m.length).toBeLessThan(session(10).length);
    expect(m[m.length - 1]).toEqual({ role: 'assistant', content: 'Fait 9' });
    expect(valid(m)).toBe(true);
  });

  it("ne touche à rien si le résumé échoue ou s'il n'y a rien à résumer", async () => {
    const m = session(10);
    const before = JSON.stringify(m);
    expect(await condenseHistory(m, { summarize: async () => { throw new Error('402'); } })).toBe(false);
    expect(JSON.stringify(m)).toBe(before);
    const short = session(1);
    expect(await condenseHistory(short, { keepRecent: 12, summarize: async () => 'x' })).toBe(false);
  });

  it('ne coupe jamais entre un appel d’outil et sa réponse', () => {
    const m = session(6);
    const cut = cutIndex(m, 5);
    expect(m[cut].role).toBe('user');
  });

  it('la transcription garde les outils, tronque les longs résultats et reste bornée', () => {
    const t = transcript(session(40).slice(1));
    expect(t).toContain('OUTIL read_file({"path":"f0.ts"})');
    expect(t).toContain('[5000 caractères]');
    expect(t.length).toBeLessThan(125_000);
  });
});
