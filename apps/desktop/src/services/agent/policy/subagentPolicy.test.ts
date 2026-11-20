import { describe, expect, it } from 'vitest';
import { READ_ONLY_TOOLS } from './permissions';
import { subagentAllowedTools } from './subagentPolicy';

const all = ['read_file', 'write_file', 'run_command', 'start_dev_server', 'spawn_subagents', 'export_animation', 'task_done'];

describe('subagentAllowedTools', () => {
  it('en Full : écriture autorisée, commandes/spawn/export interdits', () => {
    const tools = subagentAllowedTools(all, 'full', READ_ONLY_TOOLS);
    expect(tools.has('write_file')).toBe(true);
    expect(tools.has('read_file')).toBe(true);
    expect(tools.has('run_command')).toBe(false);
    expect(tools.has('start_dev_server')).toBe(false);
    expect(tools.has('spawn_subagents')).toBe(false);
    expect(tools.has('export_animation')).toBe(false);
  });

  it('hors Full : lecture seule stricte', () => {
    const tools = subagentAllowedTools(all, 'auto', READ_ONLY_TOOLS);
    expect(tools.has('read_file')).toBe(true);
    expect(tools.has('write_file')).toBe(false);
    expect(tools.has('run_command')).toBe(false);
    expect(tools.has('spawn_subagents')).toBe(false);
  });
});
