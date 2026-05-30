/**
 * StudioTodoList — Affiche la todo list gérée par l'agent dans le studio.
 *
 * Inspiré de TRAE SOLO : checklist animée montrant ce que l'IA fait,
 * ce qui est fait, ce qui reste. Visible pendant la génération ET l'itération.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, Circle, Loader2, AlertCircle, SkipForward,
  ChevronDown, ChevronRight, Clock, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { studioTodoManager } from '@/services/studio/studioTodoManager';
import type { TodoItem, TodoSession } from '@/services/studio/studioTodoManager';

// ============================================================================
// TODO ITEM ROW
// ============================================================================

const StatusIcon: React.FC<{ status: TodoItem['status'] }> = ({ status }) => {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />;
    case 'running':
      return <Loader2 size={14} className="text-accent-primary animate-spin flex-shrink-0" />;
    case 'error':
      return <AlertCircle size={14} className="text-red-400 flex-shrink-0" />;
    case 'skipped':
      return <SkipForward size={14} className="text-text-muted/40 flex-shrink-0" />;
    default:
      return <Circle size={14} className="text-text-muted/30 flex-shrink-0" />;
  }
};

const TodoItemRow: React.FC<{ item: TodoItem }> = ({ item }) => {
  return (
    <div className={cn(
      'flex items-start gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-200',
      item.status === 'running' && 'bg-accent-primary/5 border border-accent-primary/10',
      item.status === 'done' && 'opacity-70',
      item.status === 'skipped' && 'opacity-40',
    )}>
      <div className="mt-0.5">
        <StatusIcon status={item.status} />
      </div>
      <div className="flex-1 min-w-0">
        <span className={cn(
          'text-[12px] leading-tight block',
          item.status === 'done' && 'text-text-muted line-through',
          item.status === 'running' && 'text-text-primary font-medium',
          item.status === 'error' && 'text-red-400',
          item.status === 'pending' && 'text-text-secondary',
          item.status === 'skipped' && 'text-text-muted',
        )}>
          {item.label}
        </span>
        {item.detail && item.status === 'running' && (
          <span className="text-[10px] text-text-muted block mt-0.5 truncate">
            {item.detail}
          </span>
        )}
      </div>
      {item.duration !== undefined && item.status === 'done' && (
        <span className="text-[10px] text-text-muted flex items-center gap-0.5 flex-shrink-0">
          <Clock size={9} />
          {formatDuration(item.duration)}
        </span>
      )}
    </div>
  );
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

// ============================================================================
// PROGRESS BAR
// ============================================================================

const ProgressBar: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-text-muted font-medium">
          {done}/{total} tâches
        </span>
        <span className="text-[10px] text-accent-primary font-bold">{pct}%</span>
      </div>
      <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className="h-full gradient-bg rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const StudioTodoList: React.FC = () => {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [session, setSession] = useState<TodoSession | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = studioTodoManager.subscribe((newItems, newSession) => {
      setItems([...newItems]);
      setSession(newSession);
    });
    return unsub;
  }, []);

  // Auto-scroll to running item
  useEffect(() => {
    if (scrollRef.current) {
      const running = scrollRef.current.querySelector('[data-running="true"]');
      if (running) {
        running.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [items]);

  if (!session || items.length === 0) return null;

  const stats = studioTodoManager.getStats();

  return (
    <div className="border-b border-border-subtle">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-surface-hover transition-colors"
      >
        {collapsed ? (
          <ChevronRight size={12} className="text-text-muted" />
        ) : (
          <ChevronDown size={12} className="text-text-muted" />
        )}
        <Zap size={12} className="text-accent-primary" />
        <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider flex-1 text-left">
          Tâches
        </span>
        <span className="text-[10px] text-text-muted">
          {stats.done}/{stats.total}
        </span>
      </button>

      {!collapsed && (
        <>
          <ProgressBar done={stats.done} total={stats.total} />

          <div ref={scrollRef} className="px-1.5 pb-2 space-y-0.5 max-h-[200px] overflow-y-auto scrollbar-thin">
            {items.map(item => (
              <div key={item.id} data-running={item.status === 'running' ? 'true' : undefined}>
                <TodoItemRow item={item} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default StudioTodoList;
