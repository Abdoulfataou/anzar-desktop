/**
 * ProjectActivityPanel — Panneau d'activité à droite du chat (style TRAE Work).
 *
 * Trois sections claires avec états vides élégants :
 *  - Todo        : étapes réelles du studio (studioTodoManager, synchronisé)
 *  - Fichiers    : sorties de la tâche (fichiers réellement générés)
 *  - Références  : stack, complexité, modèle — le contexte du projet
 *
 * Header avec timer écoulé. Visible pendant une session projet
 * quand le studio n'est pas ouvert.
 */
import React, { useEffect, useState, useRef } from 'react';
import {
  Loader2, CheckCircle2, Circle, AlertCircle, FileCode,
  ListChecks, Package, BookOpen, Clock, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { studioTodoManager, TodoItem } from '@/services/studio/studioTodoManager';
import type { StudioPhase, StudioFile } from '@/components/vibecoding/VibeCodingStudio';
import type { StepEvent, PlanResult } from '@/services/projectGeneration';

interface ProjectActivityPanelProps {
  projectName: string;
  phase: StudioPhase;
  files: Map<string, StudioFile>;
  currentStep: StepEvent | null;
  plan?: PlanResult | null;
  onClose?: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

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

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Section avec titre + état vide façon TRAE */
const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  count?: string;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptyHint: string;
  isEmpty: boolean;
  children?: React.ReactNode;
}> = ({ icon, title, count, emptyIcon, emptyTitle, emptyHint, isEmpty, children }) => (
  <div className="px-3 py-3 border-b border-border-subtle/50">
    <div className="flex items-center gap-1.5 mb-2.5">
      <span className="text-accent-primary">{icon}</span>
      <span className="text-[11px] font-semibold text-text-primary">{title}</span>
      {count && <span className="ml-auto text-[10px] text-text-muted">{count}</span>}
    </div>
    {isEmpty ? (
      <div className="py-4 flex flex-col items-center text-center">
        <div className="w-9 h-9 rounded-xl bg-bg-tertiary flex items-center justify-center mb-2 text-text-muted/60">
          {emptyIcon}
        </div>
        <p className="text-[11px] text-text-secondary mb-0.5">{emptyTitle}</p>
        <p className="text-[10px] text-text-muted/70 max-w-[200px] leading-relaxed">{emptyHint}</p>
      </div>
    ) : (
      children
    )}
  </div>
);

// ============================================================================
// COMPOSANT
// ============================================================================

const ProjectActivityPanel: React.FC<ProjectActivityPanelProps> = ({
  projectName,
  phase,
  files,
  currentStep,
  plan,
  onClose,
}) => {
  // ── Todo réelle du studio ──
  const [todos, setTodos] = useState<TodoItem[]>([]);
  useEffect(() => studioTodoManager.subscribe((items) => setTodos(items)), []);

  // ── Timer écoulé (style TRAE 04:33) ──
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const isActive = phase === 'planning' || phase === 'reviewing' || phase === 'generating';
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  const filesList = [...files.values()];
  const doneFiles = filesList.filter(f => f.status === 'done' || f.status === 'modified');
  const doneTodos = todos.filter(t => t.status === 'done').length;

  // Auto-scroll fichiers
  const filesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    filesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [doneFiles.length]);

  // Références : stack déduite du plan
  const stack: string[] = (() => {
    const langs = new Set<string>();
    for (const f of plan?.files || []) {
      if (f.type && f.type !== 'unknown') langs.add(f.type);
    }
    return [...langs].slice(0, 8);
  })();

  return (
    <aside className="w-72 flex-shrink-0 h-full flex flex-col border-l border-border-subtle bg-bg-secondary/40">
      {/* ── Header : nom + phase + timer ── */}
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
        <span className="flex items-center gap-1 text-[10px] text-text-muted font-mono flex-shrink-0">
          <Clock size={10} />
          {formatElapsed(elapsed)}
        </span>
        {isActive && <Loader2 size={13} className="animate-spin text-accent-primary flex-shrink-0" />}
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
      {currentStep && isActive && (
        <div className="px-3 py-2 border-b border-border-subtle/60 flex items-center gap-2 flex-shrink-0 bg-accent-primary/5">
          <Loader2 size={11} className="animate-spin text-accent-primary flex-shrink-0" />
          <span className="text-[11px] text-text-primary truncate">{currentStep.label}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* ── TODO ── */}
        <Section
          icon={<ListChecks size={12} />}
          title="Todo"
          count={todos.length > 0 ? `${doneTodos}/${todos.length}` : undefined}
          emptyIcon={<ListChecks size={16} />}
          emptyTitle="Pas encore d'étapes"
          emptyHint="La progression détaillée apparaîtra ici dès que le plan sera prêt"
          isEmpty={todos.length === 0}
        >
          <div className="space-y-0.5">
            {todos.map(item => (
              <div key={item.id} className="flex items-start gap-2 px-1 py-1 rounded-md">
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
        </Section>

        {/* ── FICHIERS GÉNÉRÉS (Task Outputs) ── */}
        <Section
          icon={<Package size={12} />}
          title="Fichiers générés"
          count={doneFiles.length > 0 ? `${doneFiles.length}` : undefined}
          emptyIcon={<Package size={16} />}
          emptyTitle="Pas encore de fichiers"
          emptyHint="Les fichiers créés pendant la tâche apparaîtront ici au fur et à mesure"
          isEmpty={doneFiles.length === 0}
        >
          <div className="space-y-0.5 max-h-56 overflow-y-auto scrollbar-thin">
            {doneFiles.map(f => (
              <div key={f.path} className="flex items-center gap-1.5 px-1 py-0.5">
                <FileCode size={10} className="text-emerald-400/70 flex-shrink-0" />
                <span className="text-[10px] text-text-secondary font-mono truncate">{f.path}</span>
              </div>
            ))}
            <div ref={filesEndRef} />
          </div>
        </Section>

        {/* ── RÉFÉRENCES ── */}
        <Section
          icon={<BookOpen size={12} />}
          title="Références"
          emptyIcon={<BookOpen size={16} />}
          emptyTitle="Pas encore de contexte"
          emptyHint="La stack et les informations du projet apparaîtront après la planification"
          isEmpty={!plan}
        >
          <div className="space-y-2">
            {plan?.title && (
              <p className="text-[11px] text-text-primary font-medium px-1">{plan.title}</p>
            )}
            {stack.length > 0 && (
              <div className="flex flex-wrap gap-1 px-1">
                {stack.map(s => (
                  <span key={s} className="px-1.5 py-0.5 rounded bg-bg-tertiary text-[10px] text-text-secondary font-mono">
                    {s}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 px-1 text-[10px] text-text-muted">
              {plan?.files && <span>{plan.files.length} fichiers planifiés</span>}
              {plan?.complexity && <span className="capitalize">{plan.complexity === 'low' ? 'Simple' : plan.complexity === 'high' ? 'Complexe' : 'Moyen'}</span>}
            </div>
          </div>
        </Section>
      </div>
    </aside>
  );
};

export default ProjectActivityPanel;
