import React, { useEffect, useMemo, useState } from 'react'
import { Play, RotateCcw, X, Terminal, History, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { useRunStore } from '@/stores/runStore'
import { useChangeStore } from '@/stores/changeStore'
import { detectProjectKind, getActionsForKind, type ProjectKind, type RunAction } from '@/services/runActions'
import { runService } from '@/services/runService'
import ChangePreviewModal from '@/components/runs/ChangePreviewModal'
import { isTauri } from '@/lib/utils'
import { save } from '@tauri-apps/api/dialog'
import { writeTextFile } from '@tauri-apps/api/fs'

function exportRunAsText(run: any): string {
  const lines: string[] = []
  lines.push(`Run: ${run.title}`)
  lines.push(`Status: ${run.status}`)
  lines.push(`Created: ${new Date(run.createdAt).toISOString()}`)
  lines.push(`Updated: ${new Date(run.updatedAt).toISOString()}`)
  lines.push('')
  if (run.steps?.length) {
    lines.push('Steps:')
    for (const st of run.steps) {
      lines.push(`- ${st.status} ${st.label}${st.error ? ` — ${st.error}` : ''}`)
    }
    lines.push('')
  }
  lines.push('Logs:')
  for (const l of run.logs || []) {
    lines.push(`[${new Date(l.ts).toISOString()}] [${l.level}] ${l.message}`)
  }
  lines.push('')
  return lines.join('\n')
}

function statusVariant(status: string) {
  if (status === 'success') return 'success'
  if (status === 'error') return 'error'
  if (status === 'running') return 'warning'
  if (status === 'canceled') return 'ghost'
  return 'outline'
}

export default function RunPanel({
  projectId,
  projectPath,
  onOpenTerminal,
}: {
  projectId: string
  projectPath?: string
  onOpenTerminal?: () => void
}) {
  const [kind, setKind] = useState<ProjectKind>('unknown')
  const [collapsed, setCollapsed] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)

  const runs = useRunStore((s) => s.runs.filter((r) => r.projectId === projectId))
  const activeRunId = useRunStore((s) => s.activeRunId)
  const setActiveRun = useRunStore((s) => s.setActiveRun)
  const deleteRun = useRunStore((s) => s.deleteRun)
  const pendingSets = useChangeStore((s) => s.pending[projectId] || [])
  const applyPending = useChangeStore((s) => s.apply)
  const removePending = useChangeStore((s) => s.remove)

  const activeRun = useMemo(() => runs.find((r) => r.id === activeRunId) || runs[0] || null, [runs, activeRunId])

  useEffect(() => {
    if (!projectPath) return
    let alive = true
    ;(async () => {
      const k = await detectProjectKind(projectPath)
      if (alive) setKind(k)
    })()
    return () => {
      alive = false
    }
  }, [projectPath])

  const actions: RunAction[] = useMemo(() => getActionsForKind(kind), [kind])

  const runAction = async (actionId: RunAction['id']) => {
    if (!projectPath) return
    await runService.executeAction({ projectId, projectPath, actionId })
  }

  if (!projectPath) return null

  const selectedChangeSet = previewId ? pendingSets.find((p) => p.id === previewId) || null : null

  return (
    <Card className="mx-4 my-3" padding="sm" rounded="xl">
      <CardHeader
        title="Runs"
        description={`Projet: ${kind}`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="xs" onClick={() => setCollapsed((v) => !v)}>
              {collapsed ? 'Afficher' : 'Masquer'}
            </Button>
            <Button variant="ghost" size="xs" leftIcon={Terminal} onClick={onOpenTerminal}>
              Terminal
            </Button>
          </div>
        }
      />

      {!collapsed && (
        <CardContent className="space-y-3">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button
                key={a.id}
                variant="outline"
                size="sm"
                leftIcon={Play}
                onClick={() => void runAction(a.id)}
              >
                {a.label}
              </Button>
            ))}
          </div>

          {/* Run selector */}
          {runs.length > 0 && (
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-text-muted" />
              <select
                className="flex-1 px-3 py-2 rounded-lg text-xs bg-bg-tertiary border border-border-subtle text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                value={activeRun?.id || ''}
                onChange={(e) => setActiveRun(e.target.value || null)}
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — {r.title}
                  </option>
                ))}
              </select>
              {activeRun && (
                <Button variant="ghost" size="xs" leftIcon={X} onClick={() => deleteRun(activeRun.id)}>
                  Supprimer
                </Button>
              )}
            </div>
          )}

          {/* Timeline */}
          {activeRun && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border-subtle bg-bg-secondary/40 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">{activeRun.title}</p>
                    <p className="text-[11px] text-text-muted">
                      {new Date(activeRun.createdAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <Badge variant={statusVariant(activeRun.status) as any} className="capitalize">
                    {activeRun.status}
                  </Badge>
                </div>

                {activeRun.steps.length === 0 ? (
                  <p className="text-xs text-text-muted">Aucun step (lance une action).</p>
                ) : (
                  <div className="space-y-2">
                    {activeRun.steps.map((s) => (
                      <div
                        key={s.id}
                        className={cn(
                          'flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-tertiary/40 px-3 py-2',
                          s.status === 'error' && 'border-accent-error/30'
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-text-primary truncate">{s.label}</p>
                          {s.error && <p className="text-[11px] text-accent-error truncate">{s.error}</p>}
                        </div>
                        <Badge variant={statusVariant(s.status) as any} className="capitalize">
                          {s.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Logs */}
              <div className="rounded-xl border border-border-subtle bg-bg-secondary/40 p-3 overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-text-primary">Logs</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      leftIcon={Download}
                      onClick={async () => {
                        const text = exportRunAsText(activeRun)
                        const safeName = (activeRun.title || 'run')
                          .toLowerCase()
                          .replace(/[^a-z0-9-_]+/g, '_')
                          .slice(0, 40)
                        const filename = `${safeName}_${new Date(activeRun.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`

                        if (isTauri()) {
                          const path = await save({
                            title: 'Exporter les logs',
                            defaultPath: filename,
                            filters: [{ name: 'Text', extensions: ['txt'] }],
                          })
                          if (!path) return
                          await writeTextFile(path, text)
                        } else {
                          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = filename
                          document.body.appendChild(a)
                          a.click()
                          a.remove()
                          URL.revokeObjectURL(url)
                        }
                      }}
                      title="Exporter les logs"
                    >
                      Export
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      leftIcon={RotateCcw}
                      onClick={() => setActiveRun(activeRun.id)}
                      title="Rafraîchir (auto)"
                    >
                      Refresh
                    </Button>
                  </div>
                </div>

                <div className="h-[180px] overflow-auto rounded-lg bg-bg-primary/40 border border-border-subtle">
                  {(activeRun.logs || []).slice(-250).map((l) => (
                    <div
                      key={l.id}
                      className={cn(
                        'px-3 py-1 text-[11px] font-mono whitespace-pre-wrap break-words border-b border-border-subtle/40',
                        l.level === 'stderr' || l.level === 'error'
                          ? 'text-accent-error bg-accent-error/5'
                          : l.level === 'success'
                            ? 'text-accent-success bg-accent-success/5'
                            : l.level === 'system'
                              ? 'text-accent-info bg-accent-info/5'
                              : 'text-text-primary'
                      )}
                    >
                      {l.message}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* A-mode: pending changes queue (preview/apply) */}
          {pendingSets.length > 0 && (
            <div className="rounded-xl border border-accent-warning/30 bg-accent-warning/5 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-text-primary">
                  Changements en attente ({pendingSets.length})
                </p>
                <Badge variant="warning">Approval requis</Badge>
              </div>
              <div className="mt-2 space-y-2">
                {pendingSets.slice(0, 3).map((cs) => (
                  <div key={cs.id} className="rounded-lg border border-border-subtle bg-bg-tertiary/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-text-primary truncate">{cs.title}</p>
                        <p className="text-[11px] text-text-muted truncate">{cs.operations.length} opération(s)</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="xs" onClick={() => setPreviewId(cs.id)}>
                          Preview
                        </Button>
                        <Button variant="outline" size="xs" onClick={() => void applyPending(projectId, cs.id)}>
                          Appliquer
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => removePending(projectId, cs.id)}>
                          Rejeter
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {pendingSets.length > 3 && (
                  <p className="text-[11px] text-text-muted">+{pendingSets.length - 3} autres…</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      )}

      {selectedChangeSet && (
        <ChangePreviewModal
          projectId={projectId}
          changeSet={selectedChangeSet}
          onClose={() => setPreviewId(null)}
        />
      )}
    </Card>
  )
}
