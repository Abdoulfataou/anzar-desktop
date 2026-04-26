import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { commandCardService } from '@/services/commandCardService'
import { useSettingsStore } from '@/stores/settingsStore'

export type CommandCardStatus = 'suggested' | 'running' | 'success' | 'error' | 'killed'

export type CommandLogEntry = {
  id: string
  ts: number
  type: 'stdout' | 'stderr' | 'system' | 'error' | 'success'
  content: string
}

export type CommandCard = {
  id: string // stable id (messageId + index)
  messageId: string
  title: string
  command: string
  projectId?: string | null
  projectPath?: string
  status: CommandCardStatus
  createdAt: number
  startedAt?: number
  endedAt?: number
  processId?: string
  exitCode?: number
  logs: CommandLogEntry[]
  // UI state
  collapsed?: boolean
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

type CommandStore = {
  cards: Record<string, CommandCard>
  order: string[]
  activeCardId: string | null

  ensureCard: (payload: {
    id: string
    messageId: string
    command: string
    title?: string
    projectId?: string | null
    projectPath?: string
  }) => CommandCard

  setCard: (id: string, updates: Partial<CommandCard>) => void
  appendLog: (id: string, entry: Omit<CommandLogEntry, 'id' | 'ts'> & { ts?: number }) => void
  removeCard: (id: string) => void
  clearFinished: () => void
  setActiveCard: (id: string | null) => void
  toggleCollapsed: (id: string) => void
  stopAllRunning: () => Promise<void>
}

const MAX_LOGS_PER_CARD = 800
const MAX_FINISHED_CARDS_TO_KEEP = 40
const FINISHED_TTL_MS = 15 * 60 * 1000 // 15 minutes

export const useCommandStore = create<CommandStore>()(
  persist(
    (set, get) => ({
      cards: {},
      order: [],
      activeCardId: null,

      ensureCard: ({ id, messageId, command, title, projectId, projectPath }) => {
        const existing = get().cards[id]
        if (existing) {
          // Opportunistic enrichment (ex: user selects project after card creation)
          if ((!existing.projectPath && projectPath) || (existing.projectId == null && projectId != null)) {
            get().setCard(id, {
              projectId: existing.projectId ?? projectId ?? undefined,
              projectPath: existing.projectPath ?? projectPath,
            })
          }
          return existing
        }

        const card: CommandCard = {
          id,
          messageId,
          title: title || 'Commande',
          command: command.trim(),
          projectId,
          projectPath,
          status: 'suggested',
          createdAt: Date.now(),
          logs: [],
          collapsed: false,
        }

        set((s) => ({
          cards: { ...s.cards, [id]: card },
          order: [...s.order, id],
        }))

        return card
      },

      setCard: (id, updates) => {
        set((s) => ({
          cards: {
            ...s.cards,
            [id]: s.cards[id] ? { ...s.cards[id], ...updates } : (s.cards[id] as any),
          },
        }))
        // opportunistic cleanup
        sweepFinished(get, set)
      },

      appendLog: (id, entry) => {
        const ts = entry.ts ?? Date.now()
        set((s) => {
          const card = s.cards[id]
          if (!card) return s
          const logs = [...card.logs, { id: uid('clog'), ts, type: entry.type, content: entry.content }]
          return {
            ...s,
            cards: {
              ...s.cards,
              [id]: { ...card, logs: logs.slice(Math.max(0, logs.length - MAX_LOGS_PER_CARD)) },
            },
          }
        })
      },

      removeCard: (id) => {
        set((s) => {
          const next = { ...s.cards }
          delete next[id]
          return { cards: next, order: s.order.filter((x) => x !== id) }
        })
      },

      clearFinished: () => {
        set((s) => {
          const keepIds = s.order.filter((id) => {
            const c = s.cards[id]
            return c && (c.status === 'running' || c.status === 'suggested')
          })
          const nextCards: Record<string, CommandCard> = {}
          for (const id of keepIds) nextCards[id] = s.cards[id]
          return { cards: nextCards, order: keepIds }
        })
      },

      setActiveCard: (id) => set({ activeCardId: id }),

      toggleCollapsed: (id) => {
        set((s) => {
          const c = s.cards[id]
          if (!c) return s
          return { ...s, cards: { ...s.cards, [id]: { ...c, collapsed: !c.collapsed } } }
        })
      },

      stopAllRunning: async () => {
        const ids = get().order.filter((id) => get().cards[id]?.status === 'running')
        for (const id of ids) {
          await commandCardService.kill(id)
        }
      },
    }),
    {
      name: 'anzar-command-cards',
      version: 1,
      partialize: (s) => ({ cards: s.cards, order: s.order }),
      onRehydrateStorage: () => (state, err) => {
        if (err) return
        // Sanitize persisted state (max logs + coherent order) then sweep.
        try {
          sanitizePersistedCommandStore()
          sweepFinished(useCommandStore.getState as any, useCommandStore.setState as any)
          initCommandStoreSweeper()
        } catch {
          // ignore
        }
      },
    }
  )
)

function isFinishedStatus(status: CommandCardStatus) {
  return status === 'success' || status === 'error' || status === 'killed'
}

function sanitizePersistedCommandStore() {
  const s = useCommandStore.getState()
  const seen = new Set<string>()
  const nextOrder: string[] = []
  const nextCards: Record<string, CommandCard> = {}

  // Keep order items that exist, de-dup
  for (const id of s.order || []) {
    if (seen.has(id)) continue
    const c = s.cards?.[id]
    if (!c) continue
    seen.add(id)
    nextOrder.push(id)
    nextCards[id] = { ...c, logs: (c.logs || []).slice(-(MAX_LOGS_PER_CARD)) }
  }

  // Keep any cards that exist but aren't in order (append at end)
  for (const [id, c] of Object.entries(s.cards || {})) {
    if (seen.has(id)) continue
    seen.add(id)
    nextOrder.push(id)
    nextCards[id] = { ...c, logs: (c.logs || []).slice(-(MAX_LOGS_PER_CARD)) }
  }

  useCommandStore.setState({ cards: nextCards, order: nextOrder })
}

function sweepFinished(get: () => any, set: any) {
  const settings = useSettingsStore.getState().settings
  if (!settings.autoCleanFinishedCommands) return

  const state = get()
  const now = Date.now()

  const ids = state.order as string[]
  const cards = state.cards as Record<string, CommandCard>

  const finished = ids
    .map((id) => cards[id])
    .filter(Boolean)
    .filter((c) => isFinishedStatus(c.status))
    .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))

  // Keep the most recent finished cards
  const keepFinishedIds = new Set(finished.slice(0, MAX_FINISHED_CARDS_TO_KEEP).map((c) => c.id))

  const toRemove: string[] = []
  for (const c of finished) {
    const ended = c.endedAt ?? c.createdAt
    if (!keepFinishedIds.has(c.id) && now - ended > FINISHED_TTL_MS) {
      toRemove.push(c.id)
    }
  }

  if (toRemove.length === 0) return

  set((s: any) => {
    const nextCards = { ...s.cards }
    for (const id of toRemove) delete nextCards[id]
    return { cards: nextCards, order: s.order.filter((id: string) => !toRemove.includes(id)) }
  })
}

function initCommandStoreSweeper() {
  // Prevent multiple intervals (HMR / multi-import)
  const g: any = globalThis as any
  if (g.__anzarCommandStoreSweeper) return
  g.__anzarCommandStoreSweeper = true

  setInterval(() => {
    try {
      sweepFinished(useCommandStore.getState as any, useCommandStore.setState as any)
    } catch {
      // ignore
    }
  }, 60_000)
}

// Ensure it's started in normal runtime too (not only on rehydrate)
initCommandStoreSweeper()
