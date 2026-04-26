import { terminalService, type TerminalEvent } from '@/services/terminal'
import { useRunStore } from '@/stores/runStore'
import { detectProjectKind, type ProjectKind, type RunActionId, RUN_ACTIONS } from '@/services/runActions'
import { fileSystemService } from '@/services/fileSystem'
import { diagnosticService } from '@/services/diagnostic'
import { useCommandStore } from '@/stores/commandStore'
import { shouldAutoRunCommand } from '@/services/commandAutoPolicy'
import { useSettingsStore } from '@/stores/settingsStore'
import { commandCardService } from '@/services/commandCardService'
import { useChangeStore } from '@/stores/changeStore'

type ProcContext = { runId: string; stepId: string }
type RunnerState = {
  projectId: string
  projectPath: string
  kind: ProjectKind
  stepIds: string[]
  stepCmds: string[]
  current: number
}

class RunService {
  private procToCtx = new Map<string, ProcContext>()
  private runners = new Map<string, RunnerState>() // runId -> state
  private unsub: (() => void) | null = null
  private handledRunFinish = new Set<string>()

  constructor() {
    this.ensureSubscribed()
  }

  private ensureSubscribed() {
    if (this.unsub) return
    this.unsub = terminalService.onEvent((event: TerminalEvent) => this.onTerminalEvent(event))
  }

  private onTerminalEvent(event: TerminalEvent) {
    if (event.type === 'output') {
      const ctx = this.procToCtx.get(event.processId)
      if (!ctx) return

      const level =
        event.data.type === 'stdout'
          ? 'stdout'
          : event.data.type === 'stderr'
            ? 'stderr'
            : event.data.type === 'success'
              ? 'success'
              : event.data.type === 'error'
                ? 'error'
                : 'system'

      useRunStore.getState().appendLog(ctx.runId, {
        level,
        message: event.data.content,
        stepId: ctx.stepId,
      })
      return
    }

    if (event.type === 'process-end') {
      const ctx = this.procToCtx.get(event.processId)
      if (!ctx) return
      const ok = event.exitCode === 0
      useRunStore.getState().setStepStatus(ctx.runId, ctx.stepId, ok ? 'success' : 'error', ok ? undefined : `Exit code ${event.exitCode}`)
      this.procToCtx.delete(event.processId)

      // Pipeline runner: start next step on success
      if (ok) {
        const started = this.startNextStep(ctx.runId)
        if (started) return
      } else {
        useRunStore.getState().setRunStatus(ctx.runId, 'error')
        void this.onRunFinished(ctx.runId, 'error')
        this.runners.delete(ctx.runId)
        return
      }

      // No more steps -> finalize
      const run = useRunStore.getState().runs.find((r) => r.id === ctx.runId)
      if (run) {
        const hasError = run.steps.some((s) => s.status === 'error')
        useRunStore.getState().setRunStatus(ctx.runId, hasError ? 'error' : 'success')
        void this.onRunFinished(ctx.runId, hasError ? 'error' : 'success')
      }
      this.runners.delete(ctx.runId)
      return
    }

    if (event.type === 'process-error') {
      const ctx = this.procToCtx.get(event.processId)
      if (!ctx) return
      useRunStore.getState().setStepStatus(ctx.runId, ctx.stepId, 'error', event.error)
      useRunStore.getState().setRunStatus(ctx.runId, 'error')
      this.procToCtx.delete(event.processId)
      this.runners.delete(ctx.runId)
      void this.onRunFinished(ctx.runId, 'error')
    }
  }

  private async onRunFinished(runId: string, status: 'success' | 'error') {
    this.gcHandledRunFinish()
    if (this.handledRunFinish.has(runId)) return
    this.handledRunFinish.add(runId)

    if (status !== 'error') return

    const state = this.runners.get(runId)
    const run = useRunStore.getState().runs.find((r) => r.id === runId)
    if (!state || !run) return

    // Collect tail of logs
    const tail = run.logs.slice(-500).map((l) => `[${l.level}] ${l.message}`).join('\n')

    const report = await diagnosticService.analyzeErrors(tail, { projectPath: state.projectPath })

    // Propose solutions as Command Cards (Cowork)
    const ensureCard = useCommandStore.getState().ensureCard
    const settings = useSettingsStore.getState().settings
    let i = 0
    let changeSetId: string | null = null

    for (const sol of report.solutions) {
      // Code/config changes: queue as a changeset (Preview/Apply)
      if (sol.fixAction?.type === 'edit_file' || sol.fixAction?.type === 'config_change') {
        const rawPath = String((sol.fixAction as any).filePath || '').trim()
        const content = String((sol.fixAction as any).content || '')
        if (rawPath && content) {
          const normalizedProject = state.projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
          const normalizedFile = rawPath.replace(/\\/g, '/')
          const rel = normalizedFile.startsWith(normalizedProject)
            ? normalizedFile.slice(normalizedProject.length).replace(/^\/+/, '')
            : normalizedFile.replace(/^\/+/, '')

          const op = { type: 'edit' as const, path: rel, content }
          if (!changeSetId) {
            const cs = useChangeStore.getState().queue(state.projectId, `Fix code: ${sol.title}`, [op])
            changeSetId = cs.id
          } else {
            useChangeStore.getState().appendOperations(state.projectId, changeSetId, [op])
          }
        }
        continue
      }

      const cmd =
        sol.fixAction?.type === 'command'
          ? sol.fixAction.command
          : sol.fixAction?.type === 'install_package'
            ? sol.fixAction.command
            : undefined
      if (!cmd) continue

      const cardId = `runfix::${runId}::${i++}`
      ensureCard({
        id: cardId,
        messageId: `run:${runId}`,
        title: `Fix: ${sol.title}`,
        command: cmd,
        projectId: state.projectId,
        projectPath: state.projectPath,
      })

      // Auto-run allowlist if enabled
      const auto = shouldAutoRunCommand(cmd, settings)
      if (auto.ok) {
        void commandCardService.run(cardId)
      }
    }

    if (changeSetId) {
      useRunStore.getState().appendLog(runId, {
        level: 'system',
        message: `Changements proposés: ouvre Runs → Preview → Appliquer (changeset ${changeSetId}).`,
      })
    }

    // Also append a short run log summary
    useRunStore.getState().appendLog(runId, {
      level: 'system',
      message: `Diagnostic: ${report.summary}`,
    })
  }

  /**
   * Evite la croissance infinie du Set (runs sont déjà bornés dans le store).
   */
  private gcHandledRunFinish() {
    const runs = useRunStore.getState().runs
    const alive = new Set(runs.map((r) => r.id))
    if (this.handledRunFinish.size <= Math.max(80, runs.length * 2)) {
      // Still, remove ids no longer present.
      for (const id of this.handledRunFinish) {
        if (!alive.has(id)) this.handledRunFinish.delete(id)
      }
      return
    }
    // Hard prune: keep only currently alive run ids.
    this.handledRunFinish = new Set(Array.from(this.handledRunFinish).filter((id) => alive.has(id)))
  }

  private startNextStep(runId: string): boolean {
    const state = this.runners.get(runId)
    if (!state) return false

    // Find next queued step
    while (state.current < state.stepIds.length) {
      const stepId = state.stepIds[state.current]
      const cmd = state.stepCmds[state.current]
      state.current++

      if (!cmd) continue
      useRunStore.getState().setStepStatus(runId, stepId, 'running')
      useRunStore.getState().appendLog(runId, { level: 'system', message: `Exécution: ${cmd}`, stepId })

      void terminalService.runCommand(cmd, {
        cwd: state.projectPath,
        onProcessId: (pid) => this.procToCtx.set(pid, { runId, stepId }),
      })
      return true
    }

    return false
  }

  private resolveActionCommand(actionId: RunActionId, projectPath: string, kind: ProjectKind): { label: string; cmd: string } | null {
    const action = RUN_ACTIONS.find((a) => a.id === actionId)
    if (!action) return null
    const cmd = action.command({ projectPath, kind })
    if (!cmd) return null
    return { label: action.label, cmd }
  }

  async executePipeline(payload: { projectId: string; projectPath: string; title: string; actionIds: RunActionId[] }): Promise<string> {
    const { projectId, projectPath, title, actionIds } = payload
    const kind = await detectProjectKind(projectPath)

    const run = useRunStore.getState().createRun({ projectId, title })
    useRunStore.getState().setRunStatus(run.id, 'running')

    const stepIds: string[] = []
    const stepCmds: string[] = []

    for (const actionId of actionIds) {
      const resolved = this.resolveActionCommand(actionId, projectPath, kind)
      if (!resolved) continue
      const step = useRunStore.getState().addStep(run.id, {
        label: resolved.label,
        command: { cmd: resolved.cmd, args: [], cwd: projectPath },
      })
      stepIds.push(step.id)
      stepCmds.push(resolved.cmd)
    }

    if (stepIds.length === 0) {
      useRunStore.getState().appendLog(run.id, { level: 'error', message: 'Aucun step exécutable pour ce projet.' })
      useRunStore.getState().setRunStatus(run.id, 'error')
      return run.id
    }

    this.runners.set(run.id, { projectId, projectPath, kind, stepIds, stepCmds, current: 0 })
    this.startNextStep(run.id)
    return run.id
  }

  /**
   * Vérification "smart" : build + tests si disponibles.
   * - Node: build si script présent, tests si script présent
   * - Rust: build + test
   * - Python: tests (pytest)
   */
  async executeVerifyPipeline(payload: { projectId: string; projectPath: string }): Promise<string> {
    const { projectId, projectPath } = payload
    const kind = await detectProjectKind(projectPath)

    let actionIds: RunActionId[] = []

    if (kind === 'node') {
      try {
        const pkgStr = await fileSystemService.readFile(`${projectPath}/package.json`)
        const pkg = JSON.parse(pkgStr)
        const scripts = pkg?.scripts || {}
        if (scripts.build) actionIds.push('build')
        if (scripts.test) actionIds.push('test')
        if (actionIds.length === 0) actionIds = ['test']
      } catch {
        actionIds = ['build', 'test']
      }
    } else if (kind === 'rust') {
      actionIds = ['build', 'test']
    } else if (kind === 'python') {
      actionIds = ['test']
    } else {
      actionIds = ['test']
    }

    return this.executePipeline({
      projectId,
      projectPath,
      title: 'Vérifier le projet',
      actionIds,
    })
  }

  async executeAction(payload: { projectId: string; projectPath: string; actionId: RunActionId }): Promise<string> {
    const { projectId, projectPath, actionId } = payload
    const action = RUN_ACTIONS.find((a) => a.id === actionId)
    if (!action) throw new Error(`Action inconnue: ${actionId}`)

    // Single-step pipeline
    return this.executePipeline({
      projectId,
      projectPath,
      title: `Action: ${action.label}`,
      actionIds: [actionId],
    })
  }
}

export const runService = new RunService()
