import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/runtime/terminal', () => ({
  terminalService: { exec: vi.fn() },
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
const ctx = { projectRoot: '/tmp/projet' } as any;

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

  it('refuse une commande interdite sans l’exécuter', async () => {
    exec.mockClear();
    const result = await execRunCommand({ command: 'bash -c "echo x"' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.output).toContain("n'a pas été exécutée");
    expect(exec).not.toHaveBeenCalled();
  });
});
