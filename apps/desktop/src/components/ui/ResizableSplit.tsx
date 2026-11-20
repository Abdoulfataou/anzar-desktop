/**
 * ResizableSplit — Découpe horizontale en 2 panneaux avec divider draggable.
 *
 * - Pourcentage piloté par drag souris (pointer events), borné [minLeftPct, 100-minLeftPct]
 * - Divider accessible au clavier (← →, 2% par pression)
 * - Double-clic sur le divider → reset à la position initiale
 */
import React, { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ResizableSplitProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Largeur gauche initiale en % (défaut 38) */
  initialLeftPct?: number;
  /** Borne minimale gauche en % (défaut 22) */
  minLeftPct?: number;
  className?: string;
  /** Masque le panneau droit : le gauche prend toute la largeur */
  rightHidden?: boolean;
  /** Clé localStorage : la largeur choisie est retenue d'une ouverture à l'autre */
  storageKey?: string;
}

export default function ResizableSplit({
  left,
  right,
  initialLeftPct = 38,
  minLeftPct = 22,
  className,
  rightHidden = false,
  storageKey,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPctState] = useState(() => {
    try {
      const saved = storageKey ? Number(localStorage.getItem(storageKey)) : NaN;
      if (saved >= minLeftPct && saved <= 100 - minLeftPct) return saved;
    } catch { /* stockage indisponible */ }
    return initialLeftPct;
  });
  const setLeftPct = useCallback((v: number | ((p: number) => number)) => {
    setLeftPctState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      try { if (storageKey) localStorage.setItem(storageKey, String(Math.round(next * 10) / 10)); } catch { /* ignore */ }
      return next;
    });
  }, [storageKey]);
  const [isDragging, setIsDragging] = useState(false);

  const applyPct = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(100 - minLeftPct, Math.max(minLeftPct, pct)));
    },
    [minLeftPct, setLeftPct]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setIsDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      applyPct(e.clientX);
    },
    [isDragging, applyPct]
  );

  const endDrag = useCallback(() => setIsDragging(false), []);

  if (rightHidden) {
    return (
      <div ref={containerRef} className={cn('flex min-h-0 min-w-0 relative', className)}>
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">{left}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('flex min-h-0 min-w-0 relative', className)}>
      <div className="min-w-0 min-h-0 overflow-hidden" style={{ width: `${leftPct}%`, flexShrink: 0 }}>
        {left}
      </div>

      {/* Divider */}
      <div
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setLeftPct(initialLeftPct)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setLeftPct((p) => Math.max(minLeftPct, p - 2));
          if (e.key === 'ArrowRight') setLeftPct((p) => Math.min(100 - minLeftPct, p + 2));
        }}
        title="Glisser pour redimensionner · double-clic pour réinitialiser"
        className={cn(
          'w-1 flex-shrink-0 relative z-10 group outline-none cursor-col-resize'
        )}
      >
        {/* Zone de hit confortable (8px) invisible */}
        <div
          className={cn(
            'absolute inset-y-3 left-1/2 -translate-x-1/2 w-0.5 rounded-full transition-colors',
            'group-hover:bg-text-muted group-focus-visible:bg-text-muted',
            isDragging && 'bg-text-muted'
          )}
        />
        {/* Poignée centrale */}
        <div
          className={cn(
            'hidden'
          )}
        />
      </div>

      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">{right}</div>
    </div>
  );
}
