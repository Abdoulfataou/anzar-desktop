/**
 * Page Tickets (super-agent) : des tâches confiées à des exécutants qui travaillent seuls,
 * chacun dans une copie isolée du projet, avec un budget. Le résultat attend ta validation.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ticket as TicketIcon, Plus, X, Play, Pause, Square, Trash2, GitMerge, RotateCw, Loader2, CheckCircle2, AlertCircle,
  Clock, Wand2, MessageSquare, FileDiff, Ban, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import {
  useTicketStore, DEFAULT_BUDGET_FCFA, DEFAULT_MAX_MINUTES, inWorkWindow,
  type Ticket, type TicketPriority, type TicketStatus,
} from '@/stores/ticketStore';
import { splitIntoTickets, type ProposedTicket } from '@/services/superagent/router';
import { cleanupMerged, discardTicket, mergeTicket, ticketDiff } from '@/services/superagent/ticketGit';
import { buildAgentContext } from '@/services/agent/agentContext';
import type { AIModel } from '@/types';
import { TICKET_TEMPLATES } from '@/services/workspace/templates';

const btn = 'flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base font-medium disabled:opacity-50';
const btnPrimary = `${btn} bg-primary-btn text-primary-btn-fg hover:opacity-90`;
const btnGhost = `${btn} text-text-secondary hover:bg-hover-fill`;
const input = 'mt-1 w-full h-9 px-3 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none focus:border-input-border-hover';

const STATUS: Record<TicketStatus, { label: string; tone: string }> = {
  draft: { label: 'Brouillon', tone: 'text-text-muted' },
  queued: { label: 'En file', tone: 'text-text-secondary' },
  running: { label: 'En cours', tone: 'text-accent-warning' },
  review: { label: 'À valider', tone: 'text-accent-success' },
  merged: { label: 'Fusionné', tone: 'text-text-muted' },
  done: { label: 'Terminé', tone: 'text-text-muted' },
  failed: { label: 'Échec', tone: 'text-accent-error' },
  cancelled: { label: 'Annulé', tone: 'text-text-muted' },
};
const PRIORITY: Record<TicketPriority, string> = { high: 'Haute', normal: 'Normale', low: 'Basse' };
const MODELS: { id: AIModel; label: string }[] = [
  { id: 'auto', label: 'Auto' }, { id: 'fast', label: 'Rapide' }, { id: 'thinking', label: 'Réflexion' }, { id: 'max', label: 'Max' }, { id: 'pro', label: 'Pro' },
];

const fcfa = (n?: number) => `${Math.round(n || 0).toLocaleString('fr-FR')} FCFA`;
const duration = (t: Ticket) => {
  if (!t.startedAt) return '';
  const ms = (t.finishedAt || Date.now()) - t.startedAt;
  const min = Math.round(ms / 60_000);
  return min < 1 ? '< 1 min' : `${min} min`;
};

export default function TicketsPage() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const tickets = useTicketStore((s) => s.tickets);
  const settings = useTicketStore((s) => s.settings);
  const runningId = useTicketStore((s) => s.runningId);
  const [form, setForm] = useState<'ticket' | 'split' | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 15_000); return () => clearInterval(t); }, []);

  const shown = tickets.filter((t) => projectFilter === 'all' || t.projectId === projectFilter);
  const groups: { title: string; statuses: TicketStatus[] }[] = [
    { title: 'Brouillons du routeur', statuses: ['draft'] },
    { title: 'En cours et en file', statuses: ['running', 'queued'] },
    { title: 'À valider', statuses: ['review'] },
    { title: 'Échecs', statuses: ['failed'] },
    { title: 'Historique', statuses: ['merged', 'done', 'cancelled'] },
  ];
  const queuedCount = tickets.filter((t) => t.status === 'queued').length;
  const windowOk = inWorkWindow(settings);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-start gap-3 mb-2">
          <TicketIcon size={22} className="mt-1 text-text-secondary" />
          <div className="flex-1">
            <h1 className="text-ui-xl font-semibold text-text-primary">Tickets</h1>
            <p className="text-ui-base text-text-secondary mt-1">
              Confie des tâches au super-agent : chacune est faite seule, dans une copie isolée du projet (branche git), avec un budget.
              Ton dossier n'est touché que quand tu valides. Il travaille tant qu'ANZAR reste ouvert, même la nuit.
            </p>
          </div>
        </div>

        {/* File */}
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-border-medium bg-surface-default px-4 py-3">
          <span className={cn('flex items-center gap-1.5 text-ui-sm', settings.paused ? 'text-accent-warning' : 'text-text-secondary')}>
            {runningId ? <Loader2 size={14} className="animate-spin" /> : settings.paused ? <Pause size={14} /> : <Clock size={14} />}
            {runningId ? 'Un ticket est en cours' : settings.paused ? 'File en pause' : !windowOk ? 'En attente de la plage horaire' : queuedCount ? `${queuedCount} en file` : 'File vide'}
          </span>
          <button onClick={() => useTicketStore.getState().setSettings({ paused: !settings.paused })} className={btnGhost}>
            {settings.paused ? <><Play size={14} /> Reprendre</> : <><Pause size={14} /> Mettre en pause</>}
          </button>
          <span className="flex items-center gap-1 text-ui-sm text-text-muted ml-auto" title="Les tickets ne démarrent que dans cette plage (heure de ton ordinateur). Vide : à toute heure.">
            Travailler de
            <input type="time" value={settings.windowStart || ''} onChange={(e) => useTicketStore.getState().setSettings({ windowStart: e.target.value })}
              className="h-7 px-1 rounded bg-input border border-input-border text-ui-sm text-text-primary" />
            à
            <input type="time" value={settings.windowEnd || ''} onChange={(e) => useTicketStore.getState().setSettings({ windowEnd: e.target.value })}
              className="h-7 px-1 rounded bg-input border border-input-border text-ui-sm text-text-primary" />
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!form && (
            <>
              <button onClick={() => setForm('split')} className={btnPrimary}><Wand2 size={14} /> Découper un objectif</button>
              <button onClick={() => setForm('ticket')} className={btnGhost}><Plus size={14} /> Nouveau ticket</button>
            </>
          )}
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
            className="ml-auto h-8 px-2 rounded-lg bg-input border border-input-border text-ui-sm text-text-primary">
            <option value="all">Tous les projets</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {form === 'ticket' && <TicketForm projects={projects} defaultProject={activeProjectId} onClose={() => setForm(null)} />}
        {form === 'split' && <SplitForm projects={projects} defaultProject={activeProjectId} onClose={() => setForm(null)} />}

        {groups.map((g) => {
          const items = shown.filter((t) => g.statuses.includes(t.status));
          if (!items.length) return null;
          return (
            <section key={g.title} className="mt-8">
              <h2 className="text-ui-base font-semibold text-text-primary mb-3">{g.title} <span className="text-text-muted font-normal">({items.length})</span></h2>
              <div className="space-y-2">{items.map((t) => <TicketCard key={t.id} ticket={t} projectName={projects.find((p) => p.id === t.projectId)?.name} />)}</div>
            </section>
          );
        })}
        {!shown.length && !form && (
          <p className="mt-10 text-center text-ui-sm text-text-muted">Aucun ticket. Découpe un objectif (« ajoute un espace client avec historique des commandes ») ou crée un ticket.</p>
        )}
      </div>
    </div>
  );
}

function ProjectSelect({ projects, value, onChange }: { projects: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-ui-sm text-text-secondary">Projet</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
        <option value="">Choisir…</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}

function Limits({ budget, setBudget, minutes, setMinutes, model, setModel }: {
  budget: number; setBudget: (n: number) => void; minutes: number; setMinutes: (n: number) => void; model: AIModel; setModel: (m: AIModel) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Budget max (FCFA)</span>
        <input type="number" min={50} step={50} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className={input} />
      </label>
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Durée max (min)</span>
        <input type="number" min={5} max={240} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={input} />
      </label>
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Modèle</span>
        <select value={model} onChange={(e) => setModel(e.target.value as AIModel)} className={input}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
    </div>
  );
}

function TicketForm({ projects, defaultProject, onClose }: { projects: { id: string; name: string }[]; defaultProject: string | null; onClose: () => void }) {
  const [projectId, setProjectId] = useState(defaultProject || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [budget, setBudget] = useState(DEFAULT_BUDGET_FCFA);
  const [minutes, setMinutes] = useState(DEFAULT_MAX_MINUTES);
  const [model, setModel] = useState<AIModel>('auto');
  const save = () => {
    if (!projectId) return toast.error('Choisis le projet.');
    if (!title.trim()) return toast.error('Donne un titre au ticket.');
    useTicketStore.getState().addTicket({ projectId, title, description: description || title, priority, budgetFCFA: budget, maxMinutes: minutes, model });
    toast.success('Ticket ajouté à la file');
    onClose();
  };
  return (
    <div className="mt-4 rounded-xl border border-border-medium bg-surface-default p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-ui-lg font-semibold text-text-primary">Nouveau ticket</h2>
        <button onClick={onClose} className="p-1 rounded-md text-text-muted hover:text-text-primary"><X size={16} /></button>
      </div>
      <ProjectSelect projects={projects} value={projectId} onChange={setProjectId} />
      <div>
        <span className="text-ui-sm text-text-secondary">Partir d'un modèle</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {TICKET_TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => { setTitle(t.title); setDescription(t.description); }}
              className="h-7 px-2.5 rounded-lg border border-border-medium text-ui-caption text-text-secondary hover:bg-hover-fill">
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Titre</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ajouter la page « Mes commandes »" className={input} />
      </label>
      <label className="block">
        <span className="text-ui-sm text-text-secondary">Description et critères d'acceptation — l'exécutant ne pourra pas te poser de question</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6}
          placeholder={'Liste des commandes de l\'utilisateur connecté, la plus récente en haut, avec date, montant et statut.\nTerminé quand : la page s\'affiche depuis le menu, et la liste vient de l\'API /api/orders.'}
          className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-input-border text-ui-sm text-text-primary outline-none focus:border-input-border-hover resize-y" />
      </label>
      <div className="flex gap-2">
        {(['high', 'normal', 'low'] as const).map((p) => (
          <button key={p} onClick={() => setPriority(p)} className={cn('h-8 px-3 rounded-lg border text-ui-sm', priority === p ? 'border-input-border-hover bg-hover-fill text-text-primary' : 'border-border-medium text-text-secondary')}>
            Priorité {PRIORITY[p].toLowerCase()}
          </button>
        ))}
      </div>
      <Limits budget={budget} setBudget={setBudget} minutes={minutes} setMinutes={setMinutes} model={model} setModel={setModel} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btnGhost}>Annuler</button>
        <button onClick={save} className={btnPrimary}>Mettre en file</button>
      </div>
    </div>
  );
}

function SplitForm({ projects, defaultProject, onClose }: { projects: { id: string; name: string; metadata?: any }[]; defaultProject: string | null; onClose: () => void }) {
  const [projectId, setProjectId] = useState(defaultProject || '');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<(ProposedTicket & { keep: boolean })[] | null>(null);
  const [budget, setBudget] = useState(DEFAULT_BUDGET_FCFA);
  const [minutes, setMinutes] = useState(DEFAULT_MAX_MINUTES);
  const [model, setModel] = useState<AIModel>('auto');

  const split = async () => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return toast.error('Choisis le projet.');
    if (goal.trim().length < 10) return toast.error("Décris l'objectif en une ou deux phrases.");
    setBusy(true);
    try {
      const path = project.metadata?.localPath as string | undefined;
      const ctx = path ? await buildAgentContext(path, goal).catch(() => null) : null;
      const { tickets, costFCFA } = await splitIntoTickets(goal, { name: project.name, codeMap: ctx?.codeMap, memory: ctx?.memory });
      setProposals(tickets.map((t) => ({ ...t, keep: true })));
      if (costFCFA) toast(`Découpage : ${tickets.length} ticket(s), ${costFCFA < 1 ? '< 1' : Math.round(costFCFA)} FCFA`);
    } catch (e: any) {
      toast.error(e?.message || 'Découpage impossible');
    } finally {
      setBusy(false);
    }
  };

  const queueAll = () => {
    const kept = (proposals || []).filter((p) => p.keep);
    if (!kept.length) return toast.error('Garde au moins un ticket.');
    // Créés dans l'ordre inverse : la file prend les plus anciens d'abord, à priorité égale
    const base = Date.now();
    kept.forEach((p, i) => {
      const t = useTicketStore.getState().addTicket({ projectId, title: p.title, description: p.description, priority: p.priority, budgetFCFA: budget, maxMinutes: minutes, model, source: 'router' });
      useTicketStore.getState().updateTicket(t.id, { createdAt: base + i });
    });
    toast.success(`${kept.length} ticket(s) en file`);
    onClose();
  };

  return (
    <div className="mt-4 rounded-xl border border-border-medium bg-surface-default p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-ui-lg font-semibold text-text-primary">Découper un objectif en tickets</h2>
        <button onClick={onClose} className="p-1 rounded-md text-text-muted hover:text-text-primary"><X size={16} /></button>
      </div>
      {!proposals ? (
        <>
          <ProjectSelect projects={projects} value={projectId} onChange={setProjectId} />
          <label className="block">
            <span className="text-ui-sm text-text-secondary">Objectif</span>
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={4}
              placeholder="Ajoute un espace client : connexion par téléphone, historique des commandes, et paiement Orange Money."
              className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-input-border text-ui-sm text-text-primary outline-none focus:border-input-border-hover resize-y" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className={btnGhost}>Annuler</button>
            <button onClick={() => void split()} disabled={busy} className={btnPrimary}>
              {busy ? <><Loader2 size={14} className="animate-spin" /> Découpage…</> : <><Wand2 size={14} /> Découper</>}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-ui-sm text-text-secondary">Relis les tickets proposés : décoche ceux à ne pas faire, corrige les textes si besoin. Ils seront faits dans cet ordre.</p>
          <div className="space-y-2">
            {proposals.map((p, i) => (
              <div key={i} className={cn('rounded-lg border border-border-subtle p-3 space-y-2', !p.keep && 'opacity-50')}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={p.keep} onChange={(e) => setProposals(proposals.map((x, j) => j === i ? { ...x, keep: e.target.checked } : x))} />
                  <span className="text-ui-caption text-text-muted">{i + 1}.</span>
                  <input value={p.title} onChange={(e) => setProposals(proposals.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                    className="flex-1 h-8 px-2 rounded bg-input border border-input-border text-ui-sm text-text-primary" />
                  <select value={p.priority} onChange={(e) => setProposals(proposals.map((x, j) => j === i ? { ...x, priority: e.target.value as TicketPriority } : x))}
                    className="h-8 px-1 rounded bg-input border border-input-border text-ui-caption text-text-primary">
                    {(['high', 'normal', 'low'] as const).map((k) => <option key={k} value={k}>{PRIORITY[k]}</option>)}
                  </select>
                </div>
                <textarea value={p.description} onChange={(e) => setProposals(proposals.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} rows={3}
                  className="w-full px-2 py-1.5 rounded bg-input border border-input-border text-ui-caption text-text-secondary resize-y" />
              </div>
            ))}
          </div>
          <Limits budget={budget} setBudget={setBudget} minutes={minutes} setMinutes={setMinutes} model={model} setModel={setModel} />
          <p className="text-ui-caption text-text-muted">Budget et durée par ticket. Total maximal : {fcfa(budget * proposals.filter((p) => p.keep).length)}.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setProposals(null)} className={btnGhost}>← Objectif</button>
            <button onClick={queueAll} className={btnPrimary}>Mettre en file</button>
          </div>
        </>
      )}
    </div>
  );
}

function TicketCard({ ticket: t, projectName }: { ticket: Ticket; projectName?: string }) {
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === t.projectId));
  const repo = project?.metadata?.localPath as string | undefined;
  const [open, setOpen] = useState(t.status === 'review');
  const [diff, setDiff] = useState<{ stat: string; diff: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirmModal();
  const store = useTicketStore.getState();
  const s = STATUS[t.status];

  const openConversation = () => {
    if (!t.conversationId) return;
    useChatStore.getState().setActiveConversation(t.conversationId);
    useProjectStore.getState().setActiveProject(t.projectId);
    navigate('/');
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e: any) { toast.error(e?.message || String(e), { duration: 8_000 }); } finally { setBusy(null); }
  };
  const merge = () => run('merge', async () => {
    if (!repo || !t.branch) throw new Error('Branche du ticket introuvable.');
    await mergeTicket(repo, t.branch, t.title);
    await cleanupMerged(repo, t.worktreePath, t.branch);
    store.updateTicket(t.id, { status: 'merged', worktreePath: undefined });
    toast.success(`« ${t.title} » fusionné dans ton projet`);
  });
  const discard = async () => {
    const ok = await confirm({ title: 'Rejeter le travail', message: `Supprimer la branche et la copie de travail de « ${t.title} » ? Ce travail sera perdu.`, confirmLabel: 'Rejeter', variant: 'danger' });
    if (!ok) return;
    await run('discard', async () => {
      if (repo) await discardTicket(repo, t.worktreePath, t.branch);
      store.updateTicket(t.id, { status: 'cancelled', worktreePath: undefined, branch: undefined });
    });
  };
  const showDiff = () => run('diff', async () => {
    if (!repo || !t.branch) throw new Error('Branche du ticket introuvable.');
    setDiff(await ticketDiff(repo, t.branch));
  });

  const progressNote = useMemo(() => t.status === 'running' ? `depuis ${duration(t)} · budget ${fcfa(t.budgetFCFA)}` : '', [t]);

  return (
    <div className="rounded-xl border border-border-medium bg-surface-default overflow-hidden">
      {ConfirmDialog}
      <button onClick={() => setOpen(!open)} className="w-full flex items-start gap-3 px-4 py-3 text-left">
        <span className={cn('mt-0.5', s.tone)}>
          {t.status === 'running' ? <Loader2 size={15} className="animate-spin" /> : t.status === 'review' ? <FileDiff size={15} />
            : t.status === 'failed' ? <AlertCircle size={15} /> : t.status === 'merged' || t.status === 'done' ? <CheckCircle2 size={15} />
            : t.status === 'cancelled' ? <Ban size={15} /> : <Clock size={15} />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-ui-base text-text-primary truncate">{t.title}</span>
          <span className="block text-ui-caption text-text-muted">
            <span className={s.tone}>{s.label}</span>
            {projectName ? ` · ${projectName}` : ''}{t.priority !== 'normal' ? ` · priorité ${PRIORITY[t.priority].toLowerCase()}` : ''}
            {progressNote ? ` · ${progressNote}` : t.costFCFA ? ` · ${fcfa(t.costFCFA)} sur ${fcfa(t.budgetFCFA)}` : ` · budget ${fcfa(t.budgetFCFA)}`}
            {t.status !== 'running' && duration(t) ? ` · ${duration(t)}` : ''}
            {t.attempts > 1 ? ` · ${t.attempts} tentatives` : ''}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-border-medium px-5 py-4 space-y-3 text-ui-sm">
          {t.error && <p className="flex items-start gap-1.5 text-accent-error"><AlertCircle size={14} className="mt-0.5 flex-shrink-0" />{t.error}</p>}
          <details>
            <summary className="cursor-pointer text-text-secondary">Description</summary>
            <p className="mt-1 whitespace-pre-wrap text-text-secondary">{t.description}</p>
          </details>
          {t.report && (
            <div>
              <p className="text-text-secondary mb-1">Rapport de l'exécutant</p>
              <p className="whitespace-pre-wrap text-text-primary max-h-60 overflow-y-auto rounded-lg bg-input p-3">{t.report}</p>
            </div>
          )}
          {t.diffStat && <pre className="rounded-lg bg-input p-2 text-ui-caption text-text-muted overflow-x-auto">{t.diffStat}</pre>}
          {diff && <pre className="max-h-96 overflow-auto rounded-lg bg-input p-2 text-ui-caption text-text-secondary whitespace-pre">{diff.diff || '(aucune différence)'}</pre>}
          {t.branch && t.status !== 'merged' && <p className="text-ui-caption text-text-muted">Branche <span className="font-mono">{t.branch}</span></p>}

          {(t.status === 'review' || t.status === 'failed') && (
            <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2}
              placeholder="Remarques pour une nouvelle tentative (facultatif) : ce qui ne va pas, ce qu'il faut changer…"
              className="w-full px-3 py-2 rounded-lg bg-input border border-input-border text-ui-sm text-text-primary outline-none resize-y" />
          )}

          <div className="flex flex-wrap gap-2">
            {t.status === 'draft' && <button onClick={() => store.queue(t.id)} className={btnPrimary}><Play size={14} /> Mettre en file</button>}
            {(t.status === 'queued' || t.status === 'draft') && <button onClick={() => store.cancel(t.id)} className={btnGhost}><Ban size={14} /> Annuler</button>}
            {t.status === 'running' && <button onClick={() => { store.requestStop(t.id); toast('Arrêt demandé : le travail fait sera gardé'); }} className={btnGhost}><Square size={14} /> Arrêter</button>}
            {t.status === 'review' && (
              <>
                <button onClick={() => void merge()} disabled={!!busy} className={btnPrimary}>
                  {busy === 'merge' ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />} Fusionner dans le projet
                </button>
                <button onClick={() => void showDiff()} disabled={!!busy} className={btnGhost}><FileDiff size={14} /> Voir les changements</button>
              </>
            )}
            {(t.status === 'review' || t.status === 'failed') && (
              <button onClick={() => { store.queue(t.id, feedback); setFeedback(''); toast.success('Ticket relancé'); }} className={btnGhost}>
                <RotateCw size={14} /> Relancer{feedback.trim() ? ' avec mes remarques' : ''}
              </button>
            )}
            {t.conversationId && <button onClick={openConversation} className={btnGhost}><MessageSquare size={14} /> Voir le travail</button>}
            {(t.status === 'review' || t.status === 'failed') && t.branch && <button onClick={() => void discard()} disabled={!!busy} className={cn(btnGhost, 'hover:text-accent-error')}><Trash2 size={14} /> Rejeter</button>}
            {['merged', 'done', 'cancelled'].includes(t.status) && (
              <button onClick={() => store.deleteTicket(t.id)} className={cn(btnGhost, 'hover:text-accent-error')}><Trash2 size={14} /> Retirer de la liste</button>
            )}
          </div>
          {t.status === 'review' && (
            <p className="flex items-start gap-1.5 text-ui-caption text-text-muted"><Info size={12} className="mt-0.5" />
              Fusionner applique ce travail à la branche actuelle de ton projet. En cas de conflit, rien ne change.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
