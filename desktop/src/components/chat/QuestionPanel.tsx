/**
 * Questions de l'agent (outil ask_user) : affichées au-dessus de la saisie, une à la fois.
 * Réponses proposées (dont une recommandée), choix multiple si demandé, et réponse libre.
 * Clavier : 1 à 4 pour choisir, Entrée pour valider, Échap pour passer.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, MessageCircleQuestion, X } from 'lucide-react';
import { cn } from '@/lib/utils';

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
}

export default function QuestionPanel({ request, onSubmit, onSkip }: {
  request: QuestionRequest;
  onSubmit: (answers: QuestionAnswer[]) => void;
  onSkip: () => void;
}) {
  const qs = request.questions;
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<number[][]>(() => qs.map(() => []));
  const [other, setOther] = useState<string[]>(() => qs.map(() => ''));
  const q = qs[step];
  const last = step === qs.length - 1;

  const answered = (i: number) => picked[i].length > 0 || other[i].trim().length > 0;
  const allAnswered = qs.every((_, i) => answered(i));

  const toggle = (opt: number) => {
    setPicked((prev) => prev.map((sel, i) => {
      if (i !== step) return sel;
      if (q.multiSelect) return sel.includes(opt) ? sel.filter((x) => x !== opt) : [...sel, opt];
      return [opt];
    }));
    // Choix unique : la réponse libre est remplacée par l'option
    if (!q.multiSelect) setOther((prev) => prev.map((t, i) => (i === step ? '' : t)));
  };

  const submit = () => {
    onSubmit(qs.map((question, i) => ({
      question: question.question,
      selected: picked[i].map((o) => question.options[o]?.label).filter(Boolean),
      other: other[i].trim() || undefined,
    })));
  };

  const next = () => {
    if (!answered(step)) return;
    if (last) { if (allAnswered) submit(); }
    else setStep(step + 1);
  };

  // Raccourcis clavier (hors saisie de texte)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (e.key === 'Escape') { e.preventDefault(); onSkip(); return; }
      if (typing) return;
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) { e.preventDefault(); toggle(n - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const headers = useMemo(() => qs.map((x, i) => x.header?.trim() || `Question ${i + 1}`), [qs]);

  return (
    <div className="mx-4 mb-1 rounded-xl border border-border-medium bg-surface-elevated flex-shrink-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <MessageCircleQuestion size={15} className="text-text-secondary flex-shrink-0" />
        {qs.length > 1 ? (
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
            {headers.map((h, i) => (
              <button key={i} onClick={() => setStep(i)}
                className={cn('flex items-center gap-1 h-6 px-2 rounded-md text-ui-caption whitespace-nowrap',
                  i === step ? 'bg-hover-fill text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                {answered(i) && <Check size={11} className="text-accent-success" />}{h}
              </button>
            ))}
          </div>
        ) : (
          <span className="flex-1 text-ui-caption text-text-muted">{headers[0]}</span>
        )}
        <button onClick={onSkip} title="Passer : l'agent décide (Échap)" className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-hover-fill">
          <X size={14} />
        </button>
      </div>

      <div className="px-3 pb-3 pt-1.5">
        <p className="text-ui-base text-text-primary mb-2">{q.question}</p>
        {q.multiSelect && <p className="text-ui-caption text-text-muted -mt-1 mb-2">Plusieurs choix possibles.</p>}
        <div className="space-y-1.5">
          {q.options.map((o, i) => {
            const on = picked[step].includes(i);
            return (
              <button key={i} onClick={() => toggle(i)}
                className={cn('w-full flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                  on ? 'border-input-border-hover bg-hover-fill' : 'border-border-medium hover:bg-hover-fill/60')}>
                <span className={cn('mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center border text-[10px]',
                  q.multiSelect ? 'rounded' : 'rounded-full', on ? 'border-text-primary bg-text-primary text-bg-primary' : 'border-border-medium text-text-muted')}>
                  {on ? <Check size={10} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="text-ui-sm text-text-primary">
                    {o.label}
                    {q.recommended === i && <span className="ml-1.5 text-ui-caption text-accent-success">(Recommandé)</span>}
                  </span>
                  {o.description && <span className="block text-ui-caption text-text-muted">{o.description}</span>}
                </span>
              </button>
            );
          })}
          <input
            value={other[step]}
            onChange={(e) => {
              const v = e.target.value;
              setOther((prev) => prev.map((t, i) => (i === step ? v : t)));
              if (v && !q.multiSelect) setPicked((prev) => prev.map((sel, i) => (i === step ? [] : sel)));
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } }}
            placeholder="Autre… (réponds avec tes mots)"
            className="w-full h-9 px-3 rounded-lg bg-input border border-input-border text-ui-sm text-text-primary outline-none focus:border-input-border-hover"
          />
        </div>

        <div className="flex items-center justify-end gap-2 mt-2.5">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="flex items-center gap-1 h-7 px-2 rounded-lg text-ui-caption text-text-secondary hover:bg-hover-fill">
              <ChevronLeft size={13} /> Précédente
            </button>
          )}
          <button onClick={onSkip} className="h-7 px-3 rounded-lg text-ui-caption text-text-secondary hover:bg-hover-fill">Passer</button>
          <button onClick={next} disabled={!answered(step) || (last && !allAnswered)}
            className="h-7 px-3 rounded-lg text-ui-caption font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 disabled:opacity-40">
            {last ? 'Envoyer' : 'Suivante'}
          </button>
        </div>
      </div>
    </div>
  );
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
  return `Réponses de l'utilisateur :\n${answers.map((a) => {
    const parts = [...a.selected, ...(a.other ? [`« ${a.other} »`] : [])];
    return `- ${a.question}\n  → ${parts.join(' ; ') || '(pas de réponse)'}`;
  }).join('\n')}\nSuis ces choix.`;
}
