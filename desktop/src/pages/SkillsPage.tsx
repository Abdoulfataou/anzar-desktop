/**
 * Page Skills : fiches d'instructions que l'agent charge selon la tâche.
 * - Personnelles : créées ici, valables pour tous les projets
 * - Projet : fichiers .anzar/skills/<nom>/SKILL.md du dossier ouvert (lecture seule ici)
 */
import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Wand2, Plus, Pencil, Trash2, ChevronRight, FolderOpen, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import { markdownComponents } from '@/components/chat/markdownComponents';
import {
  listSkills, savePersonalSkill, deletePersonalSkill, slugifySkillName, type Skill,
} from '@/services/skills';

const TEMPLATE = `## Quand l'utiliser
Décris les situations où l'agent doit suivre cette fiche.

## Étapes
1. …
2. …

## Vérifications
- …

## À éviter
- …`;

interface Draft { name: string; description: string; body: string; previousName?: string }

export default function SkillsPage() {
  const activeProject = useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const workspacePath = (activeProject?.metadata?.localPath as string | undefined) || null;
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirm, ConfirmDialog } = useConfirmModal();

  const reload = useCallback(async () => {
    setLoading(true);
    setSkills(await listSkills(workspacePath).catch(() => []));
    setLoading(false);
  }, [workspacePath]);
  useEffect(() => { void reload(); }, [reload]);

  const save = async () => {
    if (!draft) return;
    const name = slugifySkillName(draft.name);
    if (!name) { toast.error('Donne un nom à la skill (lettres, chiffres, tirets).'); return; }
    if (!draft.description.trim()) { toast.error("La description sert à l'agent pour choisir la skill : elle est obligatoire."); return; }
    if (!draft.previousName && skills.some((s) => s.source === 'personal' && s.name === name)) {
      toast.error(`Une skill « ${name} » existe déjà.`); return;
    }
    setSaving(true);
    try {
      await savePersonalSkill({ name, description: draft.description, body: draft.body }, draft.previousName);
      toast.success(`Skill « ${name} » enregistrée`);
      setDraft(null);
      setOpen(name);
      await reload();
    } catch (e: any) {
      toast.error(`Enregistrement impossible — ${e?.message || 'erreur disque'}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (skill: Skill) => {
    const ok = await confirm({
      title: 'Supprimer la skill',
      message: `Supprimer « ${skill.name} » ? L'agent ne pourra plus l'utiliser.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    await deletePersonalSkill(skill.name);
    await reload();
  };

  const project = skills.filter((s) => s.source === 'project');
  const personal = skills.filter((s) => s.source === 'personal');

  const renderSkill = (skill: Skill) => {
    const isOpen = open === skill.name;
    return (
      <div key={`${skill.source}:${skill.name}`} className="rounded-xl border border-border-medium bg-surface-default overflow-hidden">
        <div className="group flex items-start gap-3 px-4 py-3">
          <button onClick={() => setOpen(isOpen ? null : skill.name)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
            <ChevronRight size={16} className={cn('mt-0.5 flex-shrink-0 text-text-muted transition-transform', isOpen && 'rotate-90')} />
            <span className="min-w-0">
              <span className="block font-mono text-ui-base text-text-primary">{skill.name}</span>
              <span className="block text-ui-sm text-text-secondary">{skill.description}</span>
            </span>
          </button>
          {skill.source === 'personal' && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setDraft({ name: skill.name, description: skill.description, body: skill.body, previousName: skill.name })}
                className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover-fill"
                title="Modifier"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => void remove(skill)}
                className="p-1.5 rounded-md text-text-muted hover:text-accent-error hover:bg-hover-fill"
                title="Supprimer"
              >
                <Trash2 size={14} />
              </button>
            </span>
          )}
        </div>
        {isOpen && (
          <div className="border-t border-border-medium px-5 py-4 text-ui-base text-text-primary">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents()}>
              {skill.body || '_(fiche vide)_'}
            </ReactMarkdown>
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
          <Wand2 size={22} className="mt-1 text-text-secondary" />
          <div className="flex-1">
            <h1 className="text-ui-xl font-semibold text-text-primary">Skills</h1>
            <p className="text-ui-base text-text-secondary mt-1">
              Des fiches d'instructions que l'agent charge quand la tâche s'y prête : une procédure de déploiement,
              tes conventions de code, l'intégration d'un paiement… Tape aussi <span className="font-mono">/nom-de-la-skill</span> dans la saisie pour l'utiliser directement.
            </p>
          </div>
          {!draft && (
            <button
              onClick={() => setDraft({ name: '', description: '', body: TEMPLATE })}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 flex-shrink-0"
            >
              <Plus size={14} /> Nouvelle skill
            </button>
          )}
        </div>

        {draft && (
          <div className="mt-6 rounded-xl border border-border-medium bg-surface-default p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-ui-lg font-semibold text-text-primary">{draft.previousName ? 'Modifier la skill' : 'Nouvelle skill'}</h2>
              <button onClick={() => setDraft(null)} className="p-1 rounded-md text-text-muted hover:text-text-primary" title="Annuler">
                <X size={16} />
              </button>
            </div>
            <label className="block">
              <span className="text-ui-sm text-text-secondary">Nom (minuscules et tirets)</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onBlur={() => setDraft((d) => d && { ...d, name: slugifySkillName(d.name) })}
                placeholder="deploiement-railway"
                className="mt-1 w-full h-9 px-3 rounded-lg bg-input border border-input-border font-mono text-ui-base text-text-primary outline-none focus:border-input-border-hover"
              />
            </label>
            <label className="block">
              <span className="text-ui-sm text-text-secondary">Description — l'agent la lit pour décider quand utiliser la skill</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Déployer le backend sur Railway : variables, build, vérifications après mise en ligne"
                className="mt-1 w-full h-9 px-3 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none focus:border-input-border-hover"
              />
            </label>
            <label className="block">
              <span className="text-ui-sm text-text-secondary">Instructions (Markdown)</span>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={14}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-input-border font-mono text-ui-caption leading-relaxed text-text-primary outline-none focus:border-input-border-hover resize-y"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="h-8 px-3 rounded-lg text-ui-base text-text-secondary hover:bg-hover-fill">Annuler</button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="h-8 px-3 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}

        <section className="mt-8">
          <h2 className="text-ui-base font-semibold text-text-primary mb-1">Personnelles</h2>
          <p className="text-ui-sm text-text-muted mb-3">Disponibles dans tous tes projets.</p>
          {loading ? (
            <p className="text-ui-sm text-text-muted">Chargement…</p>
          ) : personal.length ? (
            <div className="space-y-2">{personal.map(renderSkill)}</div>
          ) : (
            <p className="text-ui-sm text-text-muted">Aucune skill personnelle pour l'instant.</p>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-ui-base font-semibold text-text-primary mb-1">
            Projet {activeProject ? <span className="font-normal text-text-secondary">— {activeProject.name}</span> : null}
          </h2>
          <p className="text-ui-sm text-text-muted mb-3">
            Fichiers <span className="font-mono">.anzar/skills/&lt;nom&gt;/SKILL.md</span> du projet : ils voyagent avec le dépôt git et remplacent une skill personnelle du même nom.
          </p>
          {!workspacePath ? (
            <p className="flex items-center gap-2 text-ui-sm text-text-muted"><FolderOpen size={14} /> Ouvre un projet pour voir ses skills.</p>
          ) : loading ? (
            <p className="text-ui-sm text-text-muted">Chargement…</p>
          ) : project.length ? (
            <div className="space-y-2">{project.map(renderSkill)}</div>
          ) : (
            <p className="text-ui-sm text-text-muted">Aucune skill dans ce projet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
