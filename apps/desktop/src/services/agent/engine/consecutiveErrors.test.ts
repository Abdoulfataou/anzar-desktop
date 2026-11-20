import { describe, expect, it } from 'vitest';
import { runAgentEngine } from './agentSession';
import type { StreamDelta } from '@/types';

/** Un modèle qui appelle toujours un outil qui échoue. */
async function* failingCall(): AsyncGenerator<StreamDelta, void, undefined> {
  yield { tool_calls: [{ index: 0, id: `c${Math.random()}`, type: 'function', function: { name: 'read_file', arguments: '{}' } } as any] };
}

describe('runAgentEngine — erreurs consécutives', () => {
  it("s'arrête exactement au seuil annoncé", async () => {
    let calls = 0;
    const r = await runAgentEngine({
      messages: [{ role: 'user', content: 'go' }],
      maxSteps: 20,
      maxConsecutiveErrors: 4,
      stream: failingCall,
      executeTool: async () => { calls++; return { output: 'boom', isError: true }; },
    });
    expect(r.stopReason).toBe('error');
    expect(calls).toBe(4);
  });

  it('0 désactive le plafond', async () => {
    const r = await runAgentEngine({
      messages: [{ role: 'user', content: 'go' }],
      maxSteps: 6,
      maxConsecutiveErrors: 0,
      stream: failingCall,
      executeTool: async () => ({ output: 'boom', isError: true }),
    });
    expect(r.stopReason).toBe('max_steps');
  });
});
