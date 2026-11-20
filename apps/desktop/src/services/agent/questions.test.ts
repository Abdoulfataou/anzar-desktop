import { describe, expect, it } from 'vitest';
import { formatAnswers, parseQuestions } from './questions';

describe('questions', () => {
  it('normalise les questions et détecte la recommandation par libellé', () => {
    const questions = parseQuestions({
      questions: [
        {
          question: 'Quelle couleur ?',
          header: 'Couleur',
          options: [{ label: 'Bleu' }, { label: 'Rouge (Recommandé)' }],
        },
        { question: 'Invalide', options: [{ label: 'Seule' }] },
      ],
    });

    expect(questions).toHaveLength(1);
    expect(questions[0].options.map((o) => o.label)).toEqual(['Bleu', 'Rouge']);
    expect(questions[0].recommended).toBe(1);
    expect(questions[0].header).toBe('Couleur');
  });

  it('accepte un index de recommandation explicite et le multi-select', () => {
    const [q] = parseQuestions({
      question: 'Choisis',
      options: ['A', 'B'],
      recommended: 0,
      multi_select: true,
    });
    expect(q.recommended).toBe(0);
    expect(q.multiSelect).toBe(true);
  });

  it('formate les réponses, y compris la réponse libre et l’auto-validation', () => {
    const text = formatAnswers([
      { question: 'Couleur ?', selected: ['Bleu'], other: 'turquoise', auto: true },
      { question: 'Taille ?', selected: [] },
    ]);
    expect(text).toContain('validées automatiquement');
    expect(text).toContain('Bleu ; « turquoise »');
    expect(text).toContain('(pas de réponse)');
  });
});
