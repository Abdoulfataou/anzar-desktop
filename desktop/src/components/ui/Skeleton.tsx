/**
 * Skeleton — Placeholder de chargement anime
 * Utilise pour les pages async avant que les donnees arrivent
 */
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  /** Nombre de lignes a afficher */
  lines?: number;
  /** Variante: text (defaut), circle, card */
  variant?: 'text' | 'circle' | 'card';
}

export function Skeleton({ className, variant = 'text' }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-surface-hover rounded',
        variant === 'circle' && 'rounded-full',
        variant === 'card' && 'rounded-xl',
        className
      )}
    />
  );
}

/** Skeleton pour une section Settings complete */
export function SettingsSkeleton() {
  return (
    <div className="space-y-8 p-6 max-w-2xl">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Section 1 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton variant="circle" className="w-8 h-8" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="ml-[42px] space-y-3">
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Section 2 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton variant="circle" className="w-8 h-8" />
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="ml-[42px] space-y-3">
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-6 w-12 rounded-full" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-6 w-12 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Skeleton pour une liste de projets */
export function ProjectListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-border-subtle">
          <Skeleton variant="circle" className="w-10 h-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton pour le chat (messages) */
export function ChatSkeleton() {
  return (
    <div className="space-y-4 p-6">
      {/* Message AI */}
      <div className="flex gap-3">
        <Skeleton variant="circle" className="w-8 h-8 flex-shrink-0" />
        <div className="space-y-2 flex-1 max-w-[70%]">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      {/* Message User */}
      <div className="flex gap-3 justify-end">
        <div className="space-y-2 max-w-[60%]">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
