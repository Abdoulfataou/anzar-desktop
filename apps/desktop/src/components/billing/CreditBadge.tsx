/**
 * CreditBadge — Pilule de crédits persistante (barre supérieure), Blueprint UI/UX.
 *
 * "Une interface neutre où la couleur est réservée au sens : l'ambre
 *  appartient exclusivement aux crédits."
 *
 * États (Blueprint §Badge de crédits) :
 *  - Normal      bg-surface-2 + border, icône ambre 14px, valeur en text
 *  - Bas         fond credit-soft, bordure credit/30, valeur en credit,
 *                seuil = moins de 5 générations moyennes restantes
 *  - Insuffisant comme « Bas » + libellé « Recharger » à la place de l'icône
 *  - Vide        fond danger/12, valeur en danger, libellé « Recharger »
 *
 * Animations : Débit → la valeur défile vers le bas (300 ms) + puce « −n »
 * qui monte et s'efface (600 ms). Crédit → compteur croissant (800 ms) +
 * halo success unique. Chiffres mono tabular-nums (le solde ne tremble pas).
 */
import { useEffect, useRef, useState } from 'react';
import { Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAccountStore } from '@/stores/accountStore';
import RechargeModal from './RechargeModal';

/** Coût moyen d'une génération (FCFA) — calibré sur le pricing de vente
 * ANZAR (~250 F/1M in, 500 F/1M out ; génération moyenne ≈ 20k in + 4k out). */
export const AVG_GENERATION_COST_FCFA = 300;

type BadgeState = 'normal' | 'low' | 'insufficient' | 'empty';

function getBadgeState(loggedIn: boolean, remaining: number): BadgeState {
  if (!loggedIn || remaining <= 0) return 'empty';
  // Insuffisant : solde inférieur au coût d'une génération moyenne
  if (remaining < AVG_GENERATION_COST_FCFA) return 'insufficient';
  // Bas : moins de 5 générations moyennes restantes
  if (remaining < 5 * AVG_GENERATION_COST_FCFA) return 'low';
  return 'normal';
}

/** Compteur animé : interpole vers `value` en `duration` ms. */
function useAnimatedCounter(value: number, duration: number): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return display;
}

export default function CreditBadge() {
  const [showRecharge, setShowRecharge] = useState(false);
  const loggedIn = useAccountStore((s) => s.isLoggedIn);
  const remaining = useAccountStore((s) => s.credits.remaining);

  // ── Détection débit/crédit pour les animations du Blueprint ──
  const prevRef = useRef(remaining);
  const [debitFlash, setDebitFlash] = useState<number | null>(null); // −n montant
  const [creditGlow, setCreditGlow] = useState(false);
  const [rollDown, setRollDown] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = remaining;
    if (remaining < prev) {
      // Débit : valeur défile vers le bas + puce « −n » qui monte (600 ms)
      setDebitFlash(prev - remaining);
      setRollDown(true);
      const t1 = setTimeout(() => setRollDown(false), 300);
      const t2 = setTimeout(() => setDebitFlash(null), 600);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (remaining > prev) {
      // Crédit : compteur croissant + halo success unique (800 ms)
      setCreditGlow(true);
      const t = setTimeout(() => setCreditGlow(false), 800);
      return () => clearTimeout(t);
    }
  }, [remaining]);

  const state = getBadgeState(loggedIn, remaining);
  const display = useAnimatedCounter(remaining, creditGlow ? 800 : 300);

  const pillClass = {
    normal: 'bg-surface-elevated border-border-medium text-text-primary hover:bg-surface-hover hover:border-border-strong',
    low: 'bg-credit-soft border-credit/30 text-credit hover:border-credit/50',
    insufficient: 'bg-credit-soft border-credit/40 text-credit hover:border-credit/60',
    empty: 'bg-accent-error/10 border-accent-error/40 text-accent-error hover:bg-accent-error/15',
  }[state];

  return (
    <>
      <button
        onClick={() => setShowRecharge(true)}
        title={
          state === 'normal'
            ? `Solde : ${remaining.toLocaleString('fr-FR')} FCFA`
            : state === 'low'
              ? `Il vous reste environ ${Math.max(1, Math.floor(remaining / AVG_GENERATION_COST_FCFA))} générations.`
              : 'Recharger vos crédits (FCFA)'
        }
        className={cn(
          'relative flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-medium transition-all duration-200 select-none',
          'font-mono tabular-nums',
          pillClass,
          creditGlow && 'ring-2 ring-accent-success/50 ring-offset-1 ring-offset-bg-primary'
        )}
      >
        {/* Icône ambre en état normal/bas ; libellé « Recharger » sinon */}
        {state === 'normal' || state === 'low' ? (
          <Wallet size={14} className={state === 'normal' ? 'text-credit' : ''} />
        ) : (
          <span className="font-sans text-[10px] font-semibold">Recharger</span>
        )}

        <span
          className={cn(
            'font-semibold transition-transform duration-300',
            rollDown && 'translate-y-[3px] opacity-40'
          )}
        >
          {display.toLocaleString('fr-FR')}
        </span>
        <span className="opacity-60 font-sans text-[10px]">FCFA</span>

        {/* Puce « −n » : monte et s'efface (600 ms) */}
        {debitFlash !== null && (
          <span
            className="absolute -top-2 right-0 px-1.5 py-0.5 rounded-full bg-bg-tertiary border border-border-subtle text-[9px] font-semibold text-text-secondary animate-debit-float pointer-events-none"
            aria-hidden
          >
            −{debitFlash.toLocaleString('fr-FR')}
          </span>
        )}
      </button>

      {showRecharge && <RechargeModal onClose={() => setShowRecharge(false)} />}
    </>
  );
}
