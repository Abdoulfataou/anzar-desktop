/**
 * GenerationPanel — Panneau latéral droit style TRAE SOLO
 *
 * Affiché pendant la génération de projet avec 3 sections :
 * 1. Todo — checklist des phases (✅ done, ● active, ○ pending)
 * 2. Context — barre % + onglets Skills/Files/Other
 * 3. Steps — timeline détaillée file-by-file (réutilise ActivityTimeline)
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  CheckCircle2, Circle, Loader2, AlertCircle,
  X, FileCode, Minimize2, Maximize2,
  FilePlus, FileEdit, Terminal, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useActivityStore,
  type TodoItem,
  type ContextFile,
  type AgentStep,
} from '@/stores/activityStore';

// ============================================================================
// TODO SECTION
// ============================================================================

function TodoSection({ todos, isActive }: { todos: TodoItem[]; isActive: boolean }) {
  if (todos.length === 0) return null;

  return (
    <div className="px-3 py-2">
      <h3 className="text-[11px] font-bold text-text-primary uppercase tracking-wider mb-2">
        Todo
      </h3>
      <div className="space-y-1">
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-center gap-2 group">
            {/* Status icon */}
            {todo.status === 'done' ? (
              <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
            ) : todo.status === 'active' ? (
              <Loader2 size={14} className="text-accent-primary animate-spin flex-shrink-0" />
            ) : todo.status === 'error' ? (
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
            ) : (
              <Circle size={14} className="text-text-muted/40 flex-shrink-0" />
            )}
            {/* Label */}
            <span
              className={cn(
                'text-xs truncate flex-1',
                todo.status === 'done' && 'text-text-muted line-through',
                todo.status === 'active' && 'text-text-primary font-medium',
                todo.status === 'error' && 'text-red-400',
                todo.status === 'pending' && 'text-text-muted',
              )}
            >
              {todo.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// CONTEXT SECTION
// ============================================================================

type ContextTab = 'skills' | 'files' | 'other';

function ContextSection({
  contextFiles,
  contextPercent,
  isCompact,
  onToggleCompact,
}: {
  contextFiles: ContextFile[];
  contextPercent: number;
  isCompact: boolean;
  onToggleCompact: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ContextTab>('files');

  const grouped = useMemo(() => {
    const skills = contextFiles.filter((f) => f.type === 'skill');
    const files = contextFiles.filter((f) => f.type === 'file');
    const other = contextFiles.filter((f) => f.type === 'other');
    return { skills, files, other };
  }, [contextFiles]);

  const tabCounts: Record<ContextTab, number> = {
    skills: grouped.skills.length,
    files: grouped.files.length,
    other: grouped.other.length,
  };

  const currentFiles = grouped[activeTab];

  return (
    <div className="px-3 py-2 border-t border-border-subtle">
      {/* Header: Context label + % bar + compact toggle */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-bold text-text-primary uppercase tracking-wider">
          Context
        </span>
        <button
          onClick={onToggleCompact}
          className="ml-auto text-[10px] text-text-muted hover:text-text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-surface-hover"
        >
          {isCompact ? 'expand' : 'compact'}
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              contextPercent > 80
                ? 'bg-amber-400'
                : contextPercent > 50
                ? 'bg-accent-primary'
                : 'bg-emerald-400',
            )}
            style={{ width: `${contextPercent}%` }}
          />
        </div>
        <span className="text-[11px] font-mono tabular-nums text-text-muted w-8 text-right">
          {contextPercent}%
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-2">
        {(['skills', 'files', 'other'] as ContextTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all',
              activeTab === tab
                ? 'bg-accent-primary/15 text-accent-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-hover',
            )}
          >
            {tab === 'skills' && <span className="w-1.5 h-1.5 rounded-sm bg-violet-400" />}
            {tab === 'files' && <span className="w-1.5 h-1.5 rounded-sm bg-emerald-400" />}
            {tab === 'other' && <span className="w-1.5 h-1.5 rounded-sm bg-text-muted/40" />}
            <span className="capitalize">{tab}</span>
            {tabCounts[tab] > 0 && (
              <span className="text-[9px] opacity-60">{tabCounts[tab]}</span>
            )}
          </button>
        ))}
      </div>

      {/* File list */}
      {!isCompact && currentFiles.length > 0 && (
        <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
          {currentFiles.map((file) => {
            const filename = file.path.split('/').pop() || file.path;
            return (
              <div
                key={file.path}
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-surface-hover group"
              >
                <FileCode size={11} className={cn(
                  file.status === 'writing' ? 'text-amber-400' :
                  file.status === 'reading' ? 'text-sky-400' :
                  'text-text-muted'
                )} />
                <span className="text-[11px] text-text-secondary truncate flex-1 font-mono">
                  {filename}
                </span>
                {file.status === 'writing' && (
                  <Loader2 size={9} className="animate-spin text-amber-400 flex-shrink-0" />
                )}
                {file.status === 'reading' && (
                  <Loader2 size={9} className="animate-spin text-sky-400 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isCompact && currentFiles.length === 0 && (
        <p className="text-[10px] text-text-muted/50 italic px-1">
          Aucun {activeTab === 'skills' ? 'skill' : activeTab === 'files' ? 'fichier' : 'element'}
        </p>
      )}
    </div>
  );
}

// ============================================================================
// STEPS SECTION (inline mini-timeline)
// ============================================================================

function StepsSection({ steps, filesCreated, filesModified, commandsRun }: {
  steps: AgentStep[];
  filesCreated: number;
  filesModified: number;
  commandsRun: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(false);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps.length]);

  const activeStep = steps.find((s) => s.status === 'active');
  const doneSteps = steps.filter((s) => s.status === 'done');
  const visibleSteps = showAll ? steps : steps.slice(-8);

  // Summary badges
  const hasSummary = filesCreated > 0 || filesModified > 0 || commandsRun > 0;

  return (
    <div className="px-3 py-2 border-t border-border-subtle">
      {/* Summary badges */}
      {hasSummary && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {filesCreated > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
              <FilePlus size={10} />
              Created {filesCreated} file{filesCreated > 1 ? 's' : ''}
            </span>
          )}
          {filesModified > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
              <FileEdit size={10} />
              Modified {filesModified}
            </span>
          )}
          {commandsRun > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-sky-400 bg-sky-400/10 px-1.5 py-0.5 rounded">
              <Terminal size={10} />
              Ran {commandsRun} command{commandsRun > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Show all toggle */}
      {steps.length > 8 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[10px] text-text-muted hover:text-text-primary transition-colors mb-1"
        >
          {showAll ? `Masquer (${steps.length - 8} de plus)` : `Voir tout (${steps.length} etapes)`}
        </button>
      )}

      {/* Steps list */}
      <div
        ref={scrollRef}
        className="space-y-0.5 max-h-[250px] overflow-y-auto"
      >
        {visibleSteps.map((step) => (
          <StepMiniRow key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}

function StepMiniRow({ step }: { step: AgentStep }) {
  const isActive = step.status === 'active';
  const isDone = step.status === 'done';
  const isError = step.status === 'error';

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setElapsed(Date.now() - step.startedAt), 100);
    return () => clearInterval(interval);
  }, [isActive, step.startedAt]);

  const duration = step.durationMs || elapsed;
  const formatMs = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

  // Determine icon/indicator
  const getIndicator = () => {
    if (isActive) return <Loader2 size={10} className="animate-spin text-accent-primary" />;
    if (isError) return <AlertCircle size={10} className="text-red-400" />;
    if (isDone) return <CheckCircle2 size={10} className="text-emerald-400" />;
    return <Circle size={10} className="text-text-muted/30" />;
  };

  return (
    <div className={cn(
      'flex items-center gap-1.5 px-1.5 py-0.5 rounded group transition-colors',
      isActive && 'bg-accent-primary/5',
    )}>
      {getIndicator()}
      <span className={cn(
        'text-[11px] truncate flex-1',
        isActive ? 'text-text-primary' : 'text-text-secondary',
      )}>
        {step.label}
      </span>
      {duration > 0 && (
        <span className="text-[9px] font-mono tabular-nums text-text-muted flex-shrink-0">
          {formatMs(duration)}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PANEL
// ============================================================================

interface GenerationPanelProps {
  sessionId: string;
  onClose?: () => void;
  className?: string;
}

export default function GenerationPanel({
  sessionId,
  onClose,
  className,
}: GenerationPanelProps) {
  const sessions = useActivityStore((s) => s.sessions);
  const session = sessions.get(sessionId);
  const [isCompact, setIsCompact] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  if (!session) return null;

  const isActive = session.status === 'active';
  const totalDuration = session.totalDurationMs || (Date.now() - session.startedAt);
  const doneTodos = session.todos.filter((t) => t.status === 'done').length;
  const totalTodos = session.todos.length;

  return (
    <div
      className={cn(
        'flex flex-col bg-bg-primary border-l border-border-subtle h-full',
        'animate-in slide-in-from-right-5 duration-300',
        isMinimized ? 'w-10' : 'w-72',
        'transition-[width] duration-300',
        className,
      )}
    >
      {/* ── Header ── */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2.5 border-b border-border-subtle bg-surface-default/30',
        isMinimized && 'px-1.5 justify-center',
      )}>
        {isMinimized ? (
          <button
            onClick={() => setIsMinimized(false)}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Agrandir le panneau"
          >
            <Maximize2 size={14} />
          </button>
        ) : (
          <>
            {/* Activity pulse */}
            {isActive ? (
              <div className="w-2 h-2 rounded-full bg-accent-primary animate-pulse flex-shrink-0" />
            ) : session.status === 'done' ? (
              <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
            )}

            {/* Title */}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-text-primary truncate">
                {session.label}
              </p>
              {totalTodos > 0 && (
                <p className="text-[9px] text-text-muted">
                  {doneTodos}/{totalTodos} etapes
                </p>
              )}
            </div>

            {/* Timer */}
            <LiveTimer startedAt={session.startedAt} isActive={isActive} totalMs={totalDuration} />

            {/* Controls */}
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
              title="Minimiser"
            >
              <Minimize2 size={12} />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Body ── */}
      {!isMinimized && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Todo */}
          <TodoSection todos={session.todos} isActive={isActive} />

          {/* Context */}
          <ContextSection
            contextFiles={session.contextFiles}
            contextPercent={session.contextPercent}
            isCompact={isCompact}
            onToggleCompact={() => setIsCompact(!isCompact)}
          />

          {/* Steps */}
          <StepsSection
            steps={session.steps}
            filesCreated={session.filesCreated}
            filesModified={session.filesModified}
            commandsRun={session.commandsRun}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LIVE TIMER
// ============================================================================

function LiveTimer({ startedAt, isActive, totalMs }: { startedAt: number; isActive: boolean; totalMs: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  const elapsed = isActive ? now - startedAt : totalMs;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);

  return (
    <span className="flex items-center gap-1 text-[10px] font-mono tabular-nums text-text-muted flex-shrink-0">
      <Clock size={10} />
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </span>
  );
}
