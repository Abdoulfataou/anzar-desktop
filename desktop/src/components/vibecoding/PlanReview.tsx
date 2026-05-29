/**
 * PlanReview — Affichage interactif du plan avant exécution.
 *
 * Montre une vue d'ensemble du plan :
 *  - Titre + description
 *  - Fichiers à générer (arbre visuel)
 *  - Phases de développement
 *  - Complexité estimée
 *  - Bouton "Générer le projet"
 */

import React, { useMemo } from 'react';
import {
  Play, FileCode, FileJson, FileText, File,
  Layers, Clock, Zap, AlertTriangle,
  ChevronRight, Sparkles, FolderTree,
  Settings, Image,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanResult } from '@/services/projectGeneration';

// ============================================================================
// TYPES
// ============================================================================

interface PlanReviewProps {
  plan: PlanResult;
  onExecute: () => void;
  onCancel: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

function getFileIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts': case 'tsx': case 'js': case 'jsx':
    case 'py': case 'java': case 'go': case 'rs':
    case 'cpp': case 'c': case 'rb': case 'php':
      return FileCode;
    case 'json': case 'yaml': case 'yml': case 'toml': case 'xml':
      return FileJson;
    case 'md': case 'txt': case 'csv':
      return FileText;
    case 'png': case 'jpg': case 'svg': case 'gif':
      return Image;
    case 'env': case 'gitignore':
      return Settings;
    default:
      return File;
  }
}

function getExtColor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts': case 'tsx': return 'text-blue-400';
    case 'js': case 'jsx': return 'text-yellow-400';
    case 'py': return 'text-green-400';
    case 'html': return 'text-orange-400';
    case 'css': case 'scss': return 'text-pink-400';
    case 'json': return 'text-amber-400';
    default: return 'text-text-muted';
  }
}

function complexityConfig(c: string) {
  switch (c) {
    case 'low': return { label: 'Simple', color: 'text-emerald-400 bg-emerald-400/10', icon: Zap };
    case 'high': return { label: 'Complexe', color: 'text-red-400 bg-red-400/10', icon: AlertTriangle };
    default: return { label: 'Moyen', color: 'text-amber-400 bg-amber-400/10', icon: Layers };
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const PlanReview: React.FC<PlanReviewProps> = ({ plan, onExecute, onCancel }) => {
  const complexity = useMemo(() => complexityConfig(plan.complexity), [plan.complexity]);
  const ComplexityIcon = complexity.icon;

  // Grouper les fichiers par dossier pour l'affichage
  const filesByDir = useMemo(() => {
    const dirs = new Map<string, typeof plan.files>();
    for (const f of plan.files) {
      const parts = f.path.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir)!.push(f);
    }
    return dirs;
  }, [plan.files]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* ── Header ── */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-primary/10 text-accent-primary text-[11px] font-semibold mb-4">
            <Sparkles size={12} />
            Plan de projet
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">
            {plan.title}
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed max-w-lg mx-auto">
            {plan.overview}
          </p>
        </div>

        {/* ── Stats bar ── */}
        <div className="flex items-center justify-center gap-6 mb-8">
          <div className="flex items-center gap-2">
            <FolderTree size={14} className="text-accent-primary" />
            <span className="text-sm text-text-primary font-medium">{plan.files.length}</span>
            <span className="text-sm text-text-muted">fichiers</span>
          </div>
          <div className="w-px h-4 bg-border-subtle" />
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-accent-secondary" />
            <span className="text-sm text-text-primary font-medium">{plan.phases?.length || 0}</span>
            <span className="text-sm text-text-muted">phases</span>
          </div>
          <div className="w-px h-4 bg-border-subtle" />
          <div className={cn('flex items-center gap-2 px-2.5 py-1 rounded-full text-[12px] font-medium', complexity.color)}>
            <ComplexityIcon size={13} />
            {complexity.label}
          </div>
        </div>

        {/* ── Fichiers à générer ── */}
        <div className="mb-6">
          <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-3">
            Fichiers à générer
          </h3>
          <div className="space-y-3">
            {Array.from(filesByDir.entries()).map(([dir, dirFiles]) => (
              <div key={dir} className="rounded-lg border border-border-subtle bg-bg-secondary/30 overflow-hidden">
                {/* Directory header */}
                {dir !== '.' && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary/50 border-b border-border-subtle">
                    <FolderTree size={13} className="text-accent-secondary" />
                    <span className="text-[12px] font-medium text-text-primary">{dir}/</span>
                    <span className="text-[10px] text-text-muted ml-auto">{dirFiles.length} fichiers</span>
                  </div>
                )}
                {/* Files */}
                <div className="divide-y divide-border-subtle/50">
                  {dirFiles.map(f => {
                    const Icon = getFileIcon(f.path);
                    const fileName = f.path.split('/').pop() || f.path;
                    return (
                      <div key={f.path} className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-hover/50 transition-colors">
                        <Icon size={14} className={cn('flex-shrink-0', getExtColor(f.path))} />
                        <div className="flex-1 min-w-0">
                          <span className="text-[12px] text-text-primary font-medium">{fileName}</span>
                          {f.description && (
                            <p className="text-[11px] text-text-muted truncate">{f.description}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-text-muted/60 uppercase flex-shrink-0">{f.type}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Phases ── */}
        {plan.phases && plan.phases.length > 0 && (
          <div className="mb-8">
            <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-3">
              Phases de développement
            </h3>
            <div className="space-y-2">
              {plan.phases.map((phase, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border-subtle bg-bg-secondary/30">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-primary/15 text-accent-primary text-[11px] font-bold flex-shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-text-primary">{phase.name}</span>
                      {phase.duration && (
                        <span className="flex items-center gap-1 text-[10px] text-text-muted">
                          <Clock size={10} />
                          {phase.duration}
                        </span>
                      )}
                    </div>
                    {phase.description && (
                      <p className="text-[11px] text-text-muted mt-0.5">{phase.description}</p>
                    )}
                    {phase.tasks && phase.tasks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {phase.tasks.map((task, j) => (
                          <span key={j} className="px-2 py-0.5 rounded-md bg-bg-tertiary text-[10px] text-text-secondary">
                            {task}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Action buttons ── */}
        <div className="flex items-center justify-center gap-3 pt-4 pb-2">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl text-sm text-text-secondary hover:bg-surface-hover transition-colors border border-border-subtle"
          >
            Annuler
          </button>
          <button
            onClick={onExecute}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold gradient-bg text-white hover:opacity-90 transition-all shadow-lg shadow-accent-primary/20"
          >
            <Play size={16} />
            Générer le projet
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlanReview;
