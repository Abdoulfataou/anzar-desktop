/**
 * AgentProgress — Barre de progression des agents IA (données réelles)
 *
 * Connecté au ActivityStore pour afficher les étapes en temps réel.
 * Utilisé dans le workspace projet lors de la génération.
 */
import React, { useState, useEffect } from 'react';
import {
  Brain, Map, Code, TestTube, Rocket,
  CheckCircle2, Loader2, AlertCircle,
  ChevronDown, ChevronUp,
  LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActivityStore, AgentStep, ActivitySession } from '@/stores/activityStore';

interface AgentProgressProps {
  projectId: string;
  layout?: 'horizontal' | 'vertical';
  compact?: boolean;
}

// ============================================================================
// PHASE MAPPING — Map activity steps to visual phases
// ============================================================================

interface Phase {
  id: string;
  name: string;
  icon: LucideIcon;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  stepCount: number;
  currentAction?: string;
}

function mapSessionToPhases(session: ActivitySession | null): Phase[] {
  const phases: Phase[] = [
    { id: 'think', name: 'Réflexion', icon: Brain, status: 'pending', progress: 0, stepCount: 0 },
    { id: 'plan', name: 'Planification', icon: Map, status: 'pending', progress: 0, stepCount: 0 },
    { id: 'code', name: 'Codage', icon: Code, status: 'pending', progress: 0, stepCount: 0 },
    { id: 'test', name: 'Tests', icon: TestTube, status: 'pending', progress: 0, stepCount: 0 },
    { id: 'deploy', name: 'Finalisation', icon: Rocket, status: 'pending', progress: 0, stepCount: 0 },
  ];

  if (!session) return phases;

  // Map step types to phases
  const phaseMapping: Record<string, string> = {
    thinking: 'think', understanding: 'think', analyzing: 'think',
    planning: 'plan', searching: 'plan', reading: 'plan',
    writing: 'code', editing: 'code', creating: 'code', deleting: 'code',
    testing: 'test', debugging: 'test', running: 'test',
    building: 'deploy', installing: 'deploy', deploying: 'deploy',
  };

  // Count steps per phase
  for (const step of session.steps) {
    const phaseId = phaseMapping[step.type] || 'code';
    const phase = phases.find((p) => p.id === phaseId);
    if (phase) {
      phase.stepCount++;
      if (step.status === 'active') {
        phase.status = 'running';
        phase.currentAction = step.label;
      } else if (step.status === 'done') {
        if (phase.status !== 'running') phase.status = 'completed';
      } else if (step.status === 'error') {
        phase.status = 'error';
      }
    }
  }

  // Calculate progress per phase
  for (const phase of phases) {
    if (phase.status === 'completed') phase.progress = 100;
    else if (phase.status === 'running') phase.progress = 50;
    else if (phase.stepCount > 0) phase.progress = 100;
  }

  // If session is complete, all phases are 100%
  if (session.status === 'done') {
    phases.forEach((p) => { p.status = 'completed'; p.progress = 100; });
  }

  return phases;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const AgentProgress: React.FC<AgentProgressProps> = ({
  projectId,
  layout = 'horizontal',
  compact = false,
}) => {
  const sessions = useActivityStore((s) => s.sessions);
  const session = sessions.get(projectId) || null;
  const phases = mapSessionToPhases(session);

  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Live timer
  useEffect(() => {
    if (!session || session.status !== 'active') return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - session.startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  const overallProgress = Math.round(
    phases.reduce((sum, p) => sum + p.progress, 0) / phases.length
  );

  const activePhase = phases.find((p) => p.status === 'running');
  const totalDuration = session?.totalDurationMs || elapsed;

  const formatTime = (ms: number): string => {
    if (ms < 1000) return '0s';
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}:${String(remSecs).padStart(2, '0')}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-accent-success';
      case 'running': return 'text-accent-primary';
      case 'error': return 'text-accent-error';
      default: return 'text-text-muted';
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-accent-success/10 border-accent-success/30';
      case 'running': return 'bg-accent-primary/10 border-accent-primary/30 animate-pulse';
      case 'error': return 'bg-accent-error/10 border-accent-error/30';
      default: return 'bg-bg-tertiary/50 border-border-subtle';
    }
  };

  // ─── COMPACT MODE ───
  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activePhase && (
              <div className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin text-accent-primary" />
                <span className="text-xs font-medium text-text-primary">
                  {activePhase.currentAction || activePhase.name}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted font-mono">{formatTime(totalDuration)}</span>
            <span className="text-xs font-semibold text-accent-primary">{overallProgress}%</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-accent-primary to-accent-secondary transition-all duration-500 ease-out"
            style={{ width: `${overallProgress}%` }}
          />
        </div>

        {/* Phase dots */}
        <div className="flex items-center justify-center gap-1.5">
          {phases.map((phase) => (
            <div
              key={phase.id}
              className={cn(
                'w-2.5 h-2.5 rounded-full transition-all duration-300 border',
                getStatusBg(phase.status),
              )}
              title={`${phase.name}: ${phase.status}`}
            />
          ))}
        </div>
      </div>
    );
  }

  // ─── FULL MODE ───
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {session?.status === 'active' ? (
            <Loader2 size={14} className="animate-spin text-accent-primary" />
          ) : session?.status === 'done' ? (
            <CheckCircle2 size={14} className="text-accent-success" />
          ) : (
            <AlertCircle size={14} className="text-accent-error" />
          )}
          <span className="text-sm font-semibold text-text-primary">
            {activePhase?.currentAction || session?.label || 'Progression'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-muted font-mono tabular-nums">
            {formatTime(totalDuration)}
          </span>
          <span className="text-sm font-bold text-accent-primary">
            {overallProgress}%
          </span>
        </div>
      </div>

      {/* Global progress bar */}
      <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-success transition-all duration-700 ease-out"
          style={{ width: `${overallProgress}%` }}
        />
      </div>

      {/* Phase grid */}
      <div className={cn(
        'grid gap-2',
        layout === 'horizontal' ? 'grid-cols-5' : 'grid-cols-1'
      )}>
        {phases.map((phase) => {
          const Icon = phase.icon;
          return (
            <div
              key={phase.id}
              className={cn(
                'rounded-lg border p-2 transition-all duration-300',
                getStatusBg(phase.status),
              )}
            >
              <div className="flex flex-col items-center gap-1.5 text-center">
                <div className="relative">
                  {phase.status === 'running' ? (
                    <Loader2 size={16} className="animate-spin text-accent-primary" />
                  ) : phase.status === 'completed' ? (
                    <CheckCircle2 size={16} className="text-accent-success" />
                  ) : phase.status === 'error' ? (
                    <AlertCircle size={16} className="text-accent-error" />
                  ) : (
                    <Icon size={16} className="text-text-muted" />
                  )}
                </div>
                <span className={cn(
                  'text-[10px] font-medium',
                  getStatusColor(phase.status),
                )}>
                  {phase.name}
                </span>
                {phase.currentAction && phase.status === 'running' && (
                  <span className="text-[9px] text-text-muted truncate max-w-full">
                    {phase.currentAction}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detailed steps (expandable) */}
      {session && session.steps.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {session.steps.length} étape{session.steps.length > 1 ? 's' : ''} détaillée{session.steps.length > 1 ? 's' : ''}
          </button>

          {expanded && (
            <div className="mt-2 pl-2 border-l-2 border-border-subtle space-y-1 max-h-[150px] overflow-y-auto">
              {session.steps.map((step) => (
                <div key={step.id} className="flex items-center gap-2 py-0.5">
                  {step.status === 'active' ? (
                    <Loader2 size={10} className="animate-spin text-accent-primary flex-shrink-0" />
                  ) : step.status === 'done' ? (
                    <CheckCircle2 size={10} className="text-accent-success flex-shrink-0" />
                  ) : (
                    <AlertCircle size={10} className="text-accent-error flex-shrink-0" />
                  )}
                  <span className="text-[10px] text-text-secondary truncate flex-1">{step.label}</span>
                  {step.durationMs && (
                    <span className="text-[9px] text-text-muted font-mono flex-shrink-0">
                      {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentProgress;
