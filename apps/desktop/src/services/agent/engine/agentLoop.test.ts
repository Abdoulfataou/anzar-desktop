import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from './agentLoop';

vi.mock('@/services/ai/ai', () => ({ aiService: { chatStream: vi.fn() } }));
vi.mock('@/services/runtime/terminal', () => ({
  terminalService: { gitIsRepo: vi.fn(), gitInit: vi.fn(), gitCommit: vi.fn() },
}));
vi.mock('../tools', () => ({ AGENT_TOOLS: [], executeToolCall: vi.fn() }));
vi.mock('../context/agentPrompts', () => ({
  buildAgentSystemPrompt: () => 'SYSTEM',
  taskHintsSection: () => '',
}));
vi.mock('../verify/agentVerifier', () => ({ runVerification: vi.fn() }));
vi.mock('../context/agentContext', () => ({ buildAgentContext: vi.fn() }));

import { aiService } from '@/services/ai/ai';
import { executeToolCall } from '../tools';
import { runVerification } from '../verify/agentVerifier';
import { runAgentSession } from './agentLoop';

const chatStream = vi.mocked(aiService.chatStream);
const execTool = vi.mocked(executeToolCall);
const verify = vi.mocked(runVerification);

async function* stream(...deltas: any[]) {
  for (const delta of deltas) yield delta;
}

const baseOptions = {
  prompt: { projectName: 'projet', projectRoot: '/tmp/projet', codeMap: 'carte' },
  task: 'Tâche de test',
  gitCheckpoint: false,
  model: 'fast' as const,
};

const toolCall = (name: string, args: Record<string, unknown> = {}, id = 'c1') => ({
  index: 0,
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

beforeEach(() => {
  chatStream.mockReset();
  execTool.mockReset();
  verify.mockReset();
});

describe('runAgentSession', () => {
  it('termine sur une réponse texte sans outil', async () => {
    chatStream.mockReturnValueOnce(stream({ content: 'Bonjour' }) as any);
    const events: AgentEvent[] = [];

    const result = await runAgentSession({ ...baseOptions, onEvent: (e) => events.push(e) });

    expect(result.stopReason).toBe('final_answer');
    expect(result.summary).toBe('Bonjour');
    expect(events.some((e) => e.type === 'text' && e.content === 'Bonjour')).toBe(true);
    expect(execTool).not.toHaveBeenCalled();
  });

  it('ne lance pas la vérification par défaut', async () => {
    chatStream.mockReturnValueOnce(stream({ tool_calls: [toolCall('task_done')] }) as any);
    execTool.mockResolvedValue({ output: 'terminé', isDone: true });
    verify.mockResolvedValue({ passed: true, nothingToVerify: false, results: [], failureSummary: '' });

    const result = await runAgentSession({ ...baseOptions });

    expect(result.stopReason).toBe('task_done');
    expect(verify).not.toHaveBeenCalled();
  });

  it('refuse un outil non autorisé dans une session restreinte', async () => {
    chatStream
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('write_file', { path: 'a.ts', content: 'x' })] }) as any)
      .mockReturnValueOnce(stream({ content: 'Fini' }) as any);

    const result = await runAgentSession({ ...baseOptions, allowedTools: new Set(['read_file']) });

    expect(execTool).not.toHaveBeenCalled();
    expect(result.messages.some((m) => m.role === 'tool' && String(m.content).includes('non autorisé'))).toBe(true);
  });

  it('exécute un tool_call puis réinjecte son résultat', async () => {
    chatStream
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('read_file', { path: 'a.ts' })] }) as any)
      .mockReturnValueOnce(stream({ content: 'Fini' }) as any);
    execTool.mockResolvedValue({ output: 'contenu du fichier' });

    const result = await runAgentSession({ ...baseOptions });

    expect(execTool).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('final_answer');
    expect(result.summary).toBe('Fini');
    expect(result.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'c1')).toBe(true);
  });

  it('accepte task_done quand la vérification passe', async () => {
    chatStream.mockReturnValueOnce(stream({ tool_calls: [toolCall('task_done', { summary: 'résumé' })] }) as any);
    execTool.mockImplementation(async (_call, ctx) => {
      ctx.onFileChanged?.('a.ts', 'x', 'edit');
      return { output: 'résumé', isDone: true };
    });
    verify.mockResolvedValue({ passed: true, nothingToVerify: false, results: [], failureSummary: '' });

    const result = await runAgentSession({ ...baseOptions, autoVerify: true });

    expect(verify).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('task_done');
    expect(result.summary).toBe('résumé');
  });

  it('refuse task_done et s’arrête après maxVerifyAttempts', async () => {
    chatStream.mockReturnValueOnce(stream({ tool_calls: [toolCall('task_done', { summary: 'faux' })] }) as any);
    execTool.mockImplementation(async (_call, ctx) => {
      ctx.onFileChanged?.('a.ts', 'x', 'edit');
      return { output: 'faux', isDone: true };
    });
    verify.mockResolvedValue({ passed: false, nothingToVerify: false, results: [], failureSummary: 'ERREUR BUILD' });

    const result = await runAgentSession({ ...baseOptions, autoVerify: true, maxVerifyAttempts: 1 });

    expect(result.stopReason).toBe('verify_failed');
    expect(result.summary).toContain('ERREUR BUILD');
  });

  it('s’arrête au budget d’étapes', async () => {
    chatStream.mockReturnValue(stream({ tool_calls: [toolCall('read_file')] }) as any);
    execTool.mockResolvedValue({ output: 'ok' });

    const result = await runAgentSession({ ...baseOptions, maxSteps: 1 });

    expect(result.stopReason).toBe('max_steps');
    expect(chatStream).toHaveBeenCalledTimes(1);
  });

  it('respecte une annulation immédiate', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runAgentSession({ ...baseOptions, signal: controller.signal });

    expect(result.stopReason).toBe('aborted');
    expect(chatStream).not.toHaveBeenCalled();
  });
});
