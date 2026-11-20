import { describe, expect, it } from 'vitest';
import { AGENT_PROFILES, detectSubagentRole, getProfile, parseProfile, subagentSystemPrompt, SUBAGENT_ROLES } from './index';

describe('profils d’agents', () => {
  it('charge un profil par fichier Markdown', () => {
    expect(Object.keys(AGENT_PROFILES).sort()).toEqual(['dev', 'explorer', 'motion-designer', 'redaction']);
    for (const role of SUBAGENT_ROLES) expect(AGENT_PROFILES[role].kind).toBe('subagent');
  });

  it('explorateur : lecture seule, budget injecté dans les consignes', () => {
    const e = getProfile('explorer');
    expect(e.tools).toEqual(['read_file', 'list_dir', 'search_files', 'get_diagnostics']);
    expect(e.prompt).toContain(`Au plus ${e.maxSteps} étapes`);
    expect(e.prompt).not.toContain('{{');
  });

  it('motion-designer : consignes + skills obligatoires', () => {
    const p = subagentSystemPrompt('motion-designer') || '';
    expect(p).toContain('MOTION DESIGNER');
    expect(p).toContain('# SKILLS OBLIGATOIRES');
  });

  it('dev : aucune consigne en plus', () => {
    expect(subagentSystemPrompt('dev')).toBeUndefined();
  });

  it('détecte le rôle depuis la tâche', () => {
    expect(detectSubagentRole('Fais une pub animée')).toBe('motion-designer');
    expect(detectSubagentRole('Écris le slogan')).toBe('redaction');
    expect(detectSubagentRole('Corrige le bug du login')).toBe('dev');
  });

  it('borne max_steps', () => {
    expect(parseProfile('---\nname: x\nmax_steps: 999\n---\n', 'x').maxSteps).toBe(60);
  });
});
