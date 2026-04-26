import React, { useMemo, useState } from 'react'
import { Activity, ChevronUp, ChevronDown, Trash2, Square, CornerUpLeft, Play, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { useCommandStore } from '@/stores/commandStore'
import { commandCardService } from '@/services/commandCardService'
import { useSettingsStore } from '@/stores/settingsStore'
import { assessCommandRisk } from '@/services/commandRisk'
import { isAllowlistedForAutoRun } from '@/services/commandAutoPolicy'

export default function BackgroundTasksDock() {
  const [open, setOpen] = useState(true)
  const [filter, setFilter] = useState<'all' | 'running' | 'pending' | 'error' | 'success'>('all')
  const [query, setQuery] = useState('')
  const order = useCommandStore((s) => s.order)
  const cards = useCommandStore((s) => s.cards)
  const clearFinished = useCommandStore((s) => s.clearFinished)
  const stopAllRunning = useCommandStore((s) => s.stopAllRunning)
  const setActiveCard = useCommandStore((s) => s.setActiveCard)
  const settings = useSettingsStore((s) => s.settings)

  const running = useMemo(() => order.map((id) => cards[id]).filter(Boolean).filter((c) => c.status === 'running'), [order, cards])
  const pending = useMemo(() => order.map((id) => cards[id]).filter(Boolean).filter((c) => c.status === 'suggested'), [order, cards])
  const finished = useMemo(
    () => order.map((id) => cards[id]).filter(Boolean).filter((c) => c.status !== 'running' && c.status !== 'suggested'),
    [order, cards]
  )

  const count = running.length + pending.length
  if (count === 0) return null

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase()
    return order
      .map((id) => cards[id])
      .filter(Boolean)
      .filter((c) => {
        if (filter === 'running') return c.status === 'running'
        if (filter === 'pending') return c.status === 'suggested'
        if (filter === 'error') return c.status === 'error'
        if (filter === 'success') return c.status === 'success'
        return true
      })
      .filter((c) => {
        if (!q) return true
        return (
          (c.title || '').toLowerCase().includes(q) ||
          (c.command || '').toLowerCase().includes(q) ||
          (c.messageId || '').toLowerCase().includes(q)
        )
      })
  }, [order, cards, filter, query])

  const groups = useMemo(() => {
    const map = new Map<string, typeof filteredCards>()
    for (const c of filteredCards) {
      const key = c.messageId || 'unknown'
      const list = map.get(key) || []
      list.push(c)
      map.set(key, list)
    }
    // Sort cards in each group: running first, then suggested, then finished by recency
    for (const [k, list] of map.entries()) {
      map.set(
        k,
        list.sort((a, b) => {
          const score = (s: string) => (s === 'running' ? 0 : s === 'suggested' ? 1 : 2)
          const ds = score(a.status) - score(b.status)
          if (ds !== 0) return ds
          const ta = (a.endedAt ?? a.startedAt ?? a.createdAt) || 0
          const tb = (b.endedAt ?? b.startedAt ?? b.createdAt) || 0
          return tb - ta
        })
      )
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [filteredCards])

  const runAllSafe = async (messageId: string) => {
    const list = groups.find((g) => g[0] === messageId)?.[1] || []
    for (const c of list) {
      if (c.status !== 'suggested') continue
      if (!c.projectPath) continue
      const risk = assessCommandRisk(c.command)
      if (risk.level === 'danger') continue
      // Must be allowlisted for bulk run
      if (!isAllowlistedForAutoRun(c.command)) continue
      await commandCardService.run(c.id)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[90] w-[min(360px,92vw)]">
      <div className="rounded-2xl border border-border-medium bg-bg-secondary/95 backdrop-blur-xl shadow-2xl overflow-hidden">
        <button
          className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-surface-hover transition-colors"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent-primary" />
            <span className="text-sm font-semibold text-text-primary">Tâches</span>
            <span className="text-xs text-text-muted">({count})</span>
          </div>
          {open ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronUp className="w-4 h-4 text-text-muted" />}
        </button>

        {open && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-text-muted">
                En cours: {running.length} · En attente: {pending.length} · Terminées: {finished.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="xs"
                  leftIcon={Square}
                  onClick={() => void stopAllRunning()}
                  disabled={running.length === 0}
                >
                  Stop all
                </Button>
                <Button variant="ghost" size="xs" leftIcon={Trash2} onClick={() => clearFinished()}>
                  Nettoyer
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-bg-tertiary/40 px-2 py-1 flex-1">
                <Search className="w-4 h-4 text-text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filtrer…"
                  className="bg-transparent outline-none text-xs text-text-primary w-full"
                />
              </div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className={cn('px-2 py-1 rounded-lg text-xs bg-bg-tertiary/40 border border-border-subtle text-text-primary')}
              >
                <option value="all">Tous</option>
                <option value="running">En cours</option>
                <option value="pending">En attente</option>
                <option value="error">Erreurs</option>
                <option value="success">Succès</option>
              </select>
            </div>

            <div className="space-y-2 max-h-[180px] overflow-auto">
              {groups.length === 0 ? (
                <div className="text-xs text-text-muted px-2 py-2">Aucune tâche.</div>
              ) : (
                groups.map(([messageId, list]) => {
                  const groupTitle =
                    messageId.startsWith('run:') ? `Run ${messageId.slice(4)}` : messageId.startsWith('msg_') ? 'Chat' : messageId
                  const canBulkRun = list.some((c) => c.status === 'suggested' && !!c.projectPath && isAllowlistedForAutoRun(c.command))

                  return (
                    <div key={messageId} className="rounded-lg border border-border-subtle bg-bg-tertiary/30 overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border-subtle/60">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-text-secondary truncate">
                            {groupTitle} <span className="text-text-muted">({list.length})</span>
                          </p>
                        </div>
                        {canBulkRun && (
                          <Button
                            variant="outline"
                            size="xs"
                            leftIcon={Play}
                            onClick={() => void runAllSafe(messageId)}
                            title="Exécute toutes les commandes allowlistées (safe)"
                          >
                            Run all (safe)
                          </Button>
                        )}
                      </div>

                      <div className="divide-y divide-border-subtle/50">
                        {list.slice(0, 6).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setActiveCard(c.id)}
                            className={cn('w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors')}
                            title="Ouvrir la carte"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-text-primary truncate">{c.title}</p>
                                <p className="text-[11px] font-mono text-text-secondary truncate">{c.command}</p>
                              </div>
                              <CornerUpLeft className="w-4 h-4 text-text-muted flex-shrink-0" />
                            </div>
                            <p
                              className={cn(
                                'text-[11px] mt-1',
                                c.status === 'running'
                                  ? 'text-accent-warning'
                                  : c.status === 'suggested'
                                    ? 'text-text-muted'
                                    : c.status === 'success'
                                      ? 'text-accent-success'
                                      : c.status === 'error'
                                        ? 'text-accent-error'
                                        : 'text-text-muted'
                              )}
                            >
                              {c.status === 'running'
                                ? 'Running…'
                                : c.status === 'suggested'
                                  ? 'En attente (Run)'
                                  : c.status === 'success'
                                    ? 'Succès'
                                    : c.status === 'error'
                                      ? 'Erreur'
                                      : 'Terminé'}
                            </p>
                          </button>
                        ))}
                        {list.length > 6 && (
                          <div className="px-3 py-2 text-[11px] text-text-muted">
                            … et {list.length - 6} autre(s)
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
