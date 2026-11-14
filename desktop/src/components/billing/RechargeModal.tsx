/**
 * RechargeModal — Recharge de crédits prépayés ANZAR (FCFA).
 *
 * Système prépayé : pas d'abonnement, des crédits FCFA consommés par usage.
 * Packs avec bonus progressif, moyens Mobile Money (Wave/Orange Money…).
 * L'intégration paiement automatique est en cours côté backend : la demande
 * est enregistrée (POST /api/payments/initiate) et validée par un admin.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, X, Check, Smartphone, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { openExternalUrl } from '@/services/infra/externalLinks';

export type PaymentMethod = 'wave' | 'orange_money' | 'airtel_money' | 'flooz' | 'mpesa' | 'nita_transfert' | 'amana_transfert';

const RECHARGE_PACKS = [
  { amount: 500,   bonus: 0,  label: 'Decouverte', tag: '' },
  { amount: 2000,  bonus: 0,  label: 'Starter',    tag: '' },
  { amount: 5000,  bonus: 15, label: 'Pro',         tag: 'Populaire' },
  { amount: 15000, bonus: 25, label: 'Business',    tag: '+25%' },
  { amount: 50000, bonus: 35, label: 'Enterprise',  tag: '+35%' },
];

function getRechargeBonus(amount: number): number {
  if (amount >= 50000) return 35;
  if (amount >= 15000) return 25;
  if (amount >= 5000) return 15;
  return 0;
}

const METHODS: { id: PaymentMethod; label: string; color: string }[] = [
  { id: 'wave',            label: 'Wave',              color: 'from-blue-500 to-cyan-500' },
  { id: 'orange_money',    label: 'Orange Money',      color: 'from-orange-500 to-amber-500' },
  { id: 'airtel_money',    label: 'Airtel Money',      color: 'from-red-500 to-rose-500' },
  { id: 'flooz',           label: 'Flooz (Moov)',      color: 'from-yellow-500 to-lime-500' },
  { id: 'mpesa',           label: 'M-Pesa',            color: 'from-green-600 to-emerald-500' },
  { id: 'nita_transfert',  label: 'Depot Nita',        color: 'from-purple-500 to-violet-500' },
  { id: 'amana_transfert', label: 'Depot Amana',       color: 'from-teal-500 to-cyan-600' },
];

export default function RechargeModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('wave');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const balance = useAccountStore((s) => s.credits.remaining);

  const numericAmount = typeof amount === 'number' ? amount : 0;
  const bonusPct = getRechargeBonus(numericAmount);
  const bonusAmount = bonusPct > 0 ? Math.round(numericAmount * bonusPct / 100) : 0;
  const totalCredited = numericAmount + bonusAmount;
  const isValid = numericAmount >= 500;

  const submit = async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const BACKEND = useSettingsStore.getState().getBackendUrl();
      const res = await fetch(`${BACKEND}/api/payments/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numericAmount,
          currency: 'XOF',
          method,
          userId: 'current-user',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.paymentUrl) {
          await openExternalUrl(data.paymentUrl);
          onClose();
          return;
        }
        toast.success(
          data?.message ||
            `Demande de recharge de ${numericAmount.toLocaleString('fr-FR')} F enregistrée ! Envoie le paiement via ${METHODS.find((m2) => m2.id === method)?.label || method}.`,
          { duration: 6000 }
        );
        onClose();
        return;
      }

      const text = await res.text().catch(() => '');
      throw new Error(text || 'Erreur serveur');
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Paiement indisponible pour le moment. Reessaie plus tard.";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Portail : la barre de titre a un backdrop-filter, qui piège les éléments `fixed`.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 animate-scale-in">
        <div className="rounded-2xl border border-border-medium bg-bg-secondary shadow-2xl overflow-y-auto max-h-[90vh]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
                <CreditCard size={16} className="text-white" />
              </div>
              <h3 className="text-base font-semibold text-text-primary">Recharger</h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Solde actuel — contexte wallet prépayé */}
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-bg-tertiary border border-border-subtle">
              <span className="flex items-center gap-2 text-xs text-text-secondary">
                <Wallet size={13} className="text-text-muted" />
                Solde actuel
              </span>
              <span className="font-mono text-sm font-semibold text-text-primary tabular-nums">
                {balance.toLocaleString('fr-FR')} <span className="text-text-muted">FCFA</span>
              </span>
            </div>

            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">Montant (FCFA)</label>
              <div className="relative mb-3">
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAmount(v === '' ? '' : parseInt(v));
                  }}
                  placeholder="Saisir un montant..."
                  className={cn(
                    'w-full px-4 py-3 pr-16 rounded-xl text-lg font-semibold tabular-nums font-mono',
                    'bg-bg-tertiary border border-border-subtle',
                    'text-text-primary placeholder-text-muted placeholder:font-sans',
                    'focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all'
                  )}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-text-muted font-medium">FCFA</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {RECHARGE_PACKS.map((pack) => (
                  <button
                    key={pack.amount}
                    onClick={() => setAmount(pack.amount)}
                    className={cn(
                      'relative py-2.5 px-2 rounded-xl text-sm font-medium transition-all text-center',
                      amount === pack.amount
                        ? 'gradient-bg text-white shadow-md'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-surface-hover'
                    )}
                  >
                    {pack.tag && (
                      <span className={cn(
                        'absolute -top-1.5 right-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold',
                        pack.tag === 'Populaire'
                          ? 'bg-accent-primary/20 text-accent-primary'
                          : 'bg-green-500/20 text-green-600 dark:text-green-400'
                      )}>
                        {pack.tag}
                      </span>
                    )}
                    <span className="block text-xs opacity-70">{pack.label}</span>
                    <span className="font-mono tabular-nums">{pack.amount.toLocaleString('fr-FR')} F</span>
                  </button>
                ))}
              </div>

              {bonusPct > 0 && numericAmount > 0 && (
                <div className="mt-2 p-2.5 rounded-xl bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Bonus +{bonusPct}%</span>
                    <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                      +{bonusAmount.toLocaleString('fr-FR')} F
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-text-secondary">Total credite</span>
                    <span className="font-mono font-bold text-text-primary tabular-nums">
                      {totalCredited.toLocaleString('fr-FR')} F
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">Moyen de paiement</label>
              <div className="space-y-2">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all',
                      method === m.id
                        ? 'border-accent-primary/40 bg-accent-primary/5'
                        : 'border-border-subtle hover:bg-surface-hover'
                    )}
                  >
                    <div className={cn('w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center', m.color)}>
                      <Smartphone size={14} className="text-white" />
                    </div>
                    <span className="text-sm font-medium text-text-primary">{m.label}</span>
                    {method === m.id && (
                      <Check size={14} className="ml-auto text-accent-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={submit}
              disabled={!isValid || isSubmitting}
              className={cn(
                'w-full py-3 rounded-xl font-medium text-sm shadow-md transition-all flex items-center justify-center gap-2',
                isValid
                  ? 'gradient-bg text-white hover:opacity-90 active:scale-[0.98]'
                  : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
              )}
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Traitement en cours…
                </>
              ) : (
                <>
                  <CreditCard size={16} />
                  {isValid
                    ? `Payer ${numericAmount.toLocaleString('fr-FR')} FCFA${bonusPct > 0 ? ` → ${totalCredited.toLocaleString('fr-FR')} F crédités` : ''}`
                    : 'Saisir un montant (min. 500 FCFA)'}
                </>
              )}
            </button>

            <p className="text-[11px] text-text-muted text-center leading-relaxed">
              Crédits prépayés — aucun abonnement. La validation du paiement Mobile Money
              (Wave, Orange Money…) est automatique à terme ; pour l'instant, un admin
              crédite votre compte dès réception.
            </p>
          </div>
        </div>
      </div>
    </div>
  ,
    document.body
  );
}
