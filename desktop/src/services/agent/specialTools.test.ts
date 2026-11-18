import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/skills', () => ({
  findSkill: vi.fn(),
  readSkillFile: vi.fn(),
  skillToolOutput: vi.fn((skill: any, prefix: string) => `${prefix}${skill.name} »\n\nbody`),
}));

import { findSkill, readSkillFile } from '@/services/skills';
import { askUser, loadSkill, parsePlan } from './specialTools';

const skill = { name: 'deploy', description: '', body: 'body', source: 'project', origin: '.agents', files: [], editable: true } as any;

beforeEach(() => {
  vi.mocked(findSkill).mockReset();
  vi.mocked(readSkillFile).mockReset();
});

describe('askUser', () => {
  it('refuse des questions invalides', async () => {
    const result = await askUser({}, { background: false, requestAnswers: vi.fn() });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('au moins une question');
  });

  it('choisit automatiquement en arrière-plan', async () => {
    const requestAnswers = vi.fn();
    const result = await askUser(
      { questions: [{ question: 'Q', options: ['A', 'B'] }] },
      { background: true, requestAnswers },
    );
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Personne');
    expect(requestAnswers).not.toHaveBeenCalled();
  });

  it('affiche les questions puis formate les réponses', async () => {
    const onQuestions = vi.fn();
    const result = await askUser(
      { questions: [{ question: 'Quelle couleur ?', options: ['Bleu', 'Rouge'] }] },
      {
        background: false,
        onQuestions,
        requestAnswers: vi.fn().mockResolvedValue([{ question: 'Quelle couleur ?', selected: ['Bleu'] }]),
      },
    );
    expect(onQuestions).toHaveBeenCalledWith(expect.any(Array), 'Quelle couleur ?');
    expect(result.output).toContain('Bleu');
  });

  it('demande à l’agent de décider si l’utilisateur passe', async () => {
    const result = await askUser(
      { questions: [{ question: 'Q', options: ['A', 'B'] }] },
      { background: false, requestAnswers: vi.fn().mockResolvedValue(null) },
    );
    expect(result.output).toContain("L'utilisateur a passé");
  });
});

describe('loadSkill', () => {
  it('signale une skill introuvable', async () => {
    vi.mocked(findSkill).mockReturnValue(undefined as any);
    const result = await loadSkill({ name: 'x' }, []);
    expect(result.isError).toBe(true);
    expect(result.output).toContain('introuvable');
  });

  it('renvoie le corps de la skill', async () => {
    vi.mocked(findSkill).mockReturnValue(skill);
    const result = await loadSkill({ name: 'deploy' }, [skill]);
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('deploy »');
  });

  it('lit un fichier joint et gère une erreur de lecture', async () => {
    vi.mocked(findSkill).mockReturnValue(skill);
    vi.mocked(readSkillFile).mockResolvedValueOnce('contenu');
    const ok = await loadSkill({ name: 'deploy', file: 'README.md' }, [skill]);
    expect(ok.output).toContain('contenu');

    vi.mocked(readSkillFile).mockRejectedValueOnce(new Error('absent'));
    const ko = await loadSkill({ name: 'deploy', file: 'missing.md' }, [skill]);
    expect(ko.isError).toBe(true);
    expect(ko.output).toContain('absent');
  });
});

describe('parsePlan', () => {
  it('normalise le titre et le markdown', () => {
    const plan = parsePlan({ title: 'Mon plan', plan: '## Étape' });
    expect(plan.title).toBe('Mon plan');
    expect(plan.markdown).toBe('## Étape');
    expect(plan.output).toContain('Plan affiché');
  });

  it('fournit des valeurs par défaut', () => {
    expect(parsePlan({}).title).toBe('Plan');
  });
});
