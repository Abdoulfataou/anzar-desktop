import { describe, expect, it, vi } from 'vitest';
import type { APIMessage } from '@/types';
import { runAgentEngine } from './agentSession';
import { BudgetLedger } from './budget';

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

describe('runAgentEngine — budget', () => {
  it('refuse l’étape suivante dès que le budget d’étapes est épuisé', async () => {
    const messages = [userMessage()];
    const budget = new BudgetLedger({ steps: 1 });
    const executeTool = vi.fn().mockResolvedValue({ output: 'résultat' });

    const result = await runAgentEngine({
      messages,
      budget,
      stream: () => stream({ tool_calls: [call('read_file')] }),
      executeTool,
    });

    expect(result.stopReason).toBe('budget_exhausted');
    expect(result.steps).toBe(1);
    expect(result.summary).toContain('Budget de cette demande atteint');
    // Une seule étape exécutée : le second appel modèle n'a pas eu lieu.
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(budget.usage().steps).toBe(1);
  });

  it('utilise le budget pour les étapes quand il en fournit', async () => {
    const messages = [userMessage()];
    const budget = new BudgetLedger({ steps: 3 });

    const result = await runAgentEngine({
      messages,
      budget,
      maxSteps: 40,
      stream: () => stream({ content: 'Bonjour' }),
      executeTool: vi.fn(),
    });

    expect(result.stopReason).toBe('final_answer');
    expect(budget.usage().steps).toBe(1);
  });

  it('s’arrête aussi sur un plafond de coût', async () => {
    const messages = [userMessage()];
    const budget = new BudgetLedger({ fcfa: 5 });
    budget.charge({ fcfa: 6 });

    const streamSpy = vi.fn(() => stream({ content: 'jamais' }));
    const result = await runAgentEngine({ messages, budget, stream: streamSpy, executeTool: vi.fn() });

    expect(result.stopReason).toBe('budget_exhausted');
    expect(result.steps).toBe(0);
    expect(streamSpy).not.toHaveBeenCalled();
  });
});

describe('runAgentEngine — boucles', () => {
  it('bloque un appel identique qui échoue et arrête si le modèle insiste', async () => {
    const messages = [userMessage()];
    const executeTool = vi.fn().mockResolvedValue({ output: 'échec', isError: true });

    const result = await runAgentEngine({
      messages,
      // Même outil, mêmes arguments à chaque étape.
      stream: () => stream({ tool_calls: [call('edit_file')] }),
      executeTool,
    });

    expect(result.stopReason).toBe('loop_detected');
    // Deux exécutions réelles, puis un blocage, puis l'arrêt.
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.summary).toContain('Boucle détectée');
  });

  it('arrête après une série d’échecs avec des arguments différents', async () => {
    let n = 0;
    const executeTool = vi.fn().mockResolvedValue({ output: 'échec', isError: true });
    const varying = () => ({
      index: 0,
      id: `c${n}`,
      type: 'function' as const,
      function: { name: 'read_file', arguments: JSON.stringify({ path: `fichier-${++n}.ts` }) },
    });

    const result = await runAgentEngine({
      messages: [userMessage()],
      // Comme le chat : le plafond d'erreurs du moteur est désactivé (le mode Auto escalade),
      // c'est la détection de boucle qui doit arrêter.
      maxConsecutiveErrors: 0,
      stream: () => stream({ tool_calls: [varying()] }),
      executeTool,
    });

    expect(result.stopReason).toBe('loop_detected');
    expect(executeTool).toHaveBeenCalledTimes(8);
    expect(result.summary).toContain('échecs');
  });

  it('laisse passer une répétition légitime sous le seuil', async () => {
    let n = 0;
    const executeTool = vi.fn().mockResolvedValue({ output: 'échec', isError: true });
    const result = await runAgentEngine({
      messages: [userMessage()],
      stream: () => stream(n++ < 2
        ? { tool_calls: [call('read_file', `c${n}`)] }
        : { content: 'Corrigé' }),
      executeTool,
    });

    expect(result.stopReason).toBe('final_answer');
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.summary).toBe('Corrigé');
  });
});
