import { describe, expect, it } from 'vitest';
import { runAgentEngine } from './agentSession';
import type { StreamDelta } from '@/types';

/**
 * Un modèle qui appelle un outil qui échoue, avec des arguments différents à chaque fois.
 * Les arguments varient pour rester sur le chemin `maxConsecutiveErrors` : un appel
 * strictement identique serait arrêté avant par la détection de boucle (ses tests propres
 * sont dans `loopGuard.test.ts`).
 */
function failingCallFactory() {
  let n = 0;
  return async function* failingCall(): AsyncGenerator<StreamDelta, void, undefined> {
    n += 1;
    yield { tool_calls: [{ index: 0, id: `c${n}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: `f${n}.ts` }) } } as any] };
  };
}

describe('runAgentEngine — erreurs consécutives', () => {
  it("s'arrête exactement au seuil annoncé", async () => {
    let calls = 0;
    const r = await runAgentEngine({
      messages: [{ role: 'user', content: 'go' }],
      maxSteps: 20,
      maxConsecutiveErrors: 4,
      stream: failingCallFactory(),
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
      stream: failingCallFactory(),
      executeTool: async () => ({ output: 'boom', isError: true }),
    });
    expect(r.stopReason).toBe('max_steps');
  });
});
