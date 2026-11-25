import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '@/types';

vi.mock('./index', () => ({ executeToolCall: vi.fn() }));
vi.mock('./webTools', () => ({
  executeWebTool: vi.fn(),
  WEB_TOOL_NAMES: new Set(['web_search', 'read_url']),
}));
vi.mock('@/services/mcp/manager', () => ({
  callMcpTool: vi.fn(),
  isMcpTool: (name: string) => name.startsWith('mcp__'),
}));
vi.mock('@/services/workspace/personalSpace', () => ({
  PERSONAL_SPACE_TOOLS: new Set(['read_file']),
}));

import { executeToolCall } from './index';
import { executeWebTool } from './webTools';
import { callMcpTool } from '@/services/mcp/manager';
import { executeGenericTool } from './toolExecution';
import { clearFileConflicts } from '../policy/fileConflicts';

const call = (name: string): ToolCall => ({
  id: 'c1',
  type: 'function',
  function: { name, arguments: '{}' },
});

beforeEach(() => {
  clearFileConflicts();
  vi.mocked(executeToolCall).mockReset();
  vi.mocked(executeWebTool).mockReset();
  vi.mocked(callMcpTool).mockReset();
});

describe('executeGenericTool', () => {
  it('route les outils web', async () => {
    vi.mocked(executeWebTool).mockResolvedValue({ output: 'web', costFCFA: 3 } as any);
    const result = await executeGenericTool(call('web_search'), { query: 'x' }, { agentRoot: '/p', workspacePath: '/p' });
    expect(executeWebTool).toHaveBeenCalledWith('web_search', { query: 'x' }, undefined);
    expect(result.output).toBe('web');
  });

  it('route les connecteurs MCP', async () => {
    vi.mocked(callMcpTool).mockResolvedValue({ output: 'mcp' } as any);
    const result = await executeGenericTool(call('mcp__github__list'), {}, { agentRoot: '/p', workspacePath: '/p' });
    expect(callMcpTool).toHaveBeenCalled();
    expect(result.output).toBe('mcp');
  });

  it('route les outils locaux quand un projet est ouvert', async () => {
    vi.mocked(executeToolCall).mockResolvedValue({ output: 'local' } as any);
    const onFileChanged = vi.fn();
    const result = await executeGenericTool(call('read_file'), { path: 'a.ts' }, {
      agentRoot: '/p',
      workspacePath: '/p',
      onFileChanged,
    });
    expect(executeToolCall).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), expect.objectContaining({ projectRoot: '/p' }));
    expect(result.output).toBe('local');
  });

  it('refuse une écriture après la modification d’un autre agent', async () => {
    vi.mocked(executeToolCall).mockResolvedValue({ output: 'ok' } as any);
    const base = { agentRoot: '/p', workspacePath: '/p', convId: 'c1', agentId: 'lead' };
    await executeGenericTool(call('read_file'), { path: 'a.ts' }, base);
    await executeGenericTool(call('write_file'), { path: 'a.ts', content: 'x' }, { ...base, agentId: 'child' });
    const conflict = await executeGenericTool(call('write_file'), { path: 'a.ts', content: 'y' }, base);
    expect(conflict.isError).toBe(true);
    expect(conflict.output).toContain('autre agent');
    expect(conflict.output).toContain('Relis');
    expect(executeToolCall).toHaveBeenCalledTimes(2);
  });

  it('refuse sans dossier de travail', async () => {
    const result = await executeGenericTool(call('read_file'), {}, { agentRoot: null, workspacePath: null });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('Aucun dossier');
  });
});
