/**
 * Settings Page - Premium ANZAR
 * Refonte avec onglets : Profil · Abonnement · Preferences · Avance · A propos
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
  Settings, Wrench,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import { authService } from '@/services/infra/auth';
import { Transaction } from '@/types';
import { cn, isTauri } from '@/lib/utils';
import { openExternalUrl } from '@/services/infra/externalLinks';
import { checkForUpdates, getCachedUpdateResult, getLastUpdateCheckMs, installUpdateAndRelaunch } from '@/services/infra/updateService';
import { useThemeStore } from '@/stores/themeStore';

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

/* ===== Setting Row ===== */
function SettingRow({ label, description, children }: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary">{label}</p>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

/* ===== Credit Gauge ===== */
function CreditGauge({ remaining, totalRecharged }: {
  remaining: number;
  totalRecharged: number;
}) {
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
              Solde epuise - rechargez pour continuer
            </p>
          )}
        </div>
        <span className={cn('text-sm font-semibold tabular-nums', statusColor)}>
          {remaining === 0 ? 'Epuise' : `${remainingPercent}%`}
        </span>
      </div>
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

function RechargeModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('wave');

  const methods: { id: PaymentMethod; label: string; color: string }[] = [
    { id: 'wave',              label: 'Wave',              color: 'from-blue-500 to-cyan-500' },
    { id: 'orange_money',      label: 'Orange Money',      color: 'from-orange-500 to-amber-500' },
    { id: 'airtel_money',      label: 'Airtel Money',      color: 'from-red-500 to-rose-500' },
    { id: 'flooz',             label: 'Flooz (Moov)',      color: 'from-yellow-500 to-lime-500' },
    { id: 'mpesa',             label: 'M-Pesa',            color: 'from-green-600 to-emerald-500' },
    { id: 'nita_transfert',    label: 'Depot Nita',        color: 'from-purple-500 to-violet-500' },
    { id: 'amana_transfert',   label: 'Depot Amana',       color: 'from-teal-500 to-cyan-600' },
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
                    'w-full px-4 py-3 pr-16 rounded-xl text-lg font-semibold tabular-nums',
                    'bg-bg-tertiary border border-border-subtle',
                    'text-text-primary placeholder-text-muted',
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
                    <span>{pack.amount.toLocaleString('fr-FR')} F</span>
                  </button>
                ))}
              </div>

              {bonusPct > 0 && numericAmount > 0 && (
                <div className="mt-2 p-2.5 rounded-xl bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Bonus +{bonusPct}%</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      +{bonusAmount.toLocaleString('fr-FR')} F
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-text-secondary">Total credite</span>
                    <span className="font-bold text-text-primary">
                      {totalCredited.toLocaleString('fr-FR')} F
                    </span>
                  </div>
                </div>
              )}
            </div>

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

            <button
              onClick={async () => {
                if (!isValid) return;
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
                    window.alert(
                      data?.message ||
                        `Demande de recharge de ${numericAmount.toLocaleString('fr-FR')} F enregistree !\n\nEnvoie le paiement via ${methods.find((m2) => m2.id === method)?.label || method}, puis ton compte sera credite${bonusPct > 0 ? ` de ${totalCredited.toLocaleString('fr-FR')} F (bonus +${bonusPct}% inclus)` : ''} apres validation.`
                    );
                    onClose();
                    return;
                  }

                  const text = await res.text().catch(() => '');
                  throw new Error(text || 'Erreur serveur');
                } catch (e) {
                  const msg =
                    e instanceof Error ? e.message : "Paiement indisponible pour le moment. Reessaie plus tard.";
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
                ? `Payer ${numericAmount.toLocaleString('fr-FR')} FCFA${bonusPct > 0 ? ` → ${totalCredited.toLocaleString('fr-FR')} F credites` : ''}`
                : 'Saisir un montant (min. 500 FCFA)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ===================================================================
   TAB DEFINITIONS
   =================================================================== */
type TabId = 'profil' | 'abonnement' | 'preferences' | 'avance' | 'apropos';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'profil',      label: 'Profil',       icon: User },
  { id: 'abonnement',  label: 'Abonnement',   icon: CreditCard },
  { id: 'preferences', label: 'Preferences',  icon: Palette },
  { id: 'avance',      label: 'Avance',       icon: Wrench },
  { id: 'apropos',     label: 'A propos',     icon: Info },
];

/* ===================================================================
   MAIN SETTINGS PAGE
   =================================================================== */
export default function SettingsPage() {
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const resetSettings = useSettingsStore((s) => s.resetSettings);
  const setTheme = useThemeStore((s) => s.setTheme);

  const user = useAccountStore((s) => s.user);
  const credits = useAccountStore((s) => s.credits);
  const transactions = useAccountStore((s) => s.transactions);

  const handleLogout = () => {
    if (window.confirm('Se deconnecter ?')) {
      authService.logout();
      navigate('/login', { replace: true });
    }
  };

  const [activeTab, setActiveTab] = useState<TabId>('profil');
  const [form, setForm] = useState(settings);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showRecharge, setShowRecharge] = useState(false);
  const [showAllTx, setShowAllTx] = useState(false);
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
    setForm(settings);
  }, [settings]);

  useEffect(() => {
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
    if (!updateState.lastCheckedMs) return 'Jamais';
    try {
      return new Date(updateState.lastCheckedMs).toLocaleString('fr-FR');
    } catch {
      return '—';
    }
  }, [updateState.lastCheckedMs]);

  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'theme') {
      setTheme(value as any);
      updateSettings({ theme: value as any });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1200);
    }
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
    if (window.confirm('Reinitialiser tous les parametres par defaut ?')) {
      resetSettings();
      setForm(useSettingsStore.getState().settings);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  const rechargeTx = transactions.filter((tx) => tx.type === 'recharge' || tx.type === 'bonus');
  const displayedTx = showAllTx ? rechargeTx : rechargeTx.slice(0, 5);

  /* ===== Tab content renderers ===== */

  const renderProfil = () => (
    <div className="space-y-6">
      {/* Profile card */}
      {user && (
        <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center flex-shrink-0 shadow-lg">
              <span className="text-white font-bold text-xl">
                {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-text-primary truncate">{user.name}</h3>
              <p className="text-sm text-text-muted truncate">{user.email}</p>
              <span className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold bg-accent-primary/15 text-accent-primary">
                <CreditCard size={10} />
                Compte Prepaye
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Quick credit summary */}
      <div className="p-4 rounded-xl bg-surface-default border border-border-subtle">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-text-secondary">Solde actuel</span>
          <button
            onClick={() => setActiveTab('abonnement')}
            className="text-xs text-accent-primary hover:text-accent-primary/80 transition-colors flex items-center gap-1"
          >
            Voir details
            <ArrowUpRight size={11} />
          </button>
        </div>
        <p className="text-2xl font-bold text-text-primary tabular-nums">
          {credits.remaining.toLocaleString('fr-FR')} <span className="text-sm font-normal text-text-muted">FCFA</span>
        </p>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className={cn(
          'w-full py-3 rounded-xl text-sm font-medium',
          'bg-accent-error/10 hover:bg-accent-error/20',
          'text-accent-error',
          'transition-all duration-200 flex items-center justify-center gap-2'
        )}
      >
        <LogOut size={15} />
        Se deconnecter
      </button>
    </div>
  );

  const renderAbonnement = () => (
    <div className="space-y-6">
      {/* Credit gauge */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
            <CreditCard size={15} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-text-primary">Mon solde</span>
        </div>
        <CreditGauge
          remaining={credits.remaining}
          totalRecharged={credits.totalRecharged}
        />
        <button
          onClick={() => setShowRecharge(true)}
          className="w-full py-3 rounded-xl gradient-bg text-white text-sm font-medium shadow-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <ArrowUpRight size={15} />
          Recharger mon compte
        </button>
      </div>

      {/* Transaction history */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle">
        <div className="flex items-center gap-2 mb-4">
          <History size={15} className="text-text-muted" />
          <span className="text-sm font-semibold text-text-primary">Historique des recharges</span>
        </div>
        {rechargeTx.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">Aucune recharge pour le moment</p>
        ) : (
          <>
            <div className="divide-y divide-border-subtle">
              {displayedTx.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </div>
            {rechargeTx.length > 5 && (
              <button
                onClick={() => setShowAllTx(!showAllTx)}
                className="text-xs text-accent-primary hover:text-accent-primary/80 transition-colors mt-3"
              >
                {showAllTx ? 'Voir moins' : `Voir tout (${rechargeTx.length})`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  const renderPreferences = () => (
    <div className="space-y-6">
      {/* Mode IA */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={15} className="text-accent-primary" />
          <span className="text-sm font-semibold text-text-primary">Mode IA</span>
        </div>
        <SettingRow label="Mode par defaut" description="Rapide pour les reponses directes, Reflexion pour l'analyse approfondie">
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
              Reflexion
            </button>
          </div>
        </SettingRow>
      </div>

      {/* Apparence */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <Palette size={15} className="text-purple-500" />
          <span className="text-sm font-semibold text-text-primary">Apparence</span>
        </div>

        <SettingRow label="Theme" description="Choisis entre clair, sombre ou automatique">
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

        <div className="py-3">
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

        <SettingRow label="Langue">
          <select
            value={form.language}
            onChange={(e) => update('language', e.target.value as 'fr' | 'en')}
            className={cn(
              'px-3 py-2 rounded-xl text-sm',
              'bg-bg-secondary border border-border-subtle',
              'text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary'
            )}
          >
            <option value="fr">Francais</option>
            <option value="en">English</option>
          </select>
        </SettingRow>

        <SettingRow label="Mode compact" description="Reduit les espacements">
          <Toggle checked={form.compactMode} onChange={(v) => update('compactMode', v)} />
        </SettingRow>

        <SettingRow label="Animations" description="Transitions et effets visuels">
          <Toggle checked={form.animations} onChange={(v) => update('animations', v)} />
        </SettingRow>
      </div>

      {/* Save / Reset */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleReset}
          className={cn(
            'px-4 py-2.5 rounded-xl text-sm font-medium',
            'bg-bg-tertiary hover:bg-surface-hover',
            'text-text-secondary hover:text-text-primary',
            'transition-all duration-200 flex items-center gap-2'
          )}
        >
          <RotateCcw size={14} />
          Reinitialiser
        </button>
        <button
          onClick={handleSave}
          disabled={status === 'saving'}
          className={cn(
            'flex-1 py-2.5 rounded-xl text-sm font-medium text-white',
            'transition-all duration-200 flex items-center justify-center gap-2',
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
            <><Check size={14} /> Sauvegarde</>
          ) : (
            <><Save size={14} /> Sauvegarder</>
          )}
        </button>
      </div>
    </div>
  );

  const renderAvance = () => (
    <div className="space-y-6">
      {/* Reseau */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <Wifi size={15} className="text-blue-500" />
          <span className="text-sm font-semibold text-text-primary">Reseau</span>
        </div>
        <SettingRow label="Sauvegarde automatique" description="Enregistre les conversations automatiquement">
          <Toggle checked={form.autoSave} onChange={(v) => update('autoSave', v)} />
        </SettingRow>
        <SettingRow label="Economie de bande passante" description="Optimise pour les connexions lentes">
          <Toggle checked={form.bandwidthSaver} onChange={(v) => update('bandwidthSaver', v)} />
        </SettingRow>
        <SettingRow label="Mode hors ligne">
          <Toggle checked={form.offlineMode} onChange={(v) => update('offlineMode', v)} />
        </SettingRow>
      </div>

      {/* Developpeur */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle space-y-1">
        <div className="flex items-center gap-2 mb-3">
          <Settings size={15} className="text-orange-500" />
          <span className="text-sm font-semibold text-text-primary">Developpeur</span>
        </div>
        <SettingRow
          label="Mode developpeur"
          description="Affiche des options avancees (terminal)"
        >
          <Toggle checked={form.developerMode} onChange={(v) => update('developerMode', v)} />
        </SettingRow>
        <SettingRow
          label="Execution des commandes"
          description="Comment les commandes IA sont executees"
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
            <option value="manual">Manuel (Run requis)</option>
            <option value="always_ask">Toujours demander</option>
            <option value="auto_run">Auto-run (sur uniquement)</option>
          </select>
        </SettingRow>
        <SettingRow label="Verifier apres application" description="Lance automatiquement la verification">
          <Toggle checked={form.autoVerifyAfterApply} onChange={(v) => update('autoVerifyAfterApply', v)} />
        </SettingRow>
        <SettingRow label="Nettoyage auto des commandes" description="Supprime les commandes terminees">
          <Toggle checked={form.autoCleanFinishedCommands} onChange={(v) => update('autoCleanFinishedCommands', v)} />
        </SettingRow>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={status === 'saving'}
          className={cn(
            'flex-1 py-2.5 rounded-xl text-sm font-medium text-white',
            'transition-all duration-200 flex items-center justify-center gap-2',
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
            <><Check size={14} /> Sauvegarde</>
          ) : (
            <><Save size={14} /> Sauvegarder</>
          )}
        </button>
      </div>
    </div>
  );

  const renderApropos = () => (
    <div className="space-y-6">
      {/* Infos app */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Info size={15} className="text-accent-primary" />
          <span className="text-sm font-semibold text-text-primary">ANZAR</span>
        </div>
        <div className="space-y-2.5">
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
            <span className="font-mono text-text-primary">Desktop</span>
          </div>
        </div>
      </div>

      {/* Mises a jour */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">Mises a jour</span>
          <span className="text-[11px] text-text-muted">Derniere verif : {lastCheckLabel}</span>
        </div>

        {!isTauri() ? (
          <p className="text-xs text-text-muted">
            Disponible uniquement dans l'app desktop installee.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {updateState.error ? (
                <p className="text-xs text-accent-error truncate">{updateState.error}</p>
              ) : updateState.available ? (
                <p className="text-xs text-accent-warning">
                  Mise a jour disponible{updateState.version ? ` (v${updateState.version})` : ''}.
                </p>
              ) : (
                <p className="text-xs text-text-muted">Aucune mise a jour detectee.</p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={async () => {
                  setUpdateState((s) => ({ ...s, checking: true, error: undefined }));
                  try {
                    const res = await checkForUpdates();
                    const checkedMs = getLastUpdateCheckMs();
                    if (res.supported) {
                      setUpdateState((s) => ({
                        ...s,
                        checking: false,
                        available: res.shouldUpdate,
                        version: res.manifest?.version,
                        lastCheckedMs: checkedMs,
                      }));
                    } else {
                      setUpdateState((s) => ({ ...s, checking: false, error: 'Non supporte.' }));
                    }
                  } catch {
                    setUpdateState((s) => ({
                      ...s,
                      checking: false,
                      error: 'Impossible de verifier. Reessaie plus tard.',
                    }));
                  }
                }}
                disabled={updateState.checking || updateState.installing}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-medium transition-all border',
                  'border-border-subtle bg-bg-tertiary/40 hover:bg-surface-hover',
                  (updateState.checking || updateState.installing) && 'opacity-60 cursor-not-allowed'
                )}
              >
                {updateState.checking ? 'Verification...' : 'Verifier'}
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

      {/* Liens */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle">
        <div className="flex items-center gap-4">
          <button
            onClick={() => openExternalUrl('https://anzar.dev/docs')}
            className="text-accent-primary hover:text-accent-primary/80 transition-colors text-sm flex items-center gap-1.5"
          >
            <ExternalLink size={13} />
            Documentation
          </button>
          <button
            onClick={() => openExternalUrl('https://anzar.dev/support')}
            className="text-accent-primary hover:text-accent-primary/80 transition-colors text-sm flex items-center gap-1.5"
          >
            <ExternalLink size={13} />
            Support
          </button>
        </div>
      </div>

      {/* Contact */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Mail size={15} className="text-text-muted" />
          <span className="text-sm font-semibold text-text-primary">Contact & Support</span>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <button
            onClick={() => openExternalUrl('mailto:abdul@issalanhub.com')}
            className="flex items-center gap-3 p-3 rounded-xl bg-bg-tertiary/50 hover:bg-surface-hover transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-accent-primary/10 flex items-center justify-center flex-shrink-0">
              <Mail size={14} className="text-accent-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-text-primary">Email</p>
              <p className="text-[11px] text-text-muted truncate">abdul@issalanhub.com</p>
            </div>
          </button>

          <button
            onClick={() => openExternalUrl('tel:+17172161490')}
            className="flex items-center gap-3 p-3 rounded-xl bg-bg-tertiary/50 hover:bg-surface-hover transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <Phone size={14} className="text-green-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-text-primary">Telephone</p>
              <p className="text-[11px] text-text-muted">+1 (717) 216-1490</p>
            </div>
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => openExternalUrl('https://wa.me/17172161490')}
              className="flex-1 flex items-center gap-2 p-3 rounded-xl bg-bg-tertiary/50 hover:bg-surface-hover transition-all group"
            >
              <div className="w-7 h-7 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                <MessageCircle size={13} className="text-green-500" />
              </div>
              <span className="text-xs font-semibold text-text-primary">WhatsApp</span>
            </button>
            <button
              onClick={() => openExternalUrl('https://t.me/+17172161490')}
              className="flex-1 flex items-center gap-2 p-3 rounded-xl bg-bg-tertiary/50 hover:bg-surface-hover transition-all group"
            >
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Send size={13} className="text-blue-500" />
              </div>
              <span className="text-xs font-semibold text-text-primary">Telegram</span>
            </button>
          </div>
        </div>

        {/* Company */}
        <div className="pt-3 border-t border-border-subtle space-y-2">
          <div className="flex items-center gap-2">
            <Globe size={13} className="text-text-muted" />
            <span className="text-sm font-semibold text-text-primary">IssalanHub</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={13} className="text-text-muted" />
            <span className="text-xs text-text-muted">USA · Niger</span>
          </div>
        </div>

        <div className="pt-3 border-t border-border-subtle">
          <p className="text-[11px] text-text-muted/70 text-center">
            {"© "}{new Date().getFullYear()} IssalanHub. Tous droits reserves.
          </p>
        </div>
      </div>
    </div>
  );

  const tabContent: Record<TabId, () => JSX.Element> = {
    profil: renderProfil,
    abonnement: renderAbonnement,
    preferences: renderPreferences,
    avance: renderAvance,
    apropos: renderApropos,
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-primary">
      {/* Header */}
      <div className="border-b border-border-subtle px-6 py-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-text-primary">Parametres</h1>
        <p className="text-xs text-text-muted mt-1">Gere ton profil, ton abonnement et tes preferences</p>
      </div>

      {/* Body: sidebar tabs + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Tab sidebar */}
        <nav className="w-48 flex-shrink-0 border-r border-border-subtle bg-bg-secondary/30 p-3 space-y-1 overflow-y-auto">
          {TABS.map(({ id, label, icon: TabIcon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left',
                activeTab === id
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              )}
            >
              <TabIcon size={16} />
              {label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-xl mx-auto p-6">
            {tabContent[activeTab]()}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showRecharge && <RechargeModal onClose={() => setShowRecharge(false)} />}
    </div>
  );
}
