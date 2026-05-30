import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square, RotateCcw, Terminal, Trash2, Copy, ChevronDown, ChevronUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { commandCardService } from '@/services/commands/commandCardService'
import { useCommandStore, type CommandCard as CommandCardType } from '@/stores/commandStore'
import { assessCommandRisk } from '@/services/commands/commandRisk'
import { detectToolFromCommand, devToolInstallUrl, devToolLabel } from '@/services/infra/devToolLinks'
import { openExternalUrl } from '@/services/infra/externalLinks'

function badgeVariant(status: CommandCardType['status']) {
  if (status === 'running') return 'warning'
  if (status === 'success') return 'success'
  if (status === 'error') return 'error'
  if (status === 'killed') return 'ghost'
  return 'outline'
}

export default function CommandCard({ cardId }: { cardId: string }) {
  const card = useCommandStore((s) => s.cards[cardId])
  const remove = useCommandStore((s) => s.removeCard)
  const toggleCollapsed = useCommandStore((s) => s.toggleCollapsed)
  const activeCardId = useCommandStore((s) => s.activeCardId)
  const setActiveCard = useCommandStore((s) => s.setActiveCard)
  const [copiedCmd, setCopiedCmd] = useState(false)
  const [copiedLogs, setCopiedLogs] = useState(false)
  const logsRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const canRun = !!card && card.status !== 'running'
  const canKill = !!card && card.status === 'running' && !!card.processId

  const shortCmd = useMemo(() => {
    if (!card) return ''
    return card.command.length > 120 ? card.command.slice(0, 120) + '…' : card.command
  }, [card])

  if (!card) return null
  const isActive = activeCardId === cardId
  const risk = useMemo(() => assessCommandRisk(card.command), [card.command])

  const riskVariant =
    risk.level === 'safe' ? 'success' : risk.level === 'warning' ? 'warning' : 'error'
  const riskLabel =
    risk.level === 'safe' ? 'Sûr' : risk.level === 'warning' ? 'Risqué' : 'Dangereux'

  const durationMs = (card.startedAt ? (card.endedAt ?? Date.now()) - card.startedAt : 0)
  const durationStr = card.startedAt
    ? `${Math.max(0, Math.round(durationMs / 100) / 10).toFixed(1)}s`
    : '—'

  const handleCopyCmd = async () => {
    await navigator.clipboard.writeText(card.command)
    setCopiedCmd(true)
    setTimeout(() => setCopiedCmd(false), 1200)
  }

  const handleCopyLogs = async () => {
    const text = card.logs.map((l) => l.content).join('\n')
    await navigator.clipboard.writeText(text)
    setCopiedLogs(true)
    setTimeout(() => setCopiedLogs(false), 1200)
  }

  const jumpBottom = () => {
    const el = logsRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }

  // Auto-scroll logs while running
  useEffect(() => {
    if (card.status !== 'running') return
    jumpBottom()
  }, [card.status, card.logs.length])

  // Scroll into view when selected from dock
  useEffect(() => {
    if (isActive) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [isActive])

  const missingTool = useMemo(() => {
    if (card.status !== 'error') return null
    const tool = detectToolFromCommand(card.command)
    if (!tool) return null
    const text = card.logs.map((l) => l.content).join('\n').toLowerCase()
    const looksMissing =
      text.includes('command not found') ||
      text.includes('not recognized as an internal or external command') ||
      text.includes('no such file or directory') ||
      text.includes('executable file not found')
    return looksMissing ? tool : null
  }, [card.status, card.command, card.logs])

  return (
    <div
      ref={rootRef}
      className={cn(
        'mt-2 rounded-xl border bg-bg-tertiary/30 overflow-hidden',
        isActive ? 'border-accent-primary/40 shadow-lg' : 'border-border-subtle'
      )}
      onMouseEnter={() => setActiveCard(cardId)}
    >
      <div className="flex items-start justify-between gap-3 px-3 py-2 border-b border-border-subtle">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-accent-primary" />
            <p className="text-xs font-semibold text-text-primary truncate">{card.title}</p>
            <Badge variant={badgeVariant(card.status) as any} className="capitalize">
              {card.status}
            </Badge>
            <Badge
              variant={riskVariant as any}
              title={risk.reason}
            >
              {riskLabel}
            </Badge>
            {typeof card.exitCode === 'number' && (
              <span className={cn('text-[11px] font-mono', card.exitCode === 0 ? 'text-accent-success' : 'text-accent-error')}>
                exit {card.exitCode}
              </span>
            )}
          </div>
          <p className="text-[11px] font-mono text-text-secondary mt-1 break-words">{shortCmd}</p>
          <div className="mt-1 text-[11px] text-text-muted flex flex-wrap gap-x-3 gap-y-1">
            <span>Durée: {durationStr}</span>
            {card.projectPath && <span className="truncate">Dossier: {card.projectPath}</span>}
          </div>
          {!card.projectPath && (
            <p className="text-[11px] text-accent-warning mt-1">
              Sélectionne un projet local pour exécuter cette commande.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="xs"
            leftIcon={Play}
            disabled={!canRun || !card.projectPath}
            onClick={() => void commandCardService.run(cardId)}
            title="Exécuter"
          >
            Run
          </Button>
          <Button
            variant="ghost"
            size="xs"
            leftIcon={Square}
            disabled={!canKill}
            onClick={() => void commandCardService.kill(cardId)}
            title="Arrêter"
          >
            Stop
          </Button>
          <Button
            variant="ghost"
            size="xs"
            leftIcon={RotateCcw}
            disabled={card.status === 'running' || !card.projectPath}
            onClick={() => void commandCardService.retry(cardId)}
            title="Relancer"
          >
            Retry
          </Button>
          <Button variant="ghost" size="xs" leftIcon={Copy} onClick={() => void handleCopyCmd()} title="Copier commande">
            {copiedCmd ? 'Copié' : 'Cmd'}
          </Button>
          <Button variant="ghost" size="xs" leftIcon={Copy} onClick={() => void handleCopyLogs()} title="Copier logs">
            {copiedLogs ? 'Copié' : 'Logs'}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            leftIcon={card.collapsed ? ChevronDown : ChevronUp}
            onClick={() => toggleCollapsed(cardId)}
            title={card.collapsed ? 'Afficher logs' : 'Masquer logs'}
          >
            {card.collapsed ? 'Show' : 'Hide'}
          </Button>
          <Button variant="ghost" size="xs" leftIcon={Trash2} onClick={() => remove(cardId)} title="Supprimer">
            Remove
          </Button>
        </div>
      </div>

      {!card.collapsed && (
        <div className="relative">
          <div className="absolute right-2 top-2 z-10">
            <Button variant="outline" size="xs" leftIcon={ArrowDown} onClick={jumpBottom} title="Aller en bas">
              Bas
            </Button>
          </div>
          <div ref={logsRef} className="max-h-[200px] overflow-auto pt-9">
        {card.logs.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-text-muted">Aucun log.</div>
        ) : (
          card.logs.slice(-250).map((l) => (
            <div
              key={l.id}
              className={cn(
                'px-3 py-1 text-[11px] font-mono whitespace-pre-wrap break-words border-b border-border-subtle/40',
                l.type === 'stderr' || l.type === 'error'
                  ? 'text-accent-error bg-accent-error/5'
                  : l.type === 'success'
                    ? 'text-accent-success bg-accent-success/5'
                    : l.type === 'system'
                      ? 'text-accent-info bg-accent-info/5'
                      : 'text-text-primary'
              )}
            >
              {l.content}
            </div>
          ))
        )}
          </div>
        </div>
      )}

      {missingTool && (
        <div className="px-3 py-3 border-t border-border-subtle bg-bg-secondary/40">
          <p className="text-xs text-text-secondary">
            <span className="font-semibold">{devToolLabel(missingTool)}</span> introuvable.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Button
              variant="outline"
              size="xs"
              onClick={() => void openExternalUrl(devToolInstallUrl(missingTool))}
            >
              Installer
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void commandCardService.retry(cardId)}
              disabled={!card.projectPath}
              title="Relancer après installation"
            >
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
