/**
 * StudioDiff — Onglet Diff du studio : diff unifié des fichiers modifiés.
 *
 * S'appuie sur StudioFile.previousContent vs content (rempli par le hook
 * useVibeCodingStudio à chaque itération). Rendu ligne à ligne :
 * fond vert/rouge 8-12% (palette calme), numéros de ligne en mono.
 */
import React, { useMemo, useState } from 'react';
import { GitCompare, FileCode } from 'lucide-react';
import { diffLines } from 'diff';
import { cn } from '@/lib/utils';
import type { StudioFile } from './VibeCodingStudio';
import { computeDelta } from './FileChips';

interface StudioDiffProps {
  files: StudioFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

interface DiffRow {
  type: 'ctx' | 'add' | 'rem' | 'hunk';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

function buildRows(oldText: string, newText: string): DiffRow[] {
  const parts = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  let lastWasRem = false;

  for (const p of parts) {
    const lines = (p.value.endsWith('\n') ? p.value.slice(0, -1) : p.value).split('\n');
    for (const line of lines) {
      if (p.removed) {
        rows.push({ type: 'rem', oldNo: oldNo++, newNo: null, text: line });
        lastWasRem = true;
      } else if (p.added) {
        rows.push({ type: 'add', oldNo: null, newNo: newNo++, text: line });
        lastWasRem = false;
      } else {
        if (lastWasRem) rows.push({ type: 'hunk', oldNo: null, newNo: null, text: '⋯' });
        lastWasRem = false;
        rows.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line });
      }
    }
  }
  return rows;
}

export default function StudioDiff({ files, selectedFile, onSelectFile }: StudioDiffProps) {
  const modified = useMemo(
    () => files.filter((f) => f.status === 'modified' && f.previousContent !== undefined),
    [files]
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const activePath = selectedFile && modified.some((f) => f.path === selectedFile)
    ? selectedFile
    : modified[0]?.path ?? null;
  const active = modified.find((f) => f.path === activePath) || null;

  if (modified.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-6">
        <div>
          <GitCompare size={28} className="mx-auto mb-3 text-text-muted/40" />
          <p className="text-sm text-text-secondary mb-1">Aucune modification</p>
          <p className="text-xs text-text-muted">
            Le diff apparaît ici après une itération sur le projet.
          </p>
        </div>
      </div>
    );
  }

  const rows = active ? buildRows(active.previousContent ?? '', active.content) : [];
  const totals = active ? computeDelta(active) : { added: 0, removed: 0 };

  return (
    <div className="flex h-full min-h-0">
      {/* Liste des fichiers modifiés */}
      <div className="w-[220px] flex-shrink-0 border-r border-border-subtle overflow-y-auto py-2">
        {modified.map((f) => {
          const d = computeDelta(f);
          const isSel = f.path === activePath;
          return (
            <button
              key={f.path}
              onClick={() => onSelectFile(f.path)}
              className={cn(
                'w-full text-left px-3 py-1.5 flex items-center gap-1.5 text-[12px] transition-colors',
                isSel ? 'bg-accent-primary/10 text-text-primary' : 'text-text-secondary hover:bg-surface-hover'
              )}
              title={f.path}
            >
              <FileCode size={11} className="flex-shrink-0 opacity-60" />
              <span className="truncate flex-1 font-mono">{f.path.split('/').pop()}</span>
              {d.added > 0 && <span className="text-accent-success text-[10px] font-semibold">+{d.added}</span>}
              {d.removed > 0 && <span className="text-accent-error text-[10px] font-semibold">−{d.removed}</span>}
            </button>
          );
        })}
      </div>

      {/* Diff du fichier actif */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle bg-bg-secondary/30 flex-shrink-0">
          <span className="font-mono text-[11px] text-text-secondary truncate flex-1">{active?.path}</span>
          <span className="font-mono text-[11px] text-accent-success">+{totals.added}</span>
          <span className="font-mono text-[11px] text-accent-error">−{totals.removed}</span>
          <button
            onClick={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(activePath!)) next.delete(activePath!);
                else next.add(activePath!);
                return next;
              })
            }
            className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded transition-colors"
            title={collapsed.has(activePath!) ? 'Afficher tout le fichier' : 'Réduire aux changements'}
          >
            {collapsed.has(activePath!) ? 'Tout afficher' : 'Réduire'}
          </button>
        </div>

        <div className="flex-1 overflow-auto font-mono text-[11.5px] leading-[1.55]">
          {rows.map((r, i) => {
            if (r.type === 'hunk' && collapsed.has(activePath!)) {
              return (
                <div key={i} className="px-3 py-0.5 bg-bg-tertiary/50 text-text-muted text-[10px] select-none">
                  ⋯ contexte inchangé ⋯
                </div>
              );
            }
            if (r.type === 'hunk') {
              return (
                <div key={i} className="px-3 py-0.5 text-text-muted/50 text-[10px] select-none">
                  ⋯
                </div>
              );
            }
            const isCtx = r.type === 'ctx';
            if (isCtx && collapsed.has(activePath!)) {
              // en mode réduit on n'affiche pas les lignes de contexte
              return null;
            }
            return (
              <div
                key={i}
                className={cn(
                  'flex px-0 leading-[1.55]',
                  r.type === 'add' && 'bg-accent-success/[0.08]',
                  r.type === 'rem' && 'bg-accent-error/[0.08]'
                )}
              >
                <span className="w-10 flex-shrink-0 text-right pr-2 text-text-muted/40 select-none tabular-nums">
                  {r.oldNo ?? ''}
                </span>
                <span className="w-10 flex-shrink-0 text-right pr-2 text-text-muted/40 select-none tabular-nums">
                  {r.newNo ?? ''}
                </span>
                <span
                  className={cn(
                    'w-4 flex-shrink-0 select-none',
                    r.type === 'add' ? 'text-accent-success' : r.type === 'rem' ? 'text-accent-error' : 'text-text-muted/30'
                  )}
                >
                  {r.type === 'add' ? '+' : r.type === 'rem' ? '−' : ' '}
                </span>
                <pre className="flex-1 whitespace-pre-wrap break-all text-text-primary/90">{r.text || ' '}</pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
