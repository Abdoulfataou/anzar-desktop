import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentLoopOptions, AgentSessionResult } from '../engine/agentLoop';
import { clearLiveAgents, resetLiveRegistryForTests } from './live';
import { execSpawnAgent, execWaitAgent } from './liveTools';

const result = (opts: AgentLoopOptions, summary: string): AgentSessionResult => ({
  stopReason: 'final_answer',
  summary,
  steps: 1,
  messages: [{ role: 'assistant', content: summary }] as AgentSessionResult['messages'],
  filesChanged: [],
});

const context = (runSubagent: any) => ({
  convId: 'conv-tools',
  projectRoot: '/tmp/projet',
  permissionMode: 'auto' as const,
  subagentDepth: 0,
  signal: new AbortController().signal,
  runSubagent,
  childBudget: () => undefined,
  onFileChanged: vi.fn(),
}) as any;

afterEach(() => { clearLiveAgents(); resetLiveRegistryForTests(); });

describe('wait_agent', () => {
  it('attend plusieurs sous-agents en un appel et rassemble leurs résumés', async () => {
    const runSubagent = vi.fn(async (opts: AgentLoopOptions) => {
      await new Promise((r) => setTimeout(r, opts.task.includes('lent') ? 30 : 5));
      return result(opts, `fait: ${opts.task}`);
    });
    const ctx = context(runSubagent);
    await execSpawnAgent({ task: 'page panier', name: 'panier' }, ctx);
    await execSpawnAgent({ task: 'page compte (lent)', name: 'compte' }, ctx);

    const r = await execWaitAgent({ agents: ['panier', 'compte', 'panier'] }, ctx);
    expect(r.isError).toBeFalsy();
    expect(r.output).toContain('fait: page panier');
    expect(r.output).toContain('fait: page compte (lent)');
    expect(r.output).toContain('cohérence de l\'ensemble');
    expect(runSubagent).toHaveBeenCalledTimes(2);
  });

  it('garde la forme à un seul sous-agent et signale un nom inconnu', async () => {
    const ctx = context(vi.fn(async (opts: AgentLoopOptions) => result(opts, 'ok')));
    await execSpawnAgent({ task: 'une tâche', name: 'seul' }, ctx);
    const one = await execWaitAgent({ agent: 'seul' }, ctx);
    expect(one.output).toMatch(/^seul — /);
    expect(one.output).not.toContain('cohérence');
    const unknown = await execWaitAgent({ agents: ['seul', 'fantome'] }, ctx);
    expect(unknown.isError).toBe(true);
    expect(unknown.output).toContain('fantome');
    expect((await execWaitAgent({}, ctx)).isError).toBe(true);
  });
});
