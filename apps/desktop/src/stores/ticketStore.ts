/**
 * Super-agent : file de tickets par projet. Chaque ticket est traité par un exécutant
 * dans sa propre worktree git (le dossier du projet n'est jamais touché), avec un
 * budget en FCFA et une durée maximale. Le résultat attend la validation de
 * l'utilisateur avant d'être fusionné. Sauvegardé dans tickets.json.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createJsonFileStorage } from '@/lib/fileStore';
import { generateId } from '@/lib/utils';
import type { AIModel } from '@/types';

export type TicketStatus =
  | 'draft'      // proposé par le routeur, pas encore validé
  | 'queued'     // en file d'attente
  | 'running'
  | 'review'     // terminé avec des modifications : à valider
  | 'merged'
  | 'done'       // terminé sans modification (réponse, analyse)
  | 'failed'
  | 'cancelled';

export type TicketPriority = 'high' | 'normal' | 'low';

export interface Ticket {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  model: AIModel;
  /** Budget maximal en FCFA : l'exécutant est arrêté au-delà */
  budgetFCFA: number;
  /** Durée maximale en minutes */
  maxMinutes: number;
  source: 'manual' | 'router';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  branch?: string;
  worktreePath?: string;
  conversationId?: string;
  costFCFA?: number;
  /** Résumé final de l'exécutant */
  report?: string;
  /** Fichiers modifiés (git diff --stat) */
  diffStat?: string;
  error?: string;
  /** Pourquoi le watchdog a arrêté l'exécutant */
  stopReason?: 'budget' | 'time' | 'stalled' | 'user';
  attempts: number;
  /** Remarques de l'utilisateur pour une nouvelle tentative */
  feedback?: string;
  /** L'utilisateur a demandé l'arrêt (lu par le watchdog) */
  stopRequested?: boolean;
}

export type TicketInput = Pick<Ticket, 'projectId' | 'title' | 'description' | 'priority' | 'model' | 'budgetFCFA' | 'maxMinutes'> & { source?: Ticket['source']; status?: 'draft' | 'queued' };

export interface QueueSettings {
  paused: boolean;
  /** Plage horaire de travail (heure locale « HH:MM ») ; vide = à toute heure */
  windowStart?: string;
  windowEnd?: string;
  /** Tickets traités en même temps (chacun dans sa worktree) ; défaut 2, de 1 à 4 */
  maxParallel?: number;
}

export const DEFAULT_BUDGET_FCFA = 500;
export const DEFAULT_MAX_MINUTES = 30;
export const DEFAULT_MAX_PARALLEL = 2;
export const MAX_PARALLEL_LIMIT = 4;

/** Nombre de tickets à traiter en même temps, borné. */
export function maxParallelOf(s: QueueSettings): number {
  const n = Math.round(Number(s.maxParallel ?? DEFAULT_MAX_PARALLEL));
  return Number.isFinite(n) ? Math.min(MAX_PARALLEL_LIMIT, Math.max(1, n)) : DEFAULT_MAX_PARALLEL;
}
const PRIORITY_ORDER: Record<TicketPriority, number> = { high: 0, normal: 1, low: 2 };

/** La plage horaire permet-elle de lancer un ticket maintenant ? */
export function inWorkWindow(s: QueueSettings, now = new Date()): boolean {
  const parse = (t?: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    return m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])) : null;
  };
  const a = parse(s.windowStart);
  const b = parse(s.windowEnd);
  if (a === null || b === null || a === b) return true;
  const cur = now.getHours() * 60 + now.getMinutes();
  return a < b ? cur >= a && cur < b : cur >= a || cur < b; // plage qui passe minuit (22:00 → 06:00)
}

/** Prochain ticket à lancer : priorité, puis ancienneté. */
export function nextTicket(tickets: Ticket[]): Ticket | undefined {
  return tickets
    .filter((t) => t.status === 'queued')
    .sort((x, y) => PRIORITY_ORDER[x.priority] - PRIORITY_ORDER[y.priority] || x.createdAt - y.createdAt)[0];
}

interface TicketState {
  tickets: Ticket[];
  settings: QueueSettings;
  /** Tickets en cours (non sauvegardé) */
  runningIds: string[];

  addTicket: (input: TicketInput) => Ticket;
  updateTicket: (id: string, patch: Partial<Ticket>) => void;
  deleteTicket: (id: string) => void;
  queue: (id: string, feedback?: string) => void;
  cancel: (id: string) => void;
  requestStop: (id: string) => void;
  setSettings: (patch: Partial<QueueSettings>) => void;
  markRunning: (id: string) => void;
  markStopped: (id: string) => void;
  /** Au démarrage : un ticket resté « en cours » a été interrompu par la fermeture de l'app */
  recoverInterrupted: () => void;
}

export const useTicketStore = create<TicketState>()(
  persist(
    (set) => ({
      tickets: [],
      settings: { paused: false },
      runningIds: [],

      addTicket: (input) => {
        const t: Ticket = {
          ...input,
          id: generateId(),
          title: input.title.trim().slice(0, 140) || 'Ticket',
          description: input.description.trim(),
          status: input.status ?? 'queued',
          source: input.source ?? 'manual',
          budgetFCFA: Math.max(50, Math.round(input.budgetFCFA || DEFAULT_BUDGET_FCFA)),
          maxMinutes: Math.max(5, Math.min(240, Math.round(input.maxMinutes || DEFAULT_MAX_MINUTES))),
          createdAt: Date.now(),
          attempts: 0,
        };
        set((s) => ({ tickets: [t, ...s.tickets] }));
        return t;
      },
      updateTicket: (id, patch) => set((s) => ({ tickets: s.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      deleteTicket: (id) => set((s) => ({ tickets: s.tickets.filter((t) => t.id !== id) })),
      queue: (id, feedback) => set((s) => ({
        tickets: s.tickets.map((t) => (t.id === id
          ? { ...t, status: 'queued', error: undefined, stopReason: undefined, feedback: feedback?.trim() || t.feedback }
          : t)),
      })),
      cancel: (id) => set((s) => ({
        tickets: s.tickets.map((t) => (t.id === id && (t.status === 'queued' || t.status === 'draft') ? { ...t, status: 'cancelled' } : t)),
      })),
      requestStop: (id) => set((s) => ({ tickets: s.tickets.map((t) => (t.id === id && t.status === 'running' ? { ...t, stopRequested: true } : t)) })),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      markRunning: (id) => set((s) => (s.runningIds.includes(id) ? s : { runningIds: [...s.runningIds, id] })),
      markStopped: (id) => set((s) => ({ runningIds: s.runningIds.filter((x) => x !== id) })),
      recoverInterrupted: () => set((s) => ({
        tickets: s.tickets.map((t) => (t.status === 'running' && !s.runningIds.includes(t.id)
          ? { ...t, status: 'failed', error: "Interrompu : l'app a été fermée pendant le travail. Relance-le.", finishedAt: Date.now() }
          : t)),
      })),
    }),
    {
      name: 'anzar-tickets',
      storage: createJsonFileStorage('tickets.json') as any,
      partialize: (s) => ({ tickets: s.tickets, settings: s.settings }) as any,
    }
  )
);
