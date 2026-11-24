import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ai/ai', () => ({
  aiService: { chatStream: vi.fn() },
  markSlowNetwork: vi.fn(),
}));
vi.mock('@/services/agent/tools', () => ({
  AGENT_TOOLS: [
    { type: 'function', function: { name: 'write_file', description: '', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'read_file', description: '', parameters: { type: 'object', properties: {} } } },
  ],
  executeToolCall: vi.fn(),
}));
vi.mock('@/services/agent/tools/webTools', () => ({
  WEB_TOOLS: [],
  WEB_TOOL_NAMES: new Set(),
  executeWebTool: vi.fn(),
}));
vi.mock('@/services/agent/context/agentPrompts', () => ({
  buildAgentSystemPrompt: () => 'SYSTEM',
  runtimeFactsSection: () => '',
  memorySection: () => '',
  FORMATTING_GUIDE: '',
  VISUALS_GUIDE: '',
  CONNECTORS_GUIDE: '',
}));
vi.mock('@/services/agent/context/agentContext', () => ({
  buildAgentContext: vi.fn().mockResolvedValue({ codeMap: '', taskHints: '', memory: undefined }),
}));
vi.mock('@/services/agent/policy/commandGuard', () => ({
  commandRisk: vi.fn().mockResolvedValue(null),
  noteAgentWrite: vi.fn(),
  agentScriptSecretRisk: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/workspace/personalInstructions', () => ({
  loadPersonalInstructions: vi.fn().mockResolvedValue(''),
  personalInstructionsSection: () => '',
}));
vi.mock('@/services/agent/tools/fileChanges', () => ({
  snapshotBeforeChange: vi.fn(),
  collectChanges: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/workspace/attachmentFiles', () => ({
  copyAttachmentsToWorkspace: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/workspace/personalSpace', () => ({
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
vi.mock('@/services/agent/tools/devServer', () => ({
  detectDevCommand: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/agent/runtime/sessionStore', () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn().mockResolvedValue(undefined),
  recordSessionEvent: vi.fn(),
}));
vi.mock('@/lib/credits', () => ({
  refreshCredits: vi.fn().mockResolvedValue(0),
  LOW_BALANCE_FCFA: 100,
}));

import { aiService } from '@/services/ai/ai';
import { copyAttachmentsToWorkspace } from '@/services/workspace/attachmentFiles';
import { noteAgentWrite } from '@/services/agent/policy/commandGuard';
import { ensurePersonalSpace } from '@/services/workspace/personalSpace';
import { buildAgentContext } from '@/services/agent/context/agentContext';
import { executeToolCall } from '@/services/agent/tools';
import { useAgentChat, type AgentChatResult } from './useAgentChat';
import { loadSession, saveSession } from '@/services/agent/runtime/sessionStore';
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

const renderChat = (permissionMode: 'ask' | 'plan' | 'full' = 'full', model: 'fast' | 'auto' = 'fast') =>
  renderHook(() => useAgentChat({
    workspacePath: '/tmp/projet',
    workspaceName: 'projet',
    model,
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

  it('retourne un résultat de session structuré', async () => {
    vi.mocked(aiService.chatStream).mockReturnValueOnce(stream({ content: 'Bonjour' }) as any);
    const { result } = renderChat();

    let out: AgentChatResult | null = null;
    await act(async () => {
      out = await result.current.sendMessage('Fais quelque chose');
    });

    expect(out).not.toBeNull();
    expect(out!.stopReason).toBe('final_answer');
    expect(out!.isError).toBe(false);
    expect(out!.content).toContain('Bonjour');
    expect(out!.conversationId).toBeTruthy();
    expect(out!.assistantId).toBeTruthy();
  });

  it('demande l’accord puis exécute write_file en mode ask', async () => {
    vi.mocked(aiService.chatStream)
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('write_file', { path: 'a.ts', content: 'x' })] }) as any)
      .mockReturnValueOnce(stream({ content: 'Terminé' }) as any);
    vi.mocked(executeToolCall).mockResolvedValue({ output: 'fichier écrit' } as any);
    const { result } = renderChat('ask');

    let send!: Promise<AgentChatResult | null>;
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

    let send!: Promise<AgentChatResult | null>;
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

    let send!: Promise<AgentChatResult | null>;
    act(() => { send = result.current.sendMessage('Lance une tâche longue'); });

    await waitFor(() => expect(result.current.isGenerating).toBe(true));
    act(() => result.current.stop());
    release();
    await act(async () => { await send; });

    const conversation = useChatStore.getState().getActiveConversation();
    expect(conversation?.messages.at(-1)?.content).toContain('interrompu');
  });

  it('reprend après une erreur non réessayable', async () => {
    vi.mocked(aiService.chatStream)
      .mockReturnValueOnce((async function* () { throw new Error('crédit insuffisant'); })() as any)
      .mockReturnValueOnce(stream({ content: 'Repris après erreur' }) as any);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Fais une tâche');
    });

    let conversation = useChatStore.getState().getActiveConversation();
    const failed = conversation?.messages.at(-1);
    expect(failed?.isError).toBe(true);
    expect(failed?.resumable).toBe(true);

    await act(async () => {
      expect(result.current.resume(failed!.id)).toBe(true);
    });
    await waitFor(() => {
      conversation = useChatStore.getState().getActiveConversation();
      expect(conversation?.messages.at(-1)?.content).toContain('Repris après erreur');
    });
  });

  it('injecte les captures de capture_page dans le tour suivant', async () => {
    const seen: any[][] = [];
    vi.mocked(aiService.chatStream).mockImplementation((messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      return seen.length === 1
        ? stream({ tool_calls: [toolCall('capture_page', { url: 'http://localhost:1420', frames: [0, 1] })] }) as any
        : stream({ content: 'Captures vues' }) as any;
    });
    vi.mocked(executeToolCall).mockResolvedValue({
      output: 'captures',
      images: [{ label: 'frame 1', dataUrl: 'data:image/png;base64,AAAA' }],
    } as any);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Vérifie la page');
    });

    expect(seen[1].some((m) => m.role === 'user'
      && Array.isArray(m.content)
      && m.content.some((part: any) => part.type === 'image_url'))).toBe(true);
    const conversation = useChatStore.getState().getActiveConversation();
    expect(conversation?.messages.at(-1)?.content).toContain('Captures vues');
  });

  it('escalade le mode Auto après quatre échecs d’outils', async () => {
    let call = 0;
    vi.mocked(aiService.chatStream).mockImplementation(() => {
      call += 1;
      // Arguments différents à chaque échec : un appel strictement identique serait arrêté
      // par la détection de boucle, pas escaladé (voir loopGuard.test.ts).
      return call <= 4
        ? stream({ tool_calls: [toolCall('read_file', { path: `a${call}.ts` }, `c${call}`)] }) as any
        : stream({ content: 'Après escalade' }) as any;
    });
    vi.mocked(executeToolCall).mockResolvedValue({ output: 'échec', isError: true } as any);
    const { result } = renderChat('full', 'auto');

    await act(async () => {
      await result.current.sendMessage('Corrige un bug');
    });

    const conversation = useChatStore.getState().getActiveConversation();
    const last = conversation?.messages.at(-1);
    expect(last?.content).toContain('Après escalade');
    expect(last?.autoRoute?.escalated).toBe(true);
    expect(last?.autoRoute?.mode).toBe('max');
  });

  it('ouvre l’espace ANZAR pour une création sans projet', async () => {
    vi.mocked(aiService.chatStream).mockReturnValueOnce(stream({ content: 'Visuel créé' }) as any);
    const { result } = renderHook(() => useAgentChat({
      workspacePath: null,
      model: 'fast',
      permissionMode: 'full',
    }));

    await act(async () => {
      await result.current.sendMessage('fais-moi une affiche pour le lancement');
    });

    expect(ensurePersonalSpace).toHaveBeenCalled();
    expect(copyAttachmentsToWorkspace).toHaveBeenCalledWith('/tmp/anzar', [], { subdir: 'ANZAR', gitignore: false });
    expect(buildAgentContext).not.toHaveBeenCalled();
    const conversation = useChatStore.getState().getActiveConversation();
    expect(conversation?.personalSpace).toBe(true);
    expect(conversation?.messages.at(-1)?.content).toContain('Visuel créé');
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

describe('useAgentChat — sessions durables', () => {
  it("reprend une conversation avec l'historique enregistré (outils compris)", async () => {
    useChatStore.setState({ conversations: [{ id: 'conv-saved', title: 'x', messages: [], createdAt: 0, updatedAt: 0 } as any], activeConversationId: 'conv-saved' });
    vi.mocked(loadSession).mockResolvedValueOnce([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'Lis App.tsx' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'old', content: 'CONTENU-DEJA-LU' },
    ]);
    vi.mocked(aiService.chatStream).mockReturnValueOnce(stream({ content: 'Je continue' }) as any);
    const { result } = renderChat();
    await act(async () => { await result.current.sendMessage('continue', [], undefined, { conversationId: 'conv-saved' }); });
    const sent = vi.mocked(aiService.chatStream).mock.calls[0][0] as any[];
    expect(sent.some((m) => m.role === 'tool' && m.content === 'CONTENU-DEJA-LU')).toBe(true);
    expect(saveSession).toHaveBeenCalledWith('conv-saved', expect.any(Array));
  });
});
