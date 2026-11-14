/**
 * FileChips — Puces de fichiers modifiés avec deltas (+lignes/−lignes).
 *
 * Chaque puce : nom du fichier + badge de delta (vert/rouge) calculé par
 * diffLines entre previousContent et content (status 'modified').
 * Fichiers simplement générés (done/generating) : puce neutre sans delta.
 * Clic → sélection du fichier (ouverture dans l'éditeur / onglet Diff).
 */
import React, { useMemo } from 'react';
import { FileCode, Loader2 } from 'lucide-react';
import { diffLines } from 'diff';
import { cn } from '@/lib/utils';
import type { StudioFile } from './VibeCodingStudio';

export interface FileDelta {
  path: string;
  name: string;
  added: number;
  removed: number;
  status: StudioFile['status'];
}

/** Calcule le delta (+/−) d'un fichier modifié. */
export function computeDelta(file: StudioFile): { added: number; removed: number } {
  if (file.status !== 'modified' || file.previousContent === undefined) {
    return { added: 0, removed: 0 };
  }
  const parts = diffLines(file.previousContent, file.content);
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    const n = p.count ?? 0;
    if (p.added) added += n;
    else if (p.removed) removed += n;
  }
  return { added, removed };
}

export function useFileDeltas(files: StudioFile[]): FileDelta[] {
  return useMemo(
    () =>
      files
        .filter((f) => f.status === 'modified' || f.status === 'generating' || f.status === 'done')
        .sort((a, b) => {
          // modifiés d'abord, puis génération en cours, puis le reste
          const rank = (s: StudioFile['status']) => (s === 'modified' ? 0 : s === 'generating' ? 1 : 2);
          return rank(a.status) - rank(b.status);
        })
        .map((f) => ({
          path: f.path,
          name: f.path.split('/').pop() || f.path,
          status: f.status,
          ...computeDelta(f),
        })),
    [files]
  );
}

interface FileChipsProps {
  files: StudioFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  /** Limite de puces affichées (défaut 12, reste en +N) */
  max?: number;
}

export default function FileChips({ files, selectedFile, onSelectFile, max = 12 }: FileChipsProps) {
  const chips = useFileDeltas(files);

  if (chips.length === 0) return null;
  const visible = chips.slice(0, max);
  const rest = chips.length - visible.length;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 border-b border-border-subtle bg-bg-secondary/30 flex-shrink-0">
      {visible.map((c) => (
        <button
          key={c.path}
          onClick={() => onSelectFile(c.path)}
          title={c.path}
          className={cn(
            'flex items-center gap-1.5 h-6 pl-2 pr-1.5 rounded-full border text-[11px] transition-all flex-shrink-0',
            'font-mono tabular-nums',
            selectedFile === c.path
              ? 'border-accent-primary/40 bg-accent-primary/10 text-text-primary'
              : 'border-border-subtle bg-surface-elevated/60 text-text-secondary hover:bg-surface-hover'
          )}
        >
          {c.status === 'generating' ? (
            <Loader2 size={11} className="animate-spin text-accent-primary" />
          ) : (
            <FileCode size={11} className="text-text-muted" />
          )}
          <span className="max-w-[120px] truncate">{c.name}</span>
          {c.status === 'modified' && (c.added > 0 || c.removed > 0) && (
            <span className="flex items-center gap-1 text-[10px] font-semibold">
              {c.added > 0 && <span className="text-accent-success">+{c.added}</span>}
              {c.removed > 0 && <span className="text-accent-error">−{c.removed}</span>}
            </span>
          )}
        </button>
      ))}
      {rest > 0 && (
        <span className="text-[10px] text-text-muted flex-shrink-0 px-1">+{rest}</span>
      )}
    </div>
  );
}
