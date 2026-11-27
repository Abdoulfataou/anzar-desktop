import { describe, expect, it } from 'vitest';
import { buildSubagentSystemPrompt, commandsFact, toolsSection } from './subagentPrompt';
import { AGENT_PROFILES } from '../profiles';
import type { Skill } from '@/services/skills';

const project = { projectName: 'boutique', projectRoot: '/p/boutique', memory: 'Utiliser pnpm.', codeMap: 'src/app.ts' };
const skill = (name: string, description: string): Skill => ({ name, description, body: '', source: 'builtin', origin: 'ANZAR', files: [], editable: false });
const devTools = ['read_file', 'search_files', 'edit_file', 'write_file', 'bash', 'get_diagnostics', 'load_skill', 'task_done'];

describe('prompt des sous-agents', () => {
  it('dit au sous-agent qui il est, ce qu’il ne peut pas faire et ce qu’il doit rendre', () => {
    const p = buildSubagentSystemPrompt({ project, profile: AGENT_PROFILES.dev, tools: devTools, permissionMode: 'auto', windows: false, maxSteps: 30 });
    expect(p).toContain("Tu es un sous-agent d'ANZAR, rôle « dev »");
    expect(p).toContain('ne pose aucune question');
    expect(p).toContain('# Rapport final (dans task_done)');
    expect(p).toContain('**Fichiers**');
    expect(p).toContain('Au plus 30 étapes');
    expect(p).toContain('# Ton rôle');
    // Projet : mémoire et carte du code partagées avec l'agent principal
    expect(p).toContain('Utiliser pnpm.');
    expect(p).toContain('src/app.ts');
  });

  it('ne cite jamais un outil que le sous-agent n’a pas', () => {
    const p = buildSubagentSystemPrompt({ project, profile: AGENT_PROFILES.dev, tools: devTools, permissionMode: 'auto', windows: false, maxSteps: 30 });
    for (const absent of ['ask_user', 'spawn_agent', 'wait_agent', 'web_search', 'run_command', 'export_animation', 'propose_plan']) {
      expect(p, absent).not.toContain(absent);
    }
    expect(toolsSection(devTools)).toContain('Commandes : bash');
  });

  it('aucun rôle livré ne se voit proposer un outil absent', async () => {
    const { subagentAllowedTools } = await import('../policy/subagentPolicy');
    const { READ_ONLY_TOOLS } = await import('../policy/permissions');
    const { AGENT_TOOLS, BASH_TOOLS } = await import('../tools/definitions');
    const every = [...AGENT_TOOLS, ...BASH_TOOLS].map((t) => t.function.name);
    for (const role of ['dev', 'motion-designer', 'redaction', 'revue']) {
      const profile = AGENT_PROFILES[role];
      const tools = new Set([...subagentAllowedTools({ allToolNames: every, mode: 'auto', readOnlyTools: READ_ONLY_TOOLS, profileTools: profile.tools, deny: profile.deny }), 'load_skill']);
      // Le texte généré (hors consignes du rôle et des skills) ne parle que d'outils présents.
      const generic = buildSubagentSystemPrompt({ project, tools, permissionMode: 'auto', windows: false, maxSteps: 20 });
      for (const name of every) {
        if (!tools.has(name)) expect(generic, `${role} → ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
      expect(tools.has('remember'), role).toBe(false);
    }
  });

  it('lecture seule : méthode et rapport de relecture, sans consignes d’écriture', () => {
    const p = buildSubagentSystemPrompt({ project, profile: AGENT_PROFILES.revue, tools: ['read_file', 'search_files', 'get_diagnostics', 'bash', 'task_done'], permissionMode: 'auto', windows: false, maxSteps: 25 });
    expect(p).toContain('Tu ne modifies aucun fichier');
    expect(p).toContain('**Constats**');
    expect(p).not.toContain('**Fichiers**');
    expect(p).not.toContain('réapplique ta modification');
    expect(p).not.toContain('Pas de commit');
    expect(p).toContain('jamais pour modifier un fichier');
  });

  it('liste les skills et injecte celles du rôle sans doublon', () => {
    const skills = [skill('tdd', 'Tests d’abord'), skill('motion-system', 'Système de motion')];
    const dev = buildSubagentSystemPrompt({ project, profile: AGENT_PROFILES.dev, tools: devTools, windows: false, skills, maxSteps: 30 });
    expect(dev).toContain('# Skills disponibles');
    expect(dev).toContain('- tdd : Tests d’abord');
    expect(dev).toContain('charge-la avec load_skill AVANT d\'agir');

    const motionTools = [...AGENT_PROFILES['motion-designer'].tools, 'load_skill', 'task_done'];
    const motion = buildSubagentSystemPrompt({ project, profile: AGENT_PROFILES['motion-designer'], tools: motionTools, windows: false, skills, maxSteps: 30 });
    expect(motion).toContain('# Skills de ton rôle (applique-les à la lettre)');
    expect(motion).toContain('export_animation');
    expect(motion).not.toContain('- motion-system : Système de motion');
  });

  it('sans load_skill, pas de liste de skills', () => {
    const p = buildSubagentSystemPrompt({ project, tools: ['read_file', 'task_done'], windows: false, skills: [skill('tdd', 'x')], maxSteps: 10 });
    expect(p).not.toContain('# Skills disponibles');
    expect(p).toContain('Tu ne modifies aucun fichier');
  });

  it('décrit les commandes sans promesse fausse', () => {
    const shell = new Set(['bash']);
    expect(commandsFact(shell, 'auto', false)).toMatch(/confinées au projet/);
    expect(commandsFact(shell, 'full', false)).toMatch(/Accès complet/);
    expect(commandsFact(new Set(), 'auto', true)).toMatch(/Windows/);
    expect(commandsFact(new Set(), 'full', true)).toMatch(/pas de commandes/);
    expect(commandsFact(new Set(), 'auto', false)).not.toMatch(/get_diagnostics/);
    expect(commandsFact(new Set(['get_diagnostics']), 'auto', false)).toMatch(/get_diagnostics/);
  });

  it('chaque rôle livré a des consignes et une description', () => {
    for (const role of ['dev', 'motion-designer', 'redaction', 'revue']) {
      expect(AGENT_PROFILES[role]?.prompt.length, role).toBeGreaterThan(100);
      expect(AGENT_PROFILES[role]?.description.length, role).toBeGreaterThan(40);
    }
  });

  it('une skill du projet citée par le rôle est injectée avec son contenu', () => {
    const profile = { ...AGENT_PROFILES.dev, name: 'expert-paiement', skills: ['notre-api'] };
    const own: Skill = { ...skill('notre-api', 'Conventions de notre API'), body: 'Toujours paginer par curseur.', source: 'project' };
    const p = buildSubagentSystemPrompt({ project, profile, tools: devTools, windows: false, skills: [own], maxSteps: 20 });
    expect(p).toContain('# Skills de ton rôle');
    expect(p).toContain('Toujours paginer par curseur.');
    expect(p).not.toContain('- notre-api :');
  });

  it('un sous-agent ne voit pas les skills réservées à l’agent principal', () => {
    const skills = [skill('brainstorming', 'Questions à l’utilisateur'), skill('developpement-par-sous-agents', 'Plan en lots'), skill('cause-racine', 'Remonter au bug')];
    const p = buildSubagentSystemPrompt({ project, profile: AGENT_PROFILES.dev, tools: devTools, windows: false, skills, maxSteps: 20 });
    expect(p).toContain('- cause-racine : Remonter au bug');
    expect(p).not.toContain('brainstorming');
    expect(p).not.toContain('developpement-par-sous-agents');
  });
});
