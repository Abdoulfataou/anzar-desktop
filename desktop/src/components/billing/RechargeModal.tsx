/**
 * RechargeModal — Recharge de crédits prépayés ANZAR (FCFA).
 *
 * Système prépayé : pas d'abonnement, des crédits FCFA consommés par usage.
 * Deux voies :
 *  - paiement automatique (FedaPay mobile money, Stripe carte…) : la page du fournisseur
 *    s'ouvre, l'app suit le statut, le compte est crédité dès la confirmation ;
 *  - demande manuelle (Wave, Orange Money…), validée par un admin, en secours.
 * La liste des moyens vient du serveur (GET /api/payments/methods).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, X, Check, Smartphone, Wallet, Globe, ExternalLink, CircleCheck, CircleAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { openExternalUrl } from '@/services/infra/externalLinks';
import { refreshCredits } from '@/lib/credits';

export type PaymentMethod = 'wave' | 'orange_money' | 'airtel_money' | 'flooz' | 'mpesa' | 'nita_transfert' | 'amana_transfert';

type Provider = {
  id: string; label: string; kind: 'mobile_money' | 'card' | string; description: string;
  countries: string[]; currency: string; fcfa_per_unit: number;
};
type Methods = { providers: Provider[]; manual: boolean; min_fcfa: number; max_fcfa: number };
type Choice = { type: 'provider'; id: string } | { type: 'manual'; id: PaymentMethod };
type Tracking = { intentId: string; url: string; status: 'pending' | 'paid' | 'failed' | 'cancelled'; reason?: string };

const POLL_MS = 4000;
const POLL_MAX_MS = 20 * 60 * 1000;

function authHeaders(): Record<string, string> {
  const token = useSettingsStore.getState().getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorText(res: Response): Promise<string> {
  try {
    const d = await res.json();
    if (typeof d?.detail === 'string') return d.detail;
  } catch { /* corps non JSON */ }
  return res.status === 401 ? 'Session expirée : reconnecte-toi.' : 'Paiement indisponible pour le moment.';
}

/** Même arrondi que le serveur (centime supérieur), pour afficher le montant facturé. */
export function chargedAmount(fcfa: number, p: Provider): number {
  const v = fcfa / (p.fcfa_per_unit || 1);
  return p.currency === 'xof' ? Math.ceil(v) : Math.ceil(v * 100) / 100;
}

function money(amount: number, currency: string): string {
  if (currency === 'xof') return `${amount.toLocaleString('fr-FR')} FCFA`;
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

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
  const [methods, setMethods] = useState<Methods | null>(null);
  const [choice, setChoice] = useState<Choice>({ type: 'manual', id: 'wave' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const balance = useAccountStore((s) => s.credits.remaining);
  const pollStart = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const BACKEND = useSettingsStore.getState().getBackendUrl();
        const res = await fetch(`${BACKEND}/api/payments/methods`, { headers: authHeaders() });
        if (!res.ok) throw new Error(await errorText(res));
        const data = (await res.json()) as Methods;
        if (!alive) return;
        setMethods(data);
        if (data.providers.length) setChoice({ type: 'provider', id: data.providers[0].id });
      } catch {
        if (alive) setMethods({ providers: [], manual: true, min_fcfa: 500, max_fcfa: 1_000_000 });
      }
    })();
    return () => { alive = false; };
  }, []);

  // Suivi du paiement : l'app relit le statut ; le serveur le relit chez le fournisseur.
  useEffect(() => {
    if (!tracking || tracking.status !== 'pending') return;
    pollStart.current = pollStart.current || Date.now();
    const timer = window.setInterval(async () => {
      if (Date.now() - pollStart.current > POLL_MAX_MS) { window.clearInterval(timer); return; }
      try {
        const BACKEND = useSettingsStore.getState().getBackendUrl();
        const res = await fetch(`${BACKEND}/api/payments/${tracking.intentId}`, { headers: authHeaders() });
        if (!res.ok) return;
        const d = await res.json();
        if (d.status === 'paid') {
          await refreshCredits();
          toast.success('Paiement confirmé : tes crédits sont ajoutés.');
          setTracking((t) => (t ? { ...t, status: 'paid' } : t));
        } else if (d.status === 'failed' || d.status === 'cancelled') {
          setTracking((t) => (t ? { ...t, status: d.status, reason: d.failure_reason } : t));
        }
      } catch { /* réseau : on réessaie au prochain tour */ }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [tracking]);

  const providers = methods?.providers ?? [];
  const selectedProvider = choice.type === 'provider' ? providers.find((p) => p.id === choice.id) : undefined;
  const minFcfa = methods?.min_fcfa ?? 500;
  const maxFcfa = methods?.max_fcfa ?? 1_000_000;
  const numericAmount = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0;
  const bonusPct = getRechargeBonus(numericAmount);
  const bonusAmount = bonusPct > 0 ? Math.round(numericAmount * bonusPct / 100) : 0;
  const totalCredited = numericAmount + bonusAmount;
  const isValid = numericAmount >= minFcfa && numericAmount <= maxFcfa && methods !== null;
  const charged = selectedProvider && selectedProvider.currency !== 'xof' && numericAmount > 0
    ? money(chargedAmount(numericAmount, selectedProvider), selectedProvider.currency) : '';

  const submit = async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const BACKEND = useSettingsStore.getState().getBackendUrl();
      const res = await fetch(`${BACKEND}/api/payments/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(choice.type === 'provider'
          ? { amount: numericAmount, provider: choice.id }
          : { amount: numericAmount, currency: 'XOF', method: choice.id }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const data = await res.json();
      if (data.paymentUrl) {
        pollStart.current = Date.now();
        setTracking({ intentId: data.intent_id, url: data.paymentUrl, status: 'pending' });
        await openExternalUrl(data.paymentUrl);
        return;
      }
      toast.success(
        data?.message ||
          `Demande de recharge de ${numericAmount.toLocaleString('fr-FR')} F enregistrée.`,
        { duration: 6000 }
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Paiement indisponible pour le moment. Réessaie plus tard.');
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

          {tracking ? (
            <PaymentTracking
              tracking={tracking}
              onReopen={() => openExternalUrl(tracking.url)}
              onRetry={() => { pollStart.current = 0; setTracking(null); }}
              onClose={onClose}
            />
          ) : (
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
              {methods === null ? (
                <div className="py-6 flex justify-center">
                  <div className="w-5 h-5 border-2 border-border-medium border-t-accent-primary rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {providers.map((p) => {
                    const on = choice.type === 'provider' && choice.id === p.id;
                    const Icon = p.kind === 'card' ? Globe : Smartphone;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setChoice({ type: 'provider', id: p.id })}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left',
                          on ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-border-subtle hover:bg-surface-hover'
                        )}
                      >
                        <div className={cn('w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br flex items-center justify-center',
                          p.kind === 'card' ? 'from-indigo-500 to-blue-500' : 'from-emerald-500 to-teal-500')}>
                          <Icon size={14} className="text-white" />
                        </div>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-text-primary">{p.label}</span>
                          <span className="block text-[11px] text-text-muted truncate">{p.description}</span>
                        </span>
                        {on && <Check size={14} className="ml-auto shrink-0 text-accent-primary" />}
                      </button>
                    );
                  })}

                  {methods.manual && (
                    <>
                      {providers.length > 0 && (
                        <p className="pt-2 text-[11px] text-text-muted">
                          Ou paiement manuel, crédité après vérification par l'équipe :
                        </p>
                      )}
                      {METHODS.map((m) => {
                        const on = choice.type === 'manual' && choice.id === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => setChoice({ type: 'manual', id: m.id })}
                            className={cn(
                              'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all',
                              on ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-border-subtle hover:bg-surface-hover'
                            )}
                          >
                            <div className={cn('w-7 h-7 rounded-lg bg-gradient-to-br flex items-center justify-center', m.color)}>
                              <Smartphone size={13} className="text-white" />
                            </div>
                            <span className="text-sm font-medium text-text-primary">{m.label}</span>
                            {on && <Check size={14} className="ml-auto text-accent-primary" />}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
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
                    ? `Payer ${charged || `${numericAmount.toLocaleString('fr-FR')} FCFA`}${bonusPct > 0 ? ` → ${totalCredited.toLocaleString('fr-FR')} F crédités` : ''}`
                    : `Saisir un montant (min. ${minFcfa.toLocaleString('fr-FR')} FCFA)`}
                </>
              )}
            </button>

            <p className="text-[11px] text-text-muted text-center leading-relaxed">
              Crédits prépayés, aucun abonnement.
              {selectedProvider
                ? selectedProvider.currency !== 'xof'
                  ? ` Le paiement par carte est facturé en ${selectedProvider.currency.toUpperCase()} ; ton compte reçoit l'équivalent en FCFA.`
                  : ' Ton compte est crédité dès que le paiement est confirmé.'
                : " Un membre de l'équipe vérifie la réception et crédite ton compte."}
            </p>
          </div>
          )}
        </div>
      </div>
    </div>
  ,
    document.body
  );
}

function PaymentTracking({ tracking, onReopen, onRetry, onClose }: {
  tracking: Tracking; onReopen: () => void; onRetry: () => void; onClose: () => void;
}) {
  if (tracking.status === 'paid') {
    return (
      <div className="p-6 text-center space-y-3">
        <CircleCheck size={36} className="mx-auto text-green-500" />
        <p className="text-sm font-semibold text-text-primary">Paiement confirmé</p>
        <p className="text-xs text-text-secondary">Tes crédits sont ajoutés à ton solde.</p>
        <button onClick={onClose} className="w-full py-2.5 rounded-xl gradient-bg text-white text-sm font-medium">Fermer</button>
      </div>
    );
  }
  if (tracking.status === 'failed' || tracking.status === 'cancelled') {
    return (
      <div className="p-6 text-center space-y-3">
        <CircleAlert size={36} className="mx-auto text-amber-500" />
        <p className="text-sm font-semibold text-text-primary">Paiement non abouti</p>
        <p className="text-xs text-text-secondary">{tracking.reason || 'Aucun montant n\'a été crédité.'}</p>
        <button onClick={onRetry} className="w-full py-2.5 rounded-xl gradient-bg text-white text-sm font-medium">Réessayer</button>
      </div>
    );
  }
  return (
    <div className="p-6 text-center space-y-3">
      <div className="mx-auto w-9 h-9 border-[3px] border-border-medium border-t-accent-primary rounded-full animate-spin" />
      <p className="text-sm font-semibold text-text-primary">En attente du paiement</p>
      <p className="text-xs text-text-secondary leading-relaxed">
        Termine le paiement dans la page qui vient de s'ouvrir. Cette fenêtre se met à jour toute seule.
        Tu peux aussi la fermer : tes crédits arriveront dès la confirmation.
      </p>
      <div className="flex gap-2">
        <button onClick={onReopen} className="flex-1 py-2.5 rounded-xl border border-border-subtle text-sm text-text-primary hover:bg-surface-hover flex items-center justify-center gap-1.5">
          <ExternalLink size={14} /> Rouvrir la page
        </button>
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-bg-tertiary text-sm text-text-secondary hover:bg-surface-hover">Fermer</button>
      </div>
    </div>
  );
}
