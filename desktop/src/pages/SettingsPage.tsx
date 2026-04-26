/**
 * Settings Page - Premium ANZAR
 * Mon Compte · IA · Interface · Réseau · À propos
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Save, RotateCcw, Cpu, Palette, Wifi, Info,
  ExternalLink, Check, Gauge, Zap, Brain,
  User, CreditCard, ArrowUpRight, History,
  Sparkles, Smartphone,
  Plus, Gift, X, Shield, LogOut,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import { authService } from '@/services/auth';
import { Transaction, AI_PROVIDERS, AIProvider } from '@/types';
import { cn, isTauri } from '@/lib/utils';
import { openExternalUrl } from '@/services/externalLinks';

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
function RechargeModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<'wave' | 'orange_money' | 'mpesa'>('wave');

  const presetAmounts = [1000, 2000, 5000, 10000];

  const methods = [
    { id: 'wave' as const, label: 'Wave', color: 'from-blue-500 to-cyan-500' },
    { id: 'orange_money' as const, label: 'Orange Money', color: 'from-orange-500 to-amber-500' },
    { id: 'mpesa' as const, label: 'M-Pesa', color: 'from-green-600 to-emerald-500' },
  ];

  const numericAmount = typeof amount === 'number' ? amount : 0;
  const isValid = numericAmount >= 100;

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
              {/* Preset buttons */}
              <div className="grid grid-cols-4 gap-2">
                {presetAmounts.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAmount(a)}
                    className={cn(
                      'py-2 rounded-xl text-sm font-medium transition-all',
                      amount === a
                        ? 'gradient-bg text-white shadow-md'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-surface-hover'
                    )}
                  >
                    {a.toLocaleString('fr-FR')}
                  </button>
                ))}
              </div>
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
                    }
                    onClose();
                  } else {
                    throw new Error('Erreur serveur');
                  }
                } catch {
                  // Fallback: enregistrer en local et notifier
                  const { useAccountStore } = await import('@/stores/accountStore');
                  useAccountStore.getState().addCredits(numericAmount, method as any);
                  onClose();
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
                ? `Payer ${numericAmount.toLocaleString('fr-FR')} FCFA`
                : 'Saisir un montant (min. 100 FCFA)'}
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

          {/* ===== INTELLIGENCE ARTIFICIELLE ===== */}
          <Section icon={Cpu} title="Intelligence Artificielle" description="Fournisseur et mode de réponse de l'IA">
            {/* Provider selector */}
            <SettingRow label="Fournisseur IA" description="Choisis le moteur d'intelligence artificielle">
              <div className="flex flex-col gap-2 w-full">
                {(Object.keys(AI_PROVIDERS) as AIProvider[]).map((key) => {
                  const p = AI_PROVIDERS[key];
                  const isSelected = form.provider === key;
                  return (
                    <button
                      key={key}
                      onClick={() => update('provider', key)}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-xl border transition-all text-left w-full',
                        isSelected
                          ? 'border-accent-primary/60 bg-accent-primary/5 shadow-sm'
                          : 'border-border-subtle bg-bg-tertiary/30 hover:border-border-default hover:bg-bg-tertiary/60'
                      )}
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                        isSelected ? 'bg-accent-primary/20' : 'bg-bg-tertiary'
                      )}>
                        <Sparkles size={14} className={isSelected ? 'text-accent-primary' : 'text-text-muted'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn('text-sm font-semibold', isSelected ? 'text-text-primary' : 'text-text-secondary')}>
                            {p.label}
                          </span>
                          {isSelected && (
                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary text-[10px] font-medium">
                              <Check size={10} /> Actif
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {p.features.map((f) => (
                            <span
                              key={f}
                              className="px-1.5 py-0.5 rounded-md bg-bg-tertiary/80 text-[10px] text-text-muted border border-border-subtle/50"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </SettingRow>

            {/* Backend Connection */}
            <SettingRow label="Serveur backend" description="Toutes les requêtes IA transitent par le backend sécurisé ANZAR.">
              <div className="flex flex-col gap-3 w-full">
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary mb-1.5">
                    <Shield size={10} className="text-accent-primary" />
                    URL du backend
                  </label>
                  <input
                    type="url"
                    value={form.backendUrl || ''}
                    onChange={(e) => update('backendUrl', e.target.value)}
                    placeholder="https://api.anzar.app"
                    className={cn(
                      'w-full px-3 py-2.5 rounded-xl text-xs font-mono',
                      'bg-bg-tertiary border border-border-subtle',
                      'text-text-primary placeholder-text-muted',
                      'focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all'
                    )}
                  />
                </div>

                {/* Security note */}
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-accent-success/5 border border-accent-success/20">
                  <Shield size={12} className="text-accent-success flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    Les clés API (DeepSeek, Kimi) sont stockées uniquement sur le serveur.
                    Elles ne transitent jamais par ton appareil. Connexion sécurisée HTTPS.
                  </p>
                </div>
              </div>
            </SettingRow>

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
              description="Contrôle comment les commandes proposées par l’IA sont exécutées."
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
              description="Après Preview → Appliquer, lance automatiquement “Vérifier le projet”."
            >
              <Toggle checked={form.autoVerifyAfterApply} onChange={(v) => update('autoVerifyAfterApply', v)} />
            </SettingRow>

            <SettingRow
              label="Nettoyage auto des commandes"
              description="Supprime automatiquement les Command Cards terminées au bout d’un moment."
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
                <span className="font-mono text-text-primary">2.0.0</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Moteur IA</span>
                <span className="font-mono text-text-primary">ANZAR AI</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Plateforme</span>
                <span className="font-mono text-text-primary">Desktop (Windows, Mac, Linux)</span>
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
