import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/runtime/terminal', () => ({
  terminalService: { exec: vi.fn() },
  ESCALATION_HINT: '[sandbox: escalation available]',
}));
vi.mock('@/services/runtime/toolsRuntime', () => ({
  toolsCatalog: vi.fn().mockResolvedValue([]),
  toolInstall: vi.fn(),
  confirmToolInstall: vi.fn(),
}));
vi.mock('./shared', () => ({
  COMMAND_TIMEOUT_MS: 120_000,
  MAX_COMMAND_OUTPUT_CHARS: 12_000,
  resolvePath: async (_root: string, p?: string) => p || '.',
  truncate: (text: string) => text,
}));

import { terminalService } from '@/services/runtime/terminal';
import { execRunCommand } from './shellTools';

const exec = vi.mocked(terminalService.exec);
// Accès complet : ces tests portent sur la forme du résultat, pas sur l'isolation. Sans ce
// mode, Windows (ANZAR_TEST_PLATFORM=windows ou vrai runner) refuse avant d'exécuter — ce
// refus est testé à part plus bas.
const ctx = { projectRoot: '/tmp/projet', permissionMode: 'full' } as any;

describe('execRunCommand — contrat de résultat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('traite un code de sortie non nul comme un fait, pas comme une panne d’outil', async () => {
    exec.mockResolvedValue({
      success: false,
      ran: true,
      exitCode: 1,
      stdout: 'résultat partiel',
      stderr: 'AssertionError: attendu 2, reçu 1',
      durationMs: 12,
    });

    const result = await execRunCommand({ command: 'npm test' }, ctx);

    expect(result.isError).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.output).toContain('exit_code: 1');
    expect(result.output).toContain('résultat partiel');
    expect(result.output).toContain('[stderr]');
    expect(result.output).toContain('AssertionError');
  });

  it('dit clairement qu’une commande a dépassé son délai', async () => {
    exec.mockResolvedValue({
      success: false,
      ran: true,
      timedOut: true,
      exitCode: 130,
      stdout: '',
      stderr: '',
      durationMs: 120_000,
    });

    const result = await execRunCommand({ command: 'npm run build' }, ctx);

    expect(result.isError).toBe(false);
    expect(result.output).toContain('[délai dépassé]');
    expect(result.output).toContain('120 s');
  });

  it('marque une commande non lancée comme erreur, avec le motif', async () => {
    exec.mockResolvedValue({
      success: false,
      ran: false,
      exitCode: 1,
      stdout: '',
      stderr: '⛔ Programme introuvable',
      durationMs: 0,
    });

    const result = await execRunCommand({ command: 'python script.py' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.output).toContain("n'a pas été exécutée");
    expect(result.output).toContain('Programme introuvable');
  });

  it('marque un refus de l’isolation comme erreur d’action', async () => {
    exec.mockResolvedValue({
      success: false,
      ran: true,
      denied: true,
      exitCode: 1,
      stdout: '',
      stderr: '[ANZAR] Bloqué par l\'isolation des commandes : écris dans le projet.',
      durationMs: 3,
    });

    const result = await execRunCommand({ command: 'npm run build' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.output).toContain('[stderr]');
    expect(result.output).toContain("l'isolation");
  });


  it('Windows hors Accès complet : la commande ne part pas sans élévation', async () => {
    const platform = navigator.platform;
    const ua = navigator.userAgent;
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });
    try {
      exec.mockClear();
      const ask = await execRunCommand({ command: 'npm test' }, { projectRoot: '/p', permissionMode: 'ask' } as any);
      expect(ask.isError).toBe(true);
      expect(ask.output).toContain('[sandbox: unavailable');
      const auto = await execRunCommand({ command: 'npm test' }, { projectRoot: '/p', permissionMode: 'auto' } as any);
      expect(auto.output).toContain('Refusé');
      expect(exec).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
      Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    }
  });

  it('refuse de bloquer 2 minutes sur une commande sans fin, et oriente vers start_dev_server', async () => {
    const result = await execRunCommand({ command: 'npm run dev' }, ctx);
    expect(exec).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.output).toContain('start_dev_server');
  });
});
