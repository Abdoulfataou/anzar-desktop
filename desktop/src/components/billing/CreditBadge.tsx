/**
 * CreditBadge — Pilule de crédits persistante (barre supérieure).
 *
 * 4 états visuels :
 *  - normal      : solde sain, pilule discrète
 *  - low         : < LOW_THRESHOLD → ambre, invite à recharger
 *  - insufficient: < CRITICAL_THRESHOLD → orange fort + halo
 *  - empty       : 0 (ou non connecté) → rouge, action bloquante
 *
 * Clic → RechargeModal (crédits prépayés FCFA, Mobile Money).
 * Chiffres en JetBrains Mono + tabular-nums (stabilité de largeur).
 */
import { useState } from 'react';
import { Wallet, AlertTriangle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAccountStore } from '@/stores/accountStore';
import RechargeModal from './RechargeModal';

const LOW_THRESHOLD = 1000;      // FCFA — passe en ambre
const CRITICAL_THRESHOLD = 200;  // FCFA — orange fort

type BadgeState = 'normal' | 'low' | 'insufficient' | 'empty';

function getBadgeState(loggedIn: boolean, remaining: number): BadgeState {
  if (!loggedIn || remaining <= 0) return 'empty';
  if (remaining < CRITICAL_THRESHOLD) return 'insufficient';
  if (remaining < LOW_THRESHOLD) return 'low';
  return 'normal';
}

const STYLES: Record<BadgeState, { pill: string; label: string; icon: React.ReactNode }> = {
  normal: {
    pill: 'border-border-subtle bg-surface-elevated/80 text-text-secondary hover:bg-surface-hover hover:border-border-medium',
    label: 'Crédits',
    icon: <Wallet size={13} className="text-text-muted" />,
  },
  low: {
    pill: 'border-accent-warning/30 bg-accent-warning/10 text-accent-warning hover:bg-accent-warning/15',
    label: 'Bientôt épuisé',
    icon: <AlertTriangle size={13} />,
  },
  insufficient: {
    pill: 'border-accent-warning/50 bg-accent-warning/15 text-accent-warning shadow-[0_0_12px_var(--glow-accent)] hover:bg-accent-warning/20',
    label: 'Presque à sec',
    icon: <AlertTriangle size={13} className="animate-pulse" />,
  },
  empty: {
    pill: 'border-accent-error/40 bg-accent-error/10 text-accent-error hover:bg-accent-error/15',
    label: 'Recharger',
    icon: <Zap size={13} />,
  },
};

export default function CreditBadge() {
  const [showRecharge, setShowRecharge] = useState(false);
  const loggedIn = useAccountStore((s) => s.isLoggedIn);
  const remaining = useAccountStore((s) => s.credits.remaining);

  const state = getBadgeState(loggedIn, remaining);
  const style = STYLES[state];

  return (
    <>
      <button
        onClick={() => setShowRecharge(true)}
        title={`Solde : ${remaining.toLocaleString('fr-FR')} FCFA — cliquer pour recharger`}
        className={cn(
          'flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-medium transition-all select-none',
          'font-mono tabular-nums',
          style.pill
        )}
      >
        {style.icon}
        <span className="font-semibold">{remaining.toLocaleString('fr-FR')}</span>
        <span className="opacity-60 font-sans text-[10px]">FCFA</span>
      </button>

      {showRecharge && <RechargeModal onClose={() => setShowRecharge(false)} />}
    </>
  );
}
