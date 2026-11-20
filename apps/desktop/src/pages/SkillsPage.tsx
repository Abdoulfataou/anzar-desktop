/**
 * Page Skills : fiches d'instructions que l'agent charge selon la tâche (standard Agent Skills).
 * - Intégrées : le pack fourni avec ANZAR (personnalisables : une copie personnelle les remplace)
 * - Personnelles : créées ici ou installées depuis GitHub, valables pour tous les projets
 *   (+ celles de ~/.agents/skills et ~/.dsh/skills, partagées avec les autres outils)
 * - Projet : .anzar/skills, .agents/skills, .dsh/skills ou .claude/skills du dossier ouvert
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Wand2, Plus, Pencil, Trash2, ChevronRight, FolderOpen, X, Github, Search, ShieldAlert, AlertTriangle,
  FileText, FileCode, Download, Loader2, Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import { markdownComponents } from '@/components/chat/markdownComponents';
import {
  listSkills, savePersonalSkill, deletePersonalSkill, slugifySkillName, type Skill,
} from '@/services/skills';
import {
  parseGitHubInput, scanRepo, previewSkill, installSkill, SUGGESTED_REPOS,
  type RepoScan, type SkillPreview,
} from '@/services/skills/installer';

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

const btn = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base font-medium';
const btnPrimary = `${btn} bg-primary-btn text-primary-btn-fg hover:opacity-90 disabled:opacity-50`;
const btnGhost = `${btn} text-text-secondary hover:bg-hover-fill disabled:opacity-50`;
const iconBtn = 'p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover-fill';

export default function SkillsPage() {
  const activeProject = useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const workspacePath = (activeProject?.metadata?.localPath as string | undefined) || null;
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
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
    if (draft.previousName !== name && skills.some((s) => s.editable && s.name === name)) {
      toast.error(`Une skill « ${name} » existe déjà.`); return;
    }
    setSaving(true);
    try {
      await savePersonalSkill({ name, description: draft.description, body: draft.body }, draft.previousName);
      toast.success(`Skill « ${name} » enregistrée`);
      setDraft(null);
      setOpen(`personal:${name}`);
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

  const builtin = skills.filter((s) => s.source === 'builtin');
  const personal = skills.filter((s) => s.source === 'personal');
  const project = skills.filter((s) => s.source === 'project');

  const renderSkill = (skill: Skill) => {
    const key = `${skill.source}:${skill.name}`;
    const isOpen = open === key;
    return (
      <div key={key} className="rounded-xl border border-border-medium bg-surface-default overflow-hidden">
        <div className="group flex items-start gap-3 px-4 py-3">
          <button onClick={() => setOpen(isOpen ? null : key)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
            <ChevronRight size={16} className={cn('mt-0.5 flex-shrink-0 text-text-muted transition-transform', isOpen && 'rotate-90')} />
            <span className="min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-ui-base text-text-primary">{skill.name}</span>
                {skill.source !== 'builtin' && skill.origin !== 'ANZAR' && (
                  <span className="text-ui-caption font-mono px-1.5 rounded bg-hover-fill text-text-muted">{skill.origin}</span>
                )}
                {skill.files.length > 0 && (
                  <span className="text-ui-caption text-text-muted">+ {skill.files.length} fichier{skill.files.length > 1 ? 's' : ''}</span>
                )}
              </span>
              <span className="block text-ui-sm text-text-secondary line-clamp-2">{skill.description}</span>
            </span>
          </button>
          <span className="flex items-center gap-1 flex-shrink-0">
            {skill.source === 'builtin' && (
              <button onClick={() => setDraft({ name: skill.name, description: skill.description, body: skill.body })}
                className={iconBtn} title="Personnaliser (ta copie remplacera celle d'ANZAR)">
                <Copy size={14} />
              </button>
            )}
            {skill.editable && (
              <>
                <button onClick={() => setDraft({ name: skill.name, description: skill.description, body: skill.body, previousName: skill.name })}
                  className={iconBtn} title="Modifier">
                  <Pencil size={14} />
                </button>
                <button onClick={() => void remove(skill)} className={cn(iconBtn, 'hover:text-accent-error')} title="Supprimer">
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </span>
        </div>
        {isOpen && (
          <div className="border-t border-border-medium px-5 py-4 text-ui-base text-text-primary">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents()}>
              {skill.body || '_(fiche vide)_'}
            </ReactMarkdown>
            {skill.files.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border-subtle">
                <p className="text-ui-sm text-text-secondary mb-1">Fichiers joints, lus par l'agent à la demande :</p>
                <ul className="text-ui-sm font-mono text-text-muted space-y-0.5">
                  {skill.files.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>
            )}
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
              Des fiches d'instructions que l'agent charge quand la tâche s'y prête. Format standard Agent Skills :
              celles écrites pour Claude Code, Codex ou DeepSeek Harness marchent ici. Tape aussi <span className="font-mono">/nom-de-la-skill</span> dans la saisie.
            </p>
          </div>
          {!draft && !installing && (
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setInstalling(true)} className={btnGhost}><Github size={14} /> Depuis GitHub</button>
              <button onClick={() => setDraft({ name: '', description: '', body: TEMPLATE })} className={btnPrimary}><Plus size={14} /> Nouvelle</button>
            </div>
          )}
        </div>

        {installing && (
          <GitHubInstaller
            workspacePath={workspacePath}
            projectName={activeProject?.name}
            onClose={() => setInstalling(false)}
            onInstalled={async () => { await reload(); }}
          />
        )}

        {draft && (
          <div className="mt-6 rounded-xl border border-border-medium bg-surface-default p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-ui-lg font-semibold text-text-primary">{draft.previousName ? 'Modifier la skill' : 'Nouvelle skill'}</h2>
              <button onClick={() => setDraft(null)} className="p-1 rounded-md text-text-muted hover:text-text-primary" title="Annuler"><X size={16} /></button>
            </div>
            <label className="block">
              <span className="text-ui-sm text-text-secondary">Nom (minuscules et tirets)</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onBlur={() => setDraft((d) => d && { ...d, name: slugifySkillName(d.name) })}
                placeholder="deploiement-api"
                className="mt-1 w-full h-9 px-3 rounded-lg bg-input border border-input-border font-mono text-ui-base text-text-primary outline-none focus:border-input-border-hover"
              />
            </label>
            <label className="block">
              <span className="text-ui-sm text-text-secondary">Description — l'agent la lit pour décider quand utiliser la skill</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Déployer l'API sur le VPS : build, migration, vérification de santé"
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
              <button onClick={() => setDraft(null)} className={btnGhost}>Annuler</button>
              <button onClick={() => void save()} disabled={saving} className={btnPrimary}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </div>
        )}

        <Section title="Personnelles" hint={<>Disponibles dans tous tes projets. ANZAR lit aussi <span className="font-mono">~/.agents/skills</span> et <span className="font-mono">~/.dsh/skills</span>.</>}
          loading={loading} items={personal} render={renderSkill} empty="Aucune skill personnelle pour l'instant." />

        <section className="mt-8">
          <h2 className="text-ui-base font-semibold text-text-primary mb-1">
            Projet {activeProject ? <span className="font-normal text-text-secondary">— {activeProject.name}</span> : null}
          </h2>
          <p className="text-ui-sm text-text-muted mb-3">
            Dossiers <span className="font-mono">.anzar/skills</span>, <span className="font-mono">.agents/skills</span>, <span className="font-mono">.dsh/skills</span> ou <span className="font-mono">.claude/skills</span> du projet :
            ils voyagent avec le dépôt git et remplacent une skill personnelle du même nom.
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

        <Section title="Fournies avec ANZAR" hint="Une méthode de travail éprouvée, en français. Personnalise-en une pour la remplacer par ta version."
          loading={loading} items={builtin} render={renderSkill} empty="" />
      </div>
    </div>
  );
}

function Section({ title, hint, loading, items, render, empty }: {
  title: string; hint: ReactNode; loading: boolean; items: Skill[]; render: (s: Skill) => ReactNode; empty: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-ui-base font-semibold text-text-primary mb-1">{title}</h2>
      <p className="text-ui-sm text-text-muted mb-3">{hint}</p>
      {loading ? <p className="text-ui-sm text-text-muted">Chargement…</p>
        : items.length ? <div className="space-y-2">{items.map(render)}</div>
        : empty ? <p className="text-ui-sm text-text-muted">{empty}</p> : null}
    </section>
  );
}

// ============================================================================
// INSTALLATION DEPUIS GITHUB
// ============================================================================

function GitHubInstaller({ workspacePath, projectName, onClose, onInstalled }: {
  workspacePath: string | null; projectName?: string; onClose: () => void; onInstalled: () => Promise<void>;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<RepoScan | null>(null);
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async <T,>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(label);
    setError(null);
    try {
      return await fn(ctrl.signal);
    } catch (e: any) {
      if (!ctrl.signal.aborted) setError(e?.message || String(e));
      return null;
    } finally {
      if (abortRef.current === ctrl) setBusy(null);
    }
  };

  const search = async (value = input) => {
    const target = parseGitHubInput(value);
    if (!target) { setError('Adresse non reconnue. Exemple : obra/superpowers ou https://github.com/owner/repo/tree/main/skills/ma-skill'); return; }
    setScan(null);
    setPreview(null);
    const result = await run('Recherche des skills…', (signal) => scanRepo(target, signal));
    if (!result) return;
    if (!result.candidates.length) { setError('Aucun fichier SKILL.md dans ce dépôt ou ce dossier.'); return; }
    setScan(result);
    if (result.candidates.length === 1) void review(result, 0);
  };

  const review = async (s: RepoScan, index: number) => {
    const p = await run('Téléchargement pour la revue…', (signal) => previewSkill(s, s.candidates[index], signal));
    if (p) setPreview(p);
  };

  const install = async (scope: 'personal' | 'project') => {
    if (!preview) return;
    const where = scope === 'project' && workspacePath ? { scope: 'project' as const, workspacePath } : { scope: 'personal' as const };
    const ok = await run('Installation…', async () => { await installSkill(preview, where); return true; });
    if (!ok) return;
    toast.success(`Skill « ${preview.name} » installée ${scope === 'project' ? 'dans le projet' : 'pour tous tes projets'}`);
    setPreview(null);
    await onInstalled();
  };

  const dangers = preview?.warnings.filter((w) => w.level === 'danger') ?? [];

  return (
    <div className="mt-6 rounded-xl border border-border-medium bg-surface-default p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-ui-lg font-semibold text-text-primary flex items-center gap-2"><Github size={16} /> Installer depuis GitHub</h2>
        <button onClick={onClose} className="p-1 rounded-md text-text-muted hover:text-text-primary" title="Fermer"><X size={16} /></button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void search(); }} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="owner/repo, ou lien vers un dossier de skill"
          className="flex-1 h-9 px-3 rounded-lg bg-input border border-input-border font-mono text-ui-sm text-text-primary outline-none focus:border-input-border-hover"
        />
        <button type="submit" disabled={!!busy || !input.trim()} className={btnPrimary}><Search size={14} /> Chercher</button>
      </form>

      {!scan && !preview && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_REPOS.map((r) => (
            <button key={r.repo} onClick={() => { setInput(r.repo); void search(r.repo); }} title={r.note}
              className="text-left rounded-lg border border-border-medium px-3 py-2 hover:bg-hover-fill max-w-[320px]">
              <span className="block text-ui-sm font-medium text-text-primary">{r.label} <span className="font-mono font-normal text-text-muted">{r.repo}</span></span>
              <span className="block text-ui-caption text-text-muted">{r.note}</span>
            </button>
          ))}
        </div>
      )}

      {busy && <p className="flex items-center gap-2 text-ui-sm text-text-secondary"><Loader2 size={14} className="animate-spin" /> {busy}</p>}
      {error && <p className="flex items-start gap-2 text-ui-sm text-accent-error"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}</p>}

      {scan && !preview && (
        <div>
          <p className="text-ui-sm text-text-secondary mb-2">
            {scan.candidates.length} skill{scan.candidates.length > 1 ? 's' : ''} dans <span className="font-mono">{scan.target.owner}/{scan.target.repo}</span>
            {scan.license ? <> · licence <b>{scan.license}</b></> : <> · <span className="text-accent-warning">licence non indiquée</span></>}
            {' '}· ★ {scan.stars.toLocaleString('fr-FR')}
          </p>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border-subtle divide-y divide-border-subtle">
            {scan.candidates.map((c, i) => (
              <button key={c.dir || c.name} onClick={() => void review(scan, i)} disabled={!!busy}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-hover-fill disabled:opacity-50">
                <span className="min-w-0">
                  <span className="block font-mono text-ui-sm text-text-primary">{c.name}</span>
                  <span className="block font-mono text-ui-caption text-text-muted truncate">{c.dir || '(racine)'}</span>
                </span>
                <span className="text-ui-caption text-text-secondary flex-shrink-0">Examiner →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-ui-base text-text-primary">{preview.name}</p>
              <p className="text-ui-sm text-text-secondary">{preview.description}</p>
              <p className="text-ui-caption text-text-muted mt-1">
                <span className="font-mono">{preview.source.owner}/{preview.source.repo}</span>
                {preview.source.dir && <span className="font-mono"> · {preview.source.dir}</span>}
                {' '}· licence {preview.license ? <b>{preview.license}</b> : <span className="text-accent-warning">non indiquée</span>}
              </p>
            </div>
            {scan && scan.candidates.length > 1 && (
              <button onClick={() => setPreview(null)} className={btnGhost}>← Liste</button>
            )}
          </div>

          <div className={cn('rounded-lg border px-3 py-2 text-ui-sm',
            dangers.length ? 'border-accent-error/50 bg-accent-error/10' : 'border-border-medium bg-hover-fill/40')}>
            <p className="flex items-center gap-2 font-medium text-text-primary mb-1">
              <ShieldAlert size={14} className={dangers.length ? 'text-accent-error' : 'text-text-secondary'} />
              {dangers.length ? 'Points dangereux détectés : lis la skill avant de l\'installer' : 'Revue avant installation'}
            </p>
            <ul className="space-y-0.5 text-text-secondary">
              {preview.warnings.map((w) => (
                <li key={w.text} className={w.level === 'danger' ? 'text-accent-error' : ''}>• {w.text}</li>
              ))}
              <li>• Une skill donne des instructions à l'agent : installe seulement celles dont tu fais confiance à l'auteur.</li>
            </ul>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-lg border border-border-subtle px-4 py-3 text-ui-base text-text-primary">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents()}>{preview.body}</ReactMarkdown>
          </div>

          {preview.files.length > 0 && (
            <details className="rounded-lg border border-border-subtle">
              <summary className="cursor-pointer px-3 py-2 text-ui-sm text-text-secondary">{preview.files.length} fichier(s) joint(s)</summary>
              <ul className="px-3 pb-2 space-y-1">
                {preview.files.map((f) => (
                  <li key={f.path}>
                    <details>
                      <summary className={cn('cursor-pointer flex items-center gap-2 font-mono text-ui-caption', f.script ? 'text-accent-warning' : 'text-text-muted')}>
                        {f.script ? <FileCode size={12} /> : <FileText size={12} />}
                        {f.path} <span className="text-text-muted">({(f.size / 1024).toFixed(1)} Ko{f.content === undefined ? ', ignoré' : ''})</span>
                      </summary>
                      {f.content !== undefined && (
                        <pre className="mt-1 max-h-60 overflow-auto rounded bg-input p-2 text-ui-caption text-text-secondary whitespace-pre-wrap">{f.content.slice(0, 20_000)}</pre>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={() => setPreview(null)} className={btnGhost}>Annuler</button>
            {workspacePath && (
              <button onClick={() => void install('project')} disabled={!!busy} className={btnGhost}>
                <Download size={14} /> Dans le projet{projectName ? ` ${projectName}` : ''}
              </button>
            )}
            <button onClick={() => void install('personal')} disabled={!!busy} className={btnPrimary}>
              <Download size={14} /> Pour tous mes projets
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
