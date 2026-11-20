import { beforeEach, describe, expect, it, vi } from 'vitest';

const exec = vi.fn();
vi.mock('@/services/runtime/terminal', () => ({ terminalService: { exec: (...a: unknown[]) => exec(...a) } }));
vi.mock('@/services/filesystem/fileSystem', () => ({
  fileSystemService: {
    readFile: vi.fn(async () => JSON.stringify({ scripts: { lint: 'eslint .', build: 'vite build' } })),
    exists: vi.fn(async () => false),
  },
}));

import { runVerification } from './agentVerifier';

describe('runVerification', () => {
  beforeEach(() => {
    exec.mockReset();
    exec.mockResolvedValue({ success: true, stdout: 'ok', stderr: '', exitCode: 0, durationMs: 5 });
  });

  it('lance lint puis build quand tout est autorisé', async () => {
    const r = await runVerification('/p', { approve: async () => true });
    expect(exec.mock.calls.map((c) => c[0])).toEqual(['npm run lint', 'npm run build']);
    expect(r.passed).toBe(true);
  });

  it("n'exécute pas une commande refusée et la compte comme ignorée", async () => {
    const r = await runVerification('/p', { approve: async (cmd) => cmd.label !== 'build' });
    expect(exec.mock.calls.map((c) => c[0])).toEqual(['npm run lint']);
    const build = r.results.find((x) => x.label === 'build');
    expect(build?.skipped).toBe(true);
    expect(r.passed).toBe(true);
  });

  it("signale l'échec avec la sortie de la commande", async () => {
    exec.mockResolvedValueOnce({ success: false, stdout: '', stderr: 'src/a.ts: erreur', exitCode: 1, durationMs: 5 });
    const r = await runVerification('/p');
    expect(r.passed).toBe(false);
    expect(r.failureSummary).toContain('src/a.ts: erreur');
  });
});
