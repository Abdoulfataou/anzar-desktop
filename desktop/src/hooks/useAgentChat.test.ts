import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ai/ai', () => ({
  aiService: { chatStream: vi.fn() },
  markSlowNetwork: vi.fn(),
}));
vi.mock('@/services/agent/agentTools', () => ({
  AGENT_TOOLS: [
    { type: 'function', function: { name: 'write_file', description: '', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'read_file', description: '', parameters: { type: 'object', properties: {} } } },
  ],
  executeToolCall: vi.fn(),
}));
vi.mock('@/services/agent/webTools', () => ({
  WEB_TOOLS: [],
  WEB_TOOL_NAMES: new Set(),
  executeWebTool: vi.fn(),
}));
vi.mock('@/services/agent/agentPrompts', () => ({
  buildAgentSystemPrompt: () => 'SYSTEM',
  memorySection: () => '',
  FORMATTING_GUIDE: '',
  VISUALS_GUIDE: '',
  CONNECTORS_GUIDE: '',
}));
vi.mock('@/services/agent/agentContext', () => ({
  buildAgentContext: vi.fn().mockResolvedValue({ codeMap: '', taskHints: '', memory: undefined }),
}));
vi.mock('@/services/agent/commandGuard', () => ({
  commandRisk: vi.fn().mockResolvedValue(null),
  noteAgentWrite: vi.fn(),
}));
vi.mock('@/services/personalInstructions', () => ({
  loadPersonalInstructions: vi.fn().mockResolvedValue(''),
  personalInstructionsSection: () => '',
}));
vi.mock('@/services/agent/fileChanges', () => ({
  snapshotBeforeChange: vi.fn(),
  collectChanges: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/attachmentFiles', () => ({
  copyAttachmentsToWorkspace: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/personalSpace', () => ({
  PERSONAL_SPACE_TOOLS: new Set(),
  PERSONAL_SUBDIR: 'ANZAR',
  conversationUsesPersonalSpace: () => false,
  ensurePersonalSpace: vi.fn().mockResolvedValue('/tmp/anzar'),
  personalSpaceContext: () => '',
}));
vi.mock('@/services/mcp/manager', () => ({
  mcpAgentTools: vi.fn().mockResolvedValue([]),
  isMcpTool: () => false,
  mcpToolRef: () => undefined,
  mcpNeedsApproval: () => false,
  callMcpTool: vi.fn(),
  setMcpRoots: vi.fn(),
}));
vi.mock('@/services/skills', () => ({
  listSkills: vi.fn().mockResolvedValue([]),
  skillsPromptSection: () => '',
  findSkill: vi.fn(),
  readSkillFile: vi.fn(),
  skillToolOutput: vi.fn(),
}));
vi.mock('@/services/agent/devServer', () => ({
  detectDevCommand: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/credits', () => ({
  refreshCredits: vi.fn().mockResolvedValue(0),
  LOW_BALANCE_FCFA: 100,
}));

import { aiService } from '@/services/ai/ai';
import { copyAttachmentsToWorkspace } from '@/services/attachmentFiles';
import { noteAgentWrite } from '@/services/agent/commandGuard';
import { executeToolCall } from '@/services/agent/agentTools';
import { useAgentChat } from './useAgentChat';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';

async function* stream(...deltas: any[]) {
  for (const delta of deltas) yield delta;
}

const toolCall = (name: string, args: Record<string, unknown>, id = 'c1') => ({
  index: 0,
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(aiService.chatStream).mockReset();
  vi.mocked(executeToolCall).mockReset();
  vi.mocked(copyAttachmentsToWorkspace).mockResolvedValue([]);
  vi.mocked(noteAgentWrite).mockResolvedValue(undefined);
  localStorage.clear();
  useChatStore.setState({ conversations: [], activeConversationId: null, isGenerating: false });
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.setState({
    authToken: 'test-token',
    settings: { ...settings, model: 'fast', webTools: false },
  });
});

const renderChat = (permissionMode: 'ask' | 'plan' | 'full' = 'full') =>
  renderHook(() => useAgentChat({
    workspacePath: '/tmp/projet',
    workspaceName: 'projet',
    model: 'fast',
    permissionMode,
  }));

describe('useAgentChat — parcours agent', () => {
  it('envoie une demande et enregistre la réponse finale', async () => {
    vi.mocked(aiService.chatStream).mockReturnValueOnce(stream({ content: 'Bonjour' }) as any);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Fais quelque chose');
    });

    const conversation = useChatStore.getState().getActiveConversation();
    const last = conversation?.messages[conversation.messages.length - 1];
    expect(last?.content).toContain('Bonjour');
    expect(last?.isError).toBeFalsy();
    expect(result.current.isGenerating).toBe(false);
  });

  it('demande l’accord puis exécute write_file en mode ask', async () => {
    vi.mocked(aiService.chatStream)
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('write_file', { path: 'a.ts', content: 'x' })] }) as any)
      .mockReturnValueOnce(stream({ content: 'Terminé' }) as any);
    vi.mocked(executeToolCall).mockResolvedValue({ output: 'fichier écrit' } as any);
    const { result } = renderChat('ask');

    let send!: Promise<void>;
    act(() => { send = result.current.sendMessage('Écris un fichier'); });

    await waitFor(() => expect(result.current.approval?.name).toBe('write_file'));
    act(() => result.current.resolveApproval(true));
    await act(async () => { await send; });

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    const conversation = useChatStore.getState().getActiveConversation();
    expect(conversation?.messages.at(-1)?.content).toContain('Terminé');
  });

  it('pose une question à l’utilisateur puis reprend le tour', async () => {
    vi.mocked(aiService.chatStream)
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('ask_user', {
        questions: [{ question: 'Quelle couleur ?', options: [{ label: 'Bleu' }, { label: 'Rouge' }] }],
      })] }) as any)
      .mockReturnValueOnce(stream({ content: 'Bleu choisi' }) as any);
    const { result } = renderChat('full');

    let send!: Promise<void>;
    act(() => { send = result.current.sendMessage('Choisis une couleur'); });

    await waitFor(() => expect(result.current.question?.questions[0].question).toBe('Quelle couleur ?'));
    act(() => result.current.resolveQuestion([{ question: 'Quelle couleur ?', selected: ['Bleu'] }]));
    await act(async () => { await send; });

    expect(executeToolCall).not.toHaveBeenCalled();
    const conversation = useChatStore.getState().getActiveConversation();
    expect(conversation?.messages.at(-1)?.content).toContain('Bleu choisi');
  });

  it('propose un plan et s’arrête sans exécuter d’outil', async () => {
    vi.mocked(aiService.chatStream).mockReturnValueOnce(stream({
      tool_calls: [toolCall('propose_plan', { title: 'Plan de test', plan: '## Étape 1' })],
    }) as any);
    const { result } = renderChat('plan');

    await act(async () => {
      await result.current.sendMessage('Propose un plan');
    });

    expect(executeToolCall).not.toHaveBeenCalled();
    const conversation = useChatStore.getState().getActiveConversation();
    expect(conversation?.messages.at(-1)?.plan?.title).toBe('Plan de test');
  });

  it('annule une génération en cours et marque la réponse interrompue', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(aiService.chatStream).mockReturnValueOnce((async function* () {
      yield { content: 'Début' };
      await gate;
      yield { content: 'Suite' };
    })() as any);
    const { result } = renderChat();

    let send!: Promise<void>;
    act(() => { send = result.current.sendMessage('Lance une tâche longue'); });

    await waitFor(() => expect(result.current.isGenerating).toBe(true));
    act(() => result.current.stop());
    release();
    await act(async () => { await send; });

    const conversation = useChatStore.getState().getActiveConversation();
    expect(conversation?.messages.at(-1)?.content).toContain('interrompu');
  });

  it('utilise le résumé de task_done comme réponse finale', async () => {
    vi.mocked(aiService.chatStream).mockReturnValueOnce(stream({
      tool_calls: [toolCall('task_done', { summary: 'Travail terminé' })],
    }) as any);
    vi.mocked(executeToolCall).mockResolvedValue({ output: 'Travail terminé', isDone: true } as any);
    const { result } = renderChat('full');

    await act(async () => {
      await result.current.sendMessage('Termine la tâche');
    });

    const conversation = useChatStore.getState().getActiveConversation();
    expect(conversation?.messages.at(-1)?.content).toContain('Travail terminé');
  });
});
