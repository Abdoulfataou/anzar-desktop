/**
 * ActivityTimeline — Affichage en temps réel du processus agent
 *
 * Affiche chaque étape comme dans Cursor / Claude Cowork :
 * ▸ Thinking...
 * ✓ Reading src/App.tsx (0.3s)
 * ▸ Planning changes...
 * ✓ Writing src/components/Login.tsx (1.2s)
 * ▸ Editing src/routes.tsx...
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Brain, FileSearch, Map, PenTool, FileEdit,
  FilePlus, Trash2, Package, Play, TestTube, Hammer,
  Bug, Rocket, CheckCircle2, AlertCircle, Search,
  Loader2, ChevronDown, ChevronUp, Eye,
  LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AgentStep,
  AgentActionType,
  ActivitySession,
  useActivityStore,
} from '@/stores/activityStore';

// ============================================================================
// CONFIG — Icônes et couleurs par type d'action
// ============================================================================

interface ActionConfig {
  icon: LucideIcon;
  label: string;
  color: string;
  bgColor: string;
}

const ACTION_CONFIG: Record<AgentActionType, ActionConfig> = {
  thinking:      { icon: Brain,        label: 'Réflexion',          color: 'text-violet-400',  bgColor: 'bg-violet-400/10' },
  understanding: { icon: Eye,          label: 'Compréhension',      color: 'text-blue-400',    bgColor: 'bg-blue-400/10' },
  planning:      { icon: Map,          label: 'Planification',      color: 'text-cyan-400',    bgColor: 'bg-cyan-400/10' },
  reading:       { icon: FileSearch,   label: 'Lecture',            color: 'text-sky-400',     bgColor: 'bg-sky-400/10' },
  searching:     { icon: Search,       label: 'Recherche',          color: 'text-indigo-400',  bgColor: 'bg-indigo-400/10' },
  analyzing:     { icon: Eye,          label: 'Analyse',            color: 'text-purple-400',  bgColor: 'bg-purple-400/10' },
  writing:       { icon: PenTool,      label: 'Écriture',           color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
  editing:       { icon: FileEdit,     label: 'Modification',       color: 'text-amber-400',   bgColor: 'bg-amber-400/10' },
  creating:      { icon: FilePlus,     label: 'Création',           color: 'text-green-400',   bgColor: 'bg-green-400/10' },
  deleting:      { icon: Trash2,       label: 'Suppression',        color: 'text-red-400',     bgColor: 'bg-red-400/10' },
  installing:    { icon: Package,      label: 'Installation',       color: 'text-orange-400',  bgColor: 'bg-orange-400/10' },
  running:       { icon: Play,         label: 'Exécution',          color: 'text-teal-400',    bgColor: 'bg-teal-400/10' },
  testing:       { icon: TestTube,     label: 'Tests',              color: 'text-pink-400',    bgColor: 'bg-pink-400/10' },
  building:      { icon: Hammer,       label: 'Build',              color: 'text-yellow-400',  bgColor: 'bg-yellow-400/10' },
  debugging:     { icon: Bug,          label: 'Debugging',          color: 'text-rose-400',    bgColor: 'bg-rose-400/10' },
  deploying:     { icon: Rocket,       label: 'Déploiement',        color: 'text-fuchsia-400', bgColor: 'bg-fuchsia-400/10' },
  complete:      { icon: CheckCircle2, label: 'Terminé',            color: 'text-accent-success', bgColor: 'bg-accent-success/10' },
  error:         { icon: AlertCircle,  label: 'Erreur',             color: 'text-accent-error',   bgColor: 'bg-accent-error/10' },
};

// ============================================================================
// SINGLE STEP ROW
// ============================================================================

function StepRow({ step, isLast }: { step: AgentStep; isLast: boolean }) {
  const config = ACTION_CONFIG[step.type] || ACTION_CONFIG.thinking;
  const Icon = config.icon;
  const isActive = step.status === 'active';
  const isDone = step.status === 'done';
  const isError = step.status === 'error';

  const [elapsed, setElapsed] = useState(0);

  // Live timer for active steps
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - step.startedAt);
    }, 100);
    return () => clearInterval(interval);
  }, [isActive, step.startedAt]);

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const duration = step.durationMs || elapsed;

  return (
    <div className="flex items-start gap-2.5 group">
      {/* Timeline connector line */}
      <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
        {/* Icon circle */}
        <div
          className={cn(
            'w-6 h-6 rounded-lg flex items-center justify-center transition-all duration-300',
            isActive && 'animate-pulse',
            config.bgColor,
          )}
        >
          {isActive ? (
            <Loader2 size={12} className={cn('animate-spin', config.color)} />
          ) : isError ? (
            <AlertCircle size={12} className="text-accent-error" />
          ) : isDone ? (
            <CheckCircle2 size={12} className="text-accent-success" />
          ) : (
            <Icon size={12} className={config.color} />
          )}
        </div>

        {/* Vertical line */}
        {!isLast && (
          <div
            className={cn(
              'w-px flex-1 min-h-[12px] mt-0.5 transition-colors',
              isDone ? 'bg-accent-success/30' :
              isActive ? 'bg-accent-primary/30' :
              'bg-border-subtle'
            )}
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs font-medium truncate',
              isActive ? 'text-text-primary' :
              isDone ? 'text-text-secondary' :
              'text-accent-error'
            )}
          >
            {step.label}
          </span>

          {/* Duration badge */}
          {duration > 0 && (
            <span
              className={cn(
                'text-[10px] font-mono tabular-nums flex-shrink-0',
                isActive ? 'text-accent-primary' : 'text-text-muted'
              )}
            >
              {formatDuration(duration)}
            </span>
          )}
        </div>

        {/* File path */}
        {step.filePath && (
          <p className="text-[10px] text-text-muted truncate mt-0.5 font-mono">
            {step.filePath}
          </p>
        )}

        {/* Detail (expandable for thinking) */}
        {step.detail && step.type === 'thinking' && isDone && (
          <p className="text-[10px] text-text-muted mt-0.5 line-clamp-2">
            {step.detail}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN TIMELINE COMPONENT
// ============================================================================

interface ActivityTimelineProps {
  sessionId?: string;        // Show specific session
  maxSteps?: number;         // Limit visible steps
  compact?: boolean;         // Compact mode for chat
  className?: string;
}

export default function ActivityTimeline({
  sessionId,
  maxSteps = 50,
  compact = false,
  className,
}: ActivityTimelineProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessions = useActivityStore((s) => s.sessions);
  const activeSessionId = useActivityStore((s) => s.activeSessionId);

  const targetSessionId = sessionId || activeSessionId;
  const session = targetSessionId ? sessions.get(targetSessionId) : null;

  // Auto-scroll to bottom when new steps added
  useEffect(() => {
    if (scrollRef.current && !isCollapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session?.steps.length, isCollapsed]);

  if (!session || session.steps.length === 0) {
    return null;
  }

  const visibleSteps = session.steps.slice(-maxSteps);
  const isActive = session.status === 'active';
  const totalDuration = session.totalDurationMs || (Date.now() - session.startedAt);
  const activeStep = session.steps.find((s) => s.status === 'active');

  // Compact mode — just show the current active step
  if (compact) {
    if (!activeStep) return null;
    const config = ACTION_CONFIG[activeStep.type];
    const Icon = config.icon;

    return (
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-xl',
        'bg-surface-default/50 border border-border-subtle',
        'animate-in fade-in duration-300',
        className
      )}>
        <div className={cn('animate-pulse rounded-md p-1', config.bgColor)}>
          <Icon size={12} className={config.color} />
        </div>
        <span className="text-xs text-text-secondary truncate flex-1">
          {activeStep.label}
        </span>
        <Loader2 size={12} className="animate-spin text-accent-primary flex-shrink-0" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border-subtle bg-surface-default/50 overflow-hidden',
        'transition-all duration-300',
        className
      )}
    >
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors"
      >
        {/* Activity indicator */}
        {isActive ? (
          <div className="w-2 h-2 rounded-full bg-accent-primary animate-pulse" />
        ) : session.status === 'done' ? (
          <CheckCircle2 size={12} className="text-accent-success" />
        ) : (
          <AlertCircle size={12} className="text-accent-error" />
        )}

        <span className="text-xs font-semibold text-text-primary truncate flex-1 text-left">
          {session.label}
        </span>

        {/* Stats */}
        <span className="text-[10px] text-text-muted font-mono tabular-nums flex-shrink-0">
          {session.steps.length} étape{session.steps.length > 1 ? 's' : ''}
          {' · '}
          {formatTotalDuration(totalDuration)}
        </span>

        {isCollapsed ? (
          <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
        ) : (
          <ChevronUp size={12} className="text-text-muted flex-shrink-0" />
        )}
      </button>

      {/* Steps */}
      {!isCollapsed && (
        <div
          ref={scrollRef}
          className="px-3 pb-2 max-h-[400px] overflow-y-auto"
        >
          {visibleSteps.map((step, idx) => (
            <StepRow
              key={step.id}
              step={step}
              isLast={idx === visibleSteps.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// INLINE ACTIVITY (for chat — shows inside message stream)
// ============================================================================

export function InlineActivity({ sessionId }: { sessionId: string }) {
  const sessions = useActivityStore((s) => s.sessions);
  const session = sessions.get(sessionId);

  if (!session) return null;

  const activeStep = session.steps.find((s) => s.status === 'active');
  const doneSteps = session.steps.filter((s) => s.status === 'done');

  return (
    <div className="space-y-1 mb-2">
      {/* Done steps — collapsed */}
      {doneSteps.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {doneSteps.slice(-12).map((step) => {
            const config = ACTION_CONFIG[step.type];
            const Icon = config.icon;
            return (
              <div
                key={step.id}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-md',
                  'bg-bg-tertiary/50 text-text-muted',
                  'text-[10px]'
                )}
                title={step.label}
              >
                <CheckCircle2 size={9} className="text-accent-success" />
                <Icon size={9} className={config.color} />
                <span className="truncate max-w-[100px]">{step.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Active step — prominent */}
      {activeStep && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg',
          'border border-accent-primary/20 bg-accent-primary/5',
          'animate-in fade-in duration-200'
        )}>
          <Loader2 size={12} className="animate-spin text-accent-primary flex-shrink-0" />
          <span className="text-xs text-text-primary">{activeStep.label}</span>
          {activeStep.filePath && (
            <span className="text-[10px] text-text-muted font-mono truncate">
              {activeStep.filePath}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTotalDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
