import React, { useEffect, useMemo, useState } from 'react'
import { X, FileText, Trash2, ArrowRightLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useProjectStore } from '@/stores/projectStore'
import { useChangeStore, type PendingChangeSet } from '@/stores/changeStore'
import DiffView from '@/components/runs/DiffView'
import { runService } from '@/services/runService'
import toast from 'react-hot-toast'
import { useRunStore } from '@/stores/runStore'
import { useSettingsStore } from '@/stores/settingsStore'

function opLabel(op: any): string {
  if (op.type === 'create') return `Créer: ${op.path}`
  if (op.type === 'edit') return `Modifier: ${op.path}`
  if (op.type === 'delete') return `Supprimer: ${op.path}`
  if (op.type === 'rename') return `Renommer: ${op.oldPath} → ${op.newPath}`
  return 'Opération'
}

export default function ChangePreviewModal({
  projectId,
  changeSet,
  onClose,
}: {
  projectId: string
  changeSet: PendingChangeSet
  onClose: () => void
}) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId) || null)
  const apply = useChangeStore((s) => s.apply)
  const applySelected = useChangeStore((s) => s.applySelected)
  const remove = useChangeStore((s) => s.remove)
  const projectPath = (project?.metadata as any)?.localPath as string | undefined

  const setActiveRun = useRunStore((s) => s.setActiveRun)
  const autoVerifyAfterApply = useSettingsStore((s) => s.settings.autoVerifyAfterApply)

  const notifyVerifyStarted = (runId: string) => {
    toast.custom(
      (t) => (
        <div
          className={cn(
            'max-w-md w-[min(420px,92vw)] rounded-xl border border-border-medium bg-bg-secondary/95 backdrop-blur-xl shadow-2xl px-4 py-3',
            t.visible ? 'animate-scale-in' : 'animate-fade-out'
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">Vérification lancée</p>
              <p className="text-xs text-text-muted mt-0.5">
                On vérifie le projet (build/tests si disponibles).
              </p>
            </div>
            <button
              className="text-xs text-text-muted hover:text-text-primary"
              onClick={() => toast.dismiss(t.id)}
            >
              ✕
            </button>
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setActiveRun(runId)
                toast.dismiss(t.id)
              }}
            >
              Voir détails
            </Button>
          </div>
        </div>
      ),
      { duration: 6000 }
    )
  }

  const fileMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of project?.files || []) map.set(f.path, f.content)
    return map
  }, [project])

  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    // Default: everything selected when opening
    setSelected(new Set(changeSet.operations.map((_, i) => i)))
  }, [changeSet.id, changeSet.operations.length])

  const selectedIndexes = useMemo(() => Array.from(selected).sort((a, b) => a - b), [selected])

  const toggle = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(changeSet.operations.map((_, i) => i)))
  const selectNone = () => setSelected(new Set())

  type OpGroup = {
    key: string
    label: string
    opIndexes: number[]
  }

  const groups: OpGroup[] = useMemo(() => {
    const map = new Map<string, OpGroup>()
    changeSet.operations.forEach((op: any, idx: number) => {
      const type = String(op?.type || 'unknown')
      const key =
        type === 'rename'
          ? `rename:${op?.oldPath || ''}->${op?.newPath || ''}`
          : String(op?.path || `op-${idx}`)
      const label =
        type === 'rename'
          ? `${op?.oldPath || ''} → ${op?.newPath || ''}`.trim()
          : String(op?.path || `op-${idx}`)

      const existing = map.get(key)
      if (existing) existing.opIndexes.push(idx)
      else map.set(key, { key, label, opIndexes: [idx] })
    })

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [changeSet])

  const [activeGroupKey, setActiveGroupKey] = useState<string>('')
  useEffect(() => {
    setActiveGroupKey(groups[0]?.key || '')
  }, [changeSet.id, groups.length])

  const activeGroup = useMemo(
    () => groups.find((g) => g.key === activeGroupKey) || groups[0] || null,
    [groups, activeGroupKey]
  )

  const toggleGroup = (g: OpGroup) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = g.opIndexes.every((i) => next.has(i))
      for (const i of g.opIndexes) {
        if (allSelected) next.delete(i)
        else next.add(i)
      }
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[min(1000px,92vw)] max-h-[85vh] overflow-hidden rounded-2xl border border-border-medium bg-bg-secondary/95 backdrop-blur-xl shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border-subtle">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant="warning">Preview</Badge>
              <h3 className="text-sm font-semibold text-text-primary truncate">{changeSet.title}</h3>
            </div>
            <p className="text-xs text-text-muted mt-1">
              {changeSet.operations.length} opération(s) — {new Date(changeSet.createdAt).toLocaleString('fr-FR')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void applySelected(projectId, changeSet.id, selectedIndexes).then(onClose)}
              disabled={selectedIndexes.length === 0}
              title="Appliquer uniquement la sélection"
            >
              Appliquer sélection
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedIndexes.length === 0 || !projectPath}
              onClick={() =>
                void applySelected(projectId, changeSet.id, selectedIndexes).then(async () => {
                  if (projectPath) {
                    if (!autoVerifyAfterApply) {
                      const runId = await runService.executeVerifyPipeline({ projectId, projectPath })
                      notifyVerifyStarted(runId)
                    } else {
                      const latest = useRunStore
                        .getState()
                        .runs.find((r) => r.projectId === projectId && r.title === 'Vérifier le projet')
                      if (latest) notifyVerifyStarted(latest.id)
                    }
                  }
                  onClose()
                })
              }
              title={!projectPath ? 'Vérification indisponible (projet non local)' : 'Appliquer la sélection puis vérifier le projet'}
            >
              Appliquer sélection + Vérifier
            </Button>
            <Button variant="ghost" size="sm" onClick={() => selectAll()}>
              Tout
            </Button>
            <Button variant="ghost" size="sm" onClick={() => selectNone()}>
              Rien
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void apply(projectId, changeSet.id).then(onClose)}>
              Appliquer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!projectPath}
              onClick={() =>
                void apply(projectId, changeSet.id).then(async () => {
                  if (projectPath) {
                    if (!autoVerifyAfterApply) {
                      const runId = await runService.executeVerifyPipeline({ projectId, projectPath })
                      notifyVerifyStarted(runId)
                    } else {
                      const latest = useRunStore
                        .getState()
                        .runs.find((r) => r.projectId === projectId && r.title === 'Vérifier le projet')
                      if (latest) notifyVerifyStarted(latest.id)
                    }
                  }
                  onClose()
                })
              }
              title={!projectPath ? 'Vérification indisponible (projet non local)' : 'Appliquer puis vérifier le projet'}
            >
              Appliquer + Vérifier
            </Button>
            <Button variant="ghost" size="sm" onClick={() => remove(projectId, changeSet.id)}>
              Rejeter
            </Button>
            <Button variant="ghost" size="sm" leftIcon={X} onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>

        <div className="p-4 overflow-auto max-h-[calc(85vh-72px)] space-y-4">
          {/* Tabs fichiers */}
          {groups.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-border-subtle">
              {groups.map((g) => {
                const selectedCount = g.opIndexes.filter((i) => selected.has(i)).length
                const allSelected = selectedCount === g.opIndexes.length
                const isActive = g.key === activeGroup?.key
                return (
                  <button
                    key={g.key}
                    onClick={() => setActiveGroupKey(g.key)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-xl border text-xs whitespace-nowrap transition-all',
                      isActive
                        ? 'border-accent-primary/40 bg-accent-primary/10 text-text-primary'
                        : 'border-border-subtle bg-bg-tertiary/30 text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                    )}
                    title={g.label}
                  >
                    <input
                      type="checkbox"
                      className="accent-accent-primary"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allSelected && selectedCount > 0
                      }}
                      onChange={(e) => {
                        e.stopPropagation()
                        toggleGroup(g)
                      }}
                    />
                    <span className="max-w-[220px] truncate">{g.label}</span>
                    <span className="text-[10px] opacity-70">
                      {selectedCount}/{g.opIndexes.length}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Contenu du fichier actif */}
          {changeSet.operations
            .map((op: any, idx: number) => ({ op, idx }))
            .filter(({ idx }) => !activeGroup || activeGroup.opIndexes.includes(idx))
            .map(({ op, idx }) => {
            const kind = op.type as string
            const icon =
              kind === 'delete' ? (
                <Trash2 className="w-4 h-4 text-accent-error" />
              ) : kind === 'rename' ? (
                <ArrowRightLeft className="w-4 h-4 text-accent-warning" />
              ) : (
                <FileText className="w-4 h-4 text-accent-primary" />
              )

            const checked = selected.has(idx)
            const headerLeft = (
              <div className="flex items-center gap-2 min-w-0">
                <input
                  type="checkbox"
                  className="accent-accent-primary"
                  checked={checked}
                  onChange={() => toggle(idx)}
                />
                {icon}
                <p className="text-xs font-medium text-text-primary truncate">{opLabel(op)}</p>
              </div>
            )

            if (kind === 'create' || kind === 'edit') {
              const oldText = fileMap.get(op.path) || ''
              const newText = op.content || ''
              return (
                <div
                  key={idx}
                  className={cn(
                    'rounded-xl border bg-bg-tertiary/40 p-3',
                    checked ? 'border-border-subtle' : 'border-border-subtle opacity-60'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    {headerLeft}
                    <Badge variant={kind === 'create' ? 'success' : 'primary'} className="capitalize">
                      {kind}
                    </Badge>
                  </div>
                  <DiffView oldText={oldText} newText={newText} />
                </div>
              )
            }

            if (kind === 'delete') {
              const oldText = fileMap.get(op.path) || ''
              return (
                <div
                  key={idx}
                  className={cn(
                    'rounded-xl border bg-accent-error/5 p-3',
                    checked ? 'border-accent-error/30' : 'border-border-subtle opacity-60'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    {headerLeft}
                    <Badge variant="error">delete</Badge>
                  </div>
                  <DiffView oldText={oldText} newText={''} />
                </div>
              )
            }

            if (kind === 'rename') {
              return (
                <div
                  key={idx}
                  className={cn(
                    'rounded-xl border bg-accent-warning/5 p-3',
                    checked ? 'border-accent-warning/30' : 'border-border-subtle opacity-60'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    {headerLeft}
                    <Badge variant="warning">rename</Badge>
                  </div>
                  <p className="text-xs text-text-secondary mt-2">
                    Ancien: <span className="font-mono">{op.oldPath}</span>
                    <br />
                    Nouveau: <span className="font-mono">{op.newPath}</span>
                  </p>
                </div>
              )
            }

            return (
              <div key={idx} className="rounded-xl border border-border-subtle bg-bg-tertiary/40 p-3">
                <p className="text-xs text-text-muted">Opération inconnue.</p>
              </div>
            )
          })}

          {!project && (
            <div className={cn('rounded-xl border border-border-subtle bg-bg-tertiary/40 p-3')}>
              <p className="text-xs text-text-muted">Projet introuvable (preview limité).</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
