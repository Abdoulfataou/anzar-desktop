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

  it('ne masque rien chez les connecteurs qui ne passent pas par uvx', () => {
    for (const p of MCP_PRESETS.filter((x) => x.build({ token: 't' }).command !== 'uvx')) {
      expect(deniedMcpTools(p.build({ token: 't' }))).toEqual([]);
    }
  });
});

describe('connecteurs Blender et Inkscape', () => {
  it('versions épinglées, accord à chaque action, outils dangereux masqués', () => {
    const blender = MCP_PRESETS.find((p) => p.id === 'blender')!.build({});
    expect(blender).toMatchObject({ command: 'uvx', args: ['mcp-for-blender@2.3.1'], alwaysAsk: true });
    expect(deniedMcpTools(blender)).toEqual(['execute_blender_code', 'record_trajectory_feedback']);
    const inkscape = MCP_PRESETS.find((p) => p.id === 'inkscape')!.build({});
    expect(inkscape).toMatchObject({ command: 'uvx', args: ['inkscape-mcp@2.0.0'], alwaysAsk: true });
    expect(deniedMcpTools(inkscape)).toEqual([]); // blocage par opération, fait par Rust
  });
});

describe('connecteurs Audacity et OBS', () => {
  it('Audacity : commande exacte, enregistrement au micro masqué', () => {
    const a = MCP_PRESETS.find((p) => p.id === 'audacity')!.build({});
    expect(a).toMatchObject({ command: 'uvx', args: ['--from', 'audacity-mcp-server==0.1.23', 'audacity-mcp'], alwaysAsk: true });
    expect(deniedMcpTools(a)).toEqual(['transport_record']);
  });

  it('OBS : mot de passe en variable, clé de diffusion jamais exposée', () => {
    const o = MCP_PRESETS.find((p) => p.id === 'obs')!.build({ password: ' secret ', port: '' });
    expect(o).toMatchObject({ command: 'uvx', args: ['obs-mcp@0.2.0'], env: { OBS_PASSWORD: 'secret' }, alwaysAsk: true });
    expect(o.env).not.toHaveProperty('OBS_PORT');
    expect(deniedMcpTools(o)).toContain('get_stream_service_settings');
    expect(deniedMcpTools(o)).toContain('call_vendor_request');
  });
});
