import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FileOperation } from '@/types'
import { useProjectStore } from '@/stores/projectStore'

type PendingChangeSet = {
  id: string
  projectId: string
  title: string
  createdAt: number
  operations: FileOperation[]
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

type ChangeStore = {
  pending: Record<string, PendingChangeSet[]> // projectId -> changesets
  queue: (projectId: string, title: string, operations: FileOperation[]) => PendingChangeSet
  appendOperations: (projectId: string, changeSetId: string, operations: FileOperation[]) => void
  updateTitle: (projectId: string, changeSetId: string, title: string) => void
  clearProject: (projectId: string) => void
  remove: (projectId: string, changeSetId: string) => void
  apply: (projectId: string, changeSetId: string) => Promise<void>
  applySelected: (projectId: string, changeSetId: string, selectedIndexes: number[]) => Promise<void>
}

export const useChangeStore = create<ChangeStore>()(
  persist(
    (set, get) => ({
      pending: {},

      queue: (projectId, title, operations) => {
        const cs: PendingChangeSet = { id: uid('cs'), projectId, title, createdAt: Date.now(), operations }
        set((s) => ({
          pending: {
            ...s.pending,
            [projectId]: [cs, ...(s.pending[projectId] || [])],
          },
        }))
        return cs
      },

      appendOperations: (projectId, changeSetId, operations) => {
        if (!operations || operations.length === 0) return
        set((s) => ({
          pending: {
            ...s.pending,
            [projectId]: (s.pending[projectId] || []).map((c) =>
              c.id === changeSetId ? { ...c, operations: [...c.operations, ...operations] } : c
            ),
          },
        }))
      },

      updateTitle: (projectId, changeSetId, title) => {
        set((s) => ({
          pending: {
            ...s.pending,
            [projectId]: (s.pending[projectId] || []).map((c) =>
              c.id === changeSetId ? { ...c, title } : c
            ),
          },
        }))
      },

      clearProject: (projectId) => set((s) => ({ pending: { ...s.pending, [projectId]: [] } })),

      remove: (projectId, changeSetId) =>
        set((s) => ({
          pending: {
            ...s.pending,
            [projectId]: (s.pending[projectId] || []).filter((c) => c.id !== changeSetId),
          },
        })),

      apply: async (projectId, changeSetId) => {
        const setForProject = get().pending[projectId] || []
        const cs = setForProject.find((c) => c.id === changeSetId)
        if (!cs) return

        // Apply to store + disk explicitly (user-approved)
        await useProjectStore.getState().executeBatchOperations(projectId, cs.operations, { writeToDisk: true })

        // Remove after apply
        get().remove(projectId, changeSetId)
      },

      applySelected: async (projectId, changeSetId, selectedIndexes) => {
        const setForProject = get().pending[projectId] || []
        const cs = setForProject.find((c) => c.id === changeSetId)
        if (!cs) return

        const indexSet = new Set((selectedIndexes || []).filter((n) => Number.isFinite(n)))
        if (indexSet.size === 0) return

        const selectedOps: FileOperation[] = []
        const remainingOps: FileOperation[] = []

        cs.operations.forEach((op, idx) => {
          if (indexSet.has(idx)) selectedOps.push(op)
          else remainingOps.push(op)
        })

        if (selectedOps.length === 0) return

        await useProjectStore.getState().executeBatchOperations(projectId, selectedOps, { writeToDisk: true })

        // Keep remaining operations in the same changeset, or remove it if empty
        if (remainingOps.length === 0) {
          get().remove(projectId, changeSetId)
          return
        }

        set((s) => ({
          pending: {
            ...s.pending,
            [projectId]: (s.pending[projectId] || []).map((c) =>
              c.id === changeSetId ? { ...c, operations: remainingOps } : c
            ),
          },
        }))
      },
    }),
    { name: 'anzar-change-queue', version: 1, partialize: (s) => ({ pending: s.pending }) }
  )
)

export type { PendingChangeSet }
