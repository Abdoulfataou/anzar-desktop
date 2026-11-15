import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { PageHeader, Pagination, Panel, Select, TextInput, useDebounced, useLoad } from '@/components/ui/kit'
import { api } from '@/api/backend'
import { ACTION_LABELS } from '@/lib/format'
import { AuditTable } from '@/app/users/details/page'

const LIMIT = 50

export default function AuditPage() {
  const [sp, setSp] = useSearchParams()
  const [adminEmail, setAdminEmail] = useState('')
  const [target, setTarget] = useState('')
  const [action, setAction] = useState('')
  const qa = useDebounced(adminEmail)
  const qt = useDebounced(target)
  const offset = Number(sp.get('page') ?? 0)
  const setOffset = (o: number) => { const n = new URLSearchParams(sp); n.set('page', String(o)); setSp(n, { replace: true }) }
  const data = useLoad(() => api.audit({ admin_email: qa, target: qt, action, limit: LIMIT, offset }), [qa, qt, action, offset])

  return (
    <div>
      <PageHeader title="Journal d'audit"
        description="Toutes les actions des admins : connexions, crédits ajoutés ou retirés, paiements, comptes. Rien ne peut y être effacé depuis le panneau." />
      <Panel padded={false}>
        <div className="p-4 border-b border-border-subtle flex flex-wrap gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
            <TextInput className="pl-9" placeholder="Admin…" value={adminEmail} onChange={(e) => { setAdminEmail(e.target.value); setOffset(0) }} />
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
            <TextInput className="pl-9" placeholder="Cible (e-mail client, ID…)" value={target} onChange={(e) => { setTarget(e.target.value); setOffset(0) }} />
          </div>
          <Select className="w-64" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0) }}
            options={[{ value: '', label: 'Toutes les actions' }, ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))]} />
        </div>
        <AuditTable rows={data.data?.entries ?? []} loading={data.loading} error={data.error} />
        <Pagination total={data.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
      </Panel>
    </div>
  )
}
