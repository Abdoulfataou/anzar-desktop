import { describe, expect, it, vi } from 'vitest';

// tool_wait ne rend la main qu'une fois la commande tuée (comme Rust).
let release: (() => void) | null = null;
const invoke = vi.fn(async (cmd: string, _a?: unknown) => {
  if (cmd === 'tool_wait') {
    await new Promise<void>((r) => { release = r; });
    return { code: 130, stdout: 'partiel', stderr: '' };
  }
  if (cmd === 'tool_kill') { release?.(); return null; }
  return 1;
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, a: unknown) => invoke(cmd, a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

describe('bouton Stop', () => {
  it('arrête la commande en cours au lieu d’attendre sa fin', async () => {
    const { terminalService, STOPPED_MESSAGE } = await import('./terminal');
    const t = terminalService as any;
    t.allowedProjectPaths = new Set(['/Users/x/proj']);
    t.ensureToolEvents = async () => {};
    const ctrl = new AbortController();
    const run = t.runTool('s', 'flutter', ['pub', 'get'], '/Users/x/proj', 120_000, ctrl.signal);
    await new Promise((r) => setTimeout(r, 0));
    ctrl.abort();
    const r = await run;
    expect(invoke.mock.calls.some(([c]) => c === 'tool_kill')).toBe(true);
    expect(r.code).toBe(130);
    expect(r.stderr).toContain(STOPPED_MESSAGE);
  });

  it('ne lance rien si la tâche est déjà arrêtée', async () => {
    const { terminalService } = await import('./terminal');
    const t = terminalService as any;
    invoke.mockClear();
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await t.runTool('s2', 'npm', ['install'], '/Users/x/proj', 120_000, ctrl.signal);
    expect(r.code).toBe(130);
    expect(invoke.mock.calls.some(([c]) => c === 'tool_spawn')).toBe(false);
  });
});
