/**
 * Terminal — Terminal intégré ANZAR
 * Affichage stdout/stderr coloré, input de commandes, historique, kill process
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Terminal as TerminalIcon, X, Trash2, Square, Play,
  ChevronUp, ChevronDown, Maximize2, Minimize2,
  Package, GitBranch, Zap, AlertTriangle, CheckCircle2,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  terminalService,
  ProcessOutput,
  TerminalEvent,
  RunningProcess,
} from '@/services/terminal';

// ============================================================================
// OUTPUT LINE COMPONENT
// ============================================================================

function OutputLine({ output }: { output: ProcessOutput }) {
  const colorMap: Record<ProcessOutput['type'], string> = {
    stdout: 'text-text-primary',
    stderr: 'text-accent-error',
    system: 'text-accent-info',
    error: 'text-accent-error font-semibold',
    success: 'text-accent-success font-semibold',
  };

  const prefixMap: Record<ProcessOutput['type'], string> = {
    stdout: '',
    stderr: '⚠ ',
    system: '▸ ',
    error: '✗ ',
    success: '✓ ',
  };

  return (
    <div
      className={cn(
        'px-4 py-0.5 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all',
        colorMap[output.type] || 'text-text-primary',
        output.type === 'stderr' && 'bg-accent-error/5',
        output.type === 'error' && 'bg-accent-error/10',
        output.type === 'success' && 'bg-accent-success/5',
        output.type === 'system' && 'bg-accent-info/5 text-accent-info',
      )}
    >
      <span className="select-none opacity-50">{prefixMap[output.type]}</span>
      {output.content}
    </div>
  );
}

// ============================================================================
// MAIN TERMINAL COMPONENT
// ============================================================================

interface TerminalProps {
  projectPath?: string;
  className?: string;
  defaultExpanded?: boolean;
  onClose?: () => void;
}

export default function TerminalPanel({
  projectPath,
  className,
  defaultExpanded = true,
  onClose,
}: TerminalProps) {
  const [outputs, setOutputs] = useState<ProcessOutput[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isMaximized, setIsMaximized] = useState(false);
  const [runningProcesses, setRunningProcesses] = useState<RunningProcess[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Subscribe to terminal events
  useEffect(() => {
    const unsubscribe = terminalService.onEvent((event: TerminalEvent) => {
      switch (event.type) {
        case 'output':
          setOutputs((prev) => {
            const next = [...prev, event.data];
            // Cap at 500 entries to prevent memory leak
            return next.length > 500 ? next.slice(-500) : next;
          });
          break;
        case 'process-start':
          setRunningProcesses((prev) => [...prev, event.process]);
          break;
        case 'process-end':
        case 'process-error':
          setRunningProcesses((prev) =>
            prev.filter((p) => p.id !== event.processId)
          );
          break;
      }
    });

    return unsubscribe;
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [outputs]);

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded) {
      inputRef.current?.focus();
    }
  }, [isExpanded]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cmd = inputValue.trim();
    if (!cmd) return;

    // Add to history
    setCommandHistory((prev) => [cmd, ...prev.slice(0, 50)]);
    setHistoryIndex(-1);
    setInputValue('');

    // Execute command
    await terminalService.runCommand(cmd, { cwd: projectPath });
  }, [inputValue, projectPath]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHistoryIndex((prev) => {
        const next = Math.min(prev + 1, commandHistory.length - 1);
        if (next >= 0) setInputValue(commandHistory[next]);
        return next;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHistoryIndex((prev) => {
        const next = prev - 1;
        if (next < 0) {
          setInputValue('');
          return -1;
        }
        setInputValue(commandHistory[next]);
        return next;
      });
    } else if (e.key === 'c' && e.ctrlKey) {
      // Ctrl+C — kill all running
      terminalService.killAll();
    }
  }, [commandHistory]);

  const handleClear = () => {
    setOutputs([]);
    terminalService.clearOutput();
  };

  const handleKillAll = () => {
    terminalService.killAll();
  };

  // Quick actions
  const quickActions = [
    {
      icon: Package, label: 'Install', color: 'text-accent-primary',
      action: () => projectPath && terminalService.installDependencies(projectPath),
    },
    {
      icon: Play, label: 'Run', color: 'text-accent-success',
      action: () => projectPath && terminalService.runDevServer(projectPath),
    },
    {
      icon: Zap, label: 'Build', color: 'text-accent-warning',
      action: () => projectPath && terminalService.buildProject(projectPath),
    },
    {
      icon: GitBranch, label: 'Git', color: 'text-accent-secondary',
      action: () => projectPath && terminalService.gitStatus(projectPath),
    },
  ];

  const isRunning = runningProcesses.length > 0;

  if (!isExpanded) {
    return (
      <div
        className={cn(
          'flex items-center justify-between px-4 py-2 border-t border-border-subtle bg-bg-secondary/50 cursor-pointer',
          className
        )}
        onClick={() => setIsExpanded(true)}
      >
        <div className="flex items-center gap-2">
          <TerminalIcon size={14} className="text-text-muted" />
          <span className="text-xs font-medium text-text-secondary">Terminal</span>
          {isRunning && (
            <div className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin text-accent-primary" />
              <span className="text-[10px] text-accent-primary">{runningProcesses.length} en cours</span>
            </div>
          )}
        </div>
        <ChevronUp size={14} className="text-text-muted" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col border-t border-border-subtle bg-bg-primary',
        isMaximized ? 'fixed inset-0 z-50' : '',
        className
      )}
      style={!isMaximized ? { height: '280px' } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-secondary/80 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-2">
          <TerminalIcon size={14} className="text-accent-primary" />
          <span className="text-xs font-semibold text-text-primary">Terminal</span>
          {isRunning && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent-primary/10">
              <Loader2 size={10} className="animate-spin text-accent-primary" />
              <span className="text-[10px] font-medium text-accent-primary">{runningProcesses.length}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Quick actions */}
          {projectPath && quickActions.map((qa) => (
            <button
              key={qa.label}
              onClick={() => qa.action()}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium',
                'hover:bg-surface-hover transition-colors',
                qa.color
              )}
              title={qa.label}
            >
              <qa.icon size={11} />
              <span className="hidden sm:inline">{qa.label}</span>
            </button>
          ))}

          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* Kill all */}
          {isRunning && (
            <button
              onClick={handleKillAll}
              className="p-1 rounded hover:bg-accent-error/10 text-accent-error transition-colors"
              title="Arrêter tout"
            >
              <Square size={12} />
            </button>
          )}

          {/* Clear */}
          <button
            onClick={handleClear}
            className="p-1 rounded hover:bg-surface-hover text-text-muted transition-colors"
            title="Effacer"
          >
            <Trash2 size={12} />
          </button>

          {/* Maximize */}
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1 rounded hover:bg-surface-hover text-text-muted transition-colors"
            title={isMaximized ? 'Réduire' : 'Agrandir'}
          >
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>

          {/* Collapse */}
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 rounded hover:bg-surface-hover text-text-muted transition-colors"
            title="Réduire"
          >
            <ChevronDown size={12} />
          </button>

          {/* Close */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-accent-error/10 text-text-muted hover:text-accent-error transition-colors"
              title="Fermer"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Output area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-bg-primary/50 font-mono"
        onClick={() => inputRef.current?.focus()}
      >
        {outputs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <TerminalIcon size={24} className="text-text-muted mb-2 opacity-30" />
            <p className="text-xs text-text-muted">
              Tape une commande ou utilise les boutons rapides ci-dessus
            </p>
            {projectPath && (
              <p className="text-[10px] text-text-muted mt-1 opacity-60 truncate max-w-[300px]">
                cwd: {projectPath}
              </p>
            )}
          </div>
        ) : (
          <div className="py-1">
            {outputs.map((output) => (
              <OutputLine key={output.id} output={output} />
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-3 py-2 border-t border-border-subtle bg-bg-secondary/30 flex-shrink-0"
      >
        <span className="text-accent-primary text-xs font-mono font-bold select-none">$</span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Entrer une commande..."
          className={cn(
            'flex-1 bg-transparent border-none outline-none',
            'text-xs font-mono text-text-primary placeholder-text-muted',
          )}
          spellCheck={false}
          autoComplete="off"
        />
        {inputValue.trim() && (
          <button
            type="submit"
            className="px-2 py-1 rounded text-[10px] font-medium gradient-bg text-white hover:opacity-90 transition-opacity"
          >
            Exécuter
          </button>
        )}
      </form>
    </div>
  );
}
