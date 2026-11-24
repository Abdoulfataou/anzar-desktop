import { describe, expect, it } from 'vitest';
import { READ_ONLY_TOOLS } from './permissions';
import { CAPABILITY_TOOLS, subagentAllowedTools } from './subagentPolicy';

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

  it('refuse les outils des capacités déclarées (deny)', () => {
    const tools = subagentAllowedTools({
      ...base, mode: 'full',
      allToolNames: [...all, 'web_search', 'read_url', 'apply_patch'],
      deny: ['fs.write', 'network'],
    });
    expect(tools.has('write_file')).toBe(false);
    expect(tools.has('apply_patch')).toBe(false);
    expect(tools.has('web_search')).toBe(false);
    expect(tools.has('read_url')).toBe(false);
    // Les lectures restent, et task_done ne peut jamais être refusé.
    expect(tools.has('read_file')).toBe(true);
    // capture_page passe par le navigateur : refusé avec `network`.
    expect(tools.has('capture_page')).toBe(false);
    expect(tools.has('task_done')).toBe(true);
  });

  it('une capacité inconnue ne retire rien', () => {
    const tools = subagentAllowedTools({ ...base, mode: 'full', deny: ['fs.destroy'] });
    expect(tools.has('write_file')).toBe(true);
    expect(CAPABILITY_TOOLS['fs.write']).toContain('write_file');
    expect(CAPABILITY_TOOLS['fs.write']).toContain('apply_patch');
  });

  it('deny ne rouvre pas ce que la politique exclut', () => {
    const tools = subagentAllowedTools({ ...base, mode: 'full', deny: [] });
    expect(tools.has('run_command')).toBe(false);
  });

});
