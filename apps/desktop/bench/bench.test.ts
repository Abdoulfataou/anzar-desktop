/**
 * Banc d'essai — exécute le **vrai `AgentRunner`** sur des scénarios déterministes.
 *
 * Ce qui est mesuré : la boucle, le budget, la détection de boucle, le nudging,
 * la vérification (ligne de base + ciblage) et le comportement du tour — pas la qualité
 * du modèle. Le modèle est scripté, les outils écrivent dans un dépôt en mémoire, et les
 * commandes du projet répondent selon l'état du dépôt.
 *
 * Lancer : `npm run bench` (ou `npx vitest run bench`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── État partagé avec les modules simulés (hoisted : les factories s'exécutent avant) ──
const h = vi.hoisted(() => ({ world: null as any }));

vi.mock('@/services/ai/ai', () => ({
  aiService: {
    chatStream: (messages: any, opts: any) => h.world.stream(messages, opts),
    chat: vi.fn(),
  },
  markSlowNetwork: vi.fn(),
}));

vi.mock('@/services/runtime/terminal', () => ({
  NETWORK_BLOCKED_TAG: '[ANZAR] Réseau coupé',
  commandNetworkOpen: () => true,
  terminalService: {
    exec: (command: string) => h.world.exec(command),
    grantInstall: vi.fn(),
    grantNetwork: vi.fn(),
    gitIsRepo: vi.fn(async () => false),
    gitInit: vi.fn(),
    gitCommit: vi.fn(),
  },
}));

vi.mock('@/services/filesystem/fileSystem', () => ({
  fileSystemService: {
    exists: (path: string) => Promise.resolve(h.world.exists(path)),
    readFile: (path: string) => Promise.resolve(h.world.readFile(path)),
    writeFile: (path: string, content: string) => { h.world.writeFile(path, content); return Promise.resolve(); },
    deleteFile: (path: string) => { h.world.deleteFile(path); return Promise.resolve(); },
    readDirectoryTree: () => Promise.resolve([]),
    readProjectFiles: () => Promise.resolve([]),
  },
}));

// Le banc mesure le harnais : la carte des changements (git) est hors périmètre.
vi.mock('@/services/workspace/gitChanges', () => ({
  beginTurn: async () => undefined,
  endTurn: async () => [],
}));

vi.mock('@/services/agent/tools/toolExecution', () => ({
  executeGenericTool: (call: any, args: any) => h.world.execute(call, args),
}));

vi.mock('@/services/agent/tools/fileChanges', () => ({
  snapshotBeforeChange: async (snapshots: Map<string, unknown>, _root: string, rel?: string) => {
    if (rel) snapshots.set(rel, h.world.repo[rel] ?? null);
  },
  collectChanges: async () => undefined,
}));

vi.mock('@/services/agent/context/agentContext', () => ({
  buildAgentContext: vi.fn().mockResolvedValue({ codeMap: '', taskHints: '', memory: undefined, stats: { totalFiles: 0, totalSymbols: 0, indexMs: 0 } }),
}));
vi.mock('@/services/agent/context/agentPrompts', () => ({
  buildAgentSystemPrompt: () => 'SYSTEM',
  runtimeFactsSection: () => '',
  memorySection: () => '',
  FORMATTING_GUIDE: '',
  VISUALS_GUIDE: '',
  CONNECTORS_GUIDE: '',
}));
vi.mock('@/services/agent/policy/commandGuard', () => ({
  commandRisk: vi.fn().mockResolvedValue(null),
  noteAgentWrite: vi.fn(async () => undefined),
}));
vi.mock('@/services/workspace/personalInstructions', () => ({
  loadPersonalInstructions: vi.fn().mockResolvedValue(''),
  personalInstructionsSection: () => '',
}));
vi.mock('@/services/workspace/personalSpace', () => ({
  PERSONAL_SPACE_TOOLS: new Set(),
  PERSONAL_SUBDIR: 'ANZAR',
  conversationUsesPersonalSpace: () => false,
  ensurePersonalSpace: vi.fn().mockResolvedValue(null),
  personalSpaceContext: () => '',
}));
vi.mock('@/services/workspace/attachmentFiles', () => ({
  copyAttachmentsToWorkspace: vi.fn(async (_root: string, files: unknown[]) => files),
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

import { AgentRunner } from '@/services/agent/runtime/agentRunner';
import { resetBaselineCache } from '@/services/agent/verify/baseline';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUsageStore } from '@/stores/usageStore';
import type { AgentChatResult } from '@/services/agent/runtime/turnTypes';
import { TASKS, type Action, type BenchTask } from './tasks';

// ── Dépôt en mémoire + monde simulé ─────────────────────────────────────────

const expand = (actions: Action[]): Exclude<Action, { a: 'repeat' }>[] =>
  actions.flatMap((a) => (a.a === 'repeat'
    ? Array.from({ length: a.times }, () => expand([a.of])).flat()
    : [a]));

class World {
  readonly root: string;
  readonly repo: Record<string, string>;
  readonly executed: string[] = [];
  calls = 0;

  /** Les commandes de la référence sont oubliées à la première écriture : on mesure
   *  ce que la vérification finale a réellement lancé. */
  private firstWrite = false;
  private step = 0;
  private readonly script: ReturnType<typeof expand>;

  constructor(readonly task: BenchTask) {
    this.root = `/bench/${task.id}`;
    this.repo = { ...task.files };
    this.script = expand(task.script);
  }

  private rel(path: string): string {
    return String(path || '').replace(this.root, '').replace(/^\/+/, '');
  }
  exists(path: string): boolean { return this.rel(path) in this.repo; }
  readFile(path: string): string {
    const key = this.rel(path);
    if (!(key in this.repo)) throw new Error(`fichier absent : ${key}`);
    return this.repo[key];
  }
  writeFile(path: string, content: string): void {
    if (!this.firstWrite) {
      this.firstWrite = true;
      this.executed.length = 0;
    }
    this.repo[this.rel(path)] = content;
  }
  deleteFile(path: string): void { delete this.repo[this.rel(path)]; }

  /** Résultat d'une commande du projet (vérifications comprises). */
  async exec(command: string) {
    this.executed.push(command);
    const check = this.task.checks?.find((c) => c.command === command);
    const ok = check ? check.ok(this.repo) : true;
    const failure = typeof check?.failure === 'function' ? check.failure(this.repo) : check?.failure || '';
    return { success: ok, exitCode: ok ? 0 : 1, stdout: ok ? 'ok' : '', stderr: ok ? '' : failure, durationMs: 1 };
  }

  /** Outils de l'agent, branchés sur le dépôt en mémoire. */
  async execute(call: any, args: any) {

    switch (call.function.name) {
      case 'read_file': {
        try { return { output: this.readFile(args.path) }; } catch (e: any) { return { output: e.message, isError: true }; }
      }
      case 'write_file': {
        this.writeFile(args.path, String(args.content ?? ''));
        return { output: `OK — ${args.path} écrit` };
      }
      case 'edit_file': {
        const current = this.readFile(args.path);
        if (!current.includes(args.old_text)) return { output: `old_text introuvable dans ${args.path}`, isError: true };
        this.writeFile(args.path, current.replace(args.old_text, args.new_text));
        return { output: `OK — ${args.path} modifié` };
      }
      case 'list_dir': return { output: Object.keys(this.repo).join('\n') };
      case 'search_files': return { output: Object.keys(this.repo).filter((p) => this.repo[p].includes(args.pattern)).join('\n') || 'aucun résultat' };
      case 'run_command': {
        const r = await this.exec(String(args.command || ''));
        return { output: r.success ? 'ok' : r.stderr, isError: !r.success };
      }
      case 'task_done': return { output: String(args.summary || ''), isDone: true };
      default: return { output: `outil non simulé : ${call.function.name}`, isError: true };
    }
  }

  /** Flux SSE scripté : une action par appel au modèle. */
  stream(_messages: unknown, opts: any): AsyncGenerator<any> {
    const self = this;
    self.calls += 1;
    const action = opts?.tools ? self.script[self.step++] : undefined;

    const run = async function* () {
      yield { serverCostFCFA: 1 };
      // Pas d'outils : c'est la synthèse forcée (boucle détectée, étapes épuisées).
      if (!opts?.tools) {
        yield { content: 'Bilan : arrêt demandé.' };
        return;
      }
      if (!action) {
        yield { content: 'Script épuisé.' };
        return;
      }
      const call = (name: string, args: Record<string, unknown>) => ({
        index: 0,
        id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'function' as const,
        function: { name, arguments: JSON.stringify(args) },
      });
      switch (action.a) {
        case 'text': yield { content: action.text }; break;
        case 'read': yield { tool_calls: [call('read_file', { path: action.path })] }; break;
        case 'write': yield { tool_calls: [call('write_file', { path: action.path, content: action.content })] }; break;
        case 'edit': yield { tool_calls: [call('edit_file', { path: action.path, old_text: action.old, new_text: action.new })] }; break;
        case 'cmd': yield { tool_calls: [call('run_command', { command: action.command })] }; break;
        case 'done': yield { tool_calls: [call('task_done', { summary: action.summary })] }; break;
        case 'plan': yield { tool_calls: [call('propose_plan', { title: action.title, plan: action.plan })] }; break;
      }
    };
    return run() as AsyncGenerator<any>;
  }
}

// ── Exécution ───────────────────────────────────────────────────────────────

beforeEach(() => {
  resetBaselineCache();
  useChatStore.setState({ conversations: [], activeConversationId: null, isGenerating: false });
  useUsageStore.setState({ records: [] });
  useSettingsStore.setState({
    authToken: null,
    settings: {
      ...useSettingsStore.getState().settings,
      model: 'fast',
      webTools: false,
      autoVerifyAfterApply: true,
      networkProxy: false,
    },
  });
});

interface Row {
  tache: string;
  arret: string;
  appels: number;
  cout: number;
  commandes: number;
  ok: boolean;
}

const rows: Row[] = [];

describe('banc d’essai du harnais', () => {
  for (const task of TASKS) {
    it(task.id, async () => {
      const world = new World(task);
      h.world = world;
      const runner = new AgentRunner({
        workspacePath: world.root,
        workspaceName: 'bench',
        model: 'fast',
        permissionMode: 'full',
        budget: task.budget,
      });

      let result: AgentChatResult | null = null;
      try {
        result = await runner.sendMessage(task.prompt);
      } catch (e: any) {
        throw new Error(`[${task.id}] le tour a levé : ${e?.message || e}`);
      }

      // Fichiers attendus
      for (const [path, expected] of Object.entries(task.expect.files || {})) {
        const content = world.repo[path] ?? '';
        if (expected instanceof RegExp) expect(content, `${task.id} — ${path}`).toMatch(expected);
        else expect(content, `${task.id} — ${path}`).toContain(expected);
      }

      const stop = result?.stopReason;
      const commands = world.executed;
      if (task.expect.noCommands) expect(commands, `${task.id} — aucune commande attendue`).toEqual([]);
      if (task.expect.command) expect(commands, `${task.id} — commande attendue`).toContain(task.expect.command);
      if (task.expect.notCommand) expect(commands, `${task.id} — commande interdite`).not.toContain(task.expect.notCommand);
      if (task.expect.minCalls !== undefined) expect(world.calls).toBeGreaterThanOrEqual(task.expect.minCalls);
      if (task.expect.maxCalls !== undefined) expect(world.calls).toBeLessThanOrEqual(task.expect.maxCalls);

      expect(stop, `${task.id} — arrêt`).toBe(task.expect.stop);

      rows.push({
        tache: task.id,
        arret: String(stop),
        appels: world.calls,
        cout: Math.round((result?.costFCFA ?? 0) * 100) / 100,
        commandes: commands.length,
        ok: stop === task.expect.stop,
      });
    });
  }

  it('récapitulatif', () => {
    const total = rows.reduce((n, r) => n + r.cout, 0);
    const calls = rows.reduce((n, r) => n + r.appels, 0);
    const commands = rows.reduce((n, r) => n + r.commandes, 0);
    // Tableau lisible en local et dans les logs de CI.
    // eslint-disable-next-line no-console
    console.table(rows);
    // eslint-disable-next-line no-console
    console.log(`[bench] ${rows.length} tâches · ${calls} appels modèle · ${commands} commandes · ${Math.round(total * 100) / 100} FCFA simulés`);
    expect(rows).toHaveLength(TASKS.length);
    expect(rows.every((r) => r.ok)).toBe(true);
  });
});
