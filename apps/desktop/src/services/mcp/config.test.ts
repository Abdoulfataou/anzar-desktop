import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { deniedMcpTools, loadServers, MCP_PRESETS, saveServers } from './config';

beforeEach(() => vi.mocked(invoke).mockReset());

describe('MCP config broker', () => {
  it('charge la configuration via Rust, jamais par le FS renderer', async () => {
    vi.mocked(invoke).mockResolvedValue([{ id: 'github', name: 'GitHub', transport: 'http', enabled: true }]);
    const servers = await loadServers();
    expect(servers).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('mcp_config_load');
  });

  it('enregistre via Rust (validation, fusion des secrets et permissions)', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await saveServers([{ id: 'github', name: 'GitHub', transport: 'http', enabled: true } as any]);
    expect(invoke).toHaveBeenCalledWith('mcp_config_save', { servers: expect.any(Array) });
  });
});

describe('connecteur GIMP', () => {
  it('lance la version épinglée, demande toujours l’accord et masque call_api', () => {
    const gimp = MCP_PRESETS.find((p) => p.id === 'gimp')!;
    const cfg = gimp.build({});
    expect(cfg).toMatchObject({ transport: 'stdio', command: 'uvx', args: ['gimp3-mcp@0.2.0'], alwaysAsk: true });
    expect(deniedMcpTools(cfg)).toEqual(['call_api']);
    expect(gimp.requirement).toContain('install-plugin');
  });

  it('ne bloque rien chez les autres connecteurs', () => {
    for (const p of MCP_PRESETS.filter((x) => x.id !== 'gimp')) {
      expect(deniedMcpTools(p.build({ token: 't' }))).toEqual([]);
    }
  });
});
