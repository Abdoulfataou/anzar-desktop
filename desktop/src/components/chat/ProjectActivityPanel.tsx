/**
 * ProjectActivityPanel — Panneau d'activité à droite du chat (flux chat-first).
 *
 * Affiche EN TEMPS RÉEL et de façon FIDÈLE :
 *  - la todo list réelle du studio (source: studioTodoManager, synchronisée)
 *  - l'étape en cours
 *  - le contexte : fichiers générés (compteur unique = réellement reçus)
 *
 * Visible pendant une session projet quand le studio n'est pas ouvert.
 */
import React, { useEffect, useState, useRef } from 'react';
import {
  Loader2, CheckCircle2, Circle, AlertCircle, FileCode, ListChecks, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { studioTodoManager, TodoItem } from '@/services/studio/studioTodoManager';
import type { StudioPhase, StudioFile } from '@/components/vibecoding/VibeCodingStudio';
import type { StepEvent } from '@/services/projectGeneration';

interface ProjectActivityPanelProps {
  projectName: string;
  phase: StudioPhase;
  files: Map<string, StudioFile>;
  currentStep: StepEvent | null;
  onClose?: () => void;
}

const StatusIcon: React.FC<{ status: TodoItem['status'] }> = ({ status }) => {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />;
    case 'running':
      return <Loader2 size={13} className="text-accent-primary animate-spin flex-shrink-0" />;
    case 'error':
      return <AlertCircle size={13} className="text-red-400 flex-shrink-0" />;
    default:
      return <Circle size={13} className="text-text-muted/40 flex-shrink-0" />;
  }
};

const ProjectActivityPanel: React.FC<ProjectActivityPanelProps> = ({
  projectName,
  phase,
  files,
  currentStep,
  onClose,
}) => {
  // ── Abonnement à la todo réelle du studio ──
  const [todos, setTodos] = useState<TodoItem[]>([]);
  useEffect(() => studioTodoManager.subscribe((items) => setTodos(items)), []);

  const filesList = [...files.values()];
  const doneFiles = filesList.filter(f => f.status === 'done' || f.status === 'modified');
  const doneTodos = todos.filter(t => t.status === 'done').length;

  // Auto-scroll de la liste de fichiers
  const filesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    filesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [doneFiles.length]);

  return (
    <aside className="w-72 flex-shrink-0 h-full flex flex-col border-l border-border-subtle bg-bg-secondary/40">
      {/* ── Header ── */}
      <div className="px-3 py-2.5 border-b border-border-subtle flex items-center gap-2 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-text-primary truncate">{projectName}</p>
          <p className="text-[10px] text-text-muted">
            {phase === 'planning' ? 'Planification en cours'
              : phase === 'generating' ? 'Génération du code'
              : phase === 'iterating' ? 'Projet prêt'
              : phase === 'error' ? 'Erreur'
              : 'Préparation'}
          </p>
        </div>
        {(phase === 'planning' || phase === 'generating') && (
          <Loader2 size={13} className="animate-spin text-accent-primary flex-shrink-0" />
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
            title="Masquer le panneau"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* ── Étape en cours ── */}
      {currentStep && (phase === 'planning' || phase === 'generating') && (
        <div className="px-3 py-2 border-b border-border-subtle/60 flex items-center gap-2 flex-shrink-0">
          <Loader2 size={11} className="animate-spin text-accent-primary flex-shrink-0" />
          <span className="text-[11px] text-text-primary truncate">{currentStep.label}</span>
        </div>
      )}

      {/* ── TODO (source de vérité : studioTodoManager) ── */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {todos.length > 0 && (
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-2">
              <ListChecks size={12} className="text-accent-primary" />
              <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                Étapes
              </span>
              <span className="ml-auto text-[10px] text-text-muted">
                {doneTodos}/{todos.length}
              </span>
            </div>
            <div className="space-y-1">
              {todos.map(item => (
                <div key={item.id} className="flex items-start gap-2 px-1.5 py-1 rounded-md">
                  <div className="mt-0.5"><StatusIcon status={item.status} /></div>
                  <span
                    className={cn(
                      'text-[11px] leading-snug',
                      item.status === 'done' && 'text-text-muted line-through decoration-text-muted/40',
                      item.status === 'running' && 'text-text-primary font-medium',
                      item.status === 'error' && 'text-red-400',
                      (item.status === 'pending' || item.status === 'skipped') && 'text-text-secondary',
                    )}
                  >
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Contexte : fichiers réellement générés ── */}
        <div className="px-3 py-2.5 border-t border-border-subtle/60">
          <div className="flex items-center gap-1.5 mb-2">
            <FileCode size={12} className="text-accent-primary" />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
              Fichiers
            </span>
            <span className="ml-auto text-[10px] text-text-muted">
              {doneFiles.length}{filesList.length > doneFiles.length ? `/${filesList.length}` : ''}
            </span>
          </div>
          {doneFiles.length === 0 ? (
            <p className="text-[11px] text-text-muted/70 px-1.5">
              {phase === 'planning' ? 'En attente du plan…' : 'Aucun fichier pour le moment'}
            </p>
          ) : (
            <div className="space-y-0.5">
              {doneFiles.map(f => (
                <div key={f.path} className="flex items-center gap-1.5 px-1.5 py-0.5">
                  <CheckCircle2 size={10} className="text-emerald-400/70 flex-shrink-0" />
                  <span className="text-[10px] text-text-secondary font-mono truncate">{f.path}</span>
                </div>
              ))}
              <div ref={filesEndRef} />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default ProjectActivityPanel;
