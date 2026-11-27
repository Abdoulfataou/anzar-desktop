import { beforeEach, describe, expect, it, vi } from 'vitest';

// Simule Rust : tool_wait rend la main quand le test le décide (fin) ou après tool_kill.
let finish: ((r: { code: number; stdout: string; stderr: string }) => void) | null = null;
const invoke = vi.fn(async (cmd: string, _a?: unknown) => {
  if (cmd === 'tool_wait') return new Promise((r) => { finish = r; });
  if (cmd === 'tool_kill') { finish?.({ code: 130, stdout: '', stderr: '' }); return null; }
  return 42; // tool_spawn : pid
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, a: unknown) => invoke(cmd, a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

async function service() {
  const { terminalService } = await import('./terminal');
  const t = terminalService as any;
  t.allowedProjectPaths = new Set(['/Users/x/proj']);
  t.ensureToolEvents = async () => {};
  return t;
}

describe('commande au premier plan : rend la main au délai sans tuer', () => {
  beforeEach(() => { invoke.mockClear(); finish = null; });

  it('une commande qui finit avant son délai rend son résultat exact, puis est oubliée', async () => {
    const t = await service();
    const pending = t.execShellYield('npm test', { cwd: '/Users/x/proj', yieldMs: 5_000 });
    await vi.waitFor(() => expect(finish).not.toBeNull());
    finish!({ code: 1, stdout: '3 passed\n', stderr: '1 failed\n' });
    const r = await pending;
    expect(r.kind).toBe('finished');
    expect(r.result).toMatchObject({ exitCode: 1, stdout: '3 passed', stderr: '1 failed', ran: true, success: false });
    expect(t.processes.size).toBe(0);
    expect(t.outputHistory.size).toBe(0);
  });

  it('au délai, rend l’identifiant et la sortie déjà produite ; le processus n’est pas tué', async () => {
    const t = await service();
    const r = await t.execShellYield('./gradlew assembleDebug', { cwd: '/Users/x/proj', yieldMs: 20 });
    expect(r.kind).toBe('running');
    expect(invoke.mock.calls.some(([c]) => c === 'tool_kill')).toBe(false);
    expect(t.getJob(r.jobId)?.status).toBe('running');
    // La suite se lit comme un travail d'arrière-plan
    t.emitOutput(r.jobId, 'stdout', 'BUILD SUCCESSFUL');
    expect(t.getJob(r.jobId)?.output).toContain('BUILD SUCCESSFUL');
    await t.killProcess(r.jobId);
  });

  it('le bouton Stop arrête une commande rendue au délai', async () => {
    const t = await service();
    const ctrl = new AbortController();
    const r = await t.execShellYield('flutter test', { cwd: '/Users/x/proj', yieldMs: 20, signal: ctrl.signal });
    expect(r.kind).toBe('running');
    ctrl.abort();
    await vi.waitFor(() => expect(invoke.mock.calls.some(([c]) => c === 'tool_kill')).toBe(true));
    expect(t.getJob(r.jobId)?.status).toBe('killed');
  });
});
