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

  it('refuse git push et la lecture d’un secret sans appeler le shell', async () => {
    const push = await execBash({ command: 'git push origin main' }, ctx);
    expect(push.isError).toBe(true);
    expect(push.output).toContain('réservé à l’utilisateur');
    const env = await execBash({ command: 'cat .env' }, ctx);
    expect(env.isError).toBe(true);
    expect(env.output).toContain('secret');
    expect(shell.execShell).not.toHaveBeenCalled();
  });

  it('laisse passer un message de commit qui contient « push » et un .env.example', async () => {
    shell.execShell.mockResolvedValue({ success: true, exitCode: 0, stdout: 'ok', stderr: '', durationMs: 1, ran: true });
    await execBash({ command: 'git commit -m "fix push"' }, ctx);
    await execBash({ command: 'cat .env.example' }, ctx);
    expect(shell.execShell).toHaveBeenCalledTimes(2);
  });

  it('transmet une élévation approuvée à usage unique au shell', async () => {
    shell.execShell.mockResolvedValue({ success: true, exitCode: 0, stdout: 'ok', stderr: '', durationMs: 1, ran: true });
    const escalatedCtx = { ...ctx, escalated: true };
    await execBash({ command: 'touch ../hors-projet', justification: 'nécessaire pour ce test' }, escalatedCtx);
    expect(shell.execShell).toHaveBeenCalledWith(
      'touch ../hors-projet',
      expect.objectContaining({ escalated: true, escalationReason: 'nécessaire pour ce test' }),
    );
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

  it('arrête le travail en arrière-plan quand le tour est annulé', async () => {
    shell.runShell.mockResolvedValue('job-stop');
    shell.getJob.mockReturnValue({ status: 'running', output: '', command: 'npm run dev' });
    const controller = new AbortController();
    const jobCtx = { ...ctx, signal: controller.signal };

    await execBash({ command: 'npm run dev', run_in_background: true }, jobCtx);
    controller.abort();
    await Promise.resolve();

    expect(shell.killProcess).toHaveBeenCalledWith('job-stop');
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
