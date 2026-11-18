import { describe, expect, it, vi } from 'vitest';
import type { APIMessage } from '@/types';
import { runAgentEngine } from './agentSession';

async function* stream(...deltas: any[]) {
  for (const delta of deltas) yield delta;
}

const userMessage = (content = 'Tâche'): APIMessage => ({ role: 'user', content });
const call = (name: string, id = 'c1') => ({
  index: 0,
  id,
  type: 'function' as const,
  function: { name, arguments: '{}' },
});

describe('runAgentEngine', () => {
  it('termine une réponse texte et ajoute le message assistant', async () => {
    const messages = [userMessage()];
    const result = await runAgentEngine({
      messages,
      stream: () => stream({ content: 'Bonjour' }),
      executeTool: vi.fn(),
    });

    expect(result.stopReason).toBe('final_answer');
    expect(result.summary).toBe('Bonjour');
    expect(messages[messages.length - 1]).toEqual({ role: 'assistant', content: 'Bonjour' });
  });

  it('exécute un outil et boucle', async () => {
    const messages = [userMessage()];
    const executeTool = vi.fn().mockResolvedValue({ output: 'résultat' });
    let callIndex = 0;

    const result = await runAgentEngine({
      messages,
      stream: () => (callIndex++ === 0
        ? stream({ tool_calls: [call('read_file')] })
        : stream({ content: 'Fini' })),
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('final_answer');
    expect(messages.some((m) => m.role === 'tool' && m.tool_call_id === 'c1')).toBe(true);
  });

  it('s’arrête sur un plan sans vérification', async () => {
    const messages = [userMessage()];
    const result = await runAgentEngine({
      messages,
      stream: () => stream({ tool_calls: [call('propose_plan')] }),
      executeTool: vi.fn().mockResolvedValue({ output: 'plan', stop: 'plan' }),
    });

    expect(result.stopReason).toBe('plan');
    expect(result.summary).toBe('plan');
  });

  it('gate task_done par la vérification et refuse une fois', async () => {
    const messages = [userMessage()];
    const verify = vi.fn()
      .mockResolvedValueOnce({ passed: false, failureSummary: 'ERREUR' })
      .mockResolvedValueOnce({ passed: true, failureSummary: '' });
    let callIndex = 0;

    const result = await runAgentEngine({
      messages,
      maxVerifyAttempts: 2,
      stream: () => (callIndex++ === 0
        ? stream({ tool_calls: [call('task_done')] })
        : stream({ tool_calls: [call('task_done', 'c2')] })),
      executeTool: vi.fn().mockResolvedValue({ output: 'terminé', isDone: true }),
      verify,
      shouldVerify: () => true,
    });

    expect(verify).toHaveBeenCalledTimes(2);
    expect(result.stopReason).toBe('task_done');
    expect(messages.some((m) => m.role === 'user' && String(m.content).includes('REFUSÉ'))).toBe(true);
  });

  it('ajoute une relance quand des fichiers ont changé sans task_done', async () => {
    const messages = [userMessage()];
    let callIndex = 0;
    const onToolBatchEnd = vi.fn();

    const result = await runAgentEngine({
      messages,
      stream: () => (callIndex++ === 0 ? stream({ content: 'fait' }) : stream({ content: 'terminé' })),
      executeTool: vi.fn(),
      shouldNudge: () => true,
      nudgeMessage: 'Appelle task_done.',
      onToolBatchEnd,
    });

    expect(callIndex).toBe(2);
    expect(result.stopReason).toBe('final_answer');
    expect(messages.some((m) => m.role === 'user' && m.content === 'Appelle task_done.')).toBe(true);
  });

  it('réessaie une étape coupée', async () => {
    const messages = [userMessage()];
    let callIndex = 0;
    const onRetry = vi.fn();

    const result = await runAgentEngine({
      messages,
      stream: () => {
        if (callIndex++ === 0) throw new Error('réseau');
        return stream({ content: 'OK' });
      },
      executeTool: vi.fn(),
      retry: { attempts: 1, delayMs: () => 0, isRetryable: () => true },
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('final_answer');
    expect(result.summary).toBe('OK');
  });

  it('s’arrête au budget d’étapes', async () => {
    const messages = [userMessage()];
    const result = await runAgentEngine({
      messages,
      maxSteps: 1,
      stream: () => stream({ tool_calls: [call('read_file')] }),
      executeTool: vi.fn().mockResolvedValue({ output: 'ok' }),
    });

    expect(result.stopReason).toBe('max_steps');
    expect(result.steps).toBe(1);
  });

  it('respecte une annulation avant le premier appel', async () => {
    const controller = new AbortController();
    controller.abort();
    const streamFn = vi.fn();

    const result = await runAgentEngine({
      messages: [userMessage()],
      signal: controller.signal,
      stream: streamFn,
      executeTool: vi.fn(),
    });

    expect(result.stopReason).toBe('aborted');
    expect(streamFn).not.toHaveBeenCalled();
  });
});
