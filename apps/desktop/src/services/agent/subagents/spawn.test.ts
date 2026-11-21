import { describe, expect, it, vi } from 'vitest';
import { execSpawnSubagents } from './spawn';
import { AGENT_PROFILES } from '../profiles';

const result = { stopReason: 'final_answer', summary: 'ok', steps: 2, messages: [], filesChanged: [] };

const makeCtx = (
  permissionMode: 'auto' | 'full',
  runSubagent = vi.fn().mockResolvedValue(result),
  childBudget?: (share: number, capFcfa?: number) => unknown,
) => ({
  projectRoot: '/projet',
  signal: undefined,
  permissionMode,
  runSubagent,
  childBudget,
});

const tasks = [
  { task: 'fais une animation pour la pub', role: 'motion-designer' },
  { task: 'écris le texte du site', role: 'redaction' },
];

describe('spawn_subagents — profils', () => {
  it('applique les outils déclarés par chaque profil (mode Full)', async () => {
    const runSubagent = vi.fn().mockResolvedValue(result);
    await execSpawnSubagents({ tasks }, makeCtx('full', runSubagent) as any);

    const [motion, redaction] = runSubagent.mock.calls.map((c) => c[0]);
    // motion-designer : écrit, capture, mais pas d'export ni de commandes
    expect(motion.allowedTools.has('write_file')).toBe(true);
    expect(motion.allowedTools.has('capture_page')).toBe(true);
    expect(motion.allowedTools.has('export_animation')).toBe(false);
    expect(motion.allowedTools.has('run_command')).toBe(false);
    // redaction : écrit du texte, ne capture pas de page
    expect(redaction.allowedTools.has('write_file')).toBe(true);
    expect(redaction.allowedTools.has('capture_page')).toBe(false);
    expect(redaction.allowedTools.has('task_done')).toBe(true);
  });

  it('respecte la politique hors Full même si le profil demande plus', async () => {
    const runSubagent = vi.fn().mockResolvedValue(result);
    await execSpawnSubagents({ tasks }, makeCtx('auto', runSubagent) as any);

    const [motion] = runSubagent.mock.calls.map((c) => c[0]);
    expect(motion.allowedTools.has('write_file')).toBe(false);
    expect(motion.allowedTools.has('read_file')).toBe(true);
  });

  it('transmet le modèle et le budget déclarés par le profil', async () => {
    const runSubagent = vi.fn().mockResolvedValue(result);
    await execSpawnSubagents({ tasks }, makeCtx('full', runSubagent) as any);

    const [motion, redaction] = runSubagent.mock.calls.map((c) => c[0]);
    expect(motion.maxSteps).toBe(AGENT_PROFILES['motion-designer'].maxSteps);
    expect(motion.model).toBe(AGENT_PROFILES['motion-designer'].model);
    expect(redaction.model).toBe(AGENT_PROFILES['redaction'].model);
  });

  it('répartit le budget restant : une enveloppe par sous-agent', async () => {
    const runSubagent = vi.fn().mockResolvedValue(result);
    const childBudget = vi.fn((share: number, capFcfa?: number) => ({ share, capFcfa }));
    await execSpawnSubagents({ tasks }, makeCtx('full', runSubagent, childBudget) as any);

    // 80 % du budget restant partagé entre 2 sous-agents, plafonné par le manifeste.
    expect(childBudget).toHaveBeenCalledTimes(2);
    expect(childBudget).toHaveBeenCalledWith(0.4, undefined);        // motion-designer
    expect(childBudget).toHaveBeenCalledWith(0.4, AGENT_PROFILES.redaction.budgetFCFA);
    const [motion] = runSubagent.mock.calls.map((c) => c[0]);
    expect(motion.budget).toEqual({ share: 0.4, capFcfa: undefined });
  });

  it('transmet le modèle explicite du profil dev', async () => {
    const runSubagent = vi.fn().mockResolvedValue(result);
    await execSpawnSubagents({
      tasks: [{ task: 'corrige le bug', role: 'dev' }, { task: 'autre chose', role: 'dev' }],
    }, makeCtx('full', runSubagent) as any);

    const [first] = runSubagent.mock.calls.map((c) => c[0]);
    expect(first.model).toBe('fast');
  });
});
