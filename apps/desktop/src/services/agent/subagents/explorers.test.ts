import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatStream = vi.fn();
vi.mock('@/services/ai/ai', () => ({ aiService: { chatStream: (...a: unknown[]) => chatStream(...a) } }));
vi.mock('../context/agentContext', () => ({ buildAgentContext: vi.fn(async () => ({ codeMap: '', memory: '' })) }));
const readFile = vi.fn(async () => ({ output: 'export const x = 1;' }));
vi.mock('../tools/fsTools', () => ({
  execReadFile: (...a: unknown[]) => readFile(...(a as [])),
  execListDir: vi.fn(),
  execSearchFiles: vi.fn(),
  execGetDiagnostics: vi.fn(),
}));

import { exploreInParallel } from './explorers';

function stream(deltas: object[]) {
  return (async function* () { for (const d of deltas) yield d; })();
}

describe('exploreInParallel', () => {
  beforeEach(() => { chatStream.mockReset(); readFile.mockClear(); });

  it('lit un fichier puis rend le résumé du modèle', async () => {
    chatStream
      .mockReturnValueOnce(stream([{ tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] }, { serverCostFCFA: 2 }]))
      .mockReturnValueOnce(stream([{ content: 'x vaut 1 (a.ts:1).' }, { serverCostFCFA: 1 }]));
    const { results, costFCFA } = await exploreInParallel(['Que vaut x ?'], { projectRoot: '/p' });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ ok: true, summary: 'x vaut 1 (a.ts:1).' });
    expect(costFCFA).toBe(3);
  });

  it("refuse un outil d'écriture", async () => {
    chatStream
      .mockReturnValueOnce(stream([{ tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{}' } }] }]))
      .mockReturnValueOnce(stream([{ content: 'Impossible.' }]));
    const { results } = await exploreInParallel(['Écris'], { projectRoot: '/p' });
    const secondCall = chatStream.mock.calls[1][0] as { role: string; content: string }[];
    expect(secondCall.find((m) => m.role === 'tool')?.content).toMatch(/non autorisé|lecture seule/);
    expect(results[0].ok).toBe(true);
  });
});
