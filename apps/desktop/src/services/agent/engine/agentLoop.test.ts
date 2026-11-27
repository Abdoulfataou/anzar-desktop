import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from './agentLoop';

vi.mock('@/services/ai/ai', () => ({ aiService: { chatStream: vi.fn() } }));
vi.mock('@/services/runtime/terminal', () => ({
  terminalService: { gitIsRepo: vi.fn(), gitInit: vi.fn(), gitCommit: vi.fn() },
}));
vi.mock('../tools', () => {
  const def = (name: string) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });
  return {
    AGENT_TOOLS: [def('read_file'), def('run_command'), def('start_dev_server'), def('task_done')],
    BASH_TOOLS: [],
    POWERSHELL_TOOLS: [def('powershell'), def('job_output'), def('job_kill')],
    executeToolCall: vi.fn(),
  };
});
vi.mock('../context/agentPrompts', () => ({
  buildAgentSystemPrompt: () => 'SYSTEM',
  taskHintsSection: () => '',
  projectContextSections: () => ['# Projet\nNom : projet'],
}));
vi.mock('../verify/agentVerifier', () => ({ runVerification: vi.fn() }));
vi.mock('../context/agentContext', () => ({ buildAgentContext: vi.fn() }));

import { aiService } from '@/services/ai/ai';
import { executeToolCall } from '../tools';
import { runVerification } from '../verify/agentVerifier';
import { runAgentSession } from './agentLoop';
import { BudgetLedger } from './budget';

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

describe('runAgentSession — budget du sous-agent', () => {
  it('charge tokens et coût dans l’enveloppe fournie', async () => {
    chatStream.mockReturnValueOnce(
      stream({ content: 'Terminé' }, { serverCostFCFA: 3 }) as any,
    );
    const budget = new BudgetLedger({ fcfa: 50 });

    const result = await runAgentSession({ ...baseOptions, budget });

    expect(result.stopReason).toBe('final_answer');
    expect(budget.usage().fcfa).toBe(3);
    expect(budget.usage().tokensOut).toBeGreaterThan(0);
    expect(budget.usage().tokensIn).toBeGreaterThan(0);
  });

  it('s’arrête quand l’enveloppe est épuisée', async () => {
    chatStream.mockReturnValue(stream({ tool_calls: [toolCall('read_file')] }) as any);
    execTool.mockResolvedValue({ output: 'ok' } as any);
    const budget = new BudgetLedger({ fcfa: 1 });
    budget.charge({ fcfa: 2 });

    const result = await runAgentSession({ ...baseOptions, budget });

    expect(result.stopReason).toBe('budget_exhausted');
    expect(chatStream).not.toHaveBeenCalled();
  });

  it('sous-agent : consignes dédiées, skills listées et load_skill exécuté sur place', async () => {
    chatStream
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('load_skill', { name: 'tdd' })] }) as any)
      .mockReturnValueOnce(stream({ content: 'Fini' }) as any);
    const skill = { name: 'tdd', description: 'Tests d’abord', body: 'Cycle rouge, vert, nettoyage.', source: 'builtin' as const, origin: 'ANZAR', files: [] as string[], editable: false };

    const result = await runAgentSession({
      ...baseOptions,
      subagentRole: 'dev',
      permissionMode: 'auto',
      skills: [skill],
      allowedTools: new Set(['read_file', 'task_done']),
    });

    const [messages, opts] = chatStream.mock.calls[0] as any[];
    expect(messages[0].content).toContain("Tu es un sous-agent d'ANZAR, rôle « dev »");
    expect(messages[0].content).toContain('- tdd : Tests d’abord');
    expect(messages[0].content).not.toContain('SYSTEM');
    expect(opts.tools.map((t: any) => t.function.name)).toEqual(['read_file', 'task_done', 'load_skill']);
    expect(execTool).not.toHaveBeenCalled();
    const toolMessage = result.messages.find((m) => m.role === 'tool');
    expect(String(toolMessage?.content)).toContain('Cycle rouge, vert, nettoyage.');
    expect(result.stopReason).toBe('final_answer');
  });

  it('Windows hors Accès complet : pas de commandes proposées à une session sans écran d’accord', async () => {
    const platform = navigator.platform;
    const ua = navigator.userAgent;
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });
    try {
      const toolNames = async (permissionMode: 'auto' | 'full') => {
        chatStream.mockReturnValueOnce(stream({ content: 'ok' }) as any);
        await runAgentSession({ ...baseOptions, subagentRole: 'dev', permissionMode });
        const opts = chatStream.mock.calls.at(-1)![1] as any;
        return opts.tools.map((t: any) => t.function.name);
      };
      expect(await toolNames('auto')).toEqual(['read_file', 'task_done']);
      expect(await toolNames('full')).toEqual(['read_file', 'run_command', 'start_dev_server', 'task_done', 'powershell', 'job_output', 'job_kill']);
      const prompt = (chatStream.mock.calls[0] as any[])[0][0].content as string;
      expect(prompt).toContain('Sur cet ordinateur (Windows), tes commandes sont refusées');
    } finally {
      Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
      Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    }
  });

  it('transmet le mode du parent aux outils de la session', async () => {
    chatStream
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('read_file', { path: 'a.ts' })] }) as any)
      .mockReturnValueOnce(stream({ content: 'Fini' }) as any);
    execTool.mockResolvedValue({ output: 'contenu' });
    await runAgentSession({ ...baseOptions, permissionMode: 'full' });
    expect(execTool.mock.calls[0][1].permissionMode).toBe('full');
  });
});
