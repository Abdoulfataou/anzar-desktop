import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Faux AgentRunner : on contrôle le résultat de chaque demande ──
const sendMessage = vi.fn();
const stop = vi.fn();
const runnerOptions: any[] = [];
vi.mock('@/services/agent/runtime/agentRunner', () => ({
  AgentRunner: class {
    constructor(opts: any) { runnerOptions.push(opts); }
    sendMessage = sendMessage;
    stop = stop;
  },
}));
vi.mock('react-hot-toast', () => {
  const t: any = vi.fn();
  t.success = vi.fn(); t.error = vi.fn();
  return { default: t };
});

// ── Stores en mémoire ──
const project = { id: 'p1', name: 'Boutique', metadata: { localPath: '/repo' } };
let projects: any[] = [project];
vi.mock('@/stores/projectStore', () => ({ useProjectStore: { getState: () => ({ projects }) } }));
const createConversation = vi.fn(() => ({ id: 'conv1' }));
vi.mock('@/stores/chatStore', () => ({
  useChatStore: { getState: () => ({ conversations: [{ id: 'conv1', messages: [] }], createConversation }) },
}));
const auto = { markStarted: vi.fn(), markFinished: vi.fn(), setRunning: vi.fn() };
vi.mock('@/stores/automationStore', () => ({ useAutomationStore: { getState: () => auto, persist: { hasHydrated: () => true } } }));

let tickets: any[] = [];
const ticketStore = {
  get tickets() { return tickets; },
  updateTicket: vi.fn((id: string, patch: any) => { tickets = tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)); }),
  setSettings: vi.fn(),
  setRunning: vi.fn(),
  settings: { paused: false },
};
vi.mock('@/stores/ticketStore', () => ({
  useTicketStore: { getState: () => ticketStore, persist: { hasHydrated: () => true } },
  inWorkWindow: () => true,
  nextTicket: (list: any[]) => list.find((t) => t.status === 'queued'),
}));
vi.mock('@/lib/credits', () => ({ refreshCredits: vi.fn(async () => 1000) }));
vi.mock('@/services/filesystem/fileSystem', () => ({ fileSystemService: { exists: vi.fn(async () => false) } }));
const commitAll = vi.fn(async () => '2 files changed');
vi.mock('@/services/superagent/ticketGit', () => ({
  isGitRepo: vi.fn(async () => true),
  prepareWorktree: vi.fn(async () => ({ path: '/wt/t1', branch: 'anzar/t1' })),
  commitAll: (...a: unknown[]) => commitAll(...(a as [])),
}));

import { runAutomation } from './automationQueue';
import { runTicket } from '@/services/superagent/ticketQueue';

const okResult = { stopReason: 'task_done', content: 'Fait.', costFCFA: 12, filesChanged: [], isError: false, conversationId: 'conv1', assistantId: 'a1' };

beforeEach(() => {
  vi.clearAllMocks();
  runnerOptions.length = 0;
  projects = [project];
});

describe('automatisations (sans composant)', () => {
  it('exécute la demande en arrière-plan et marque le succès', async () => {
    sendMessage.mockResolvedValueOnce(okResult);
    await runAutomation({ id: 'a1', name: 'Rapport', projectId: 'p1', prompt: 'Fais le rapport', model: 'fast', mode: 'auto' } as any);
    expect(runnerOptions[0]).toMatchObject({ workspacePath: '/repo', background: true, permissionMode: 'auto' });
    expect(auto.markFinished).toHaveBeenCalledWith('a1', { ok: true, error: undefined, conversationId: 'conv1' });
  });

  it('échoue proprement si le projet a disparu', async () => {
    projects = [];
    await runAutomation({ id: 'a1', name: 'Rapport', projectId: 'p1', prompt: 'x', model: 'fast', mode: 'auto' } as any);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(auto.markFinished).toHaveBeenCalledWith('a1', expect.objectContaining({ ok: false }));
  });
});

describe('tickets du super-agent (sans composant)', () => {
  const ticket = { id: 't1', projectId: 'p1', title: 'Ajouter le panier', description: 'Panier', status: 'queued', model: 'fast', budgetFCFA: 200, maxMinutes: 30, attempts: 0, branch: 'anzar/t1' };

  it('travaille dans la worktree, commite et passe en revue', async () => {
    tickets = [{ ...ticket }];
    sendMessage.mockResolvedValueOnce(okResult);
    await runTicket(tickets[0]);
    expect(runnerOptions[0]).toMatchObject({ workspacePath: '/wt/t1', background: true });
    expect(commitAll).toHaveBeenCalledWith('/wt/t1', 'ANZAR ticket : Ajouter le panier');
    expect(tickets[0]).toMatchObject({ status: 'review', costFCFA: 12, diffStat: '2 files changed' });
  });

  it('signale une vérification qui échoue encore', async () => {
    tickets = [{ ...ticket }];
    sendMessage.mockResolvedValueOnce({ ...okResult, stopReason: 'verify_failed' });
    await runTicket(tickets[0]);
    expect(tickets[0].error).toMatch(/vérification/);
  });

  it('échoue sans lancer l’agent si le projet est introuvable', async () => {
    projects = [];
    tickets = [{ ...ticket }];
    await runTicket(tickets[0]);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(tickets[0].status).toBe('failed');
  });
});
