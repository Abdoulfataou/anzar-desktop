export type RunStatus = 'queued' | 'running' | 'success' | 'error' | 'canceled'

export type RunStepStatus = 'queued' | 'running' | 'success' | 'error' | 'skipped'

export type RunLogLevel = 'system' | 'stdout' | 'stderr' | 'info' | 'warn' | 'error' | 'success'

export type RunLogEntry = {
  id: string
  ts: number
  level: RunLogLevel
  message: string
  stepId?: string
}

export type RunStep = {
  id: string
  label: string
  status: RunStepStatus
  startedAt?: number
  endedAt?: number
  command?: { cmd: string; args: string[]; cwd?: string }
  error?: string
}

export type Run = {
  id: string
  projectId: string
  title: string
  status: RunStatus
  createdAt: number
  updatedAt: number
  steps: RunStep[]
  logs: RunLogEntry[]
}

