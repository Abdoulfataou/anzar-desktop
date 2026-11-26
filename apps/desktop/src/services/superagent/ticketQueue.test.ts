import { beforeEach, describe, expect, it, vi } from 'vitest';

// Faux AgentRunner : chaque demande reste en cours jusqu'à ce que le test la libère.
const releases: Array<() => void> = [];
const runners: any[] = [];
vi.mock('@/services/agent/runtime/agentRunner', () => ({
  AgentRunner: class {
    opts: any;
    constructor(opts: any) { this.opts = opts; runners.push(this); }
    sendMessage = () => new Promise((resolve) => {
      releases.push(() => resolve({ stopReason: 'task_done', content: 'Fait.', costFCFA: 5, isError: false }));
    });
    stop = vi.fn();
  },
}));
vi.mock('react-hot-toast', () => {
  const t: any = vi.fn();
  t.success = vi.fn(); t.error = vi.fn();
  return { default: t };
});
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ projects: [{ id: 'p1', name: 'Boutique', metadata: { localPath: '/repo' } }] }) },
}));
let convN = 0;
vi.mock('@/stores/chatStore', () => ({
  useChatStore: { getState: () => ({ conversations: [], createConversation: () => ({ id: `conv${++convN}` }) }) },
}));

let tickets: any[] = [];
let runningIds: string[] = [];
let settings: any = { paused: false, maxParallel: 2 };
const store = {
  get tickets() { return tickets; },
  get runningIds() { return runningIds; },
  get settings() { return settings; },
  updateTicket: (id: string, patch: any) => { tickets = tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)); },
  setSettings: (p: any) => { settings = { ...settings, ...p }; },
  markRunning: (id: string) => { if (!runningIds.includes(id)) runningIds = [...runningIds, id]; },
  markStopped: (id: string) => { runningIds = runningIds.filter((x) => x !== id); },
};
vi.mock('@/stores/ticketStore', async () => {
  const real = await vi.importActual<any>('@/stores/ticketStore');
  return {
    useTicketStore: { getState: () => store, persist: { hasHydrated: () => true } },
    inWorkWindow: () => true,
    maxParallelOf: real.maxParallelOf,
    nextTicket: (list: any[]) => list.find((t) => t.status === 'queued'),
  };
});
vi.mock('@/lib/credits', () => ({ refreshCredits: vi.fn(async () => 1000) }));
vi.mock('@/services/filesystem/fileSystem', () => ({ fileSystemService: { exists: vi.fn(async () => false) } }));
// Opérations git : on note l'ordre pour vérifier qu'elles ne se chevauchent pas sur un même dépôt.
let gitBusy = 0;
let gitOverlap = false;
const gitOp = async <T>(value: T): Promise<T> => {
  gitBusy += 1;
  if (gitBusy > 1) gitOverlap = true;
  await new Promise((r) => setTimeout(r, 5));
  gitBusy -= 1;
  return value;
};
vi.mock('./ticketGit', () => ({
  isGitRepo: vi.fn(async () => true),
  prepareWorktree: vi.fn((_repo: string, t: { id: string }) => gitOp({ path: `/wt/${t.id}`, branch: `anzar/${t.id}` })),
  commitAll: vi.fn(() => gitOp('1 file changed')),
}));

import { checkTicketQueue } from './ticketQueue';
import { maxParallelOf } from '@/stores/ticketStore';

const ticket = (id: string) => ({ id, projectId: 'p1', title: id, description: id, status: 'queued', priority: 'normal', model: 'fast', budgetFCFA: 200, maxMinutes: 30, attempts: 0, createdAt: 0 });

describe('tickets en parallèle', () => {
  beforeEach(() => {
    releases.length = 0; runners.length = 0; runningIds = []; convN = 0;
    gitBusy = 0; gitOverlap = false;
    settings = { paused: false, maxParallel: 2 };
  });

  it('lance jusqu’à la limite, puis le suivant quand une place se libère', async () => {
    tickets = [ticket('t1'), ticket('t2'), ticket('t3')];
    checkTicketQueue();
    expect(runningIds).toEqual(['t1', 't2']);
    await vi.waitFor(() => expect(runners).toHaveLength(2));
    expect(runners.map((r) => r.opts.workspacePath).sort()).toEqual(['/wt/t1', '/wt/t2']);
    expect(gitOverlap).toBe(false);

    releases[0]();
    await vi.waitFor(() => expect(runners).toHaveLength(3));
    expect(runningIds).toHaveLength(2);
    expect(tickets.find((t) => t.id === 't1')?.status).toBe('review');
    for (const r of releases.slice(1)) r();
    await vi.waitFor(() => expect(runningIds).toHaveLength(0));
    expect(gitOverlap).toBe(false);
  });

  it('respecte la pause et le réglage à 1', () => {
    tickets = [ticket('a'), ticket('b')];
    settings = { paused: true, maxParallel: 3 };
    checkTicketQueue();
    expect(runningIds).toEqual([]);
    settings = { paused: false, maxParallel: 1 };
    checkTicketQueue();
    expect(runningIds).toEqual(['a']);
    for (const r of releases) r();
  });

  it('borne le réglage entre 1 et 4', () => {
    expect(maxParallelOf({ paused: false })).toBe(2);
    expect(maxParallelOf({ paused: false, maxParallel: 0 })).toBe(1);
    expect(maxParallelOf({ paused: false, maxParallel: 9 })).toBe(4);
  });
});
