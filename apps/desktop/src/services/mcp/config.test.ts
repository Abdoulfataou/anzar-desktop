import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { loadServers, saveServers } from './config';

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
