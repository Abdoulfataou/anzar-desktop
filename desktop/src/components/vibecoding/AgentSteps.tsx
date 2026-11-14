/**
 * AgentSteps — Étapes du pipeline multi-agents nommées et validées en direct.
 *
 * Remplace les spinners génériques : chaque étape est dérivée de l'ÉTAT RÉEL
 * (phase + plan + fichiers + step SSE courant + agents), pas de timers factices :
 *
 *   1. Analyse      — phase 'planning'  (agent planner côté serveur)
 *   2. Plan         — phase 'reviewing' (plan prêt, validation utilisateur)
 *   3. Écriture     — phase 'generating' (x/y fichiers, fichier courant)
 *   4. Review       — phase 'iterating' (génération vérifiée, studio prêt)
 *
 * En cas d'erreur, l'étape active passe en rouge avec le message.
 */
import React from 'react';
import { CheckCircle2, Loader2, AlertCircle, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StudioPhase, StudioFile } from './VibeCodingStudio';
import type { StepEvent, AgentUpdate } from '@/services/projectGeneration';

interface AgentStepsProps {
  phase: StudioPhase;
  planFileCount: number;
  files: StudioFile[];
  currentStep: StepEvent | null;
  activeGeneratingFile?: string;
  agents?: AgentUpdate[];
  errorMessage?: string;
  /** vertical = rail complet (phase planning) ; compact = bandeau inline */
  orientation?: 'vertical' | 'compact';
}

interface StepDef {
  key: string;
  label: string;
  detail?: string;
}

export default function AgentSteps({
  phase,
  planFileCount,
  files,
  currentStep,
  activeGeneratingFile,
  agents = [],
  errorMessage,
  orientation = 'vertical',
}: AgentStepsProps) {
  const doneCount = files.filter((f) => f.status === 'done' || f.status === 'modified').length;
  const total = planFileCount || files.length;

  // Le label du fichier courant vient du step SSE (action writing/creating)
  const currentFileLabel =
    currentStep?.file?.split('/').pop() || activeGeneratingFile?.split('/').pop() || '';

  const steps: StepDef[] = [
    { key: 'analyse', label: 'Analyse', detail: 'Compréhension de la demande par le planner' },
    { key: 'plan', label: 'Plan', detail: planFileCount > 0 ? `${planFileCount} fichiers planifiés` : 'Stack & architecture' },
    {
      key: 'ecriture',
      label: 'Écriture des fichiers',
      detail:
        phase === 'generating'
          ? `${doneCount}/${total || '…'}${currentFileLabel ? ` — ${currentFileLabel}` : ''}`
          : total > 0
            ? `${total} fichiers générés`
            : undefined,
    },
    {
      key: 'review',
      label: 'Review & vérification',
      detail:
        phase === 'iterating'
          ? 'Projet vérifié — prêt à itérer'
          : agents.some((a) => a.name.toLowerCase().includes('review'))
            ? 'Agent reviewer en attente'
            : 'Contrôle qualité automatique',
    },
  ];

  // Position courante : analyse=0, plan=1, écriture=2, review=3
  const activeIdx =
    phase === 'planning' ? 0
    : phase === 'reviewing' ? 1
    : phase === 'generating' ? 2
    : 3; // iterating (terminé) — error garde l'étape courante figée
  const errorIdx = phase === 'error' ? activeIdx : -1;

  const renderIcon = (i: number) => {
    if (i < activeIdx || phase === 'iterating') {
      return <CheckCircle2 size={15} className="text-accent-success flex-shrink-0" />;
    }
    if (i === errorIdx) {
      return <AlertCircle size={15} className="text-accent-error flex-shrink-0" />;
    }
    if (i === activeIdx) {
      return <Loader2 size={15} className="text-accent-primary animate-spin flex-shrink-0" />;
    }
    return <Circle size={15} className="text-text-muted/30 flex-shrink-0" />;
  };

  if (orientation === 'compact') {
    return (
      <div className="flex items-center gap-1 overflow-x-auto">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
            {i > 0 && <div className={cn('w-3 h-px', i <= activeIdx ? 'bg-accent-success/50' : 'bg-border-subtle')} />}
            <div
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
                phase === 'iterating' || i < activeIdx
                  ? 'text-accent-success bg-accent-success/10'
                  : i === activeIdx
                    ? 'text-accent-primary bg-accent-primary/10'
                    : 'text-text-muted bg-bg-tertiary/50'
              )}
              title={s.detail}
            >
              {renderIcon(i)}
              <span>{s.label}</span>
              {s.key === 'ecriture' && s.detail && i === activeIdx && (
                <span className="font-mono tabular-nums opacity-70">{s.detail.split(' — ')[0]}</span>
              )}
            </div>
          </div>
        ))}
        {errorMessage && errorIdx >= 0 && (
          <span className="ml-1 text-[10px] text-accent-error truncate max-w-[220px]">{errorMessage}</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-start gap-2.5">
          {renderIcon(i)}
          <div className="min-w-0">
            <p
              className={cn(
                'text-[13px] leading-tight',
                i < activeIdx || phase === 'iterating'
                  ? 'text-text-secondary'
                  : i === activeIdx
                    ? 'text-text-primary font-medium'
                    : 'text-text-muted'
              )}
            >
              {s.label}
              {s.key === 'ecriture' && s.detail && (
                <span className="ml-1.5 font-mono text-[11px] tabular-nums text-text-muted">{s.detail}</span>
              )}
            </p>
            {s.detail && i === activeIdx && s.key !== 'ecriture' && (
              <p className="text-[11px] text-text-muted mt-0.5 truncate">{s.detail}</p>
            )}
            {i === errorIdx && errorMessage && (
              <p className="text-[11px] text-accent-error mt-0.5 line-clamp-2">{errorMessage}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
