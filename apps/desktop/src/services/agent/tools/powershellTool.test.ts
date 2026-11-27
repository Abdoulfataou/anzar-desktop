/**
 * Outil powershell (Windows) : même contrat que bash, plus la règle « fail closed » tant
 * que Windows n'a pas d'isolation des commandes (phase 3 du plan de parité).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/runtime/terminal', () => ({
  terminalService: {
    execShellYield: vi.fn(),
    runShell: vi.fn(),
    getJob: vi.fn(),
    killProcess: vi.fn(),
  },
  ESCALATION_HINT: '[sandbox: escalation available]',
}));
vi.mock('./shared', () => ({
  COMMAND_TIMEOUT_MS: 120_000,
  MAX_COMMAND_OUTPUT_CHARS: 12_000,
  resolvePath: async (_root: string, p?: string) => `C:/Users/a/projet/${p && p !== '.' ? p : ''}`.replace(/\/$/, ''),
  truncate: (text: string) => text,
}));

import { terminalService } from '@/services/runtime/terminal';
import { execPowerShell } from './bashTool';

const shell = vi.mocked(terminalService);
const done = (r: Record<string, unknown>) => ({ kind: 'finished' as const, result: r as any });
const ctx = (permissionMode: string, escalated = false) => ({ projectRoot: 'C:/Users/a/projet', permissionMode, escalated }) as any;

let saved: { platform: string; ua: string };
beforeEach(() => {
  vi.clearAllMocks();
  saved = { platform: navigator.platform, ua: navigator.userAgent };
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });
});
afterEach(() => {
  Object.defineProperty(navigator, 'platform', { value: saved.platform, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: saved.ua, configurable: true });
});

describe('execPowerShell — sans isolation sous Windows', () => {
  it('mode sans accord : refus net, rien n’est lancé', async () => {
    const r = await execPowerShell({ command: 'npm test' }, ctx('auto'));
    expect(r.isError).toBe(true);
    expect(r.output).toContain('Refusé');
    expect(shell.execShellYield).not.toHaveBeenCalled();
    expect(shell.runShell).not.toHaveBeenCalled();
  });

  it('mode avec accord : demande l’élévation (carte d’accord) au lieu de lancer', async () => {
    const r = await execPowerShell({ command: 'npm test' }, ctx('ask'));
    expect(r.isError).toBe(true);
    expect(r.output).toContain('[sandbox: unavailable');
    expect(r.output).toContain('escalation');
    expect(shell.execShellYield).not.toHaveBeenCalled();
  });

  it('après accord : lance la commande avec l’élévation, pas en accès libre', async () => {
    shell.execShellYield.mockResolvedValue(done({ success: true, exitCode: 0, stdout: 'ok', stderr: '', durationMs: 3, ran: true }));
    const r = await execPowerShell({ command: 'npm test', justification: 'lancer les tests' }, ctx('ask', true));
    expect(r.isError).toBe(false);
    const opts = shell.execShellYield.mock.calls[0][1];
    expect(opts.escalated).toBe(true);
    expect(opts.unconfined).toBe(false);
    expect(opts.escalationReason).toBe('lancer les tests');
  });

  it('Accès complet : lance directement, marqué « non confiné » pour Rust', async () => {
    shell.execShellYield.mockResolvedValue(done({ success: false, exitCode: 2, stdout: '', stderr: 'erreur TS', durationMs: 5, ran: true }));
    const r = await execPowerShell({ command: 'npx tsc --noEmit' }, ctx('full'));
    expect(r.isError).toBe(false);
    expect(r.failed).toBe(true);
    expect(r.output).toContain('exit_code: 2');
    expect(shell.execShellYield.mock.calls[0][1].unconfined).toBe(true);
  });

  it('un serveur part en arrière-plan, avec les mêmes droits', async () => {
    shell.runShell.mockResolvedValue('job-1');
    shell.getJob.mockReturnValue({ status: 'running', output: 'VITE ready', command: 'npm run dev' } as any);
    const r = await execPowerShell({ command: 'npm run dev' }, ctx('full'));
    expect(r.output).toContain('job_id: job-1');
    expect(shell.runShell.mock.calls[0][1]).toMatchObject({ unconfined: true });
    expect(shell.execShellYield).not.toHaveBeenCalled();
  });

  it('commande trop longue pour la ligne de commande Windows : refus avec la marche à suivre', async () => {
    const r = await execPowerShell({ command: 'x'.repeat(10_001) }, ctx('full'));
    expect(r.isError).toBe(true);
    expect(r.output).toContain('10');
    expect(r.output).toContain('write_file');
    expect(shell.execShellYield).not.toHaveBeenCalled();
  });
});
