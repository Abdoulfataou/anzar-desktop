/**
 * Compteur du budget du tour : « 320 / 1 200 FCFA ».
 *
 * Affiché seulement quand un plafond de coût existe : c'est la dimension qui surprend
 * l'utilisateur (les étapes et les tokens sont abstraits, les FCFA non).
 */
import type { BudgetView } from '@/services/agent/engine/budget';
import { cn } from '@/lib/utils';

interface BudgetBadgeProps {
  view: BudgetView | null;
}

export function BudgetBadge({ view }: BudgetBadgeProps) {
  const limit = view?.limit.fcfa;
  if (!view || !limit || limit <= 0) return null;

  const used = Math.round(view.used.fcfa);
  const pct = Math.round(view.usedPct * 100);
  const label = `Budget utilisé : ${used} FCFA sur ${limit}`;

  return (
    <span
      className={cn(
        'px-1.5 py-0.5 rounded-md text-[11px] tabular-nums select-none',
        pct >= 85 ? 'text-credit' : pct >= 60 ? 'text-text-secondary' : 'text-text-muted',
      )}
      title={`Budget de cette demande : ${used} FCFA sur ${limit} (${pct} %)`}
      aria-label={label}
    >
      {used} / {limit} FCFA
    </span>
  );
}
