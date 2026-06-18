/**
 * StudioGitHistory — Panneau d'historique git des itérations.
 *
 * Affiche la liste des commits (snapshots ANZAR) avec :
 *  - Hash court + message + date relative
 *  - Stat diff (fichiers modifiés) au clic
 *  - Bouton rollback vers un commit spécifique
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, GitCommit, ChevronRight, ChevronDown,
  Loader2, Undo2, FileCode, Plus, Minus, Edit3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { terminalService } from '@/services/terminal';

// ============================================================================
// TYPES
// ============================================================================

interface GitLogEntry {
  hash: string;
  message: string;
  date: string;
}

interface StudioGitHistoryProps {
  projectPath: string;
  commitCount: number;
  onRollbackToCommit?: (hash: string) => Promise<void>;
}

// ============================================================================
// DIFF LINE PARSER
// ============================================================================

function parseDiffStat(stat: string): Array<{ file: string; additions: number; deletions: number }> {
  // Parse `git diff --stat` output:
  // "src/App.tsx | 5 +++--"
  // "src/main.ts | 12 ++++++------"
  const lines = stat.split('\n').filter(Boolean);
  const result: Array<{ file: string; additions: number; deletions: number }> = [];

  for (const line of lines) {
    // Skip summary line like "3 files changed, 10 insertions(+), 5 deletions(-)"
    if (line.includes('files changed') || line.includes('file changed')) continue;

    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([+-]*)/);
    if (match) {
      const file = match[1].trim();
      const plusCount = (match[3] || '').split('').filter(c => c === '+').length;
      const minusCount = (match[3] || '').split('').filter(c => c === '-').length;
      result.push({ file, additions: plusCount, deletions: minusCount });
    }
  }

  return result;
}

// ============================================================================
// COMPOSANT
// ============================================================================

const StudioGitHistory: React.FC<StudioGitHistoryProps> = ({
  projectPath,
  commitCount,
  onRollbackToCommit,
}) => {
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<Record<string, string>>({});
  const [diffLoading, setDiffLoading] = useState<string | null>(null);

  // Load git log
  useEffect(() => {
    if (!projectPath) return;

    const load = async () => {
      setLoading(true);
      try {
        const log = await terminalService.gitLogDetailed(projectPath, 30);
        setEntries(log);
      } catch {
        setEntries([]);
      }
      setLoading(false);
    };

    load();
  }, [projectPath, commitCount]); // Re-fetch when commitCount changes (new iteration)

  // Load diff for a specific commit
  const loadDiff = useCallback(async (hash: string) => {
    if (diffData[hash]) {
      // Already loaded, just toggle
      setExpandedHash(prev => prev === hash ? null : hash);
      return;
    }

    setDiffLoading(hash);
    setExpandedHash(hash);

    try {
      const stat = await terminalService.gitDiff(projectPath, hash);
      setDiffData(prev => ({ ...prev, [hash]: stat }));
    } catch {
      setDiffData(prev => ({ ...prev, [hash]: 'Impossible de charger le diff.' }));
    }

    setDiffLoading(null);
  }, [projectPath, diffData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-text-muted">
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-xs">Chargement de l'historique...</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-text-muted">
        <GitBranch size={24} className="mb-2 opacity-30" />
        <span className="text-xs">Aucun historique git</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <GitBranch size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">
          Historique ({entries.length} snapshots)
        </span>
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-y-auto">
        {entries.map((entry, idx) => {
          const isExpanded = expandedHash === entry.hash;
          const shortHash = entry.hash.slice(0, 7);
          const isFirst = idx === 0;
          const diffStat = diffData[entry.hash] ? parseDiffStat(diffData[entry.hash]) : [];

          return (
            <div key={entry.hash} className="border-b border-border-subtle/50">
              {/* Commit row */}
              <button
                onClick={() => loadDiff(entry.hash)}
                className={cn(
                  'flex items-start gap-2 w-full px-3 py-2 text-left hover:bg-surface-hover transition-colors',
                  isExpanded && 'bg-surface-hover/50',
                )}
              >
                {/* Timeline dot */}
                <div className="flex flex-col items-center mt-1 flex-shrink-0">
                  <div className={cn(
                    'w-2 h-2 rounded-full',
                    isFirst ? 'bg-accent-primary' : 'bg-text-muted/30',
                  )} />
                  {idx < entries.length - 1 && (
                    <div className="w-px h-full bg-border-subtle mt-1" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {isExpanded ? <ChevronDown size={10} className="text-text-muted flex-shrink-0" /> : <ChevronRight size={10} className="text-text-muted flex-shrink-0" />}
                    <span className="text-[11px] font-mono text-accent-primary/80">{shortHash}</span>
                    <span className="text-[11px] text-text-primary truncate">{entry.message}</span>
                  </div>
                  <span className="text-[10px] text-text-muted ml-5">{entry.date}</span>
                </div>

                {/* Rollback button (not for latest commit) */}
                {!isFirst && onRollbackToCommit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRollbackToCommit(entry.hash);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-orange-400 hover:bg-orange-500/10 transition-colors flex-shrink-0"
                    title="Revenir à ce snapshot"
                  >
                    <Undo2 size={10} />
                  </button>
                )}
              </button>

              {/* Expanded diff stat */}
              {isExpanded && (
                <div className="px-3 pb-2 ml-7">
                  {diffLoading === entry.hash ? (
                    <div className="flex items-center gap-1 text-[10px] text-text-muted py-1">
                      <Loader2 size={10} className="animate-spin" />
                      Chargement du diff...
                    </div>
                  ) : diffStat.length > 0 ? (
                    <div className="space-y-0.5">
                      {diffStat.map((file, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <FileCode size={10} className="text-text-muted flex-shrink-0" />
                          <span className="text-text-secondary truncate flex-1">{file.file}</span>
                          {file.additions > 0 && (
                            <span className="flex items-center gap-0.5 text-emerald-400">
                              <Plus size={8} />{file.additions}
                            </span>
                          )}
                          {file.deletions > 0 && (
                            <span className="flex items-center gap-0.5 text-red-400">
                              <Minus size={8} />{file.deletions}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : diffData[entry.hash] ? (
                    <div className="text-[10px] text-text-muted font-mono whitespace-pre-wrap max-h-[120px] overflow-y-auto bg-bg-tertiary/50 rounded p-1.5">
                      {diffData[entry.hash]}
                    </div>
                  ) : (
                    <div className="text-[10px] text-text-muted py-1">
                      Commit initial — pas de diff
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StudioGitHistory;
