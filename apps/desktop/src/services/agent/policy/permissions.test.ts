import { describe, expect, it } from 'vitest';
import { READ_ONLY_TOOLS, permissionChoiceOf, modeOfChoice, choiceKeepsSandbox } from './permissions';

describe('permissions', () => {
  it('garde les ensembles d’outils pour les sous-agents et l’espace ANZAR', () => {
    expect(READ_ONLY_TOOLS.has('read_file')).toBe(true);
    expect(READ_ONLY_TOOLS.has('write_file')).toBe(false);
  });

  it('le choix est le mode ; seul Accès complet retire l’isolation', () => {
    expect(permissionChoiceOf('auto', true)).toBe('auto');
    expect(permissionChoiceOf('full', true)).toBe('full');
    expect(modeOfChoice('full')).toBe('full');
    expect(choiceKeepsSandbox('full')).toBe(false);
    expect(choiceKeepsSandbox('auto')).toBe(true);
  });
});
