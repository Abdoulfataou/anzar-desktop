import { describe, expect, it } from 'vitest';
import type { APIMessage } from '@/types';
import {
  closeDanglingToolCalls,
  compactHistory,
  historyChars,
  shrinkText,
  SMALL_RESULT_CHARS,
  SHRUNK_MARK,
} from './history';

const toolMsg = (id: string, content: string): APIMessage => ({
  role: 'tool',
  tool_call_id: id,
  content,
});

describe('history', () => {
  it('shrinkText ne touche pas un texte court et marque un texte long', () => {
    expect(shrinkText('court', 100)).toBe('court');
    const long = 'x'.repeat(500);
    const shrunk = shrinkText(long, 100);
    expect(shrunk.startsWith('x'.repeat(100))).toBe(true);
    expect(shrunk).toContain(SHRUNK_MARK);
  });

  it('compactHistory protège les derniers résultats et raccourcit les anciens', () => {
    const history: APIMessage[] = [
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'tâche' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    ];
    for (let i = 0; i < 5; i++) {
      history.push(toolMsg(`t${i}`, 'a'.repeat(SMALL_RESULT_CHARS + 100)));
    }
    // Les deux derniers résultats doivent rester intacts.
    history.push(toolMsg('recent-1', 'b'.repeat(SMALL_RESULT_CHARS + 100)));
    history.push(toolMsg('recent-2', 'c'.repeat(SMALL_RESULT_CHARS + 100)));

    compactHistory(history, 2, 80);

    expect((history[3].content as string)).toContain(SHRUNK_MARK);
    expect((history[3].content as string).length).toBeLessThan(SMALL_RESULT_CHARS);
    expect((history[history.length - 1].content as string)).toHaveLength(SMALL_RESULT_CHARS + 100);
    expect((history[history.length - 2].content as string)).toHaveLength(SMALL_RESULT_CHARS + 100);
  });

  it('compactHistory raccourcit les longs arguments des anciens appels', () => {
    const big = JSON.stringify({ path: 'a.ts', content: 'y'.repeat(2_000) });
    const history: APIMessage[] = [
      { role: 'system', content: 'S' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'write_file', arguments: big } }] },
      toolMsg('c', 'ok'),
      toolMsg('recent', 'z'.repeat(SMALL_RESULT_CHARS + 100)),
    ];

    compactHistory(history, 1, 100);
    const args = history[1].tool_calls?.[0].function.arguments || '';
    expect(args.length).toBeLessThan(big.length);
    expect(args).toContain('raccourci');
  });

  it('closeDanglingToolCalls répond aux appels sans résultat', () => {
    const history: APIMessage[] = [
      { role: 'assistant', content: null, tool_calls: [
        { id: 'a', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'list_dir', arguments: '{}' } },
      ] },
      toolMsg('a', 'résultat'),
    ];

    closeDanglingToolCalls(history);
    expect(history.filter((m) => m.role === 'tool')).toHaveLength(2);
    expect(history[history.length - 1].tool_call_id).toBe('b');
  });

  it('historyChars additionne contenu et tool_calls', () => {
    const history: APIMessage[] = [
      { role: 'system', content: '1234' },
      { role: 'assistant', content: 'ab', tool_calls: [{ id: 'x', type: 'function', function: { name: 'n', arguments: '{}' } }] },
    ];
    expect(historyChars(history)).toBeGreaterThan(6);
  });
});
