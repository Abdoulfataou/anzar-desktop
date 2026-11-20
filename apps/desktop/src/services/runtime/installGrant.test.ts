import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async (cmd: string, _a?: unknown) => (cmd === 'tool_wait' ? { code: 0, stdout: '', stderr: '' } : 1));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, a: unknown) => invoke(cmd, a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

describe('accord d\'installation', () => {
  it('passe approved une seule fois, pour la commande acceptée', async () => {
    const { terminalService } = await import('./terminal');
    const t = terminalService as any;
    t.allowedProjectPaths = new Set(['/Users/x/proj']);
    t.ensureToolEvents = async () => {};
    terminalService.grantInstall('npm install react react-dom');
    await t.runTool('a', 'npm', ['install', 'react', 'react-dom'], '/Users/x/proj');
    await t.runTool('b', 'npm', ['install', 'react', 'react-dom'], '/Users/x/proj');
    await t.runTool('c', 'npm', ['install', 'lodash'], '/Users/x/proj');
    const spawns = invoke.mock.calls.filter(([c]) => c === 'tool_spawn').map((c) => (c[1] as any).approved);
    expect(spawns).toEqual([true, false, false]);
  });
});
