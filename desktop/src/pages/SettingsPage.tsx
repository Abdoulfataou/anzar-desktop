/**
 * Paramètres — structure inspirée de ZCode : navigation groupée à gauche,
 * cartes de réglages à droite. Seuls les réglages qui ont un effet réel sont présentés.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings2, Palette, User, BarChart3, Database, Info, Monitor, Moon, Sun,
  Zap, Brain, LogOut, Download, Upload, Trash2, ExternalLink, Mail, MessageCircle, Copy, Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, isTauri } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { useAccountStore } from '@/stores/accountStore';
import { useUsageStore } from '@/stores/usageStore';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { authService } from '@/services/infra/auth';
import { openExternalUrl } from '@/services/infra/externalLinks';
import { checkForUpdates, getCachedUpdateResult, getLastUpdateCheckMs, installUpdateAndRelaunch } from '@/services/infra/updateService';
import { loadPersonalInstructions, savePersonalInstructions, MAX_INSTRUCTIONS_CHARS } from '@/services/personalInstructions';
import { storeRoot } from '@/lib/fileStore';
import RechargeModal from '@/components/billing/RechargeModal';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import type { Conversation, Project } from '@/types';
import type { PermissionMode } from '@/hooks/useAgentChat';

type SectionId = 'general' | 'appearance' | 'personalization' | 'account' | 'usage' | 'data' | 'about';

const GROUPS: { title: string; sections: { id: SectionId; label: string; icon: React.ElementType }[] }[] = [
  {
    title: 'Général',
    sections: [
      { id: 'general', label: 'Général', icon: Settings2 },
      { id: 'appearance', label: 'Apparence', icon: Palette },
    ],
  },
  {
    title: 'Agent',
    sections: [{ id: 'personalization', label: 'Personnalisation', icon: User }],
  },
  {
    title: 'Compte et données',
    sections: [
      { id: 'account', label: 'Compte', icon: Wallet },
      { id: 'usage', label: 'Utilisation', icon: BarChart3 },
      { id: 'data', label: 'Données', icon: Database },
      { id: 'about', label: 'À propos', icon: Info },
    ],
  },
];

/* ── Éléments de mise en page (façon ZCode) ── */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-medium bg-surface-default divide-y divide-border-subtle">
      {children}
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-ui-base font-medium text-text-primary">{label}</div>
        {description && <div className="mt-0.5 text-ui-sm text-text-secondary leading-relaxed">{description}</div>}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: string; icon?: React.ElementType }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-0.5 p-0.5 rounded-lg bg-hover-fill">
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            'flex items-center gap-1.5 h-7 px-3 rounded-md text-ui-base transition-colors',
            value === id ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          {Icon && <Icon size={13} />}
          {label}
        </button>
      ))}
    </div>
  );
}

const btn = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base border border-border-medium text-text-primary hover:bg-hover-fill transition-colors disabled:opacity-50';
const btnPrimary = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 transition-opacity disabled:opacity-50';
const btnDanger = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base border border-accent-error/40 text-accent-error hover:bg-accent-error/10 transition-colors';

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;

/* ── Sauvegarde des tâches (export / import) ── */

interface BackupFile {
  app: 'ANZAR';
  version: 1;
  exportedAt: string;
  conversations: Conversation[];
  projects: Pick<Project, 'id' | 'name' | 'description' | 'metadata' | 'createdAt' | 'updatedAt'>[];
}

async function exportTasks(): Promise<number | null> {
  const conversations = useChatStore.getState().conversations.filter((c) => c.messages.length > 0);
  const projects = useProjectStore.getState().projects.map(({ id, name, description, metadata, createdAt, updatedAt }) => ({
    id, name, description, metadata, createdAt, updatedAt,
  }));
  const backup: BackupFile = { app: 'ANZAR', version: 1, exportedAt: new Date().toISOString(), conversations, projects };
  const json = JSON.stringify(backup);
  const name = `anzar-taches-${new Date().toISOString().slice(0, 10)}.json`;

  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
    return conversations.length;
  }
  const { save } = await import('@tauri-apps/api/dialog');
  const { downloadDir, join } = await import('@tauri-apps/api/path');
  const { writeTextFile } = await import('@tauri-apps/api/fs');
  const path = await save({
    title: 'Exporter les tâches',
    defaultPath: await downloadDir().then((d) => join(d, name)).catch(() => name),
    filters: [{ name: 'Sauvegarde ANZAR', extensions: ['json'] }],
  });
  if (!path || typeof path !== 'string') return null;
  await writeTextFile(path, json);
  return conversations.length;
}

async function importTasks(): Promise<{ added: number; skipped: number } | null> {
  let text: string;
  if (!isTauri()) {
    text = await new Promise<string>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'application/json,.json';
      input.onchange = () => input.files?.[0] ? input.files[0].text().then(resolve, reject) : reject(new Error('annulé'));
      input.click();
    });
  } else {
    const { open } = await import('@tauri-apps/api/dialog');
    const { readTextFile } = await import('@tauri-apps/api/fs');
    const path = await open({ title: 'Importer des tâches', multiple: false, filters: [{ name: 'Sauvegarde ANZAR', extensions: ['json'] }] });
    if (!path || typeof path !== 'string') return null;
    text = await readTextFile(path);
  }
  const data = JSON.parse(text) as Partial<BackupFile>;
  if (data.app !== 'ANZAR' || !Array.isArray(data.conversations)) throw new Error("ce fichier n'est pas une sauvegarde ANZAR");

  // Projets inconnus : ajoutés tels quels (le dossier pourra être rouvert depuis la tâche)
  const known = new Set(useProjectStore.getState().projects.map((p) => p.id));
  const newProjects = (data.projects || []).filter((p) => p?.id && !known.has(p.id)).map((p) => ({
    ...p, status: 'complete' as const, files: [], agents: [],
  })) as Project[];
  if (newProjects.length) useProjectStore.setState((s) => ({ projects: [...s.projects, ...newProjects] }));

  // Tâches : celles qui existent déjà (même identifiant) sont ignorées
  const existing = new Set(useChatStore.getState().conversations.map((c) => c.id));
  const valid = data.conversations.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages));
  const fresh = valid
    .filter((c) => !existing.has(c.id))
    .map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, isStreaming: false })) }));
  if (fresh.length) useChatStore.getState().importConversations(fresh);
  return { added: fresh.length, skipped: valid.length - fresh.length };
}

/* ── Page ── */

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>('general');
  const { confirm, ConfirmDialog } = useConfirmModal();
  const current = GROUPS.flatMap((g) => g.sections).find((s) => s.id === section)!;

  return (
    <div className="h-full flex overflow-hidden">
      {ConfirmDialog}
      <nav className="w-56 flex-shrink-0 border-r border-border-subtle p-3 overflow-y-auto">
        <h1 className="px-2 pt-1 pb-3 text-ui-lg font-semibold text-text-primary">Paramètres</h1>
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-3">
            <div className="px-2 pb-1 text-ui-sm text-text-muted">{g.title}</div>
            {g.sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={cn(
                  'w-full flex items-center gap-2 h-8 px-2 rounded-lg text-ui-base text-left transition-colors',
                  section === id ? 'bg-selected text-text-primary' : 'text-text-secondary hover:bg-hover-fill hover:text-text-primary'
                )}
              >
                <Icon size={15} className="flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8">
          <h2 className="mb-5 text-ui-xl font-semibold text-text-primary">{current.label}</h2>
          {section === 'general' && <GeneralSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'personalization' && <PersonalizationSection />}
          {section === 'account' && <AccountSection confirm={confirm} />}
          {section === 'usage' && <UsageSection />}
          {section === 'data' && <DataSection confirm={confirm} />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

type Confirm = ReturnType<typeof useConfirmModal>['confirm'];

function GeneralSection() {
  const model = useSettingsStore((s) => s.settings.model);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const webTools = useSettingsStore((s) => s.settings.webTools !== false);
  const codeDiagnostics = useSettingsStore((s) => s.settings.codeDiagnostics !== false);
  const [mode, setMode] = useState<PermissionMode>(() => {
    try {
      const v = localStorage.getItem('anzar.permissionMode');
      return v === 'ask' || v === 'auto' || v === 'plan' || v === 'full' ? v : 'full';
    } catch { return 'full'; }
  });
  const changeMode = (m: PermissionMode) => {
    setMode(m);
    try { localStorage.setItem('anzar.permissionMode', m); } catch { /* ignore */ }
  };
  return (
    <Card>
      <Row label="Modèle par défaut" description="Rapide : réflexion courte, le moins cher. Réflexion : le bon réglage pour la plupart des tâches. Max : tâches difficiles, plus lent et plus cher.">
        <Segmented
          value={model}
          onChange={(v) => updateSettings({ model: v })}
          options={[{ id: 'fast', label: 'Rapide', icon: Zap }, { id: 'thinking', label: 'Réflexion', icon: Brain }, { id: 'max', label: 'Max', icon: Brain }]}
        />
      </Row>
      <Row
        label="Recherche web"
        description="L'agent peut chercher sur le web et lire des pages (documentation récente, erreurs inconnues). Environ 1 FCFA par recherche ou page lue, ajouté au coût de la réponse."
      >
        <Segmented
          value={webTools ? 'on' : 'off'}
          onChange={(v) => updateSettings({ webTools: v === 'on' })}
          options={[{ id: 'on', label: 'Activée' }, { id: 'off', label: 'Désactivée' }]}
        />
      </Row>
      <Row
        label="Vérification du code"
        description="Après chaque fichier TypeScript, JavaScript ou Python écrit par l'agent, ses erreurs sont vérifiées aussitôt (types, noms inconnus, imports) et l'agent les corrige. Gratuit, sur ton ordinateur ; demande Node.js. Le premier lancement télécharge les vérificateurs."
      >
        <Segmented
          value={codeDiagnostics ? 'on' : 'off'}
          onChange={(v) => updateSettings({ codeDiagnostics: v === 'on' })}
          options={[{ id: 'on', label: 'Activée' }, { id: 'off', label: 'Désactivée' }]}
        />
      </Row>
      <Row label="Permissions par défaut" description="Ce que l'agent peut faire sans te demander. Modifiable à tout moment depuis la saisie.">
        <select
          value={mode}
          onChange={(e) => changeMode(e.target.value as PermissionMode)}
          className="h-8 px-2 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none"
        >
          <option value="ask">Demander avant de modifier</option>
          <option value="auto">Modifier automatiquement</option>
          <option value="plan">Mode plan</option>
          <option value="full">Accès complet</option>
        </select>
      </Row>
    </Card>
  );
}

function AppearanceSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  return (
    <Card>
      <Row label="Thème" description="Système suit le réglage clair ou sombre de ton Mac.">
        <Segmented
          value={theme}
          onChange={(t) => { setTheme(t); updateSettings({ theme: t }); }}
          options={[
            { id: 'system', label: 'Système', icon: Monitor },
            { id: 'light', label: 'Clair', icon: Sun },
            { id: 'dark', label: 'Sombre', icon: Moon },
          ]}
        />
      </Row>
    </Card>
  );
}

function PersonalizationSection() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void loadPersonalInstructions().then((t) => { setText(t); setSaved(t); setLoaded(true); });
  }, []);
  const save = async () => {
    try {
      await savePersonalInstructions(text);
      setSaved(text);
      toast.success('Instructions enregistrées');
    } catch {
      toast.error("Enregistrement impossible");
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-ui-base text-text-secondary">
        Des consignes que l'agent suit dans <strong className="font-medium text-text-primary">toutes</strong> tes tâches :
        ta façon de travailler, tes conventions, ce qu'il doit éviter. Pour une procédure précise, crée plutôt une Skill.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_INSTRUCTIONS_CHARS))}
        disabled={!loaded}
        rows={12}
        placeholder={"Exemples :\n- Réponds en français, code et commentaires en anglais.\n- Utilise TypeScript strict et Tailwind.\n- Lance npm run build après chaque modification importante.\n- Ne touche jamais aux fichiers .env."}
        className="w-full px-3 py-2.5 rounded-xl bg-input border border-input-border text-ui-base leading-relaxed text-text-primary outline-none focus:border-input-border-hover resize-y"
      />
      <div className="flex items-center justify-between">
        <span className="text-ui-sm text-text-muted tabular-nums">{text.length} / {MAX_INSTRUCTIONS_CHARS}</span>
        <div className="flex gap-2">
          {text !== saved && <button onClick={() => setText(saved)} className={btn}>Annuler</button>}
          <button onClick={() => void save()} disabled={text === saved} className={btnPrimary}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function AccountSection({ confirm }: { confirm: Confirm }) {
  const navigate = useNavigate();
  const user = useAccountStore((s) => s.user);
  const credits = useAccountStore((s) => s.credits);
  const transactions = useAccountStore((s) => s.transactions);
  const [showRecharge, setShowRecharge] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const recharges = transactions.filter((t) => t.type === 'recharge' || t.type === 'bonus');

  const logout = async () => {
    const ok = await confirm({ title: 'Déconnexion', message: 'Tu veux vraiment te déconnecter ?', confirmLabel: 'Se déconnecter', variant: 'warning' });
    if (!ok) return;
    authService.logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="space-y-6">
      <Card>
        <Row label={user?.name || 'Compte'} description={user?.email}>
          <button onClick={() => void logout()} className={btn}><LogOut size={14} /> Se déconnecter</button>
        </Row>
        <Row label="Solde" description={<span className="font-mono tabular-nums text-ui-lg text-text-primary">{fcfa(credits.remaining)}</span>}>
          <button onClick={() => setShowRecharge(true)} className={btnPrimary}>Recharger</button>
        </Row>
      </Card>

      <div>
        <h3 className="mb-2 text-ui-base font-semibold text-text-primary">Recharges</h3>
        <Card>
          {recharges.length === 0 ? (
            <Row label="Aucune recharge pour le moment" />
          ) : (
            (showAll ? recharges : recharges.slice(0, 5)).map((t) => (
              <Row
                key={t.id}
                label={t.description}
                description={new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
              >
                <span className="font-mono tabular-nums text-ui-base text-diff-added">+{Math.round(t.amount).toLocaleString('fr-FR')} F</span>
              </Row>
            ))
          )}
        </Card>
        {recharges.length > 5 && (
          <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-ui-sm text-link hover:underline">
            {showAll ? 'Voir moins' : `Voir tout (${recharges.length})`}
          </button>
        )}
      </div>
      {showRecharge && <RechargeModal onClose={() => setShowRecharge(false)} />}
    </div>
  );
}

function UsageSection() {
  const records = useUsageStore((s) => s.records);
  const stats = useMemo(() => {
    const now = Date.now();
    const day = 86_400_000;
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    let today = 0, week = 0, month = 0, requests = 0;
    const days: { key: string; label: string; cost: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(startToday.getTime() - i * day);
      days.push({ key: d.toDateString(), label: d.toLocaleDateString('fr-FR', { day: 'numeric' }), cost: 0 });
    }
    for (const r of records) {
      const age = now - r.timestamp;
      if (r.timestamp >= startToday.getTime()) today += r.costFCFA;
      if (age < 7 * day) week += r.costFCFA;
      if (age < 30 * day) { month += r.costFCFA; requests++; }
      const slot = days.find((x) => x.key === new Date(r.timestamp).toDateString());
      if (slot) slot.cost += r.costFCFA;
    }
    return { today, week, month, requests, days, max: Math.max(1, ...days.map((d) => d.cost)) };
  }, [records]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {[['Aujourd\'hui', stats.today], ['7 derniers jours', stats.week], ['30 derniers jours', stats.month]].map(([label, v]) => (
          <div key={label as string} className="rounded-xl border border-border-medium bg-surface-default px-4 py-3">
            <div className="text-ui-sm text-text-secondary">{label}</div>
            <div className="mt-1 font-mono tabular-nums text-ui-lg text-text-primary">{fcfa(v as number)}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border-medium bg-surface-default px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-ui-base font-medium text-text-primary">14 derniers jours</span>
          <span className="text-ui-sm text-text-secondary">{stats.requests} réponses sur 30 jours</span>
        </div>
        <div className="flex items-end gap-1.5 h-28">
          {stats.days.map((d) => (
            <div key={d.key} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${d.label} : ${fcfa(d.cost)}`}>
              <div className="w-full rounded-sm bg-text-secondary/60" style={{ height: `${Math.max(d.cost > 0 ? 4 : 1, (d.cost / stats.max) * 100)}%` }} />
              <span className="text-[10px] text-text-muted tabular-nums">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-ui-sm text-text-muted">Montants débités par le serveur pour chaque réponse, enregistrés sur cet ordinateur.</p>
    </div>
  );
}

function DataSection({ confirm }: { confirm: Confirm }) {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const taskCount = useChatStore((s) => s.conversations.filter((c) => c.messages.length > 0).length);
  useEffect(() => { void storeRoot().then(setRoot); }, []);

  const doExport = async () => {
    setBusy('export');
    try {
      const n = await exportTasks();
      if (n != null) toast.success(`${n} tâche${n > 1 ? 's' : ''} exportée${n > 1 ? 's' : ''}`);
    } catch (e: any) {
      toast.error(`Export impossible — choisis un dossier dans Documents, Bureau ou Téléchargements. (${e?.message || e})`);
    } finally { setBusy(null); }
  };
  const doImport = async () => {
    setBusy('import');
    try {
      const r = await importTasks();
      if (r) toast.success(`${r.added} tâche${r.added > 1 ? 's' : ''} importée${r.added > 1 ? 's' : ''}${r.skipped ? ` · ${r.skipped} déjà présente${r.skipped > 1 ? 's' : ''}` : ''}`);
    } catch (e: any) {
      toast.error(`Import impossible — ${e?.message || e}`);
    } finally { setBusy(null); }
  };
  const clearAll = async () => {
    const ok = await confirm({
      title: 'Supprimer toutes les tâches',
      message: `Supprimer définitivement les ${taskCount} tâches ? Les fichiers de tes projets ne sont pas touchés. Pense à exporter avant.`,
      confirmLabel: 'Tout supprimer',
      variant: 'danger',
    });
    if (ok) { useChatStore.getState().clearAllConversations(); toast.success('Tâches supprimées'); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <Row label="Exporter les tâches" description={`Toutes tes tâches (${taskCount}) et la liste des projets dans un fichier .json : sauvegarde, ou passage sur un autre ordinateur.`}>
          <button onClick={() => void doExport()} disabled={!!busy || taskCount === 0} className={btn}><Download size={14} /> Exporter</button>
        </Row>
        <Row label="Importer des tâches" description="Ajoute les tâches d'une sauvegarde ANZAR. Celles déjà présentes sont ignorées, rien n'est écrasé.">
          <button onClick={() => void doImport()} disabled={!!busy} className={btn}><Upload size={14} /> Importer</button>
        </Row>
        {root && (
          <Row label="Dossier des données" description={<span className="font-mono break-all">{root}</span>}>
            <button
              onClick={() => void navigator.clipboard.writeText(root).then(() => toast.success('Chemin copié'), () => toast.error('Copie impossible'))}
              className={btn}
            >
              <Copy size={14} /> Copier
            </button>
          </Row>
        )}
      </Card>
      <Card>
        <Row label="Supprimer toutes les tâches" description="Les fichiers de tes projets restent intacts.">
          <button onClick={() => void clearAll()} disabled={taskCount === 0} className={btnDanger}><Trash2 size={14} /> Tout supprimer</button>
        </Row>
      </Card>
    </div>
  );
}

function AboutSection() {
  const appVersion = (typeof __APP_VERSION__ === 'string' && __APP_VERSION__) ? __APP_VERSION__ : '—';
  const [st, setSt] = useState<{ checking: boolean; installing: boolean; available: boolean; version?: string; checkedMs?: number; error?: string }>(() => {
    const cached = getCachedUpdateResult();
    return {
      checking: false, installing: false,
      available: !!(cached?.supported && cached.shouldUpdate),
      version: cached?.supported ? cached.manifest?.version : undefined,
      checkedMs: getLastUpdateCheckMs() || undefined,
    };
  });
  const check = async () => {
    setSt((s) => ({ ...s, checking: true, error: undefined }));
    try {
      const res = await checkForUpdates();
      setSt((s) => res.supported
        ? { ...s, checking: false, available: res.shouldUpdate, version: res.manifest?.version, checkedMs: getLastUpdateCheckMs() || Date.now() }
        : { ...s, checking: false, error: 'Non disponible ici.' });
    } catch {
      setSt((s) => ({ ...s, checking: false, error: 'Vérification impossible. Réessaie plus tard.' }));
    }
  };
  const install = async () => {
    setSt((s) => ({ ...s, installing: true, error: undefined }));
    try { await installUpdateAndRelaunch(); } catch { setSt((s) => ({ ...s, installing: false, error: "Installation impossible." })); }
  };
  const status = st.error
    ? st.error
    : st.available
      ? `Version ${st.version || 'nouvelle'} disponible`
      : `À jour${st.checkedMs ? ` · vérifié le ${new Date(st.checkedMs).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`;

  return (
    <div className="space-y-6">
      <Card>
        <Row label="ANZAR" description={<span className="font-mono">Version {appVersion}</span>} />
        <Row label="Mises à jour" description={isTauri() ? status : "Disponible dans l'app installée."}>
          {isTauri() && (
            <div className="flex gap-2">
              <button onClick={() => void check()} disabled={st.checking || st.installing} className={btn}>
                {st.checking ? 'Vérification…' : 'Vérifier'}
              </button>
              {st.available && (
                <button onClick={() => void install()} disabled={st.installing} className={btnPrimary}>
                  {st.installing ? 'Installation…' : 'Installer'}
                </button>
              )}
            </div>
          )}
        </Row>
      </Card>
      <Card>
        <Row label="Support" description="Une question, un problème de recharge ou de facturation.">
          <div className="flex gap-2">
            <button onClick={() => openExternalUrl('mailto:abdul@issalanhub.com')} className={btn}><Mail size={14} /> E-mail</button>
            <button onClick={() => openExternalUrl('https://wa.me/17172161490')} className={btn}><MessageCircle size={14} /> WhatsApp</button>
          </div>
        </Row>
        <Row label="Documentation">
          <button onClick={() => openExternalUrl('https://anzar.dev/docs')} className={btn}><ExternalLink size={14} /> Ouvrir</button>
        </Row>
      </Card>
      <p className="text-center text-ui-sm text-text-muted">© {new Date().getFullYear()} IssalanHub</p>
    </div>
  );
}
