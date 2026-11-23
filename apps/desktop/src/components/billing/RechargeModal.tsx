/**
 * RechargeModal — Recharge de crédits prépayés ANZAR.
 *
 * Le solde est en crédits ; les packs sont affichés et payés dans la monnaie de
 * l'utilisateur. Tout vient du serveur (GET /api/pricing) : devise retenue (ou repli
 * USD avec la raison), packs à prix ronds, moyens de paiement qui acceptent cette
 * devise, taux et sa date. L'app n'envoie qu'un identifiant de pack (ou un montant
 * libre en XOF) : le serveur recalcule toujours le prix.
 *
 * Deux voies :
 *  - paiement automatique (FedaPay, Paystack, Flutterwave, Stripe…) : la page du
 *    fournisseur s'ouvre, l'app suit le statut, le compte est crédité à la confirmation ;
 *  - demande manuelle (Wave, Orange Money…), en XOF seulement, validée par un admin.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, X, Check, Smartphone, Wallet, Globe, ExternalLink, CircleCheck, CircleAlert, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCurrencyStore, type Offer, type PackOffer } from '@/stores/currencyStore';
import { openExternalUrl } from '@/services/infra/externalLinks';
import { refreshCredits } from '@/lib/credits';
import { creditsInLocal, currencyName, formatCredits, formatMinor, formatMoney } from '@/lib/money';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export type PaymentMethod = 'wave' | 'orange_money' | 'airtel_money' | 'flooz' | 'mpesa' | 'nita_transfert' | 'amana_transfert';

type Choice = { type: 'provider'; id: string } | { type: 'manual'; id: PaymentMethod };
type Selection = { kind: 'pack'; pack: PackOffer } | { kind: 'amount'; amount: number } | null;
type Tracking = { intentId: string; url: string; status: 'pending' | 'paid' | 'failed' | 'cancelled'; reason?: string };
type PricingExtras = Offer & { min_fcfa?: number; max_fcfa?: number; manual?: boolean; bonus_tiers?: [number, number][] };

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

/** Bonus des paliers du serveur pour un montant libre (même règle que le serveur). */
export function tierBonus(amount: number, tiers: [number, number][] = []): number {
  let pct = 0;
  for (const [min, p] of tiers) if (amount >= min) pct = p;
  return pct;
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

function rateLine(o: Offer): string {
  if (o.currency === 'XOF') return '1 crédit = 1 F CFA.';
  if (!o.fcfa_per_unit) return '';
  const one = `1 ${o.symbol || o.currency}`;
  const credits = o.fcfa_per_unit >= 10 ? Math.round(o.fcfa_per_unit).toLocaleString('fr-FR')
    : o.fcfa_per_unit.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
  if (o.rate_fixed) return `${one} = ${credits} crédits (parité fixe).`;
  const when = o.rate_as_of ? new Date(o.rate_as_of).toLocaleDateString('fr-FR') : '';
  return `${one} ≈ ${credits} crédits${when ? ` (taux du ${when})` : ''}.`;
}

export default function RechargeModal({ onClose }: { onClose: () => void }) {
  const offer = useCurrencyStore((s) => s.offer) as PricingExtras | null;
  const loading = useCurrencyStore((s) => s.loading);
  const loadError = useCurrencyStore((s) => s.error);
  const currencies = useCurrencyStore((s) => s.currencies);
  const [selection, setSelection] = useState<Selection>(null);
  const [customAmount, setCustomAmount] = useState<number | ''>('');
  const [choice, setChoice] = useState<Choice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [pickCurrency, setPickCurrency] = useState(false);
  const balance = useAccountStore((s) => s.credits.remaining);
  const pollStart = useRef(0);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  useEffect(() => {
    void useCurrencyStore.getState().load();
    void useCurrencyStore.getState().loadCurrencies();
  }, []);

  // Nouvelle offre (autre devise) : on repart d'une sélection vide et du 1er moyen proposé
  useEffect(() => {
    setSelection(null);
    setCustomAmount('');
    setChoice(offer?.providers.length ? { type: 'provider', id: offer.providers[0].id }
      : offer?.manual ? { type: 'manual', id: 'wave' } : null);
  }, [offer?.currency, offer?.providers.length, offer?.manual]);

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

  const providers = offer?.providers ?? [];
  const minFcfa = offer?.min_fcfa ?? 500;
  const maxFcfa = offer?.max_fcfa ?? 1_000_000;
  const rate = offer ? { currency: offer.currency, decimals: offer.decimals, fcfaPerUnit: offer.fcfa_per_unit } : null;

  const summary = useMemo(() => {
    if (!offer || !selection) return null;
    if (selection.kind === 'pack') {
      return { price: formatMinor(selection.pack.price_minor, offer.currency, offer.decimals),
               credits: selection.pack.credit_fcfa, bonusPct: selection.pack.bonus_pct };
    }
    const pct = tierBonus(selection.amount, offer.bonus_tiers);
    return { price: formatMoney(selection.amount, offer.currency, 0),
             credits: selection.amount + Math.round(selection.amount * pct / 100), bonusPct: pct };
  }, [offer, selection]);

  const amountOk = selection?.kind !== 'amount' || (selection.amount >= minFcfa && selection.amount <= maxFcfa);
  const isValid = !!offer && !!selection && !!choice && amountOk;

  const submit = async () => {
    if (!isValid || !offer || !selection || !choice || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const BACKEND = useSettingsStore.getState().getBackendUrl();
      // Jamais de prix dans la requête : seulement le pack (ou le montant libre en XOF).
      const what = selection.kind === 'pack'
        ? { pack_id: selection.pack.id }
        : { amount: selection.amount };
      const body = choice.type === 'provider'
        ? { provider: choice.id, currency: offer.currency, country: offer.country, ...what }
        : { method: choice.id, currency: 'XOF',
            amount: selection.kind === 'pack' ? selection.pack.price_minor : selection.amount };
      const res = await fetch(`${BACKEND}/api/payments/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const data = await res.json();
      if (data.paymentUrl) {
        pollStart.current = Date.now();
        setTracking({ intentId: data.intent_id, url: data.paymentUrl, status: 'pending' });
        await openExternalUrl(data.paymentUrl);
        return;
      }
      toast.success(data?.message || 'Demande de recharge enregistrée.', { duration: 6000 });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Paiement indisponible pour le moment. Réessaie plus tard.');
      // Les prix ont pu changer (taux, grille) : on recharge l'offre.
      void useCurrencyStore.getState().load(offer.currency);
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeCurrency = (code: string) => {
    setPickCurrency(false);
    void useCurrencyStore.getState().load(code);
  };

  // Portail : la barre de titre a un backdrop-filter, qui piège les éléments `fixed`.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="recharge-title" tabIndex={-1} className="relative w-full max-w-md mx-4 animate-scale-in">
        <div className="rounded-2xl border border-border-medium bg-bg-secondary shadow-2xl overflow-y-auto max-h-[90vh]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
                <CreditCard size={16} className="text-white" />
              </div>
              <h3 id="recharge-title" className="text-base font-semibold text-text-primary">Recharger</h3>
            </div>
            <button onClick={onClose} aria-label="Fermer la recharge" className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted transition-colors">
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
            {/* Solde actuel, en crédits, avec l'équivalent local */}
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-bg-tertiary border border-border-subtle">
              <span className="flex items-center gap-2 text-xs text-text-secondary">
                <Wallet size={13} className="text-text-muted" />
                Solde actuel
              </span>
              <span className="text-right">
                <span className="block font-mono text-sm font-semibold text-text-primary tabular-nums">{formatCredits(balance)}</span>
                {creditsInLocal(balance, rate) && (
                  <span className="block text-[11px] text-text-muted tabular-nums">{creditsInLocal(balance, rate)}</span>
                )}
              </span>
            </div>

            {/* Monnaie de paiement */}
            {offer && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">
                  Prix en <span className="font-medium text-text-primary">{currencyName(offer.currency)}</span>
                </span>
                {currencies.length > 1 && (
                  pickCurrency ? (
                    <select
                      aria-label="Monnaie de paiement"
                      autoFocus
                      value={offer.currency}
                      onChange={(e) => changeCurrency(e.target.value)}
                      onBlur={() => setPickCurrency(false)}
                      className="px-2 py-1 rounded-lg bg-bg-tertiary border border-border-subtle text-text-primary"
                    >
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>{c.code} — {currencyName(c.code)}</option>
                      ))}
                    </select>
                  ) : (
                    <button onClick={() => setPickCurrency(true)} className="text-accent-primary hover:underline">Changer</button>
                  )
                )}
              </div>
            )}

            {offer?.message && (
              <div role="status" className="flex gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-text-secondary">
                <Info size={14} className="shrink-0 mt-0.5 text-amber-500" />
                <span>{offer.message}</span>
              </div>
            )}

            {loading && !offer ? (
              <div className="py-8 flex justify-center">
                <div className="w-5 h-5 border-2 border-border-medium border-t-accent-primary rounded-full animate-spin" />
              </div>
            ) : !offer ? (
              <p className="text-sm text-text-secondary text-center py-6">{loadError || 'Prix indisponibles pour le moment.'}</p>
            ) : (
            <>
            <div>
              <div id="recharge-pack-label" className="text-xs font-medium text-text-secondary mb-2">Choisis un pack</div>
              <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="recharge-pack-label">
                {offer.packs.map((pack) => {
                  const on = selection?.kind === 'pack' && selection.pack.id === pack.id;
                  return (
                    <button
                      key={pack.id}
                      aria-pressed={on}
                      onClick={() => { setSelection({ kind: 'pack', pack }); setCustomAmount(''); }}
                      className={cn(
                        'relative py-2.5 px-3 rounded-xl text-left transition-all',
                        on ? 'gradient-bg text-white shadow-md' : 'bg-bg-tertiary text-text-secondary hover:bg-surface-hover'
                      )}
                    >
                      {pack.bonus_pct > 0 && (
                        <span className="absolute -top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-green-500/20 text-green-600 dark:text-green-400">
                          +{pack.bonus_pct} %
                        </span>
                      )}
                      {pack.label && <span className="block text-[11px] opacity-70">{pack.label}</span>}
                      <span className="block font-mono tabular-nums text-sm font-semibold">
                        {formatMinor(pack.price_minor, offer.currency, offer.decimals)}
                      </span>
                      <span className="block text-[11px] opacity-80 tabular-nums">{formatCredits(pack.credit_fcfa)}</span>
                    </button>
                  );
                })}
              </div>

              {offer.free_amount && (
                <div className="mt-3">
                  <label htmlFor="recharge-amount" className="text-[11px] text-text-muted mb-1 block">Ou un montant libre (F CFA)</label>
                  <div className="relative">
                    <input
                      id="recharge-amount"
                      type="number"
                      min={minFcfa}
                      max={maxFcfa}
                      step={100}
                      value={customAmount}
                      onChange={(e) => {
                        const v = e.target.value === '' ? '' : parseInt(e.target.value, 10);
                        setCustomAmount(v);
                        setSelection(typeof v === 'number' && !Number.isNaN(v) && v > 0 ? { kind: 'amount', amount: v } : null);
                      }}
                      placeholder={`${minFcfa.toLocaleString('fr-FR')} minimum`}
                      className="w-full px-4 py-2.5 pr-16 rounded-xl font-mono tabular-nums bg-bg-tertiary border border-border-subtle text-text-primary placeholder-text-muted placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-accent-primary"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-text-muted">F CFA</span>
                  </div>
                </div>
              )}

              {summary && (
                <div className="mt-3 p-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary">Tu paies</span>
                    <span className="font-mono font-semibold text-text-primary tabular-nums">{summary.price}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-text-secondary">Tu reçois{summary.bonusPct > 0 ? ` (dont +${summary.bonusPct} %)` : ''}</span>
                    <span className="font-mono font-bold text-text-primary tabular-nums">{formatCredits(summary.credits)}</span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div id="recharge-method-label" className="text-xs font-medium text-text-secondary mb-2 block">Moyen de paiement</div>
              <div className="space-y-2" role="group" aria-labelledby="recharge-method-label">
                {providers.length === 0 && !offer.manual && (
                  <p className="text-xs text-text-muted">Aucun moyen de paiement n'est disponible pour le moment.</p>
                )}
                {providers.map((p) => {
                  const on = choice?.type === 'provider' && choice.id === p.id;
                  const Icon = p.kind === 'card' ? Globe : Smartphone;
                  return (
                    <button
                      key={p.id}
                      aria-pressed={on}
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

                {offer.manual && (
                  <>
                    {providers.length > 0 && (
                      <p className="pt-2 text-[11px] text-text-muted">
                        Ou paiement manuel, crédité après vérification par l'équipe :
                      </p>
                    )}
                    {METHODS.map((m) => {
                      const on = choice?.type === 'manual' && choice.id === m.id;
                      return (
                        <button
                          key={m.id}
                          aria-pressed={on}
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
                  {isValid && summary
                    ? `Payer ${summary.price} → ${formatCredits(summary.credits)}`
                    : selection?.kind === 'amount' && !amountOk
                      ? `Entre ${minFcfa.toLocaleString('fr-FR')} et ${maxFcfa.toLocaleString('fr-FR')} F CFA`
                      : 'Choisis un pack'}
                </>
              )}
            </button>

            <p className="text-[11px] text-text-muted text-center leading-relaxed">
              Crédits prépayés, aucun abonnement. {rateLine(offer)}
              {choice?.type === 'manual' ? " Un membre de l'équipe vérifie la réception et crédite ton compte." : ''}
              {offer.pricing_source === 'computed' && !offer.rate_fixed && offer.rates_attribution && (
                <>
                  {' '}
                  <button type="button" className="underline hover:text-text-secondary"
                    onClick={() => openExternalUrl(offer.rates_attribution!.url)}>
                    {offer.rates_attribution.label}
                  </button>
                </>
              )}
            </p>
            </>
            )}
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
