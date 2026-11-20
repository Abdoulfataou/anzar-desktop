import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Minus, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  DataTable, ErrorBox, Field, Notice, PageHeader, Pagination, Panel, Stat, Tabs, TextInput, useDebounced, useLoad, usePermissions, useTab,
} from '@/components/ui/kit'
import { CreditModal } from '@/components/actions'
import { AdminUser, api } from '@/api/backend'
import { fcfa } from '@/lib/format'
import { TxTable } from '@/app/users/details/page'

const LIMIT = 50

export default function CreditsPage() {
  const perms = usePermissions()
  const tabs = [
    { id: 'ledger', label: 'Grand livre' },
    { id: 'adjust', label: 'Créditer / retirer', hidden: !perms.canManageMoney },
  ]
  const [tab, setTab] = useTab(tabs)
  return (
    <div>
      <PageHeader title="Crédits" description="Tous les mouvements d'argent : recharges, bonus, remboursements et consommation." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'ledger' ? <Ledger /> : <Adjust />}
    </div>
  )
}

function Ledger() {
  const [sp, setSp] = useSearchParams()
  const typeTabs = [
    { id: 'all', label: 'Tous' },
    { id: 'recharge', label: 'Recharges' },
    { id: 'bonus', label: 'Bonus' },
    { id: 'refund', label: 'Remboursements' },
    { id: 'usage', label: 'Consommation' },
  ]
  const [type, setType] = useTab(typeTabs, 'type')
  const [email, setEmail] = useState(sp.get('email') ?? '')
  const q = useDebounced(email)
  const offset = Number(sp.get('page') ?? 0)
  const setOffset = (o: number) => { const n = new URLSearchParams(sp); n.set('page', String(o)); setSp(n, { replace: true }) }
  const data = useLoad(() => api.transactions({ email: q, type: type === 'all' ? '' : type, limit: LIMIT, offset }), [q, type, offset])
  const d = data.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {typeTabs.map((t) => (
          <button key={t.id} onClick={() => setType(t.id)}
            className={`rounded-full px-3 py-1 text-xs border ${type === t.id
              ? 'border-accent-primary text-accent-primary bg-accent-primary/10' : 'border-border text-foreground-secondary hover:text-foreground-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {d && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <Stat label="Mouvements" value={d.total} />
          <Stat label="Total crédité" value={fcfa(d.sum_credited)} tone="success" />
          <Stat label="Total débité" value={fcfa(-d.sum_debited)} />
        </div>
      )}
      <Panel padded={false}>
        <div className="p-4 border-b border-border-subtle">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
            <TextInput className="pl-9" placeholder="Filtrer par e-mail…" value={email}
              onChange={(e) => { setEmail(e.target.value); if (offset) setOffset(0) }} />
          </div>
        </div>
        {data.error ? <div className="p-4"><ErrorBox message={data.error} onRetry={data.reload} /></div>
          : <TxTable rows={d?.transactions ?? []} loading={data.loading} showUser />}
        <Pagination total={d?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
      </Panel>
    </div>
  )
}

function Adjust() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [target, setTarget] = useState<{ user: AdminUser; mode: 'credit' | 'debit' } | null>(null)
  const results = useLoad(() => (q.trim().length >= 2 ? api.users({ search: q.trim(), limit: 10 }) : Promise.resolve({ users: [], total: 0 })), [q])

  return (
    <div className="space-y-4 max-w-3xl">
      <Notice>
        Pas encore de paiement automatique : quand un client t'envoie de l'argent (Orange Money, Wave…), cherche son compte
        ci-dessous et ajoute le montant en <b>Recharge</b>, avec la référence de la transaction. S'il a fait une demande depuis
        l'app, valide-la plutôt dans <button className="underline" onClick={() => navigate('/payments')}>Paiements</button> :
        le bonus de recharge s'applique automatiquement.
      </Notice>
      <Panel title="Choisir le compte">
        <Field label="E-mail ou nom du client">
          <TextInput autoFocus placeholder="ex. client@gmail.com" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </Panel>
      {q.trim().length >= 2 && (
        <Panel padded={false}>
          <DataTable<AdminUser>
            rows={results.data?.users ?? []}
            rowKey={(u) => u.email}
            loading={results.loading}
            error={results.error}
            empty="Aucun compte ne correspond"
            columns={[
              { key: 'e', header: 'Compte', render: (u) => <div><p className="font-medium">{u.email}</p><p className="text-xs text-foreground-muted">{u.name}</p></div> },
              { key: 'b', header: 'Solde', align: 'right', render: (u) => (
                <span className={(u.balance_fcfa ?? 0) < 0 ? 'text-accent-error' : ''}>{fcfa(u.balance_fcfa)}</span>) },
              { key: 'a', header: '', align: 'right', render: (u) => (
                <div className="flex justify-end gap-2">
                  <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setTarget({ user: u, mode: 'credit' })}>Créditer</Button>
                  <Button size="sm" variant="ghost" leftIcon={<Minus className="h-3.5 w-3.5" />} onClick={() => setTarget({ user: u, mode: 'debit' })}>Retirer</Button>
                </div>
              ) },
            ]}
          />
        </Panel>
      )}
      {target && (
        <CreditModal open email={target.user.email} mode={target.mode} balance={target.user.balance_fcfa ?? 0}
          onClose={() => setTarget(null)} onDone={results.reload} />
      )}
    </div>
  )
}
