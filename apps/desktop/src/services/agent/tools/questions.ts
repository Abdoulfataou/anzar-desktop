/**
 * Questions de l'outil ask_user : normalisation des arguments du modèle et
 * formatage des réponses renvoyées à l'agent. Fonctions pures.
 */

export interface AgentQuestionOption {
  label: string;
  description?: string;
}

export interface AgentQuestion {
  question: string;
  header?: string;
  options: AgentQuestionOption[];
  /** Index de l'option recommandée */
  recommended?: number;
  multiSelect?: boolean;
}

export interface QuestionRequest {
  id: string;
  questions: AgentQuestion[];
}

export interface QuestionAnswer {
  question: string;
  selected: string[];
  other?: string;
  /** true = choix par défaut validé automatiquement après le délai d'attente */
  auto?: boolean;
}

/** Normalise les arguments de l'outil (le modèle peut s'écarter un peu du schéma). */
export function parseQuestions(args: any): AgentQuestion[] {
  const raw = Array.isArray(args?.questions) ? args.questions : args?.question ? [args] : [];
  return raw.slice(0, 4).map((q: any) => {
    const options: AgentQuestionOption[] = (Array.isArray(q?.options) ? q.options : [])
      .map((o: any) => (typeof o === 'string' ? { label: o } : { label: String(o?.label ?? ''), description: o?.description ? String(o.description) : undefined }))
      .filter((o: AgentQuestionOption) => o.label.trim())
      .slice(0, 6);
    // Recommandée : index fourni, sinon libellé terminé par « (Recommandé) »
    let recommended = Number.isInteger(q?.recommended) ? Number(q.recommended) : -1;
    options.forEach((o, i) => {
      if (/\((recommand[ée]e?|recommended)\)\s*$/i.test(o.label)) {
        o.label = o.label.replace(/\s*\((recommand[ée]e?|recommended)\)\s*$/i, '');
        if (recommended < 0) recommended = i;
      }
    });
    return {
      question: String(q?.question ?? '').trim(),
      header: q?.header ? String(q.header).slice(0, 24) : undefined,
      options,
      recommended: recommended >= 0 && recommended < options.length ? recommended : undefined,
      multiSelect: !!(q?.multi_select ?? q?.multiSelect),
    };
  }).filter((q: AgentQuestion) => q.question && q.options.length >= 2);
}

/** Texte renvoyé à l'agent. */
export function formatAnswers(answers: QuestionAnswer[]): string {
  const auto = answers.some((a) => a.auto);
  return `Réponses de l'utilisateur${auto ? ' (validées automatiquement après le délai — options recommandées)' : ''} :\n${answers.map((a) => {
    const parts = [...a.selected, ...(a.other ? [`« ${a.other} »`] : [])];
    return `- ${a.question}\n  → ${parts.join(' ; ') || '(pas de réponse)'}`;
  }).join('\n')}\nSuis ces choix.`;
}
