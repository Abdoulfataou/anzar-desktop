import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/runtime/terminal', () => ({
  terminalService: {
    execShell: vi.fn(),
    runShell: vi.fn(),
    getJob: vi.fn(),
    waitForJob: vi.fn(),
    killProcess: vi.fn(),
  },
}));
vi.mock('./shared', () => ({
  COMMAND_TIMEOUT_MS: 120_000,
  MAX_COMMAND_OUTPUT_CHARS: 12_000,
  resolvePath: async (_root: string, p?: string) => {
    if (String(p || '').includes('..')) throw new Error('Chemin non autorisé (sortie du projet)');
    return `/tmp/projet/${p && p !== '.' ? p : ''}`.replace(/\/$/, '');
  },
  truncate: (text: string) => text,
}));

import { terminalService } from '@/services/runtime/terminal';
import { execBash, execJobKill, execJobOutput } from './bashTool';

const ctx = { projectRoot: '/tmp/projet' } as any;
const shell = vi.mocked(terminalService);

describe('execBash', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rend le code de sortie et la sortie, sans traiter un échec comme une panne', async () => {
    shell.execShell.mockResolvedValue({
      success: false, exitCode: 1, stdout: 'ok', stderr: 'boom', durationMs: 4, ran: true,
    });

    const result = await execBash({ command: 'npm test' }, ctx);

    expect(result.isError).toBe(false);
    expect(result.output).toContain('exit_code: 1');
    expect(result.output).toContain('[stderr]');
    expect(result.output).toContain('boom');
    expect(shell.execShell).toHaveBeenCalledWith('npm test', expect.objectContaining({ timeout: 120_000 }));
  });

  it('dit clairement qu’une commande a dépassé son délai', async () => {
    shell.execShell.mockResolvedValue({
      success: false, exitCode: 130, stdout: '', stderr: '', durationMs: 5_000, ran: true, timedOut: true,
    });
    const result = await execBash({ command: 'sleep 10', timeoutMs: 5_000 }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('[délai dépassé]');
    expect(result.output).toContain('5 s');
  });

  it('marque une commande non lancée comme erreur', async () => {
    shell.execShell.mockResolvedValue({
      success: false, exitCode: 1, stdout: '', stderr: '⛔ refus', durationMs: 0, ran: false,
    });
    const result = await execBash({ command: 'rm -rf /' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("n'a pas été exécutée");
  });

  it('rend un job_id pour un travail en arrière-plan', async () => {
    shell.runShell.mockResolvedValue('job-1');
    shell.getJob.mockReturnValue({ status: 'running', output: 'démarrage', command: 'npm run dev' });

    const result = await execBash({ command: 'npm run dev', run_in_background: true }, ctx);

    expect(result.isError).toBe(false);
    expect(result.output).toContain('job_id: job-1');
    expect(result.output).toContain('en cours');
    expect(result.output).toContain('job_output');
  });

  it('refuse un workdir qui sort du projet', async () => {
    const result = await execBash({ command: 'ls', workdir: '../..' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain('dossier de travail invalide');
  });

  it('applique le plafond de délai', async () => {
    shell.execShell.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1, ran: true });
    await execBash({ command: 'sleep 1', timeoutMs: 99_999_999 }, ctx);
    expect(shell.execShell).toHaveBeenCalledWith('sleep 1', expect.objectContaining({ timeout: 600_000 }));
  });
});

describe('job_output / job_kill', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attend et rend l’état du travail', async () => {
    shell.waitForJob.mockResolvedValue({ status: 'completed', exitCode: 0, output: 'fini', command: 'npm run build' });
    const result = await execJobOutput({ job_id: 'job-1', wait_ms: 1_000 }, ctx);
    expect(result.output).toContain('fini');
    expect(result.output).toContain('code 0');
    expect(result.isError).toBe(false);
  });

  it('arrête un travail', async () => {
    shell.killProcess.mockResolvedValue(true);
    const result = await execJobKill({ job_id: 'job-1' });
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('arrêté');
  });

  it('signale un identifiant inconnu', async () => {
    shell.waitForJob.mockResolvedValue(null);
    const result = await execJobOutput({ job_id: 'nope' }, ctx);
    expect(result.isError).toBe(true);
  });
});
