import { describe, expect, it } from 'vitest';
import { parseSkill, parseToolList, serializeSkill } from './format';

describe('format SKILL.md', () => {
  it('lit allowed-tools en ligne', () => {
    const s = parseSkill('---\nname: deploy\ndescription: Déployer\nallowed-tools: Read Bash(git:*) Write\n---\nCorps', 'x');
    expect(s.allowedTools).toEqual(['Read', 'Bash(git:*)', 'Write']);
  });

  it('lit allowed-tools en liste YAML', () => {
    const s = parseSkill('---\nname: deploy\ndescription: D\nallowed-tools:\n  - read_file\n  - run_command\n---\nCorps', 'x');
    expect(s.allowedTools).toEqual(['read_file', 'run_command']);
  });

  it('ignore un objet imbriqué sans casser les autres clés', () => {
    const s = parseSkill('---\nname: a\nmetadata:\n  author: moi\ndescription: Desc\n---\nCorps', 'x');
    expect(s.description).toBe('Desc');
    expect(s.allowedTools).toBeUndefined();
  });

  it('parseToolList tolère les virgules', () => {
    expect(parseToolList('Read, Write')).toEqual(['Read', 'Write']);
  });

  it('une description avec guillemets et barres obliques inverses survit à l’aller-retour', () => {
    const description = 'Déployer « l\'API » : chemin C:\\app et option "--prod"';
    const back = parseSkill(serializeSkill({ name: 'deploiement', description, body: 'Étapes.' }), 'x');
    expect(back.description).toBe(description);
  });

  it('lit les guillemets simples YAML', () => {
    expect(parseSkill("---\nname: a\ndescription: 'L''API publique'\n---\nx", 'a').description).toBe("L'API publique");
  });
});
