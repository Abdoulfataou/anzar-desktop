import { beforeEach, describe, expect, it, vi } from 'vitest';

// Même harnais que useAgentChat.test.ts, mais on pilote AgentRunner directement :
// c'est le contrat de l'adaptateur (et non le hook) que ce fichier verrouille.
vi.mock('@/services/ai/ai', () => ({
  aiService: { chatStream: vi.fn(), chat: vi.fn() },
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
vi.mock('@/services/agent/verify/agentVerifier', () => ({
  runVerification: vi.fn(),
}));

import { aiService } from '@/services/ai/ai';
import { executeToolCall } from '@/services/agent/tools';
import { commandRisk, noteAgentWrite } from '@/services/agent/policy/commandGuard';
import { snapshotBeforeChange } from '@/services/agent/tools/fileChanges';
import { runVerification } from '@/services/agent/verify/agentVerifier';
import { resetBaselineCache } from '@/services/agent/verify/baseline';
import { refreshCredits } from '@/lib/credits';
import { AgentRunner } from './agentRunner';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUsageStore } from '@/stores/usageStore';

async function* stream(...deltas: any[]) {
  for (const delta of deltas) yield delta;
}

const toolCall = (name: string, args: Record<string, unknown>, id = 'c1') => ({
  index: 0,
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

const makeRunner = (permissionMode: 'ask' | 'plan' | 'full' = 'full') =>
  new AgentRunner({ workspacePath: '/tmp/projet', workspaceName: 'projet', model: 'fast', permissionMode });

/** Rapport de vérification : une seule commande, en échec si `output` est fourni. */
const verifyReport = (output = '') => ({
  passed: !output,
  nothingToVerify: false,
  results: [{
    label: 'build',
    command: 'npm run build',
    passed: !output,
    skipped: false,
    exitCode: output ? 1 : 0,
    output,
    durationMs: 5,
  }],
  failureSummary: output,
});

const lastMessage = () => {
  const conversation = useChatStore.getState().getActiveConversation();
  return conversation?.messages[conversation.messages.length - 1];
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(aiService.chatStream).mockReset();
  vi.mocked(executeToolCall).mockReset();
  vi.mocked(runVerification).mockReset();
  vi.mocked(refreshCredits).mockResolvedValue(0);
  vi.mocked(runVerification).mockResolvedValue(verifyReport() as any);
  resetBaselineCache();
  vi.mocked(noteAgentWrite).mockResolvedValue(undefined);
  vi.mocked(commandRisk).mockResolvedValue(null);
  // Comme la vraie fonction : elle enregistre le fichier touché dans la carte des snapshots.
  vi.mocked(snapshotBeforeChange).mockImplementation((async (snapshots: Map<string, unknown>, _root: string, rel?: string) => {
    if (rel) snapshots.set(rel, null);
  }) as any);
  localStorage.clear();
  useChatStore.setState({ conversations: [], activeConversationId: null, isGenerating: false });
  useUsageStore.setState({ records: [] });
  useSettingsStore.setState({
    authToken: 'test-token',
    settings: { ...useSettingsStore.getState().settings, model: 'fast', webTools: false, autoVerifyAfterApply: true },
  });
});

describe('AgentRunner — comptabilité du tour', () => {
  it('utilise le coût exact envoyé par le serveur et journalise sans redébiter', async () => {
    vi.mocked(aiService.chatStream).mockReturnValueOnce(stream({ serverCostFCFA: 12.5 }, { content: 'Fait' }) as any);
    const runner = makeRunner();

    const result = await runner.sendMessage('Fais quelque chose');

    expect(result?.costFCFA).toBe(12.5);
    expect(lastMessage()?.costFCFA).toBe(12.5);
    // Coût venu du serveur : une seule ligne d'usage, au coût exact (pas d'estimation locale).
    const record = useUsageStore.getState().records.at(-1);
    expect(record?.costFCFA).toBe(12.5);
    expect(record?.taskType).toBe('agent_chat');
  });
});

describe('AgentRunner — vérification automatique', () => {
  const writeTurn = () => vi.mocked(aiService.chatStream)
    .mockReturnValueOnce(stream({ tool_calls: [toolCall('write_file', { path: 'a.ts', content: 'x' })] }) as any);

  it('refuse task_done tant qu’un nouvel échec apparaît, puis accepte après correction', async () => {
    writeTurn()
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('task_done', { summary: 'Fini' }, 'c2')] }) as any)
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('task_done', { summary: 'Fini après correction' }, 'c3')] }) as any);
    vi.mocked(executeToolCall).mockImplementation(async (call: any) => (
      call.function.name === 'task_done'
        ? { output: JSON.parse(call.function.arguments).summary, isDone: true }
        : { output: 'ok' }
    ) as any);
    vi.mocked(runVerification)
      .mockResolvedValueOnce(verifyReport() as any)                              // référence : projet sain
      .mockResolvedValueOnce(verifyReport('error TS2304: introuvable') as any)   // après écriture : cassé
      .mockResolvedValueOnce(verifyReport() as any);                             // après correction
    const runner = makeRunner();

    const result = await runner.sendMessage('Écris un fichier');

    // Une référence + deux contrôles.
    expect(runVerification).toHaveBeenCalledTimes(3);
    expect(result?.stopReason).toBe('task_done');
    expect(result?.content).toContain('Fini après correction');
  });

  it('ignore une erreur déjà présente avant les modifications', async () => {
    writeTurn()
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('task_done', { summary: 'Fini' }, 'c2')] }) as any);
    vi.mocked(executeToolCall).mockImplementation(async (call: any) => (
      call.function.name === 'task_done'
        ? { output: 'Fini', isDone: true }
        : { output: 'ok' }
    ) as any);
    vi.mocked(runVerification)
      .mockResolvedValueOnce(verifyReport('error TS2304: introuvable') as any)   // projet déjà cassé avant
      .mockResolvedValueOnce(verifyReport('error TS2304: introuvable') as any);  // même erreur après
    const runner = makeRunner();

    const result = await runner.sendMessage('Écris un fichier');

    // Référence + un seul contrôle : task_done accepté du premier coup.
    expect(runVerification).toHaveBeenCalledTimes(2);
    // La référence tourne complet ; le contrôle reçoit les fichiers modifiés (ciblage).
    const calls = vi.mocked(runVerification).mock.calls;
    expect((calls[0][1] as any)?.changedFiles).toEqual([]);
    expect((calls[1][1] as any)?.changedFiles).toEqual(['a.ts']);
    expect(result?.stopReason).toBe('task_done');
    expect(result?.content).toContain('Fini');
  });

  it('bloque sur une erreur nouvelle même si le projet était déjà cassé', async () => {
    writeTurn()
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('task_done', { summary: 'Fini' }, 'c2')] }) as any)
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('task_done', { summary: 'Fini corrigé' }, 'c3')] }) as any);
    vi.mocked(executeToolCall).mockImplementation(async (call: any) => (
      call.function.name === 'task_done'
        ? { output: JSON.parse(call.function.arguments).summary, isDone: true }
        : { output: 'ok' }
    ) as any);
    vi.mocked(runVerification)
      .mockResolvedValueOnce(verifyReport('error TS2304: introuvable') as any)
      .mockResolvedValueOnce(verifyReport('error TS2304: introuvable\nerror TS2322: type invalide') as any)
      .mockResolvedValueOnce(verifyReport('error TS2304: introuvable') as any);
    const runner = makeRunner();

    const result = await runner.sendMessage('Écris un fichier');

    expect(runVerification).toHaveBeenCalledTimes(3);
    expect(result?.stopReason).toBe('task_done');
    expect(result?.content).toContain('Fini corrigé');
  });

  it('ne vérifie pas quand le réglage est désactivé', async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, autoVerifyAfterApply: false },
    });
    writeTurn()
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('task_done', { summary: 'Fini' }, 'c2')] }) as any);
    vi.mocked(executeToolCall).mockImplementation(async (call: any) => (
      call.function.name === 'task_done'
        ? { output: 'Fini', isDone: true }
        : { output: 'ok' }
    ) as any);
    const runner = makeRunner();

    const result = await runner.sendMessage('Écris un fichier');

    expect(runVerification).not.toHaveBeenCalled();
    expect(result?.stopReason).toBe('task_done');
  });
});

describe('AgentRunner — approbations', () => {
  it('n’exécute pas l’outil quand l’accord est refusé', async () => {
    vi.mocked(aiService.chatStream)
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('write_file', { path: 'a.ts', content: 'x' })] }) as any)
      .mockReturnValueOnce(stream({ content: 'Je propose autre chose' }) as any);
    const runner = makeRunner('ask');

    const pending = runner.sendMessage('Écris un fichier');
    await vi.waitFor(() => expect(runner.getState().approval?.name).toBe('write_file'));
    runner.resolveApproval(false);
    const result = await pending;

    expect(executeToolCall).not.toHaveBeenCalled();
    expect(result?.content).toContain('Je propose autre chose');
  });

  it('transmet l’accord à l’exécution quand il est donné', async () => {
    vi.mocked(aiService.chatStream)
      .mockReturnValueOnce(stream({ tool_calls: [toolCall('write_file', { path: 'a.ts', content: 'x' })] }) as any)
      .mockReturnValueOnce(stream({ content: 'Écrit' }) as any);
    vi.mocked(executeToolCall).mockResolvedValue({ output: 'fichier écrit' } as any);
    const runner = makeRunner('ask');

    const pending = runner.sendMessage('Écris un fichier');
    await vi.waitFor(() => expect(runner.getState().approval?.name).toBe('write_file'));
    runner.resolveApproval(true);
    const result = await pending;

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(result?.content).toContain('Écrit');
  });
});

describe('AgentRunner — états de session', () => {
  it('expose isGenerating pendant le tour et le remet à zéro ensuite', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(aiService.chatStream).mockReturnValueOnce((async function* () {
      yield { content: 'Début' };
      await gate;
      yield { content: 'Fin' };
    })() as any);
    const runner = makeRunner();

    const pending = runner.sendMessage('Tâche longue');
    await vi.waitFor(() => expect(runner.getState().isGenerating).toBe(true));
    release();
    await pending;

    expect(runner.getState().isGenerating).toBe(false);
  });
});

describe('AgentRunner — budget du tour', () => {
  it('arrête le tour au plafond FCFA, sans appel de synthèse supplémentaire', async () => {
    vi.mocked(aiService.chatStream).mockReturnValueOnce(
      stream({ serverCostFCFA: 20 }, { tool_calls: [toolCall('read_file', { path: 'a.ts' })] }) as any,
    );
    vi.mocked(executeToolCall).mockResolvedValue({ output: 'contenu' } as any);
    const runner = new AgentRunner({
      workspacePath: '/tmp/projet',
      workspaceName: 'projet',
      model: 'fast',
      permissionMode: 'full',
      budget: { fcfa: 10 },
    });

    const result = await runner.sendMessage('Lis le fichier');

    expect(result?.stopReason).toBe('budget_exhausted');
    expect(result?.isError).toBe(false);
    expect(result?.content).toContain('Budget de cette demande atteint');
    // Le plafond est un plafond : aucune synthèse payante n'est lancée en plus.
    expect(aiService.chatStream).toHaveBeenCalledTimes(1);
    expect(runner.getState().budget?.used.fcfa).toBeGreaterThanOrEqual(10);
    expect(runner.getState().budget?.exhaustedBy).toBe('fcfa');
  });

  it('applique un budget par défaut au travail de fond', async () => {
    vi.mocked(aiService.chatStream).mockReturnValueOnce(stream({ content: 'Fait' }) as any);
    const runner = new AgentRunner({
      workspacePath: '/tmp/projet',
      model: 'fast',
      background: true,
    });

    await runner.sendMessage('Tâche de fond');

    const budget = runner.getState().budget;
    expect(budget?.limit.fcfa).toBe(200);
    expect(budget?.limit.wallMs).toBe(15 * 60_000);
  });
});

describe('AgentRunner — rappels de boucle', () => {
  it('injecte un rappel après trois appels identiques et laisse le modèle conclure', async () => {
    const seen: any[] = [];
    let toolSteps = 0;
    vi.mocked(aiService.chatStream).mockImplementation(((messages: any, opts: any) => {
      seen.push(messages);
      if (opts?.tools && toolSteps < 3) {
        toolSteps++;
        return stream({ tool_calls: [toolCall('read_file', { path: 'a.ts' })] });
      }
      return stream({ content: 'Bilan : le fichier ne se lit pas.' });
    }) as any);
    vi.mocked(executeToolCall).mockResolvedValue({ output: 'échec', isError: true } as any);
    const runner = makeRunner();

    const result = await runner.sendMessage('Lis le fichier');

    expect(result?.stopReason).toBe('final_answer');
    expect(result?.content).toContain('Bilan');
    // Les trois appels sont réellement exécutés : plus de blocage.
    expect(executeToolCall).toHaveBeenCalledTimes(3);
    // Le 4e appel modèle voit le rappel ajouté après le 3e résultat.
    const reminderSeen = seen[3].some(
      (m: any) => m.role === 'user' && String(m.content).includes('même appel'),
    );
    expect(reminderSeen).toBe(true);
  });
});
