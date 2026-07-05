/**
 * ProjectProgressCard — Carte de progression du projet DANS le chat.
 *
 * Flux chat-first : la génération vit dans la conversation. Le studio
 * (dossiers, fichiers, éditeur) ne s'ouvre que si l'utilisateur clique
 * sur "Voir le projet".
 */
import React from 'react';
import {
  Loader2, CheckCircle2, AlertCircle, FolderOpen, Square, Hammer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StudioPhase, StudioFile } from '@/components/vibecoding/VibeCodingStudio';
import type { StepEvent } from '@/services/projectGeneration';

interface ProjectProgressCardProps {
  projectName: string;
  phase: StudioPhase;
  files: Map<string, StudioFile>;
  currentStep: StepEvent | null;
  errorMessage?: string;
  onOpenStudio: () => void;
  onCancel: () => void;
}

const ProjectProgressCard: React.FC<ProjectProgressCardProps> = ({
  projectName,
  phase,
  files,
  currentStep,
  errorMessage,
  onOpenStudio,
  onCancel,
}) => {
  const filesList = [...files.values()];
  const doneCount = filesList.filter(f => f.status === 'done' || f.status === 'modified').length;
  const total = filesList.length;

  const progress =
    phase === 'planning' ? 10
    : phase === 'reviewing' ? 20
    : phase === 'generating' ? (total > 0 ? Math.min(95, 20 + Math.round((doneCount / total) * 75)) : 25)
    : phase === 'iterating' ? 100
    : 0;

  const isActive = phase === 'planning' || phase === 'reviewing' || phase === 'generating';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <div
        className={cn(
          'rounded-2xl border bg-surface-default shadow-sm overflow-hidden',
          phase === 'error' ? 'border-red-500/30' : 'border-border-subtle'
        )}
      >
        {/* Ligne principale */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div
            className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
              phase === 'error' ? 'bg-red-500/10' : 'gradient-bg'
            )}
          >
            {phase === 'error' ? (
              <AlertCircle size={16} className="text-red-400" />
            ) : phase === 'iterating' ? (
              <CheckCircle2 size={16} className="text-white" />
            ) : (
              <Hammer size={15} className="text-white" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-text-primary truncate">{projectName}</span>
              <span
                className={cn(
                  'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0',
                  phase === 'iterating' ? 'bg-emerald-500/10 text-emerald-400'
                    : phase === 'error' ? 'bg-red-500/10 text-red-400'
                    : 'bg-accent-primary/10 text-accent-primary'
                )}
              >
                {phase === 'planning' ? 'Planification'
                  : phase === 'reviewing' ? 'Plan prêt'
                  : phase === 'generating' ? 'Génération'
                  : phase === 'iterating' ? 'Prêt'
                  : 'Erreur'}
              </span>
            </div>
            <p className="text-[11px] text-text-muted truncate mt-0.5">
              {phase === 'error'
                ? (errorMessage || 'Une erreur est survenue')
                : phase === 'iterating'
                  ? `${total} fichiers générés et vérifiés — clique pour explorer`
                  : currentStep?.label
                    || (phase === 'planning' ? 'Analyse et architecture du projet…' : `${doneCount}/${total || '…'} fichiers`)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isActive && (
              <>
                <Loader2 size={14} className="animate-spin text-accent-primary" />
                <button
                  onClick={onCancel}
                  className="p-1.5 rounded-lg text-text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  title="Annuler"
                >
                  <Square size={13} />
                </button>
              </>
            )}
            <button
              onClick={onOpenStudio}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                phase === 'iterating'
                  ? 'gradient-bg text-white hover:opacity-90 shadow'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border-subtle'
              )}
            >
              <FolderOpen size={13} />
              Voir le projet
            </button>
          </div>
        </div>

        {/* Barre de progression */}
        {phase !== 'error' && (
          <div className="h-1 bg-bg-tertiary">
            <div
              className={cn(
                'h-full transition-all duration-500',
                phase === 'iterating' ? 'bg-emerald-400' : 'gradient-bg'
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectProgressCard;
