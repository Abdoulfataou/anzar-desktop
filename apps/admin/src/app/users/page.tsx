import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, PageHeader, Pagination, Panel, Tabs, TextInput, useDebounced, useLoad, usePermissions, useTab } from '@/components/ui/kit'
import { CreditModal } from '@/components/actions'
import { AdminUser, api } from '@/api/backend'
import { ago, dateOnly, fcfa } from '@/lib/format'

const LIMIT = 50

export default function UsersPage() {
  const navigate = useNavigate()
  const perms = usePermissions()
  const [sp, setSp] = useSearchParams()
  const tabs = [
    { id: 'all', label: 'Tous' },
    { id: 'funded', label: 'Avec crédit' },
    { id: 'zero', label: 'Sans crédit' },
    { id: 'debt', label: 'En dette' },
    { id: 'disabled', label: 'Désactivés' },
  ]
  const [tab, setTab] = useTab(tabs, 'status')
  const [search, setSearch] = useState(sp.get('q') ?? '')
  const q = useDebounced(search)
  const urlQ = sp.get('q')
  useEffect(() => { if (urlQ !== null) setSearch(urlQ) }, [urlQ])
  const offset = Number(sp.get('page') ?? 0)
  const setOffset = (o: number) => { const n = new URLSearchParams(sp); n.set('page', String(o)); setSp(n, { replace: true }) }
  const [crediting, setCrediting] = useState<AdminUser | null>(null)

  const list = useLoad(() => api.users({ search: q, status: tab, limit: LIMIT, offset }), [q, tab, offset])

  return (
    <div>
      <PageHeader title="Utilisateurs" description="Comptes de l'application ANZAR : solde, activité, accès." />
      <Tabs tabs={tabs.map((t) => (t.id === tab && list.data ? { ...t, count: list.data.total } : t))} value={tab} onChange={setTab} />
      <Panel padded={false}>
        <div className="p-4 border-b border-border-subtle">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
            <TextInput className="pl-9" placeholder="Rechercher par e-mail ou nom…" value={search}
              onChange={(e) => { setSearch(e.target.value); if (offset) setOffset(0) }} />
          </div>
        </div>
        <DataTable<AdminUser>
          rows={list.data?.users ?? []}
          rowKey={(u) => u.email}
          loading={list.loading}
          error={list.error}
          empty="Aucun utilisateur"
          onRowClick={(u) => navigate(`/users/${encodeURIComponent(u.email)}`)}
          columns={[
            { key: 'email', header: 'Compte', render: (u) => (
              <div>
                <p className="font-medium">{u.email}</p>
                <p className="text-xs text-foreground-muted">{u.name || '—'}</p>
              </div>
            ) },
            { key: 'state', header: 'État', render: (u) => u.is_active
              ? <Badge variant="success">Actif</Badge> : <Badge variant="error">Désactivé</Badge> },
            { key: 'bal', header: 'Solde', align: 'right', render: (u) => (
              <span className={(u.balance_fcfa ?? 0) < 0 ? 'text-accent-error font-medium' : (u.balance_fcfa ?? 0) > 0 ? 'text-accent-success' : 'text-foreground-muted'}>
                {fcfa(u.balance_fcfa)}
              </span>
            ) },
            { key: 'rech', header: 'Rechargé', align: 'right', render: (u) => fcfa(u.total_recharged) },
            { key: 'used', header: 'Consommé', align: 'right', render: (u) => fcfa(u.total_used) },
            { key: 'last', header: 'Dernière connexion', render: (u) => <span className="text-foreground-secondary">{ago(u.last_login)}</span> },
            { key: 'created', header: 'Inscrit le', render: (u) => <span className="text-foreground-secondary">{dateOnly(u.created_at)}</span> },
            { key: 'act', header: '', align: 'right', render: (u) => perms.canManageMoney && (
              <Button size="sm" variant="outline" leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={(e) => { e.stopPropagation(); setCrediting(u) }}>Créditer</Button>
            ) },
          ]}
        />
        <Pagination total={list.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
      </Panel>
      {crediting && (
        <CreditModal open email={crediting.email} mode="credit" balance={crediting.balance_fcfa ?? 0}
          onClose={() => setCrediting(null)} onDone={list.reload} />
      )}
    </div>
  )
}
