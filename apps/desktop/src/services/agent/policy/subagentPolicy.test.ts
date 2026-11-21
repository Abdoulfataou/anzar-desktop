import { describe, expect, it } from 'vitest';
import { READ_ONLY_TOOLS } from './permissions';
import { subagentAllowedTools } from './subagentPolicy';

const all = ['read_file', 'write_file', 'run_command', 'start_dev_server', 'spawn_subagents', 'export_animation', 'capture_page', 'task_done'];
const base = { allToolNames: all, readOnlyTools: READ_ONLY_TOOLS };

describe('subagentAllowedTools', () => {
  it('en Full : écriture autorisée, commandes/spawn/export interdits', () => {
    const tools = subagentAllowedTools({ ...base, mode: 'full' });
    expect(tools.has('write_file')).toBe(true);
    expect(tools.has('read_file')).toBe(true);
    expect(tools.has('run_command')).toBe(false);
    expect(tools.has('start_dev_server')).toBe(false);
    expect(tools.has('spawn_subagents')).toBe(false);
    expect(tools.has('export_animation')).toBe(false);
  });

  it('hors Full : lecture seule stricte', () => {
    const tools = subagentAllowedTools({ ...base, mode: 'auto' });
    expect(tools.has('read_file')).toBe(true);
    expect(tools.has('write_file')).toBe(false);
    expect(tools.has('run_command')).toBe(false);
    expect(tools.has('spawn_subagents')).toBe(false);
    expect(tools.has('task_done')).toBe(true);
  });

  it('un profil réduit encore le périmètre', () => {
    const tools = subagentAllowedTools({
      ...base, mode: 'full',
      profileTools: ['read_file', 'write_file', 'capture_page', 'export_animation', 'run_command'],
    });
    expect(tools.has('write_file')).toBe(true);
    expect(tools.has('capture_page')).toBe(true);
    // Exclusions de la politique des sous-agents : un profil ne les rouvre pas.
    expect(tools.has('export_animation')).toBe(false);
    expect(tools.has('run_command')).toBe(false);
    // task_done termine le sous-agent : toujours là.
    expect(tools.has('task_done')).toBe(true);
  });

  it('un profil ne peut pas élargir hors Full', () => {
    const tools = subagentAllowedTools({
      ...base, mode: 'auto',
      profileTools: ['write_file', 'run_command', 'read_file'],
    });
    expect(tools.has('write_file')).toBe(false);
    expect(tools.has('run_command')).toBe(false);
    expect(tools.has('read_file')).toBe(true);
  });

  it('sans déclaration, la politique du mode s’applique seule', () => {
    expect(subagentAllowedTools({ ...base, mode: 'full', profileTools: [] }).has('write_file')).toBe(true);
  });
});
