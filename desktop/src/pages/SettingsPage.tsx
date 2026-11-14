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
  Plus, Gift, X, LogOut,
  Mail, Phone, MessageCircle, Send, MapPin, Globe,
  Settings, Wrench, Trash2, Edit3, BookOpen,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import { authService } from '@/services/infra/auth';
import { Transaction } from '@/types';
import { cn, isTauri } from '@/lib/utils';
import { openExternalUrl } from '@/services/infra/externalLinks';
import RechargeModal from '@/components/billing/RechargeModal';
import { checkForUpdates, getCachedUpdateResult, getLastUpdateCheckMs, installUpdateAndRelaunch } from '@/services/infra/updateService';
import { useThemeStore } from '@/stores/themeStore';
import { useDevMemoryStore, CATEGORY_LABELS, CATEGORY_ICONS, ALL_CATEGORIES } from '@/stores/devMemoryStore';
import toast from 'react-hot-toast';
import type { MemoryCategory } from '@/services/memoryService';
import { useConfirmModal } from '@/components/ui/ConfirmModal';

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



/* ===================================================================
   TAB DEFINITIONS
   =================================================================== */
type TabId = 'profil' | 'abonnement' | 'preferences' | 'memoire' | 'avance' | 'apropos';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'profil',      label: 'Profil',       icon: User },
  { id: 'abonnement',  label: 'Abonnement',   icon: CreditCard },
  { id: 'preferences', label: 'Preferences',  icon: Palette },
  { id: 'memoire',     label: 'Memoire IA',   icon: Brain },
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
  const { confirm, ConfirmDialog } = useConfirmModal();

  const handleLogout = async () => {
    const ok = await confirm({
      title: 'Déconnexion',
      message: 'Tu veux vraiment te déconnecter ?',
      confirmLabel: 'Se déconnecter',
      variant: 'warning',
    });
    if (ok) {
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

  const handleReset = async () => {
    const ok = await confirm({
      title: 'Réinitialisation',
      message: 'Réinitialiser tous les paramètres par défaut ?',
      confirmLabel: 'Réinitialiser',
      variant: 'warning',
    });
    if (ok) {
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

  /* ── Memoire IA ── */
  const memEntries = useDevMemoryStore((s) => s.entries);
  const memLoading = useDevMemoryStore((s) => s.loading);
  const memError = useDevMemoryStore((s) => s.error);
  const memSelectedCat = useDevMemoryStore((s) => s.selectedCategory);
  const memFetchEntries = useDevMemoryStore((s) => s.fetchEntries);
  const memUpsert = useDevMemoryStore((s) => s.upsertEntry);
  const memDelete = useDevMemoryStore((s) => s.deleteEntry);
  const memClearAll = useDevMemoryStore((s) => s.clearAll);
  const memSetCat = useDevMemoryStore((s) => s.setSelectedCategory);

  const [memAddOpen, setMemAddOpen] = useState(false);
  const [memNewCat, setMemNewCat] = useState<MemoryCategory>('stack');
  const [memNewKey, setMemNewKey] = useState('');
  const [memNewVal, setMemNewVal] = useState('');

  useEffect(() => {
    if (activeTab === 'memoire' && memEntries.length === 0 && !memLoading) {
      memFetchEntries();
    }
  }, [activeTab]);

  const filteredMemEntries = memSelectedCat
    ? memEntries.filter((e) => e.category === memSelectedCat)
    : memEntries;

  const handleMemAdd = async () => {
    if (!memNewKey.trim() || !memNewVal.trim()) return;
    await memUpsert(memNewCat, memNewKey.trim(), memNewVal.trim());
    setMemNewKey('');
    setMemNewVal('');
    setMemAddOpen(false);
  };

  const renderMemoire = () => (
    <div className="space-y-6">
      {/* Header + description */}
      <div className="p-5 rounded-2xl bg-surface-default border border-border-subtle">
        <div className="flex items-center gap-2 mb-2">
          <Brain size={15} className="text-purple-500" />
          <span className="text-sm font-semibold text-text-primary">Memoire developpeur</span>
        </div>
        <p className="text-xs text-text-muted">
          ANZAR apprend tes preferences de code (stack, conventions, patterns, style) pour personnaliser
          chaque generation. Les preferences sont detectees automatiquement ou ajoutees manuellement.
        </p>
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { memSetCat(null); memFetchEntries(); }}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
            !memSelectedCat
              ? 'bg-accent-primary/10 text-accent-primary'
              : 'bg-bg-secondary text-text-muted hover:text-text-primary'
          )}
        >
          Tout ({memEntries.length})
        </button>
        {ALL_CATEGORIES.map((cat) => {
          const count = memEntries.filter((e) => e.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => { memSetCat(cat); }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                memSelectedCat === cat
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'bg-bg-secondary text-text-muted hover:text-text-primary'
              )}
            >
              {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]} ({count})
            </button>
          );
        })}
      </div>

      {/* Error */}
      {memError && (
        <div className="p-3 rounded-xl bg-accent-error/10 border border-accent-error/20 text-xs text-accent-error">
          {memError}
        </div>
      )}

      {/* Entries list */}
      <div className="space-y-2">
        {memLoading ? (
          <div className="text-center text-sm text-text-muted py-8">Chargement...</div>
        ) : filteredMemEntries.length === 0 ? (
          <div className="text-center py-8">
            <BookOpen size={32} className="mx-auto text-text-muted/30 mb-2" />
            <p className="text-sm text-text-muted">Aucune preference enregistree</p>
            <p className="text-xs text-text-muted/60 mt-1">
              Genere un projet pour que ANZAR apprenne automatiquement tes preferences.
            </p>
          </div>
        ) : (
          filteredMemEntries.map((entry) => (
            <div
              key={`${entry.category}-${entry.key}`}
              className="p-3 rounded-xl bg-surface-default border border-border-subtle flex items-start gap-3 group"
            >
              <span className="text-sm mt-0.5">{CATEGORY_ICONS[entry.category]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">{entry.key}</span>
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full',
                    entry.source === 'auto'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-green-500/10 text-green-400'
                  )}>
                    {entry.source === 'auto' ? 'auto' : 'manuel'}
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-0.5 break-words">{entry.value}</p>
                <p className="text-[10px] text-text-muted/50 mt-1">
                  Confiance: {Math.round(entry.confidence * 100)}%
                </p>
              </div>
              <button
                onClick={() => memDelete(entry.category, entry.key)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent-error/10 text-text-muted hover:text-accent-error transition-all"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add new entry */}
      {memAddOpen ? (
        <div className="p-4 rounded-2xl bg-surface-default border border-border-subtle space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Edit3 size={14} className="text-accent-primary" />
            <span className="text-sm font-semibold text-text-primary">Nouvelle preference</span>
          </div>
          <select
            value={memNewCat}
            onChange={(e) => setMemNewCat(e.target.value as MemoryCategory)}
            className="w-full px-3 py-2 rounded-xl text-sm bg-bg-secondary border border-border-subtle text-text-primary"
          >
            {ALL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}</option>
            ))}
          </select>
          <input
            value={memNewKey}
            onChange={(e) => setMemNewKey(e.target.value)}
            placeholder="Cle (ex: framework, indentation)"
            className="w-full px-3 py-2 rounded-xl text-sm bg-bg-secondary border border-border-subtle text-text-primary placeholder:text-text-muted/50"
          />
          <input
            value={memNewVal}
            onChange={(e) => setMemNewVal(e.target.value)}
            placeholder="Valeur (ex: React + TypeScript, 2 espaces)"
            className="w-full px-3 py-2 rounded-xl text-sm bg-bg-secondary border border-border-subtle text-text-primary placeholder:text-text-muted/50"
          />
          <div className="flex gap-2">
            <button
              onClick={handleMemAdd}
              disabled={!memNewKey.trim() || !memNewVal.trim()}
              className="flex-1 py-2 rounded-xl text-sm font-medium text-white gradient-bg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Ajouter
            </button>
            <button
              onClick={() => setMemAddOpen(false)}
              className="px-4 py-2 rounded-xl text-sm text-text-muted hover:bg-surface-hover"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setMemAddOpen(true)}
          className="w-full py-2.5 rounded-xl text-sm font-medium text-accent-primary border border-accent-primary/20 hover:bg-accent-primary/5 transition-all flex items-center justify-center gap-2"
        >
          <Plus size={14} /> Ajouter une preference
        </button>
      )}

      {/* Clear all */}
      {memEntries.length > 0 && (
        <button
          onClick={async () => {
            const ok = await confirm({
              title: 'Effacer la mémoire',
              message: `Supprimer toutes les préférences${memSelectedCat ? ` (${CATEGORY_LABELS[memSelectedCat]})` : ''} ? Cette action est irréversible.`,
              confirmLabel: 'Tout effacer',
              variant: 'danger',
            });
            if (ok) {
              memClearAll(memSelectedCat ?? undefined);
            }
          }}
          className="w-full py-2 rounded-xl text-xs text-accent-error/60 hover:text-accent-error hover:bg-accent-error/5 transition-all"
        >
          Tout effacer{memSelectedCat ? ` (${CATEGORY_LABELS[memSelectedCat]})` : ''}
        </button>
      )}
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
    memoire: renderMemoire,
    avance: renderAvance,
    apropos: renderApropos,
  };

  return (
    <>
    {ConfirmDialog}
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
    </>
  );
}
