import { describe, expect, it } from 'vitest';
import { EDIT_TOOLS, READ_ONLY_TOOLS, COMMAND_TOOLS, needsApproval } from './permissions';

describe('permissions', () => {
  it('classe les outils', () => {
    expect(EDIT_TOOLS.has('write_file')).toBe(true);
    expect(EDIT_TOOLS.has('apply_patch')).toBe(true);
    expect(EDIT_TOOLS.has('read_file')).toBe(false);
    expect(COMMAND_TOOLS.has('run_command')).toBe(true);
    expect(READ_ONLY_TOOLS.has('search_files')).toBe(true);
    expect(READ_ONLY_TOOLS.has('glob')).toBe(true);
    expect(READ_ONLY_TOOLS.has('apply_patch')).toBe(false);
    expect(READ_ONLY_TOOLS.has('write_file')).toBe(false);
  });

  it('mode ask : écriture et commandes demandent un accord', () => {
    expect(needsApproval('ask', 'write_file')).toBe(true);
    expect(needsApproval('ask', 'run_command')).toBe(true);
    expect(needsApproval('ask', 'read_file')).toBe(false);
  });

  it('mode auto : aucune demande générique (les risques sont traités à part)', () => {
    expect(needsApproval('auto', 'write_file')).toBe(false);
    expect(needsApproval('auto', 'run_command')).toBe(false);
    expect(needsApproval('auto', 'spawn_subagents')).toBe(false);
  });

  it('modes plan/full : pas d’accord générique (plan est gardé ailleurs)', () => {
    expect(needsApproval('plan', 'write_file')).toBe(false);
    expect(needsApproval('full', 'run_command')).toBe(false);
  });
});
