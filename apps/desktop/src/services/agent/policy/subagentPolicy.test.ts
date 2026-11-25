import { describe, expect, it } from 'vitest';
import { READ_ONLY_TOOLS } from './permissions';
import { CAPABILITY_TOOLS, subagentAllowedTools } from './subagentPolicy';

const all = ['read_file', 'write_file', 'run_command', 'bash', 'job_output', 'job_kill', 'start_dev_server', 'spawn_subagents', 'spawn_agent', 'send_message', 'wait_agent', 'list_agents', 'export_animation', 'capture_page', 'task_done'];
const base = { allToolNames: all, readOnlyTools: READ_ONLY_TOOLS };

describe('subagentAllowedTools', () => {
  it('hérite de l’écriture et du shell du parent, sans récursion ni fonctions de l’app', () => {
    for (const mode of ['ask', 'auto', 'plan', 'full'] as const) {
      const tools = subagentAllowedTools({ ...base, mode });
      expect(tools.has('write_file'), mode).toBe(true);
      expect(tools.has('bash'), mode).toBe(true);
      expect(tools.has('run_command'), mode).toBe(true);
      expect(tools.has('job_output'), mode).toBe(true);
      expect(tools.has('spawn_agent'), mode).toBe(false);
      expect(tools.has('send_message'), mode).toBe(false);
      expect(tools.has('spawn_subagents'), mode).toBe(false);
      expect(tools.has('export_animation'), mode).toBe(false);
      expect(tools.has('task_done'), mode).toBe(true);
    }
  });

  it('un profil réduit encore le périmètre', () => {
    const tools = subagentAllowedTools({ ...base, mode: 'auto', profileTools: ['read_file', 'capture_page'] });
    expect(tools.has('read_file')).toBe(true);
    expect(tools.has('capture_page')).toBe(true);
    expect(tools.has('write_file')).toBe(false);
    expect(tools.has('task_done')).toBe(true);
  });

  it('sans déclaration, tous les outils non exclus sont là', () => {
    const tools = subagentAllowedTools({ ...base, mode: 'auto', profileTools: [] });
    expect(tools.has('write_file')).toBe(true);
    expect(tools.has('bash')).toBe(true);
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
    expect(tools.has('read_file')).toBe(true);
    expect(tools.has('capture_page')).toBe(false);
    expect(tools.has('task_done')).toBe(true);
  });

  it('une capacité inconnue ne retire rien', () => {
    const tools = subagentAllowedTools({ ...base, mode: 'full', deny: ['fs.destroy'] });
    expect(tools.has('write_file')).toBe(true);
    expect(CAPABILITY_TOOLS['fs.write']).toContain('write_file');
    expect(CAPABILITY_TOOLS['fs.write']).toContain('apply_patch');
  });
});
