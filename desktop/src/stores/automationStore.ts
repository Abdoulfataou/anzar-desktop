/**
 * Automatisations : une consigne envoyée à l'agent selon un horaire, dans un projet.
 * Sauvegardées dans automations.json. Elles ne tournent que pendant que l'app est ouverte :
 * une exécution manquée (app fermée) est rattrapée une seule fois au démarrage.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createJsonFileStorage } from '@/lib/fileStore';
import { generateId } from '@/lib/utils';
import type { AIModel } from '@/types';

export type AutomationSchedule =
  | { kind: 'daily'; time: string; days: number[] } // days : 0 = dimanche … 6 = samedi ; vide = tous
  | { kind: 'interval'; hours: number };

/** Sans personne devant l'écran, aucune demande d'accord n'est possible : lecture seule ou accès complet. */
export type AutomationMode = 'plan' | 'full';

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  projectId: string;
  model: AIModel;
  mode: AutomationMode;
  schedule: AutomationSchedule;
  enabled: boolean;
  createdAt: number;
  nextRunAt: number | null;
  lastRunAt?: number;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
  lastConversationId?: string;
}

export type AutomationInput = Pick<Automation, 'name' | 'prompt' | 'projectId' | 'model' | 'mode' | 'schedule'>;

export const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/** Prochaine exécution strictement après `from`. */
export function computeNextRun(schedule: AutomationSchedule, from: number = Date.now()): number | null {
  if (schedule.kind === 'interval') {
    const h = Math.max(1, Math.min(168, Math.round(schedule.hours || 0)));
    return from + h * 3_600_000;
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(schedule.time || '');
  if (!m) return null;
  const hh = Math.min(23, Number(m[1]));
  const mm = Math.min(59, Number(m[2]));
  const days = schedule.days?.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() > from && days.includes(d.getDay())) return d.getTime();
  }
  return null;
}

export function describeSchedule(s: AutomationSchedule): string {
  if (s.kind === 'interval') return s.hours === 1 ? 'Toutes les heures' : `Toutes les ${s.hours} h`;
  const days = s.days?.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
  if (days.length === 7) return `Chaque jour à ${s.time}`;
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d));
  if (ordered.length === 5 && !days.includes(0) && !days.includes(6)) return `En semaine à ${s.time}`;
  return `${ordered.map((d) => DAY_LABELS[d]).join(', ')} à ${s.time}`;
}

interface AutomationState {
  automations: Automation[];
  /** Exécution en cours (non sauvegardé) */
  runningId: string | null;
  runningConversationId: string | null;
  /** « Lancer maintenant » en attente (non sauvegardé) */
  queued: string[];

  addAutomation: (input: AutomationInput) => Automation;
  updateAutomation: (id: string, input: AutomationInput) => void;
  toggleAutomation: (id: string) => void;
  deleteAutomation: (id: string) => void;
  runNow: (id: string) => void;
  /** Utilisés par l'exécuteur */
  markStarted: (id: string, conversationId: string) => void;
  markFinished: (id: string, result: { ok: boolean; error?: string; conversationId?: string }) => void;
  setRunning: (id: string | null) => void;
}

export const useAutomationStore = create<AutomationState>()(
  persist(
    (set) => ({
      automations: [],
      runningId: null,
      runningConversationId: null,
      queued: [],

      addAutomation: (input) => {
        const a: Automation = {
          ...input,
          id: generateId(),
          enabled: true,
          createdAt: Date.now(),
          nextRunAt: computeNextRun(input.schedule),
        };
        set((s) => ({ automations: [a, ...s.automations] }));
        return a;
      },
      updateAutomation: (id, input) =>
        set((s) => ({
          automations: s.automations.map((a) =>
            a.id === id ? { ...a, ...input, nextRunAt: a.enabled ? computeNextRun(input.schedule) : null } : a
          ),
        })),
      toggleAutomation: (id) =>
        set((s) => ({
          automations: s.automations.map((a) =>
            a.id === id
              ? { ...a, enabled: !a.enabled, nextRunAt: a.enabled ? null : computeNextRun(a.schedule) }
              : a
          ),
        })),
      deleteAutomation: (id) =>
        set((s) => ({ automations: s.automations.filter((a) => a.id !== id), queued: s.queued.filter((q) => q !== id) })),
      runNow: (id) => set((s) => (s.queued.includes(id) || s.runningId === id ? s : { queued: [...s.queued, id] })),

      setRunning: (id) => set({ runningId: id, runningConversationId: null }),
      markStarted: (id, conversationId) =>
        set((s) => ({
          runningId: id,
          runningConversationId: conversationId,
          queued: s.queued.filter((q) => q !== id),
          automations: s.automations.map((a) =>
            // L'horaire suivant est calculé dès le départ : une exécution manquée n'est rattrapée qu'une fois
            a.id === id ? { ...a, lastRunAt: Date.now(), lastConversationId: conversationId, nextRunAt: a.enabled ? computeNextRun(a.schedule) : null } : a
          ),
        })),
      markFinished: (id, { ok, error, conversationId }) =>
        set((s) => ({
          runningId: null,
          runningConversationId: null,
          queued: s.queued.filter((q) => q !== id),
          automations: s.automations.map((a) =>
            a.id === id
              ? {
                  ...a,
                  lastStatus: ok ? 'ok' : 'error',
                  lastError: ok ? undefined : error,
                  lastConversationId: conversationId ?? a.lastConversationId,
                  lastRunAt: a.lastRunAt ?? Date.now(),
                  nextRunAt: a.enabled && (a.nextRunAt ?? 0) <= Date.now() ? computeNextRun(a.schedule) : a.nextRunAt,
                }
              : a
          ),
        })),
    }),
    {
      name: 'anzar-automations',
      storage: createJsonFileStorage('automations.json') as any,
      partialize: (s) => ({ automations: s.automations }) as any,
    }
  )
);
