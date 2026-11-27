/**
 * Page Agents : les spécialistes auxquels l'agent principal confie une partie du travail.
 * - Fournis avec ANZAR : dev, revue, redaction, motion-designer (personnalisables : une copie
 *   personnelle du même nom les remplace)
 * - Personnels : créés ici, valables pour tous les projets (+ ~/.claude/agents)
 * - Projet : .anzar/agents ou .claude/agents du dossier ouvert (voyagent avec le dépôt git)
 * Format : un fichier Markdown par agent, compatible avec les sous-agents de Claude Code.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Plus, Pencil, Trash2, ChevronRight, FolderOpen, X, Copy, AlertTriangle, FileWarning } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import { markdownComponents } from '@/components/chat/markdownComponents';
import { AGENT_PROFILES, type AgentProfile } from '@/services/agent/profiles';
import {
  scanCustomAgents, savePersonalAgent, deletePersonalAgent, type AgentDraft, type CustomAgent, type IgnoredAgentFile,
} from '@/services/agent/profiles/custom';
import { listSkills, slugifySkillName, type Skill } from '@/services/skills';

const TEMPLATE = `Tu es un expert de … Tu interviens sur …

- Avant d'écrire, lis comment le projet fait déjà la même chose et fais pareil.
- Règles propres à ce domaine : …
- Vérifie ton travail avec … (tests, build, capture).
- À éviter : …`;

const MODELS: { value: string; label: string }[] = [
  { value: '', label: 'Par défaut (rapide)' },
  { value: 'fast', label: 'Rapide' },
  { value: 'thinking', label: 'Réflexion' },
  { value: 'pro', label: 'Pro (plus cher)' },
];

interface FormState {
  name: string;
  description: string;
  prompt: string;
  model: string;
  skills: string[];
  maxSteps: number;
  canWrite: boolean;
  canRun: boolean;
  keywords: string;
  /** Réglages du fichier sans champ dans le formulaire : gardés tels quels à l'enregistrement. */
  tools: string[];
  extraDeny: string[];
  reasoning?: string;
  budgetFCFA?: number;
  outputMaxChars?: number;
  previousName?: string;
}

const btn = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base font-medium';
const btnPrimary = `${btn} bg-primary-btn text-primary-btn-fg hover:opacity-90 disabled:opacity-50`;
const btnGhost = `${btn} text-text-secondary hover:bg-hover-fill disabled:opacity-50`;
const iconBtn = 'p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover-fill';
const input = 'mt-1 w-full h-9 px-3 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none focus:border-input-border-hover';

function formFrom(p: AgentProfile, editing: boolean): FormState {
  return {
    name: p.name,
    description: p.description,
    prompt: p.prompt,
    model: p.model ?? '',
    skills: [...p.skills],
    maxSteps: p.maxSteps,
    canWrite: !p.deny.includes('fs.write'),
    canRun: !p.deny.includes('shell.exec'),
    keywords: p.keywords.join(' '),
    tools: [...p.tools],
    extraDeny: p.deny.filter((d) => d !== 'fs.write' && d !== 'shell.exec'),
    reasoning: p.reasoningEffort,
    budgetFCFA: p.budgetFCFA,
    outputMaxChars: p.outputMaxChars,
    previousName: editing ? p.name : undefined,
  };
}

const EMPTY: FormState = {
  name: '', description: '', prompt: TEMPLATE, model: '', skills: [], maxSteps: 25,
  canWrite: true, canRun: true, keywords: '', tools: [], extraDeny: [],
};

/** Ce que l'agent peut faire, en une ligne lisible. */
function capabilities(p: AgentProfile): string {
  const parts = [
    p.deny.includes('fs.write') ? 'lecture seule' : 'modifie les fichiers',
    p.deny.includes('shell.exec') ? 'sans commandes' : 'lance des commandes',
    p.model ? `modèle ${p.model}` : '',
    `${p.maxSteps} étapes max`,
  ].filter(Boolean);
  return parts.join(' · ');
}

export default function AgentsPage() {
  const activeProject = useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const workspacePath = (activeProject?.metadata?.localPath as string | undefined) || null;
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [ignored, setIgnored] = useState<IgnoredAgentFile[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirm, ConfirmDialog } = useConfirmModal();

  const reload = useCallback(async () => {
    setLoading(true);
    const [scan, s] = await Promise.all([
      scanCustomAgents(workspacePath).catch(() => ({ agents: [], ignored: [] })),
      listSkills(workspacePath).catch(() => []),
    ]);
    setAgents(scan.agents);
    setIgnored(scan.ignored);
    setSkills(s);
    setLoading(false);
  }, [workspacePath]);
  useEffect(() => { void reload(); }, [reload]);

  const builtin = useMemo(() => Object.values(AGENT_PROFILES).filter((p) => p.kind === 'subagent'), []);
  const personal = agents.filter((a) => a.source === 'personal');
  const project = agents.filter((a) => a.source === 'project');
  const overridden = new Set(agents.map((a) => a.name));

  const save = async () => {
    if (!form) return;
    const name = slugifySkillName(form.name);
    if (!name || name.length < 2) { toast.error("Donne un nom à l'agent (lettres, chiffres, tirets)."); return; }
    if (name === 'explorer' || name === 'lead') { toast.error(`« ${name} » est réservé par ANZAR : choisis un autre nom.`); return; }
    if (!form.description.trim()) { toast.error("La description sert à l'agent principal pour choisir ce spécialiste : elle est obligatoire."); return; }
    if (!form.prompt.trim()) { toast.error('Écris les consignes de l’agent.'); return; }
    if (form.previousName !== name && personal.some((a) => a.editable && a.name === name)) {
      toast.error(`Un agent « ${name} » existe déjà.`); return;
    }
    const draft: AgentDraft = {
      name,
      description: form.description,
      prompt: form.prompt,
      tools: form.tools,
      model: form.model || undefined,
      skills: form.skills,
      maxSteps: form.maxSteps,
      deny: [...(form.canWrite ? [] : ['fs.write']), ...(form.canRun ? [] : ['shell.exec']), ...form.extraDeny],
      reasoning: form.reasoning,
      budgetFCFA: form.budgetFCFA,
      outputMaxChars: form.outputMaxChars,
      keywords: form.keywords.split(/[\s,]+/).map((k) => k.trim().toLowerCase()).filter(Boolean),
    };
    setSaving(true);
    try {
      await savePersonalAgent(draft, form.previousName);
      toast.success(`Agent « ${name} » enregistré`);
      setForm(null);
      setOpen(`personal:${name}`);
      await reload();
    } catch (e: any) {
      toast.error(`Enregistrement impossible — ${e?.message || 'erreur disque'}`);
    } finally {
      setSaving(false);
    }
  };

  const removeIgnored = async (file: IgnoredAgentFile) => {
    const ok = await confirm({
      title: 'Supprimer le fichier',
      message: `Supprimer le fichier d'agent « ${file.name} » ? Il est inutilisable en l'état.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    await deletePersonalAgent(file.name);
    await reload();
  };

  const remove = async (agent: CustomAgent) => {
    const ok = await confirm({
      title: "Supprimer l'agent",
      message: `Supprimer « ${agent.name} » ? L'agent principal ne pourra plus lui confier de travail.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    await deletePersonalAgent(agent.name);
    await reload();
  };

  const renderAgent = (p: AgentProfile, key: string, extra?: { custom?: CustomAgent; replaced?: boolean }) => {
    const isOpen = open === key;
    const custom = extra?.custom;
    return (
      <div key={key} className={cn('rounded-xl border border-border-medium bg-surface-default overflow-hidden', extra?.replaced && 'opacity-60')}>
        <div className="group flex items-start gap-3 px-4 py-3">
          <button onClick={() => setOpen(isOpen ? null : key)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
            <ChevronRight size={16} className={cn('mt-0.5 flex-shrink-0 text-text-muted transition-transform', isOpen && 'rotate-90')} />
            <span className="min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-ui-base text-text-primary">{p.name}</span>
                {custom && custom.origin !== 'ANZAR' && (
                  <span className="text-ui-caption font-mono px-1.5 rounded bg-hover-fill text-text-muted">{custom.origin}</span>
                )}
                {custom?.overridesBuiltin && <span className="text-ui-caption text-text-muted">remplace le rôle intégré</span>}
                {extra?.replaced && <span className="text-ui-caption text-text-muted">remplacé par ta version</span>}
                {custom && custom.warnings.length > 0 && (
                  <span title={custom.warnings.join('\n')} className="flex items-center gap-1 text-ui-caption text-accent-warning">
                    <AlertTriangle size={12} /> à vérifier
                  </span>
                )}
              </span>
              <span className="block text-ui-sm text-text-secondary line-clamp-2">{p.description}</span>
              <span className="block text-ui-caption text-text-muted mt-0.5">{capabilities(p)}{p.skills.length ? ` · skills : ${p.skills.join(', ')}` : ''}</span>
            </span>
          </button>
          <span className="flex items-center gap-1 flex-shrink-0">
            {!custom?.editable && (
              <button onClick={() => setForm(formFrom(p, false))} className={iconBtn}
                title={custom ? 'Copier dans mes agents pour le modifier' : "Personnaliser (ta copie remplacera celle d'ANZAR)"}>
                <Copy size={14} />
              </button>
            )}
            {custom?.editable && (
              <>
                <button onClick={() => setForm(formFrom(custom, true))} className={iconBtn} title="Modifier"><Pencil size={14} /></button>
                <button onClick={() => void remove(custom)} className={cn(iconBtn, 'hover:text-accent-error')} title="Supprimer"><Trash2 size={14} /></button>
              </>
            )}
          </span>
        </div>
        {isOpen && (
          <div className="border-t border-border-medium px-5 py-4 text-ui-base text-text-primary space-y-3">
            {custom && custom.warnings.length > 0 && (
              <ul className="text-ui-sm text-accent-warning space-y-0.5">
                {custom.warnings.map((w) => <li key={w}>• {w}</li>)}
              </ul>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents()}>
              {p.prompt || '_(aucune consigne en plus des règles communes des sous-agents)_'}
            </ReactMarkdown>
            {custom && <p className="text-ui-caption font-mono text-text-muted break-all">{custom.path}</p>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      {ConfirmDialog}
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-start gap-3 mb-2">
          <Bot size={22} className="mt-1 text-text-secondary" />
          <div className="flex-1">
            <h1 className="text-ui-xl font-semibold text-text-primary">Agents</h1>
            <p className="text-ui-base text-text-secondary mt-1">
              Les spécialistes auxquels l'agent principal confie une partie du travail, en parallèle. Crée les tiens
              (expert Flutter, testeur, spécialiste paiement…) : il les choisira d'après leur description.
              Ils n'ont jamais plus de droits que le mode que tu as choisi.
            </p>
          </div>
          {!form && (
            <button onClick={() => setForm({ ...EMPTY })} className={cn(btnPrimary, 'flex-shrink-0')}><Plus size={14} /> Nouvel agent</button>
          )}
        </div>

        {form && (
          <AgentForm form={form} setForm={setForm} skills={skills} saving={saving} onSave={() => void save()} onCancel={() => setForm(null)} />
        )}

        {!loading && ignored.length > 0 && (
          <IgnoredFiles files={ignored} onDelete={(f) => void removeIgnored(f)} />
        )}

        <Section title="Mes agents" hint={<>Disponibles dans tous tes projets. ANZAR lit aussi <span className="font-mono">~/.claude/agents</span> (format Claude Code).</>}>
          {loading ? <Muted>Chargement…</Muted>
            : personal.length ? personal.map((a) => renderAgent(a, `personal:${a.name}`, { custom: a }))
            : <Muted>Aucun agent personnel pour l'instant.</Muted>}
        </Section>

        <Section
          title={<>Projet {activeProject ? <span className="font-normal text-text-secondary">— {activeProject.name}</span> : null}</>}
          hint={<>Dossiers <span className="font-mono">.anzar/agents</span> ou <span className="font-mono">.claude/agents</span> du projet : ils voyagent avec le dépôt git et remplacent un agent personnel du même nom.</>}
        >
          {!workspacePath ? <p className="flex items-center gap-2 text-ui-sm text-text-muted"><FolderOpen size={14} /> Ouvre un projet pour voir ses agents.</p>
            : loading ? <Muted>Chargement…</Muted>
            : project.length ? project.map((a) => renderAgent(a, `project:${a.name}`, { custom: a }))
            : <Muted>Aucun agent dans ce projet.</Muted>}
        </Section>

        <Section title="Fournis avec ANZAR" hint="Les rôles de base. Personnalise-en un pour le remplacer par ta version.">
          {builtin.map((p) => renderAgent(p, `builtin:${p.name}`, { replaced: overridden.has(p.name) }))}
        </Section>
      </div>
    </div>
  );
}

function AgentForm({ form, setForm, skills, saving, onSave, onCancel }: {
  form: FormState;
  setForm: (f: FormState | null) => void;
  skills: Skill[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const toggleSkill = (name: string) =>
    set({ skills: form.skills.includes(name) ? form.skills.filter((s) => s !== name) : [...form.skills, name] });
  return (
    <div className="mt-6 rounded-xl border border-border-medium bg-surface-default p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-ui-lg font-semibold text-text-primary">{form.previousName ? "Modifier l'agent" : 'Nouvel agent'}</h2>
        <button onClick={onCancel} className="p-1 rounded-md text-text-muted hover:text-text-primary" title="Annuler"><X size={16} /></button>
      </div>
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Nom (minuscules et tirets)</span>
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} onBlur={() => set({ name: slugifySkillName(form.name) })}
          placeholder="expert-flutter" className={cn(input, 'font-mono')} />
      </label>
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Description — l'agent principal la lit pour décider quand lui confier une tâche</span>
        <input value={form.description} onChange={(e) => set({ description: e.target.value })}
          placeholder="Expert Flutter : écrans, état (Riverpod), navigation et tests de widgets" className={input} />
      </label>
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Consignes (Markdown) — s'ajoutent aux règles communes des sous-agents (rapport, périmètre, vérification)</span>
        <textarea value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={10}
          className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-input-border font-mono text-ui-caption leading-relaxed text-text-primary outline-none focus:border-input-border-hover resize-y" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-ui-sm text-text-secondary">Modèle</span>
          <select value={form.model} onChange={(e) => set({ model: e.target.value })} className={input}>
            {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-ui-sm text-text-secondary">Étapes au plus (1 à 60)</span>
          <input type="number" min={1} max={60} value={form.maxSteps}
            onChange={(e) => set({ maxSteps: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} className={input} />
        </label>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-ui-sm text-text-primary">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.canWrite} onChange={(e) => set({ canWrite: e.target.checked })} /> Peut modifier les fichiers</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.canRun} onChange={(e) => set({ canRun: e.target.checked })} /> Peut lancer des commandes</label>
      </div>
      {form.tools.length > 0 && (
        <p className="text-ui-caption text-text-muted">Outils limités par le fichier : <span className="font-mono">{form.tools.join(', ')}</span></p>
      )}

      {skills.length > 0 && (
        <div>
          <span className="text-ui-sm text-text-secondary">Skills appliquées d'office (les autres restent disponibles à la demande)</span>
          <div className="mt-1 flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {skills.map((s) => (
              <button key={s.name} type="button" onClick={() => toggleSkill(s.name)} title={s.description}
                className={cn('px-2 h-7 rounded-md border text-ui-caption font-mono',
                  form.skills.includes(s.name) ? 'border-primary-btn bg-primary-btn/10 text-text-primary' : 'border-border-medium text-text-muted hover:bg-hover-fill')}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="block">
        <span className="text-ui-sm text-text-secondary">Mots-clés (facultatif) — aident à choisir cet agent quand le rôle n'est pas précisé</span>
        <input value={form.keywords} onChange={(e) => set({ keywords: e.target.value })} placeholder="flutter dart widget riverpod" className={cn(input, 'font-mono')} />
      </label>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className={btnGhost}>Annuler</button>
        <button onClick={onSave} disabled={saving} className={btnPrimary}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </div>
  );
}

/** Fichiers d'agents écartés : la raison en clair, pour que l'utilisateur puisse corriger. */
function IgnoredFiles({ files, onDelete }: { files: IgnoredAgentFile[]; onDelete: (f: IgnoredAgentFile) => void }) {
  const invalid = files.filter((f) => f.kind === 'invalid');
  return (
    <section className={cn('mt-6 rounded-xl border px-4 py-3',
      invalid.length ? 'border-accent-error/50 bg-accent-error/10' : 'border-border-medium bg-hover-fill/40')}>
      <h2 className="flex items-center gap-2 text-ui-base font-semibold text-text-primary">
        <FileWarning size={16} className={invalid.length ? 'text-accent-error' : 'text-text-secondary'} />
        {invalid.length
          ? `${invalid.length} fichier${invalid.length > 1 ? 's' : ''} d'agent ignoré${invalid.length > 1 ? 's' : ''}`
          : 'Agents masqués par un autre du même nom'}
      </h2>
      <p className="text-ui-sm text-text-secondary mt-0.5 mb-2">
        L'agent principal ne les voit pas. Corrige le fichier : il sera pris en compte au prochain message.
      </p>
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={`${f.path}:${f.kind}`} className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-ui-sm text-text-primary">{f.name}</span>
                <span className="text-ui-caption font-mono px-1.5 rounded bg-hover-fill text-text-muted">{f.origin}</span>
                {f.kind === 'shadowed' && <span className="text-ui-caption text-text-muted">masqué</span>}
              </span>
              <span className={cn('block text-ui-sm', f.kind === 'invalid' ? 'text-accent-error' : 'text-text-secondary')}>{f.reason}</span>
              <span className="block text-ui-caption font-mono text-text-muted break-all">{f.path}</span>
            </span>
            {f.editable && f.kind === 'invalid' && (
              <button onClick={() => onDelete(f)} className={cn(iconBtn, 'hover:text-accent-error')} title="Supprimer le fichier"><Trash2 size={14} /></button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Section({ title, hint, children }: { title: ReactNode; hint: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-ui-base font-semibold text-text-primary mb-1">{title}</h2>
      <p className="text-ui-sm text-text-muted mb-3">{hint}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-ui-sm text-text-muted">{children}</p>;
}
