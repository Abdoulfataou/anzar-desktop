/**
 * Page Automatisations : consignes envoyées à l'agent selon un horaire, dans un projet.
 * Chaque exécution crée une nouvelle tâche dans le projet (visible dans la barre latérale).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Plus, Pencil, Trash2, Play, X, Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useConfirmModal } from '@/components/ui/ConfirmModal';
import {
  useAutomationStore, describeSchedule, DAY_LABELS,
  type Automation, type AutomationInput, type AutomationSchedule,
} from '@/stores/automationStore';

interface Draft extends AutomationInput { id?: string }

const WEEKDAYS = [1, 2, 3, 4, 5];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

function when(ts?: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `aujourd'hui ${hm}`;
  if (d.toDateString() === tomorrow.toDateString()) return `demain ${hm}`;
  return `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} ${hm}`;
}

const inputCls = 'mt-1 w-full h-9 px-3 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none focus:border-input-border-hover';

export default function AutomationsPage() {
  const navigate = useNavigate();
  const projects = useProjectStore((s) => s.projects);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const conversations = useChatStore((s) => s.conversations);
  const { automations, runningId, queued, addAutomation, updateAutomation, toggleAutomation, deleteAutomation, runNow } =
    useAutomationStore();
  const [draft, setDraft] = useState<Draft | null>(null);
  const { confirm, ConfirmDialog } = useConfirmModal();

  const folders = useMemo(
    () => projects.filter((p) => typeof p.metadata?.localPath === 'string'),
    [projects]
  );
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name || 'Projet supprimé';

  const startNew = () => {
    if (!folders.length) { toast.error("Ouvre d'abord un dossier de projet : l'automatisation y travaillera."); return; }
    setDraft({
      name: '', prompt: '', projectId: folders[0].id, model: 'fast', mode: 'plan',
      schedule: { kind: 'daily', time: '09:00', days: WEEKDAYS },
    });
  };

  const save = () => {
    if (!draft) return;
    if (!draft.name.trim()) { toast.error('Donne un nom à l\'automatisation.'); return; }
    if (!draft.prompt.trim()) { toast.error('Écris la consigne que l\'agent recevra.'); return; }
    if (draft.schedule.kind === 'daily' && !/^\d{1,2}:\d{2}$/.test(draft.schedule.time)) { toast.error('Heure invalide.'); return; }
    const { id, ...input } = draft;
    const clean: AutomationInput = { ...input, name: input.name.trim(), prompt: input.prompt.trim() };
    if (id) updateAutomation(id, clean); else addAutomation(clean);
    toast.success('Automatisation enregistrée');
    setDraft(null);
  };

  const remove = async (a: Automation) => {
    const ok = await confirm({
      title: "Supprimer l'automatisation",
      message: `Supprimer « ${a.name} » ? Les tâches déjà créées restent dans le projet.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (ok) deleteAutomation(a.id);
  };

  const openTask = (a: Automation) => {
    const conv = conversations.find((c) => c.id === a.lastConversationId);
    if (!conv) { toast.error('Cette tâche a été supprimée.'); return; }
    setActiveConversation(conv.id);
    setActiveProject(conv.projectId || null);
    navigate('/');
  };

  const setSchedule = (schedule: AutomationSchedule) => draft && setDraft({ ...draft, schedule });

  return (
    <div className="h-full overflow-y-auto">
      {ConfirmDialog}
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-start gap-3 mb-2">
          <CalendarClock size={22} className="mt-1 text-text-secondary" />
          <div className="flex-1">
            <h1 className="text-ui-xl font-semibold text-text-primary">Automatisations</h1>
            <p className="text-ui-base text-text-secondary mt-1">
              Une consigne que l'agent exécute tout seul, à l'heure choisie : revue du code chaque matin,
              tests et build toutes les 6 heures, résumé des changements le vendredi… Chaque exécution crée une tâche dans le projet.
            </p>
          </div>
          {!draft && (
            <button
              onClick={startNew}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90 flex-shrink-0"
            >
              <Plus size={14} /> Nouvelle automatisation
            </button>
          )}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg bg-hover-fill px-3 py-2 text-ui-sm text-text-secondary">
          <Info size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            Les automatisations tournent seulement quand ANZAR est ouvert. Une exécution manquée est faite une fois au prochain démarrage.
            Chaque exécution consomme des crédits comme une tâche normale.
          </span>
        </div>

        {draft && (
          <div className="mt-6 rounded-xl border border-border-medium bg-surface-default p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-ui-lg font-semibold text-text-primary">{draft.id ? "Modifier l'automatisation" : 'Nouvelle automatisation'}</h2>
              <button onClick={() => setDraft(null)} className="p-1 rounded-md text-text-muted hover:text-text-primary" title="Annuler">
                <X size={16} />
              </button>
            </div>
            <label className="block">
              <span className="text-ui-sm text-text-secondary">Nom</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Revue du matin" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-ui-sm text-text-secondary">Consigne envoyée à l'agent</span>
              <textarea
                value={draft.prompt}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                rows={5}
                placeholder="Lance npm run build et npm test. S'il y a des erreurs, explique-les et propose une correction."
                className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-input-border text-ui-base leading-relaxed text-text-primary outline-none focus:border-input-border-hover resize-y"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-ui-sm text-text-secondary">Projet</span>
                <select value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })} className={inputCls}>
                  {folders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-ui-sm text-text-secondary">Modèle</span>
                <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value as Draft['model'] })} className={inputCls}>
                  <option value="fast">Rapide (moins cher)</option>
                  <option value="thinking">Réflexion</option>
                </select>
              </label>
            </div>
            <div>
              <span className="text-ui-sm text-text-secondary">Permissions</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {([
                  ['plan', 'Lecture seule', "Lit, analyse et propose un plan. Ne modifie rien."],
                  ['full', 'Accès complet', 'Modifie les fichiers et lance des commandes sans demander.'],
                ] as const).map(([mode, label, hint]) => (
                  <button
                    key={mode}
                    onClick={() => setDraft({ ...draft, mode })}
                    className={cn(
                      'text-left rounded-lg border px-3 py-2',
                      draft.mode === mode ? 'border-text-primary bg-selected' : 'border-border-medium hover:bg-hover-fill'
                    )}
                  >
                    <span className="block text-ui-base text-text-primary">{label}</span>
                    <span className="block text-ui-sm text-text-secondary">{hint}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-ui-sm text-text-muted">Personne n'est là pour valider pendant l'exécution : il n'y a donc pas de mode « demander ».</p>
            </div>
            <div>
              <span className="text-ui-sm text-text-secondary">Quand</span>
              <div className="mt-1 flex items-center gap-2">
                <select
                  value={draft.schedule.kind}
                  onChange={(e) => setSchedule(e.target.value === 'interval'
                    ? { kind: 'interval', hours: 6 }
                    : { kind: 'daily', time: '09:00', days: WEEKDAYS })}
                  className="h-9 px-3 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none"
                >
                  <option value="daily">À heure fixe</option>
                  <option value="interval">À intervalle régulier</option>
                </select>
                {draft.schedule.kind === 'daily' ? (
                  <input
                    type="time"
                    value={draft.schedule.time}
                    onChange={(e) => draft.schedule.kind === 'daily' && setSchedule({ ...draft.schedule, time: e.target.value })}
                    className="h-9 px-3 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none"
                  />
                ) : (
                  <span className="flex items-center gap-2 text-ui-base text-text-secondary">
                    toutes les
                    <input
                      type="number" min={1} max={168}
                      value={draft.schedule.hours}
                      onChange={(e) => setSchedule({ kind: 'interval', hours: Math.max(1, Math.min(168, Number(e.target.value) || 1)) })}
                      className="w-20 h-9 px-3 rounded-lg bg-input border border-input-border text-ui-base text-text-primary outline-none"
                    />
                    heures
                  </span>
                )}
              </div>
              {draft.schedule.kind === 'daily' && (
                <div className="mt-2 flex gap-1">
                  {ORDER.map((d) => {
                    const sched = draft.schedule as Extract<AutomationSchedule, { kind: 'daily' }>;
                    const on = sched.days.includes(d);
                    return (
                      <button
                        key={d}
                        onClick={() => setSchedule({ ...sched, days: on ? sched.days.filter((x) => x !== d) : [...sched.days, d] })}
                        className={cn(
                          'h-7 w-11 rounded-md text-ui-sm border',
                          on ? 'border-text-primary bg-selected text-text-primary' : 'border-border-medium text-text-muted hover:bg-hover-fill'
                        )}
                      >
                        {DAY_LABELS[d]}
                      </button>
                    );
                  })}
                  <span className="ml-2 self-center text-ui-sm text-text-muted">aucun jour coché = tous les jours</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="h-8 px-3 rounded-lg text-ui-base text-text-secondary hover:bg-hover-fill">Annuler</button>
              <button onClick={save} className="h-8 px-3 rounded-lg text-ui-base font-medium bg-primary-btn text-primary-btn-fg hover:opacity-90">
                Enregistrer
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-2">
          {!automations.length && !draft && (
            <div className="rounded-xl border border-dashed border-border-medium px-6 py-10 text-center text-ui-base text-text-secondary">
              Aucune automatisation pour l'instant.
            </div>
          )}
          {automations.map((a) => {
            const running = runningId === a.id;
            const waiting = queued.includes(a.id);
            return (
              <div key={a.id} className="group rounded-xl border border-border-medium bg-surface-default px-4 py-3">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleAutomation(a.id)}
                    title={a.enabled ? 'Désactiver' : 'Activer'}
                    className={cn('mt-0.5 relative h-5 w-9 flex-shrink-0 rounded-full transition-colors', a.enabled ? 'bg-primary-btn' : 'bg-border-medium')}
                  >
                    <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-all', a.enabled ? 'left-[18px]' : 'left-0.5')} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-ui-base font-medium truncate', a.enabled ? 'text-text-primary' : 'text-text-muted')}>{a.name}</span>
                      <span className="rounded bg-tag px-1.5 text-ui-sm text-text-secondary">{a.mode === 'plan' ? 'Lecture seule' : 'Accès complet'}</span>
                    </div>
                    <div className="text-ui-sm text-text-secondary truncate">
                      {describeSchedule(a.schedule)} · {projectName(a.projectId)}
                      {a.enabled && a.nextRunAt ? ` · prochaine : ${when(a.nextRunAt)}` : ''}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-ui-sm">
                      {running ? (
                        <span className="flex items-center gap-1 text-text-secondary"><Loader2 size={12} className="animate-spin" /> En cours…</span>
                      ) : waiting ? (
                        <span className="text-text-secondary">En attente…</span>
                      ) : a.lastRunAt ? (
                        <>
                          {a.lastStatus === 'error'
                            ? <AlertCircle size={12} className="text-accent-error" />
                            : <CheckCircle2 size={12} className="text-diff-added" />}
                          <span className="text-text-secondary">Dernière exécution {when(a.lastRunAt)}</span>
                          {a.lastConversationId && (
                            <button onClick={() => openTask(a)} className="text-link hover:underline">voir la tâche</button>
                          )}
                          {a.lastStatus === 'error' && a.lastError && <span className="text-accent-error truncate">— {a.lastError}</span>}
                        </>
                      ) : (
                        <span className="text-text-muted">Jamais exécutée</span>
                      )}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => { runNow(a.id); toast.success('Exécution lancée'); }}
                      disabled={running || waiting}
                      className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover-fill disabled:opacity-40"
                      title="Lancer maintenant"
                    >
                      <Play size={14} />
                    </button>
                    <button
                      onClick={() => setDraft({ id: a.id, name: a.name, prompt: a.prompt, projectId: a.projectId, model: a.model, mode: a.mode, schedule: a.schedule })}
                      className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover-fill"
                      title="Modifier"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => void remove(a)}
                      disabled={running}
                      className="p-1.5 rounded-md text-text-muted hover:text-accent-error hover:bg-hover-fill disabled:opacity-40"
                      title="Supprimer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
