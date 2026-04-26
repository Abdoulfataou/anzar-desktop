import React, { useMemo } from 'react'
import { AlertTriangle, X, CornerUpLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { useRunStore } from '@/stores/runStore'
import { useCommandStore } from '@/stores/commandStore'

/**
 * Petit message inline (Cowork-like) quand "Vérifier le projet" échoue
 * et que des correctifs ont été proposés sous forme de Command Cards.
 */
export default function VerifyFixNotice() {
  const runs = useRunStore((s) => s.runs)
  const dismissed = useRunStore((s) => s.dismissedVerifyFixNoticeRunIds)
  const dismiss = useRunStore((s) => s.dismissVerifyFixNotice)
  const cards = useCommandStore((s) => s.cards)
  const order = useCommandStore((s) => s.order)
  const setActiveCard = useCommandStore((s) => s.setActiveCard)

  const latestVerifyRun = useMemo(() => {
    return runs.find((r) => r.title === 'Vérifier le projet') || null
  }, [runs])

  const fixCardIds = useMemo(() => {
    if (!latestVerifyRun) return []
    const mid = `run:${latestVerifyRun.id}`
    return order
      .map((id) => cards[id])
      .filter(Boolean)
      .filter((c) => c.messageId === mid)
      .map((c) => c.id)
  }, [latestVerifyRun, order, cards])

  const fixTitles = useMemo(() => {
    return fixCardIds
      .map((id) => cards[id]?.title)
      .filter(Boolean)
      .slice(0, 3) as string[]
  }, [fixCardIds, cards])

  if (!latestVerifyRun) return null
  if (latestVerifyRun.status !== 'error') return null
  if (fixCardIds.length === 0) return null
  if (dismissed.includes(latestVerifyRun.id)) return null

  return (
    <div className="px-4 sm:px-6 pb-2">
      <div className="max-w-4xl mx-auto">
        <div className="rounded-2xl border border-accent-warning/30 bg-accent-warning/5 backdrop-blur-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-accent-warning mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary">
              Vérification échouée — {fixCardIds.length} correctif(s) proposé(s)
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              Ouvre les cartes “Fix: …” pour exécuter les commandes de correction.
            </p>
            {fixTitles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {fixTitles.map((t, idx) => (
                  <li key={idx} className="text-xs text-text-secondary truncate">
                    • {t.replace(/^Fix:\s*/i, '')}
                  </li>
                ))}
                {fixCardIds.length > 3 && (
                  <li className="text-xs text-text-muted">• … et {fixCardIds.length - 3} autre(s)</li>
                )}
              </ul>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="outline"
                size="xs"
                leftIcon={CornerUpLeft}
                onClick={() => setActiveCard(fixCardIds[0])}
              >
                Voir correctifs
              </Button>
            </div>
          </div>
          <button
            className={cn('p-1.5 rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors')}
            title="Fermer"
            onClick={() => dismiss(latestVerifyRun.id)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
