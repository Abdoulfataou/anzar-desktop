import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Run, RunLogEntry, RunLogLevel, RunStatus, RunStep, RunStepStatus } from '@/types/run'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

function now() {
  return Date.now()
}

type RunStore = {
  runs: Run[]
  activeRunId: string | null
  dismissedVerifyFixNoticeRunIds: string[]

  createRun: (payload: { projectId: string; title: string }) => Run
  setActiveRun: (runId: string | null) => void
  cancelRun: (runId: string) => void
  deleteRun: (runId: string) => void
  clearRunsForProject: (projectId: string) => void
  dismissVerifyFixNotice: (runId: string) => void

  addStep: (runId: string, step: { label: string; command?: RunStep['command'] }) => RunStep
  setStepStatus: (runId: string, stepId: string, status: RunStepStatus, error?: string) => void
  setRunStatus: (runId: string, status: RunStatus) => void

  appendLog: (runId: string, entry: { level: RunLogLevel; message: string; stepId?: string }) => RunLogEntry
}

const MAX_RUNS = 50
const MAX_LOGS_PER_RUN = 2000

export const useRunStore = create<RunStore>()(
  persist(
    (set, get) => ({
      runs: [],
      activeRunId: null,
      dismissedVerifyFixNoticeRunIds: [],

      createRun: ({ projectId, title }) => {
        const run: Run = {
          id: uid('run'),
          projectId,
          title,
          status: 'queued',
          createdAt: now(),
          updatedAt: now(),
          steps: [],
          logs: [],
        }
        set((s) => ({
          runs: [run, ...s.runs].slice(0, MAX_RUNS),
          activeRunId: run.id,
        }))
        return run
      },

      setActiveRun: (runId) => set({ activeRunId: runId }),

      dismissVerifyFixNotice: (runId) => {
        set((s) => ({
          dismissedVerifyFixNoticeRunIds: s.dismissedVerifyFixNoticeRunIds.includes(runId)
            ? s.dismissedVerifyFixNoticeRunIds
            : [...s.dismissedVerifyFixNoticeRunIds, runId].slice(-200),
        }))
      },

      cancelRun: (runId) => {
        set((s) => ({
          runs: s.runs.map((r) => (r.id === runId ? { ...r, status: 'canceled', updatedAt: now() } : r)),
        }))
      },

      deleteRun: (runId) => {
        set((s) => ({
          runs: s.runs.filter((r) => r.id !== runId),
          activeRunId: s.activeRunId === runId ? null : s.activeRunId,
          dismissedVerifyFixNoticeRunIds: s.dismissedVerifyFixNoticeRunIds.filter((id) => id !== runId),
        }))
      },

      clearRunsForProject: (projectId) => {
        set((s) => ({
          runs: s.runs.filter((r) => r.projectId !== projectId),
          activeRunId: s.runs.some((r) => r.projectId === projectId && r.id === s.activeRunId) ? null : s.activeRunId,
          dismissedVerifyFixNoticeRunIds: s.dismissedVerifyFixNoticeRunIds.filter((id) =>
            s.runs.some((r) => r.id === id && r.projectId !== projectId)
          ),
        }))
      },

      addStep: (runId, step) => {
        const newStep: RunStep = {
          id: uid('step'),
          label: step.label,
          status: 'queued',
          command: step.command,
        }
        set((s) => ({
          runs: s.runs.map((r) =>
            r.id === runId ? { ...r, steps: [...r.steps, newStep], updatedAt: now() } : r
          ),
        }))
        return newStep
      },

      setStepStatus: (runId, stepId, status, error) => {
        set((s) => ({
          runs: s.runs.map((r) => {
            if (r.id !== runId) return r
            return {
              ...r,
              steps: r.steps.map((st) => {
                if (st.id !== stepId) return st
                const startedAt = status === 'running' ? now() : st.startedAt
                const endedAt = status === 'success' || status === 'error' || status === 'skipped' ? now() : st.endedAt
                return { ...st, status, startedAt, endedAt, error }
              }),
              updatedAt: now(),
            }
          }),
        }))
      },

      setRunStatus: (runId, status) => {
        set((s) => ({
          runs: s.runs.map((r) => (r.id === runId ? { ...r, status, updatedAt: now() } : r)),
        }))
      },

      appendLog: (runId, entry) => {
        const log: RunLogEntry = { id: uid('log'), ts: now(), ...entry }
        set((s) => ({
          runs: s.runs.map((r) => {
            if (r.id !== runId) return r
            const logs = [...r.logs, log]
            return { ...r, logs: logs.slice(Math.max(0, logs.length - MAX_LOGS_PER_RUN)), updatedAt: now() }
          }),
        }))
        return log
      },
    }),
    {
      name: 'anzar-runs',
      version: 1,
      partialize: (s) => ({
        runs: s.runs,
        activeRunId: s.activeRunId,
        dismissedVerifyFixNoticeRunIds: s.dismissedVerifyFixNoticeRunIds,
      }),
      onRehydrateStorage: () => () => {
        try {
          const s = useRunStore.getState()
          const runs = (s.runs || []).slice(0, MAX_RUNS).map((r) => ({
            ...r,
            logs: (r.logs || []).slice(-(MAX_LOGS_PER_RUN)),
          }))
          const runIds = new Set(runs.map((r) => r.id))
          const activeRunId = s.activeRunId && runIds.has(s.activeRunId) ? s.activeRunId : (runs[0]?.id ?? null)
          const dismissed = (s.dismissedVerifyFixNoticeRunIds || []).filter((id) => runIds.has(id)).slice(-200)
          useRunStore.setState({ runs, activeRunId, dismissedVerifyFixNoticeRunIds: dismissed })
        } catch {
          // ignore
        }
      },
    }
  )
)
