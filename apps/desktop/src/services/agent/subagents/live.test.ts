import { afterEach, describe, expect, it, vi } from 'vitest';

// Liste des skills du sous-agent : fixe en test (pas de disque ni de serveur).
vi.mock('@/services/skills', () => ({
  listSkills: async () => [{ name: 'tdd', description: 'Tests d’abord', body: '', source: 'builtin', origin: 'ANZAR', files: [], editable: false }],
}));
import type { AgentLoopOptions, AgentSessionResult } from '../engine/agentLoop';
import {
  clearLiveAgents, listLiveAgents, parseStructuredOutput, resetLiveRegistryForTests, resolveLiveAgent,
  reportOf, sendToLiveAgent, spawnLiveAgent, stopLiveAgent, takeLiveNotifications, waitForLiveAgent,
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

afterEach(() => { clearLiveAgents(); resetLiveRegistryForTests(); });

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

  it('restaure un enfant au repos après un redémarrage simulé', async () => {
    const runSubagent = vi.fn(async (opts: AgentLoopOptions) => result(opts, 'résumé persistant'));
    const ctx = context(runSubagent, 'conv-persist');
    const spawned = spawnLiveAgent(ctx, 'tâche persistante');
    await waitForLiveAgent(spawned.agent!, 1_000);

    resetLiveRegistryForTests(); // garde localStorage, vide la mémoire
    const restored = listLiveAgents('conv-persist');
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe(spawned.agent!.name);
    expect(restored[0].status).toBe('idle');
    expect(restored[0].history.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('valide une sortie structurée et la garde', async () => {
    const runSubagent = vi.fn(async (opts: AgentLoopOptions) => ({
      ...result(opts, '```json\n{"ok":true,"n":2}\n```'),
    }));
    const ctx = context(runSubagent, 'conv-struct');
    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, n: { type: 'number' } } };
    const spawned = spawnLiveAgent(ctx, 'analyse', undefined, undefined, schema);
    await waitForLiveAgent(spawned.agent!, 1_000);
    expect(spawned.agent!.structured).toEqual({ ok: true, n: 2 });
    expect(spawned.agent!.structuredError).toBeUndefined();
  });

  it('signale une sortie structurée invalide', async () => {
    const runSubagent = vi.fn(async (opts: AgentLoopOptions) => result(opts, '```json\n{"n":"deux"}\n```'));
    const ctx = context(runSubagent, 'conv-bad');
    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
    const spawned = spawnLiveAgent(ctx, 'analyse', undefined, undefined, schema);
    await waitForLiveAgent(spawned.agent!, 1_000);
    expect(spawned.agent!.structured).toBeUndefined();
    expect(spawned.agent!.structuredError).toContain('ok');
  });

  it('met une notification de fin à disposition du parent et peut l’arrêter', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runSubagent = vi.fn(async (opts: AgentLoopOptions) => {
      await gate;
      return result(opts, 'notification');
    });
    const ctx = context(runSubagent, 'conv-notif');
    const spawned = spawnLiveAgent(ctx, 'long');
    release();
    await waitForLiveAgent(spawned.agent!, 1_000);
    const notes = takeLiveNotifications('conv-notif');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('notification');
    expect(takeLiveNotifications('conv-notif')).toEqual([]);

    const stopped = stopLiveAgent('conv-notif', spawned.agent!.name);
    expect(stopped).toBe(true);
    expect(resolveLiveAgent('conv-notif', spawned.agent!.name)?.status).toBe('stopped');
  });

  it('valide enum, oneOf et tableaux imbriqués', () => {
    const schema = {
      type: 'object',
      required: ['statut', 'items'],
      additionalProperties: false,
      properties: {
        statut: { enum: ['ok', 'ko'] },
        score: { oneOf: [{ type: 'number', minimum: 0 }, { type: 'string', pattern: '^N/A$' }] },
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['nom'],
            properties: { nom: { type: 'string', minLength: 2 }, qte: { type: 'integer', minimum: 1 } },
          },
        },
      },
    };
    expect(parseStructuredOutput('```json\n{"statut":"ok","score":3,"items":[{"nom":"ab","qte":2}]}\n```', schema).error).toBeUndefined();
    expect(parseStructuredOutput('```json\n{"statut":"peut-être","items":[]}\n```', schema).error).toContain('énumération');
    expect(parseStructuredOutput('```json\n{"statut":"ok","score":-1,"items":[{"nom":"ab"}]}\n```', schema).error).toContain('oneOf');
    expect(parseStructuredOutput('```json\n{"statut":"ok","score":"N/A","items":[]}\n```', schema).error).toContain('trop peu');
    expect(parseStructuredOutput('```json\n{"statut":"ok","score":"N/A","items":[{"nom":"a"}]}\n```', schema).error).toContain('trop courte');
  });

  it('refuse la récursion et les noms invalides', () => {
    const ctx = context(vi.fn());
    expect(spawnLiveAgent({ ...ctx, subagentDepth: 1 }, 'x').error).toContain('Profondeur');
    expect(spawnLiveAgent(ctx, 'x', undefined, 'Lead').error).toContain('invalide');
    expect(spawnLiveAgent(ctx, 'x', undefined, 'bad name').error).toContain('invalide');
  });

  it('donne à l’enfant son rôle, le mode du parent et les skills', async () => {
    const runSubagent = vi.fn(async (opts: AgentLoopOptions) => result(opts, 'ok'));
    const agent = spawnLiveAgent(context(runSubagent), 'relis le module paiement', 'revue').agent!;
    await waitForLiveAgent(agent, 1_000);
    const opts = runSubagent.mock.calls[0][0];
    expect(opts.subagentRole).toBe('revue');
    expect(opts.permissionMode).toBe('full');
    expect(opts.skills?.map((s) => s.name)).toEqual(['tdd']);
    expect(opts.allowedTools?.has('write_file')).toBe(false);
    expect(opts.systemPromptExtra).toBe('');
  });

  it('rapport : dernier message si l’enfant a été arrêté, et fichiers touchés relevés', () => {
    const stopped = reportOf({
      stopReason: 'max_steps',
      summary: "Budget d'étapes épuisé (30).",
      steps: 30,
      messages: [{ role: 'assistant', content: 'Page panier faite, reste le test.' }] as any,
      filesChanged: ['src/panier.tsx', 'src/panier.test.tsx'],
    });
    expect(stopped).toContain("Budget d'étapes épuisé");
    expect(stopped).toContain('Page panier faite, reste le test.');
    expect(stopped).toContain('Fichiers touchés (relevé ANZAR) : src/panier.tsx, src/panier.test.tsx');

    const done = reportOf({ stopReason: 'task_done', summary: 'Fait.', steps: 3, messages: [], filesChanged: [] });
    expect(done).toBe('Fait.');
  });

  it('lance un agent personnalisé avec son profil, et refuse un rôle inconnu', async () => {
    const runSubagent = vi.fn(async (opts: AgentLoopOptions) => result(opts, 'ok'));
    const custom = {
      name: 'expert-flutter', description: 'Expert Flutter', kind: 'subagent' as const, tools: ['read_file', 'edit_file'],
      maxSteps: 22, skills: [], keywords: ['flutter'], deny: [], prompt: 'Riverpod partout.', outputMaxChars: 900,
    };
    const ctx = { ...context(runSubagent), customAgents: [custom] };
    const agent = spawnLiveAgent(ctx, 'écran de profil', 'expert-flutter').agent!;
    await waitForLiveAgent(agent, 1_000);
    const opts = runSubagent.mock.calls[0][0];
    expect(opts.subagentRole).toBe('expert-flutter');
    expect(opts.subagentProfile?.prompt).toBe('Riverpod partout.');
    expect(opts.maxSteps).toBe(22);
    expect([...(opts.allowedTools ?? [])].sort()).toEqual(['edit_file', 'read_file', 'task_done']);
    expect(agent.outputMaxChars).toBe(900);

    // Sans rôle, les mots-clés de l'agent personnalisé le désignent
    const guessed = spawnLiveAgent(ctx, 'corrige le widget flutter').agent!;
    expect(guessed.role).toBe('expert-flutter');
    await waitForLiveAgent(guessed, 1_000);

    const bad = spawnLiveAgent(ctx, 'tâche', 'explorer');
    expect(bad.error).toMatch(/Rôle inconnu « explorer »/);
    expect(bad.error).toContain('expert-flutter');
  });
});
