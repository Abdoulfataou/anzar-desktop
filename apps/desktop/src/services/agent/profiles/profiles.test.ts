import { describe, expect, it } from 'vitest';
import {
  AGENT_PROFILES, detectSubagentRole, getProfile, isSubagentRole, parseProfile,
  subagentSystemPrompt, SUBAGENT_ROLES,
} from './index';
import { AGENT_TOOLS } from '../tools/definitions';
import { validateAllProfiles, validateProfile } from './validate';

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

  it('dérive les rôles des profils (kind: subagent), sans liste figée', () => {
    expect(SUBAGENT_ROLES).toEqual(['dev', 'motion-designer', 'redaction']);
    expect(isSubagentRole('dev')).toBe(true);
    expect(isSubagentRole('explorer')).toBe(false);
    expect(isSubagentRole('inconnu')).toBe(false);
  });

  it('lit les outils, le modèle et les mots-clés du frontmatter', () => {
    const motion = getProfile('motion-designer');
    expect(motion.tools).toContain('write_file');
    expect(motion.tools).toContain('export_animation');
    expect(motion.keywords.length).toBeGreaterThan(3);
    expect(getProfile('dev').model).toBe('fast');
    expect(getProfile('explorer').kind).toBe('explorer');
  });

  it('devine le rôle par mots-clés, avec dev par défaut', () => {
    expect(detectSubagentRole('monte une vidéo pub')).toBe('motion-designer');
    expect(detectSubagentRole('rédige la description')).toBe('redaction');
    expect(detectSubagentRole('refactorise le module')).toBe('dev');
  });

  it('les manifestes livrés sont valides', () => {
    const issues = validateAllProfiles(AGENT_TOOLS.map((t) => t.function.name));
    expect(issues).toEqual([]);
  });

  it('signale un manifeste incohérent', () => {
    const bad = {
      ...AGENT_PROFILES.explorer,
      name: 'Bad Name',
      tools: ['readfile'],
      model: 'turbo' as never,
      maxSteps: 999,
      description: '',
    };
    const issues = validateProfile(bad, ['read_file']);
    expect(issues.join(' | ')).toMatch(/nom invalide/);
    expect(issues.join(' | ')).toMatch(/outil inconnu : readfile/);
    expect(issues.join(' | ')).toMatch(/modèle inconnu : turbo/);
    expect(issues.join(' | ')).toMatch(/description vide/);
    expect(issues.join(' | ')).toMatch(/max_steps hors bornes/);
  });

  it('lit un budget déclaré', () => {
    expect(getProfile('redaction').budgetFCFA).toBe(30);
    expect(parseProfile('---\nname: z\nbudget_fcfa: 12\n---\n', 'z').budgetFCFA).toBe(12);
  });

  it('borne max_steps et lit tools/model/keywords', () => {
    expect(parseProfile('---\nname: x\nmax_steps: 999\n---\n', 'x').maxSteps).toBe(60);
    const p = parseProfile('---\nname: y\ntools: read_file, write_file\nmodel: max\nkeywords: pub video\n---\n', 'y');
    expect(p.tools).toEqual(['read_file', 'write_file']);
    expect(p.model).toBe('max');
    expect(p.keywords).toEqual(['pub', 'video']);
  });

  it('lit les capacités refusées et le plafond de sortie', () => {
    const p = parseProfile('---\nname: z\ndeny: fs.write, network\noutput_max_chars: 900\n---\n', 'z');
    expect(p.deny).toEqual(['fs.write', 'network']);
    expect(p.outputMaxChars).toBe(900);
    expect(getProfile('redaction').deny).toEqual(['shell.exec', 'network']);
    expect(getProfile('redaction').outputMaxChars).toBe(800);
  });

  it('signale une capacité inconnue et un plafond hors bornes', () => {
    const bad = { ...AGENT_PROFILES.explorer, deny: ['fs.destroy'], outputMaxChars: 50 };
    const issues = validateProfile(bad, ['read_file']);
    expect(issues.join(' | ')).toMatch(/capacité inconnue : fs.destroy/);
    expect(issues.join(' | ')).toMatch(/output_max_chars hors bornes : 50/);
  });

});
