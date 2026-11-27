import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/runtime/terminal', () => ({
  terminalService: {
    execShell: vi.fn(),
    execShellYield: vi.fn(),
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
import { confinedShellAvailable, execBash, execJobKill, execJobOutput } from './bashTool';

const ctx = { projectRoot: '/tmp/projet' } as any;
const shell = vi.mocked(terminalService);
/** Commande terminée avant son délai. */
const done = (r: Record<string, unknown>) => ({ kind: 'finished' as const, result: r as any });

describe('disponibilité du shell confiné', () => {
  it('ne le propose que là où Rust isole réellement (macOS)', () => {
    const originalPlatform = navigator.platform;
    const originalUserAgent = navigator.userAgent;
    try {
      Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
      Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux x86_64)', configurable: true });
      expect(confinedShellAvailable()).toBe(false);
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
      Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', configurable: true });
      expect(confinedShellAvailable()).toBe(true);
    } finally {
      Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
      Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
    }
  });
});

describe('execBash', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rend le code de sortie et la sortie, sans traiter un échec comme une panne', async () => {
    shell.execShellYield.mockResolvedValue(done({
      success: false, exitCode: 1, stdout: 'ok', stderr: 'boom', durationMs: 4, ran: true,
    }));

    const result = await execBash({ command: 'npm test' }, ctx);

    expect(result.isError).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.output).toContain('exit_code: 1');
    expect(result.output).toContain('[stderr]');
    expect(result.output).toContain('boom');
    expect(shell.execShellYield).toHaveBeenCalledWith('npm test', expect.objectContaining({ yieldMs: 120_000 }));
  });

  it('au délai, la commande n’est pas tuée : elle continue en arrière-plan avec son job_id', async () => {
    shell.execShellYield.mockResolvedValue({ kind: 'running', jobId: 'job-7-1', output: 'Running Gradle task…', durationMs: 5_000 });
    const result = await execBash({ command: './gradlew assembleDebug', timeoutMs: 5_000 }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('[toujours en cours] après 5 s');
    expect(result.output).toContain('job_id: job-7-1');
    expect(result.output).toContain('ne la relance pas');
    expect(result.output).toContain('Running Gradle task');
    expect(shell.killProcess).not.toHaveBeenCalled();
  });

  it('marque une commande non lancée comme erreur', async () => {
    shell.execShellYield.mockResolvedValue(done({
      success: false, exitCode: 1, stdout: '', stderr: '⛔ refus', durationMs: 0, ran: false,
    }));
    const result = await execBash({ command: 'rm -rf /' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("n'a pas été exécutée");
  });

  it('laisse passer un message de commit qui contient « push » et un .env.example', async () => {
    shell.execShellYield.mockResolvedValue(done({ success: true, exitCode: 0, stdout: 'ok', stderr: '', durationMs: 1, ran: true }));
    await execBash({ command: 'git commit -m "fix push"' }, ctx);
    await execBash({ command: 'cat .env.example' }, ctx);
    expect(shell.execShellYield).toHaveBeenCalledTimes(2);
  });

  it('transmet une élévation approuvée à usage unique au shell', async () => {
    shell.execShellYield.mockResolvedValue(done({ success: true, exitCode: 0, stdout: 'ok', stderr: '', durationMs: 1, ran: true }));
    const escalatedCtx = { ...ctx, escalated: true };
    await execBash({ command: 'touch ../hors-projet', justification: 'nécessaire pour ce test' }, escalatedCtx);
    expect(shell.execShellYield).toHaveBeenCalledWith(
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

  it('passe d’office en arrière-plan une commande qui ne s’arrête jamais seule', async () => {
    shell.runShell.mockResolvedValue('job-auto');
    shell.getJob.mockReturnValue({ status: 'running', output: 'VITE ready', command: 'npm run dev' });

    const result = await execBash({ command: 'npm run dev' }, ctx);

    expect(shell.execShellYield).not.toHaveBeenCalled();
    expect(shell.runShell).toHaveBeenCalledWith('npm run dev', expect.anything());
    expect(result.output).toContain('[lancée en arrière-plan]');
    expect(result.output).toContain('job_id: job-auto');
  });

  it('cas Key : flutter test | tail au délai → arrière-plan, conseils de tests, filtre qui cache tout', async () => {
    shell.execShellYield.mockResolvedValue({ kind: 'running', jobId: 'job-9-1', output: '', durationMs: 300_000 });
    const result = await execBash({ command: 'flutter test 2>&1 | tail -40', timeoutMs: 300_000 }, ctx);
    expect(result.output).toContain('[toujours en cours] après 300 s');
    expect(result.output).toContain('--timeout 30s');
    expect(result.output).toContain('| tail');
    expect(result.output).toContain('job_kill');
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
    shell.execShellYield.mockResolvedValue(done({ success: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1, ran: true }));
    await execBash({ command: 'sleep 1', timeoutMs: 99_999_999 }, ctx);
    expect(shell.execShellYield).toHaveBeenCalledWith('sleep 1', expect.objectContaining({ yieldMs: 600_000 }));
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

  it('attend 30 s par défaut, et signale une sortie qui n’avance plus', async () => {
    vi.useFakeTimers();
    try {
      shell.waitForJob.mockResolvedValue({ status: 'running', output: 'test 1/3', command: 'flutter test' });
      await execJobOutput({ job_id: 'job-stuck' }, ctx);
      expect(shell.waitForJob).toHaveBeenLastCalledWith('job-stuck', 30_000, undefined);
      vi.advanceTimersByTime(45_000);
      const second = await execJobOutput({ job_id: 'job-stuck', wait_ms: 0 }, ctx);
      expect(shell.waitForJob).toHaveBeenLastCalledWith('job-stuck', 0, undefined);
      expect(second.output).toContain('[aucune nouvelle sortie depuis 45 s]');
      expect(second.output).toContain('job_kill');
    } finally {
      vi.useRealTimers();
    }
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
