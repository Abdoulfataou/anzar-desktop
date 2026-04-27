/**
 * Settings Page - Premium ANZAR
 * Mon Compte · IA · Interface · Réseau · À propos
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Save, RotateCcw, Cpu, Palette, Wifi, Info,
  ExternalLink, Check, Gauge, Zap, Brain,
  User, CreditCard, ArrowUpRight, History,
  Smartphone,
  Plus, Gift, X, LogOut,
  Mail, Phone, MessageCircle, Send, MapPin, Globe,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import { authService } from '@/services/auth';
import { Transaction } from '@/types';
import { cn, isTauri } from '@/lib/utils';
import { openExternalUrl } from '@/services/externalLinks';
import { checkForUpdates, getCachedUpdateResult, getLastUpdateCheckMs, installUpdateAndRelaunch } from '@/services/updateService';

/* ===== Toggle Switch ===== */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('toggle-switch', checked && 'active')}
    />
  );
}

/* ===== Section wrapper ===== */
function Section({ icon: Icon, title, description, children, iconColor }: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children: React.ReactNode;
  iconColor?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center',
          iconColor || 'bg-accent-primary/10'
        )}>
          <Icon size={16} className={iconColor ? 'text-white' : 'text-accent-primary'} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          {description && <p className="text-xs text-text-muted">{description}</p>}
        </div>
      </div>
      <div className="ml-[42px] space-y-4">{children}</div>
    </div>
  );
}

/* ===== Setting Row ===== */
function SettingRow({ label, description, children }: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary">{label}</p>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

/* ===== Credit Gauge (Solde prépayé) ===== */
function CreditGauge({ remaining, totalRecharged }: {
  remaining: number;
  totalRecharged: number;
}) {
  // Si l'utilisateur n'a jamais rechargé, afficher 0%
  const remainingPercent = totalRecharged > 0
    ? Math.round((remaining / totalRecharged) * 100)
    : 0;

  const gaugeColor =
    remaining === 0 ? 'bg-accent-error' :
    remainingPercent > 50 ? 'bg-accent-success' :
    remainingPercent > 20 ? 'bg-accent-warning' :
    'bg-accent-error';

  const statusColor =
    remaining === 0 ? 'text-accent-error' :
    remainingPercent > 50 ? 'text-accent-success' :
    remainingPercent > 20 ? 'text-accent-warning' :
    'text-accent-error';

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold text-text-primary tabular-nums">
            {remaining.toLocaleString('fr-FR')} <span className="text-sm font-normal text-text-muted">FCFA</span>
          </p>
          {remaining === 0 && (
            <p className="text-xs text-accent-error font-medium">
              Solde épuisé — rechargez pour continuer
            </p>
          )}
        </div>
        <span className={cn('text-sm font-semibold tabular-nums', statusColor)}>
          {remaining === 0 ? 'Épuisé' : `${remainingPercent}%`}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-2.5 rounded-full bg-bg-tertiary overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', gaugeColor)}
          style={{ width: `${Math.max(remainingPercent, 2)}%` }}
        />
      </div>
    </div>
  );
}

/* ===== Transaction Row ===== */
function TransactionRow({ tx }: { tx: Transaction }) {
  const isUsage = tx.type === 'usage';
  const Icon = isUsage ? Cpu : tx.type === 'bonus' ? Gift : Plus;

  const methodLabel: Record<string, string> = {
    wave: 'Wave',
    orange_money: 'Orange Money',
    mpesa: 'M-Pesa',
    card: 'Carte',
  };

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className={cn(
        'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
        isUsage ? 'bg-text-muted/10' : 'bg-accent-success/10'
      )}>
        <Icon size={13} className={isUsage ? 'text-text-muted' : 'text-accent-success'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">{tx.description}</p>
        <p className="text-[11px] text-text-muted">
          {new Date(tx.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
          {tx.paymentMethod && ` · ${methodLabel[tx.paymentMethod] || tx.paymentMethod}`}
        </p>
      </div>
      <span className={cn(
        'text-sm font-medium tabular-nums flex-shrink-0',
        isUsage ? 'text-text-muted' : 'text-accent-success'
      )}>
        {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString('fr-FR')} F
      </span>
    </div>
  );
}

/* ===== Recharge Modal ===== */

type PaymentMethod = 'wave' | 'orange_money' | 'airtel_money' | 'flooz' | 'mpesa' | 'nita_transfert' | 'amana_transfert';

/** Packs de recharge avec bonus progressif */
const RECHARGE_PACKS = [
  { amount: 500,   bonus: 0,  label: 'Découverte', tag: '' },
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

function RechargeModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('wave');

  const methods: { id: PaymentMethod; label: string; color: string }[] = [
    { id: 'wave',              label: 'Wave',              color: 'from-blue-500 to-cyan-500' },
    { id: 'orange_money',      label: 'Orange Money',      color: 'from-orange-500 to-amber-500' },
    { id: 'airtel_money',      label: 'Airtel Money',      color: 'from-red-500 to-rose-500' },
    { id: 'flooz',             label: 'Flooz (Moov)',      color: 'from-yellow-500 to-lime-500' },
    { id: 'mpesa',             label: 'M-Pesa',            color: 'from-green-600 to-emerald-500' },
    { id: 'nita_transfert',    label: 'Dépôt Nita',        color: 'from-purple-500 to-violet-500' },
    { id: 'amana_transfert',   label: 'Dépôt Amana',       color: 'from-teal-500 to-cyan-600' },
  ];

  const numericAmount = typeof amount === 'number' ? amount : 0;
  const bonusPct = getRechargeBonus(numericAmount);
  const bonusAmount = bonusPct > 0 ? Math.round(numericAmount * bonusPct / 100) : 0;
  const totalCredited = numericAmount + bonusAmount;
  const isValid = numericAmount >= 500;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 animate-scale-in">
        <div className="rounded-2xl border border-border-medium bg-bg-secondary/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Header */}
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
            {/* Amount input + presets */}
            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">Montant (FCFA)</label>
              {/* Free input */}
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
                    'w-full px-4 py-3 pr-16 rounded-xl text-lg font-semibold tabular-nums',
                    'bg-bg-tertiary border border-border-subtle',
                    'text-text-primary placeholder-text-muted',
                    'focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all'
                  )}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-text-muted font-medium">FCFA</span>
              </div>
              {/* Preset packs */}
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
                    <span>{pack.amount.toLocaleString('fr-FR')} F</span>
                  </button>
                ))}
              </div>

              {/* Bonus indicator */}
              {bonusPct > 0 && numericAmount > 0 && (
                <div className="mt-2 p-2.5 rounded-xl bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Bonus +{bonusPct}%</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      +{bonusAmount.toLocaleString('fr-FR')} F
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-text-secondary">Total crédité</span>
                    <span className="font-bold text-text-primary">
                      {totalCredited.toLocaleString('fr-FR')} F
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Payment method */}
            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">Moyen de paiement</label>
              <div className="space-y-2">
                {methods.map((m) => (
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

            {/* Confirm button */}
            <button
              onClick={async () => {
                if (!isValid) return;
                try {
                  // Appel au backend pour initier le paiement
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
                      // Ouvrir le lien de paiement (Wave/Orange Money redirigent)
                      await openExternalUrl(data.paymentUrl);
                      onClose();
                      return;
                    }
                    // Beta: paiement manuel → intent créé, admin valide
                    window.alert(
                      data?.message ||
                        `Demande de recharge de ${numericAmount.toLocaleString('fr-FR')} F enregistrée !\n\nEnvoie le paiement via ${methods.find((m) => m.id === method)?.label || method}, puis ton compte sera crédité${bonusPct > 0 ? ` de ${totalCredited.toLocaleString('fr-FR')} F (bonus +${bonusPct}% inclus)` : ''} après validation.`
                    );
                    onClose();
                    return;
                  }

                  // Erreur backend (pas de fallback local)
                  const text = await res.text().catch(() => '');
                  throw new Error(text || 'Erreur serveur');
                } catch (e) {
                  // Pas de fallback local: les crédits doivent rester source-of-truth côté backend.
                  const msg =
                    e instanceof Error ? e.message : "Paiement indisponible pour le moment. Réessaie plus tard.";
                  window.alert(msg);
                }
              }}
              disabled={!isValid}
              className={cn(
                'w-full py-3 rounded-xl font-medium text-sm shadow-md transition-all flex items-center justify-center gap-2',
                isValid
                  ? 'gradient-bg text-white hover:opacity-90 active:scale-[0.98]'
                  : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
              )}
            >
              <CreditCard size={16} />
              {isValid
                ? `Payer ${numericAmount.toLocaleString('fr-FR')} FCFA${bonusPct > 0 ? ` → ${totalCredited.toLocaleString('fr-FR')} F crédités` : ''}`
                : 'Saisir un montant (min. 500 FCFA)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



/* ===================================================================
   MAIN SETTINGS PAGE
   =================================================================== */
export default function SettingsPage() {
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  const user = useAccountStore((s) => s.user);
  const credits = useAccountStore((s) => s.credits);
  const transactions = useAccountStore((s) => s.transactions);

  const handleLogout = () => {
    if (window.confirm('Se déconnecter ?')) {
      authService.logout();
      navigate('/login', { replace: true });
    }
  };

  const [form, setForm] = useState(settings);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showRecharge, setShowRecharge] = useState(false);
  const [updateState, setUpdateState] = useState<{
    checking: boolean;
    installing: boolean;
    available: boolean;
    version?: string;
    lastCheckedMs?: number;
    error?: string;
  }>({ checking: false, installing: false, available: false });

  const appVersion = (typeof __APP_VERSION__ === 'string' && __APP_VERSION__) ? __APP_VERSION__ : '—';

  useEffect(() => {
    // Prime from cache to avoid "empty" state
    const cached = getCachedUpdateResult();
    const lastCheckedMs = getLastUpdateCheckMs();
    if (cached && cached.supported) {
      setUpdateState((s) => ({
        ...s,
        available: cached.shouldUpdate,
        version: cached.manifest?.version,
        lastCheckedMs,
      }));
    } else {
      setUpdateState((s) => ({ ...s, lastCheckedMs }));
    }
  }, []);

  const lastCheckLabel = useMemo(() => {
    if (!updateState.lastCheckedMs) return 'Jamais'
    try {
      return new Date(updateState.lastCheckedMs).toLocaleString('fr-FR')
    } catch {
      return '—'
    }
  }, [updateState.lastCheckedMs]);
  const [showAllTx, setShowAllTx] = useState(false);
  // API key UI state removed — keys are now server-side only

  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    setStatus('saving');
    updateSettings(form);
    setTimeout(() => {
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    }, 400);
  };

  const handleReset = () => {
    if (window.confirm('Réinitialiser tous les paramètres par défaut ?')) {
      resetSettings();
      setForm(useSettingsStore.getState().settings);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  // Filtrer les transactions pour l'historique (recharges uniquement dans l'historique)
  const rechargeTx = transactions.filter((tx) => tx.type === 'recharge' || tx.type === 'bonus');
  const displayedTx = showAllTx ? rechargeTx : rechargeTx.slice(0, 3);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-primary">
      {/* Header */}
      <div className="border-b border-border-subtle px-6 py-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-text-primary">Paramètres</h1>
        <p className="text-xs text-text-muted mt-1">Ton compte, tes préférences</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6 space-y-8">

          {/* ===== MON COMPTE ===== */}
          <Section icon={User} title="Mon compte" description="Profil et solde prépayé" iconColor="gradient-bg">
            {/* Profile card */}
            {user && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-default border border-border-subtle">
                <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">
                    {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{user.name}</p>
                  <p className="text-xs text-text-muted truncate">{user.email}</p>
                </div>
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-accent-primary/15 text-accent-primary">
                  Prépayé
                </span>
              </div>
            )}

            {/* Credit gauge */}
            <div className="p-4 rounded-xl bg-surface-default border border-border-subtle space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <CreditCard size={14} className="text-accent-primary" />
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Crédits</span>
              </div>
              <CreditGauge
                remaining={credits.remaining}
                totalRecharged={credits.totalRecharged}
              />
              <button
                onClick={() => setShowRecharge(true)}
                className="w-full py-2.5 rounded-xl gradient-bg text-white text-sm font-medium shadow-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <ArrowUpRight size={15} />
                Recharger
              </button>
            </div>

            {/* Transaction history */}
            {rechargeTx.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <History size={13} className="text-text-muted" />
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Historique des recharges</span>
                </div>
                <div className="divide-y divide-border-subtle">
                  {displayedTx.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} />
                  ))}
                </div>
                {rechargeTx.length > 3 && (
                  <button
                    onClick={() => setShowAllTx(!showAllTx)}
                    className="text-xs text-accent-primary hover:text-accent-primary/80 transition-colors mt-1"
                  >
                    {showAllTx ? 'Voir moins' : `Voir tout (${rechargeTx.length})`}
                  </button>
                )}
              </div>
            )}
          </Section>

          <div className="h-px bg-border-subtle" />

          {/* ===== MODE IA ===== */}
          <Section icon={Cpu} title="Mode de réponse" description="Choisis comment ANZAR répond à tes questions">
            {/* Model mode selector */}
            <SettingRow label="Mode par défaut" description="Rapide pour les réponses directes, Réflexion pour l'analyse approfondie">
              <div className="flex gap-1 p-0.5 rounded-xl bg-bg-tertiary/70 border border-border-subtle">
                <button
                  onClick={() => update('model', 'fast')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    form.model === 'fast'
                      ? 'bg-accent-primary text-white shadow-sm'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  <Zap size={12} />
                  Rapide
                </button>
                <button
                  onClick={() => update('model', 'thinking')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    form.model === 'thinking'
                      ? 'bg-accent-secondary text-white shadow-sm'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  <Brain size={12} />
                  Réflexion
                </button>
              </div>
            </SettingRow>
          </Section>

          <div className="h-px bg-border-subtle" />

          {/* ===== INTERFACE ===== */}
          <Section icon={Palette} title="Interface" description="Personnalise l'apparence">
            <SettingRow label="Thème" description="Choisis entre clair, sombre ou automatique">
              <div className="flex gap-1 p-0.5 rounded-xl bg-bg-tertiary/70 border border-border-subtle">
                {(['system', 'light', 'dark'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => update('theme', t)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                      form.theme === t
                        ? 'bg-bg-primary text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-secondary'
                    )}
                  >
                    {t === 'system' ? 'Auto' : t === 'light' ? 'Clair' : 'Sombre'}
                  </button>
                ))}
              </div>
            </SettingRow>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-text-primary">Taille du texte</span>
                <span className="text-sm font-mono text-accent-primary">{form.fontSize}px</span>
              </div>
              <input
                type="range"
                min="12"
                max="20"
                step="1"
                value={form.fontSize}
                onChange={(e) => update('fontSize', parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[11px] text-text-muted mt-1">
                <span>Compact</span>
                <span>Confortable</span>
              </div>
            </div>

            <SettingRow label="Langue" description="Langue de l'interface">
              <select
                value={form.language}
                onChange={(e) => update('language', e.target.value as 'fr' | 'en')}
                className={cn(
                  'px-3 py-2 rounded-xl text-sm',
                  'bg-bg-secondary border border-border-subtle',
                  'text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary'
                )}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </SettingRow>

            <SettingRow label="Mode compact" description="Réduit les espacements pour afficher plus de contenu">
              <Toggle checked={form.compactMode} onChange={(v) => update('compactMode', v)} />
            </SettingRow>

            <SettingRow label="Animations" description="Active les transitions et effets visuels">
              <Toggle checked={form.animations} onChange={(v) => update('animations', v)} />
            </SettingRow>
          </Section>

          <div className="h-px bg-border-subtle" />

          {/* ===== RÉSEAU ===== */}
          <Section icon={Wifi} title="Réseau" description="Performance et connectivité">
            <SettingRow label="Sauvegarde automatique" description="Enregistre les conversations automatiquement">
              <Toggle checked={form.autoSave} onChange={(v) => update('autoSave', v)} />
            </SettingRow>

            <SettingRow label="Économie de bande passante" description="Optimise pour les connexions lentes">
              <Toggle checked={form.bandwidthSaver} onChange={(v) => update('bandwidthSaver', v)} />
            </SettingRow>

            <SettingRow label="Mode hors ligne" description="Fonctionne sans connexion Internet">
              <Toggle checked={form.offlineMode} onChange={(v) => update('offlineMode', v)} />
            </SettingRow>

            <div className="pt-3 border-t border-border-subtle" />

            <SettingRow
              label="Mode développeur"
              description="Affiche des options avancées (terminal). Désactivé par défaut pour le grand public."
            >
              <Toggle checked={form.developerMode} onChange={(v) => update('developerMode', v)} />
            </SettingRow>

            <SettingRow
              label="Exécution des commandes"
              description="Contrôle comment les commandes proposées par l'IA sont exécutées."
            >
              <select
                value={form.commandExecutionMode}
                onChange={(e) => update('commandExecutionMode', e.target.value as any)}
                className={cn(
                  'px-3 py-2 rounded-xl text-sm',
                  'bg-bg-secondary border border-border-subtle',
                  'text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary'
                )}
              >
                <option value="manual">Manual (Run requis)</option>
                <option value="always_ask">Always ask (confirmation)</option>
                <option value="auto_run">Auto-run (Sûr uniquement)</option>
              </select>
            </SettingRow>

            <SettingRow
              label="Vérifier après application"
              description="Apres Preview, lance automatiquement 'Verifier le projet'."
            >
              <Toggle checked={form.autoVerifyAfterApply} onChange={(v) => update('autoVerifyAfterApply', v)} />
            </SettingRow>

            <SettingRow
              label="Nettoyage auto des commandes"
              description="Supprime automatiquement les Command Cards terminées au bout d'un moment."
            >
              <Toggle checked={form.autoCleanFinishedCommands} onChange={(v) => update('autoCleanFinishedCommands', v)} />
            </SettingRow>
          </Section>

          <div className="h-px bg-border-subtle" />

          {/* ===== À PROPOS ===== */}
          <Section icon={Info} title="À propos" description="Informations sur ANZAR">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Version</span>
                <span className="font-mono text-text-primary">{appVersion}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Moteur IA</span>
                <span className="font-mono text-text-primary">ANZAR AI</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Plateforme</span>
                <span className="font-mono text-text-primary">Desktop (Windows, Mac, Linux)</span>
              </div>

              {/* Updates (Tauri only) */}
              <div className="pt-3 border-t border-border-subtle space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Mises à jour</span>
                  <span className="text-xs text-text-muted">Dernière vérif : {lastCheckLabel}</span>
                </div>

                {!isTauri() ? (
                  <p className="text-xs text-text-muted">
                    Les mises à jour automatiques sont disponibles uniquement dans l'app desktop installée.
                  </p>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {updateState.error ? (
                        <p className="text-xs text-accent-error truncate">{updateState.error}</p>
                      ) : updateState.available ? (
                        <p className="text-xs text-accent-warning">
                          Mise à jour disponible{updateState.version ? ` (v${updateState.version})` : ''}.
                        </p>
                      ) : (
                        <p className="text-xs text-text-muted">Aucune mise à jour détectée.</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={async () => {
                          setUpdateState((s) => ({ ...s, checking: true, error: undefined }));
                          try {
                            const res = await checkForUpdates();
                            const lastCheckedMs = getLastUpdateCheckMs();
                            if (res.supported) {
                              setUpdateState((s) => ({
                                ...s,
                                checking: false,
                                available: res.shouldUpdate,
                                version: res.manifest?.version,
                                lastCheckedMs,
                              }));
                            } else {
                              setUpdateState((s) => ({ ...s, checking: false, error: 'Non supporté.' }));
                            }
                          } catch (e: any) {
                            setUpdateState((s) => ({
                              ...s,
                              checking: false,
                              error: 'Impossible de vérifier. Réessaie plus tard.',
                            }));
                          }
                        }}
                        disabled={updateState.checking || updateState.installing}
                        className={cn(
                          'px-3 py-2 rounded-xl text-xs font-medium transition-all border',
                          'border-border-subtle bg-bg-tertiary/40 hover:bg-surface-hover',
                          (updateState.checking || updateState.installing) && 'opacity-60 cursor-not-allowed'
                        )}
                        title="Vérifier les mises à jour"
                      >
                        {updateState.checking ? 'Vérification...' : 'Vérifier'}
                      </button>

                      {updateState.available && (
                        <button
                          onClick={async () => {
                            setUpdateState((s) => ({ ...s, installing: true, error: undefined }));
                            try {
                              await installUpdateAndRelaunch();
                            } catch {
                              setUpdateState((s) => ({
                                ...s,
                                installing: false,
                                error: "Impossible d'installer la mise a jour.",
                              }));
                            }
                          }}
                          disabled={updateState.installing || updateState.checking}
                          className={cn(
                            'px-3 py-2 rounded-xl text-xs font-semibold text-white transition-all',
                            'gradient-bg hover:opacity-90',
                            (updateState.installing || updateState.checking) && 'opacity-60 cursor-not-allowed'
                          )}
                        >
                          {updateState.installing ? 'Installation...' : 'Installer'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-border-subtle flex items-center gap-4">
                <button
                  onClick={async () => {
                    const url = 'https://anzar.dev/docs';
                    await openExternalUrl(url);
                  }}
                  className="text-accent-primary hover:text-accent-primary/80 transition-colors text-sm flex items-center gap-1.5"
                >
                  <ExternalLink size={13} />
                  Documentation
                </button>
                <button
                  onClick={async () => {
                    const url = 'https://anzar.dev/support';
                    await openExternalUrl(url);
                  }}
                  className="text-accent-primary hover:text-accent-primary/80 transition-colors text-sm flex items-center gap-1.5"
                >
                  <ExternalLink size={13} />
                  Support
                </button>
              </div>
            </div>
          </Section>

          <div className="h-px bg-border-subtle" />

          {/* ===== CONTACT & SUPPORT ===== */}
          <Section icon={Mail} title="Contact & Support" description="IssalanHub — Nous sommes là pour vous">
            <div className="space-y-3">
              {/* Contact cards */}
              <div className="grid grid-cols-1 gap-2.5">
                <button
                  onClick={() => openExternalUrl('mailto:abdul@issalanhub.com')}
                  className="flex items-center gap-3 p-3 rounded-xl bg-surface-default border border-border-subtle hover:bg-surface-hover transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-lg bg-accent-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/20 transition-colors">
                    <Mail size={15} className="text-accent-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text-primary">Email</p>
                    <p className="text-[11px] text-text-muted truncate">abdul@issalanhub.com</p>
                  </div>
                  <ExternalLink size={12} className="text-text-muted/40 group-hover:text-accent-primary transition-colors flex-shrink-0" />
                </button>

                <button
                  onClick={() => openExternalUrl('tel:+17172161490')}
                  className="flex items-center gap-3 p-3 rounded-xl bg-surface-default border border-border-subtle hover:bg-surface-hover transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-green-500/20 transition-colors">
                    <Phone size={15} className="text-green-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text-primary">Téléphone</p>
                    <p className="text-[11px] text-text-muted">+1 (717) 216-1490</p>
                  </div>
                  <ExternalLink size={12} className="text-text-muted/40 group-hover:text-green-500 transition-colors flex-shrink-0" />
                </button>

                <div className="flex gap-2.5">
                  <button
                    onClick={() => openExternalUrl('https://wa.me/17172161490')}
                    className="flex-1 flex items-center gap-2.5 p-3 rounded-xl bg-surface-default border border-border-subtle hover:bg-surface-hover transition-all group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-green-500/20 transition-colors">
                      <MessageCircle size={14} className="text-green-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text-primary">WhatsApp</p>
                    </div>
                  </button>

                  <button
                    onClick={() => openExternalUrl('https://t.me/+17172161490')}
                    className="flex-1 flex items-center gap-2.5 p-3 rounded-xl bg-surface-default border border-border-subtle hover:bg-surface-hover transition-all group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500/20 transition-colors">
                      <Send size={14} className="text-blue-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text-primary">Telegram</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Company info */}
              <div className="pt-3 border-t border-border-subtle space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <Globe size={13} className="text-text-muted flex-shrink-0" />
                  <span className="text-sm font-semibold text-text-primary">IssalanHub</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <MapPin size={13} className="text-text-muted flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-text-muted leading-relaxed">
                    <p>USA · Niger</p>
                  </div>
                </div>
              </div>

              {/* Copyright */}
              <div className="pt-3 border-t border-border-subtle">
                <p className="text-[11px] text-text-muted/70 text-center leading-relaxed">
                  {"© "}{new Date().getFullYear()} IssalanHub. Tous droits reserves.
                  <br />
                  ANZAR est un produit de IssalanHub.
                </p>
              </div>
            </div>
          </Section>
        </div>
      </div>

      {/* Footer - Logout / Save / Reset */}
      <div className="border-t border-border-subtle px-6 py-3 flex-shrink-0 bg-bg-secondary/50 backdrop-blur-sm">
        <div className="flex items-center gap-3 justify-between max-w-2xl mx-auto">
          <button
            onClick={handleLogout}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium',
              'bg-accent-error/10 hover:bg-accent-error/20',
              'text-accent-error',
              'transition-all duration-200 flex items-center gap-2'
            )}
          >
            <LogOut size={14} />
            Déconnexion
          </button>
          <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium',
              'bg-bg-tertiary hover:bg-surface-hover',
              'text-text-secondary hover:text-text-primary',
              'transition-all duration-200 flex items-center gap-2'
            )}
          >
            <RotateCcw size={14} />
            Réinitialiser
          </button>
          <button
            onClick={handleSave}
            disabled={status === 'saving'}
            className={cn(
              'px-5 py-2 rounded-xl text-sm font-medium text-white',
              'transition-all duration-200 flex items-center gap-2',
              status === 'saving'
                ? 'bg-accent-primary/50 cursor-wait'
                : status === 'saved'
                  ? 'bg-accent-success'
                  : 'gradient-bg hover:opacity-90 shadow-md active:scale-[0.98]'
            )}
          >
            {status === 'saving' ? (
              <><Gauge size={14} className="animate-spin" /> Sauvegarde...</>
            ) : status === 'saved' ? (
              <><Check size={14} /> Sauvegardé</>
            ) : (
              <><Save size={14} /> Sauvegarder</>
            )}
          </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showRecharge && <RechargeModal onClose={() => setShowRecharge(false)} />}
    </div>
  );
}
