import { terminalService, type TerminalEvent } from '@/services/terminal'
import { useCommandStore } from '@/stores/commandStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { assessCommandRisk } from '@/services/commandRisk'
import { runService } from '@/services/runService'
import { useRunStore } from '@/stores/runStore'

/**
 * Service central pour synchroniser les CommandCards avec TerminalService.
 * - Exécution/kill/retry
 * - Streaming logs
 */
class CommandCardService {
  private unsub: (() => void) | null = null
  private processToCard = new Map<string, string>() // processId -> cardId
  private verifyTimers = new Map<string, any>() // projectId -> timeoutId

  constructor() {
    this.ensureSubscribed()
  }

  private shouldAutoVerifyAfterCard(cardId: string): boolean {
    const card = useCommandStore.getState().cards[cardId]
    if (!card) return false
    // Only for "Fix: ..." cards (produced by diagnostic loop)
    return typeof card.title === 'string' && card.title.trim().toLowerCase().startsWith('fix:')
  }

  private scheduleVerify(projectId: string, projectPath: string, sourceCardId: string) {
    // Debounce: if multiple fix commands finish, verify once.
    const prev = this.verifyTimers.get(projectId)
    if (prev) clearTimeout(prev)

    const t = setTimeout(async () => {
      try {
        // Anti-spam: if a verify is already running/queued, skip.
        const existing = useRunStore
          .getState()
          .runs.find((r) => r.projectId === projectId && r.title === 'Vérifier le projet' && (r.status === 'queued' || r.status === 'running'))
        if (existing) return

        useCommandStore.getState().appendLog(sourceCardId, { type: 'system', content: '✅ Fix appliqué — vérification en cours…' })
        await runService.executeVerifyPipeline({ projectId, projectPath })
      } catch (err: any) {
        useCommandStore.getState().appendLog(sourceCardId, { type: 'error', content: `Auto-verify échoué: ${err?.message || String(err)}` })
      }
    }, 1200)

    this.verifyTimers.set(projectId, t)
  }

  private ensureSubscribed() {
    if (this.unsub) return
    this.unsub = terminalService.onEvent((e: TerminalEvent) => this.onTerminalEvent(e))
  }

  private onTerminalEvent(e: TerminalEvent) {
    if (e.type === 'output') {
      const cardId = this.processToCard.get(e.processId)
      if (!cardId) return
      useCommandStore.getState().appendLog(cardId, { type: e.data.type, content: e.data.content, ts: e.data.timestamp })
      return
    }

    if (e.type === 'process-end') {
      const cardId = this.processToCard.get(e.processId)
      if (!cardId) return
      const ok = e.exitCode === 0
      useCommandStore.getState().setCard(cardId, {
        status: ok ? 'success' : 'error',
        exitCode: e.exitCode,
        endedAt: Date.now(),
      })
      this.processToCard.delete(e.processId)

      // Auto-verify after successful Fix command
      if (ok && this.shouldAutoVerifyAfterCard(cardId)) {
        const card = useCommandStore.getState().cards[cardId]
        if (card?.projectId && card.projectPath) {
          this.scheduleVerify(card.projectId, card.projectPath, cardId)
        }
      }
      return
    }

    if (e.type === 'process-error') {
      const cardId = this.processToCard.get(e.processId)
      if (!cardId) return
      useCommandStore.getState().appendLog(cardId, { type: 'error', content: e.error })
      useCommandStore.getState().setCard(cardId, { status: 'error', endedAt: Date.now() })
      this.processToCard.delete(e.processId)
    }
  }

  async run(cardId: string): Promise<void> {
    const card = useCommandStore.getState().cards[cardId]
    if (!card) return
    if (card.status === 'running') return
    if (!card.projectPath) {
      useCommandStore.getState().appendLog(cardId, { type: 'error', content: 'Projet non local: exécution impossible.' })
      useCommandStore.getState().setCard(cardId, { status: 'error' })
      return
    }

    // Confirmations (Cowork safety)
    const settings = useSettingsStore.getState().settings
    const mode = settings.commandExecutionMode || 'manual'
    const risk = assessCommandRisk(card.command)

    // Grand public: on confirme toute commande non-triviale (warning/danger)
    // Et on BLOQUE les commandes "danger" sauf si developerMode est activé.
    if (risk.level === 'danger' && !settings.developerMode) {
      useCommandStore.getState().appendLog(cardId, { type: 'error', content: `⛔ Commande bloquée (sécurité) — ${risk.reason}` })
      useCommandStore.getState().setCard(cardId, { status: 'error', endedAt: Date.now() })
      return
    }

    const needsConfirm = mode === 'always_ask' || risk.level !== 'safe'
    if (needsConfirm) {
      const msg =
        mode === 'always_ask'
          ? `Exécuter cette commande ?\n\n${card.command}`
          : risk.level === 'danger'
            ? `⚠️ Commande très risquée (${risk.reason}).\n\nExécuter quand même ?\n\n${card.command}`
            : `⚠️ Cette commande peut modifier ton projet (${risk.reason}).\n\nExécuter ?\n\n${card.command}`

      if ((await this.confirm(msg)) === false) {
        useCommandStore.getState().appendLog(cardId, { type: 'system', content: '⏸ Exécution annulée' })
        return
      }
    }

    useCommandStore.getState().setCard(cardId, { status: 'running', startedAt: Date.now(), endedAt: undefined, exitCode: undefined })
    useCommandStore.getState().appendLog(cardId, { type: 'system', content: `$ ${card.command}` })

    await terminalService.runCommand(card.command, {
      cwd: card.projectPath,
      onProcessId: (pid) => {
        this.processToCard.set(pid, cardId)
        useCommandStore.getState().setCard(cardId, { processId: pid })
      },
    })
  }

  private async confirm(message: string): Promise<boolean> {
    // Tauri: use native dialog, else fallback to window.confirm
    try {
      const { confirm } = await import('@tauri-apps/api/dialog')
      return await confirm(message, { title: 'Confirmer', type: 'warning' })
    } catch {
      return window.confirm(message)
    }
  }

  async kill(cardId: string): Promise<void> {
    const card = useCommandStore.getState().cards[cardId]
    if (!card?.processId) return
    await terminalService.killProcess(card.processId)
    useCommandStore.getState().setCard(cardId, { status: 'killed', endedAt: Date.now() })
    this.processToCard.delete(card.processId)
  }

  async retry(cardId: string): Promise<void> {
    // Clear logs but keep history of status? simple reset.
    useCommandStore.getState().setCard(cardId, { logs: [], processId: undefined, exitCode: undefined, startedAt: undefined, endedAt: undefined, status: 'suggested' } as any)
    await this.run(cardId)
  }
}

export const commandCardService = new CommandCardService()
