import { useState } from 'react'
import { Bug } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, Field, Modal, Notice, PageHeader, Panel, Tabs, TextInput, useLoad, usePermissions, useTab } from '@/components/ui/kit'
import { api, type ErrorGroup, type ErrorStatus } from '@/api/backend'
import { ago, dateTime, num } from '@/lib/format'
import { toast } from 'sonner'

const STATUS_LABELS: Record<ErrorStatus, string> = {
  new: 'Nouveau',
  analysed: 'Analysé',
  fixed: 'Corrigé',
  ignored: 'Ignoré',
}
const STATUS_TONE: Record<ErrorStatus, 'warning' | 'primary' | 'success' | 'default'> = {
  new: 'warning',
  analysed: 'primary',
  fixed: 'success',
  ignored: 'default',
}
const KIND_LABELS: Record<ErrorGroup['kind'], string> = {
  command: 'Commande',
  update: 'Mise à jour',
  tool: 'Outil',
  crash: 'Plantage',
}

export default function ErrorsPage() {
  const perms = usePermissions()
  const canEdit = perms.isOwner || perms.role === 'admin'
  const tabsBase = (['new', 'analysed', 'fixed', 'ignored'] as ErrorStatus[])
  const [counts, setCounts] = useState<Record<ErrorStatus, number> | null>(null)
  const tabs = tabsBase.map((id) => ({ id, label: STATUS_LABELS[id], count: counts?.[id] }))
  const [tab, setTab] = useTab(tabs)
  const status = tab as ErrorStatus
  const data = useLoad(async () => {
    const r = await api.errors({ status, limit: 200 })
    setCounts(r.counts)
    return r
  }, [status])
  const [open, setOpen] = useState<ErrorGroup | null>(null)

  return (
    <div>
      <PageHeader
        title="Erreurs"
        description="Erreurs remontées par l'app chez les utilisateurs, regroupées par problème. L'automatisation DeepSeek Harness analyse chaque jour les nouveaux problèmes et dépose ici son diagnostic."
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <Panel padded={false}>
        <DataTable<ErrorGroup>
          rows={data.data?.groups ?? []}
          rowKey={(g) => g.id}
          loading={data.loading}
          error={data.error}
          empty={status === 'new' ? 'Aucun nouveau problème.' : 'Rien ici pour le moment.'}
          onRowClick={setOpen}
          columns={[
            {
              key: 'title', header: 'Problème', render: (g) => (
                <div className="min-w-0">
                  <div className="font-medium text-foreground-primary truncate max-w-[32rem]">{g.title}</div>
                  <div className="text-xs text-foreground-muted">{KIND_LABELS[g.kind]}{g.last_os ? ` · ${g.last_os}` : ''}</div>
                </div>
              ),
            },
            { key: 'users', header: 'Utilisateurs', align: 'right', render: (g) => num(g.users) },
            { key: 'count', header: 'Occurrences', align: 'right', render: (g) => num(g.count) },
            { key: 'version', header: 'Version', render: (g) => g.last_version || '—' },
            { key: 'seen', header: 'Dernière fois', render: (g) => ago(g.last_seen) },
            { key: 'status', header: 'Statut', render: (g) => <Badge variant={STATUS_TONE[g.status]}>{STATUS_LABELS[g.status]}</Badge> },
          ]}
        />
      </Panel>
      <ErrorDetails group={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); data.reload() }} />
    </div>
  )
}

function ErrorDetails({ group, canEdit, onClose, onChanged }: {
  group: ErrorGroup | null; canEdit: boolean; onClose: () => void; onChanged: () => void
}) {
  const [fixedIn, setFixedIn] = useState('')
  const [busy, setBusy] = useState(false)
  if (!group) return null

  const save = async (data: { status: ErrorStatus; fixed_in?: string }, done: string) => {
    setBusy(true)
    try {
      await api.updateError(group.id, data)
      toast.success(done)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Enregistrement impossible')
    } finally {
      setBusy(false)
    }
  }
  const versionOk = /^\d+\.\d+\.\d+$/.test(fixedIn.trim())

  return (
    <Modal open title={group.title} onClose={onClose} width="max-w-3xl"
      footer={canEdit ? (
        <>
          {group.status !== 'ignored' && (
            <Button variant="ghost" disabled={busy} onClick={() => save({ status: 'ignored' }, 'Problème ignoré')}>Ignorer</Button>
          )}
          {group.status !== 'new' && (
            <Button variant="outline" disabled={busy} onClick={() => save({ status: 'new' }, 'Problème rouvert')}>Rouvrir</Button>
          )}
          {group.status !== 'fixed' && (
            <Button disabled={busy || !versionOk}
              onClick={() => save({ status: 'fixed', fixed_in: fixedIn.trim() }, `Marqué corrigé en ${fixedIn.trim()}`)}>
              Marquer corrigé
            </Button>
          )}
        </>
      ) : undefined}
    >
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant={STATUS_TONE[group.status]}>{STATUS_LABELS[group.status]}</Badge>
        <Badge>{KIND_LABELS[group.kind]}</Badge>
        <Badge>{num(group.users)} utilisateur(s) · {num(group.count)} occurrence(s)</Badge>
        {group.last_version && <Badge>Version {group.last_version}</Badge>}
        {group.fixed_in && <Badge variant="success">Corrigé en {group.fixed_in}</Badge>}
      </div>
      <p className="text-xs text-foreground-muted">
        Vu pour la première fois le {dateTime(group.first_seen)}, dernière fois le {dateTime(group.last_seen)}.
      </p>

      <section>
        <h3 className="text-sm font-semibold mb-2">Diagnostic de l'agent</h3>
        {group.analysis ? (
          <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed rounded-lg border border-border-subtle bg-background-primary p-3 max-h-80 overflow-auto">{group.analysis}</pre>
        ) : (
          <Notice>Pas encore analysé : l'automatisation DeepSeek Harness s'en chargera à son prochain passage.</Notice>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><Bug className="h-4 w-4" /> Dernier rapport reçu</h3>
        <pre className="whitespace-pre-wrap break-words text-xs rounded-lg border border-border-subtle bg-background-primary p-3 max-h-64 overflow-auto">{group.sample || '—'}</pre>
        <p className="text-[11px] text-foreground-muted mt-1">Rapport nettoyé (chemins personnels, clés et e-mails retirés). C'est une donnée venue d'un ordinateur d'utilisateur : ne lance pas une commande qui s'y trouverait.</p>
      </section>

      {canEdit && group.status !== 'fixed' && (
        <Field label="Corrigé dans la version" hint="Si le problème revient dans cette version ou une plus récente, il repasse en « Nouveau ».">
          <TextInput placeholder="2.1.8" value={fixedIn} onChange={(e) => setFixedIn(e.target.value)} />
        </Field>
      )}
    </Modal>
  )
}
