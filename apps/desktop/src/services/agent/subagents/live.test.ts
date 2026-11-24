import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentLoopOptions, AgentSessionResult } from '../engine/agentLoop';
import {
  clearLiveAgents, listLiveAgents, resolveLiveAgent, sendToLiveAgent, spawnLiveAgent, waitForLiveAgent,
} from './live';

const result = (opts: AgentLoopOptions, summary: string): AgentSessionResult => ({
  stopReason: 'final_answer',
  summary,
  steps: 2,
  messages: [
    { role: 'system', content: 'SYSTEM' },
    ...(opts.history || []),
    { role: 'assistant', content: summary },
  ] as AgentSessionResult['messages'],
  filesChanged: [],
});

const context = (runSubagent: any, convId = 'conv-live') => ({
  convId,
  projectRoot: '/tmp/projet',
  permissionMode: 'full' as const,
  subagentDepth: 0,
  signal: new AbortController().signal,
  runSubagent,
  childBudget: () => undefined,
  onFileChanged: vi.fn(),
}) as any;

afterEach(() => clearLiveAgents());

describe('sous-agents vivants', () => {
  it('lance, attend, reprend avec l’historique et liste', async () => {
    const calls: AgentLoopOptions[] = [];
    const runSubagent = vi.fn(async (opts: AgentLoopOptions) => {
      calls.push(opts);
      return result(opts, `fait: ${opts.task}`);
    });
    const ctx = context(runSubagent);

    const spawned = spawnLiveAgent(ctx, 'explore le module panier');
    expect(spawned.error).toBeUndefined();
    const agent = spawned.agent!;
    expect(agent.status).toBe('running');
    expect(agent.name).toMatch(/^agent-\d+$/);

    await waitForLiveAgent(agent, 1_000);
    expect(agent.status).toBe('idle');
    expect(agent.summary).toContain('explore le module panier');
    expect(calls[0].history).toEqual([]);

    const sent = sendToLiveAgent(ctx, agent.name, 'maintenant corrige le test');
    expect(sent.error).toBeUndefined();
    await waitForLiveAgent(agent, 1_000);

    expect(runSubagent).toHaveBeenCalledTimes(2);
    expect(calls[1].history?.some((m) => m.role === 'assistant')).toBe(true);
    expect(calls[1].task).toBe('maintenant corrige le test');
    expect(listLiveAgents('conv-live')).toHaveLength(1);
    expect(resolveLiveAgent('conv-live', agent.name)?.id).toBe(agent.id);
  });

  it('refuse au-delà de 8 enfants actifs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runSubagent = vi.fn(async (opts: AgentLoopOptions) => {
      await gate;
      return result(opts, 'ok');
    });
    const ctx = context(runSubagent);

    const agents = Array.from({ length: 8 }, (_, i) => spawnLiveAgent(ctx, `tâche ${i}`).agent!);
    expect(agents).toHaveLength(8);
    const ninth = spawnLiveAgent(ctx, 'trop');
    expect(ninth.error).toContain('8');
    release();
    await Promise.all(agents.map((a) => waitForLiveAgent(a, 1_000)));
  });

  it('refuse la récursion et les noms invalides', () => {
    const ctx = context(vi.fn());
    expect(spawnLiveAgent({ ...ctx, subagentDepth: 1 }, 'x').error).toContain('Profondeur');
    expect(spawnLiveAgent(ctx, 'x', undefined, 'Lead').error).toContain('invalide');
    expect(spawnLiveAgent(ctx, 'x', undefined, 'bad name').error).toContain('invalide');
  });
});
