import { describe, expect, it } from 'vitest';
import { summarizeArgs, toolDelta, toolFilePath } from './toolDisplay';

describe('toolDisplay', () => {
  it('résume les arguments des outils principaux', () => {
    expect(summarizeArgs('read_file', { path: 'a.ts' })).toBe('a.ts');
    expect(summarizeArgs('list_dir', {})).toBe('.');
    expect(summarizeArgs('glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
    expect(summarizeArgs('run_command', { command: 'npm test' })).toBe('npm test');
    expect(summarizeArgs('spawn_subagents', { tasks: [{}, {}] })).toBe('2 sous-tâches');
    expect(summarizeArgs('ask_user', { questions: [{ question: 'A ?' }, { question: 'B ?' }] })).toBe('A ? · B ?');
  });

  it('résume un patch par son nombre de fichiers', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-a',
      '+b',
      '*** Add File: src/c.ts',
      '+c',
      '*** End Patch',
    ].join('\n');
    expect(summarizeArgs('apply_patch', { patch })).toBe('2 fichiers');
    expect(toolFilePath('apply_patch', { patch })).toBeUndefined();
    expect(toolFilePath('apply_patch', {
      patch: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** End Patch',
    })).toBe('src/a.ts');
  });

  it('calcule le chemin cliquable', () => {
    expect(toolFilePath('write_file', { path: 'src/a.ts' })).toBe('src/a.ts');
    expect(toolFilePath('export_animation', { format: 'gif' })).toBe('export/animation.gif');
    expect(toolFilePath('run_command', { command: 'ls' })).toBeUndefined();
  });

  it('calcule le delta de lignes sans compter une erreur', () => {
    expect(toolDelta('write_file', { content: 'a\nb\nc' }, false)).toEqual([3, 0]);
    expect(toolDelta('edit_file', { old_text: 'a\nb', new_text: 'a\nb\nc' }, false)).toEqual([3, 2]);
    expect(toolDelta('write_file', { content: 'a' }, true)).toBeUndefined();
    expect(toolDelta('read_file', {}, false)).toBeUndefined();
  });
});
