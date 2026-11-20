import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import {
  DataTable, Notice, PageHeader, Pagination, Panel, Select, Stat, Tabs, TextInput, useDebounced, useLoad, useTab,
} from '@/components/ui/kit'
import { api, BreakdownRow, DailyPoint } from '@/api/backend'
import { fcfa, label, num, TASK_LABELS } from '@/lib/format'
import { UsageTable } from '@/app/users/details/page'

const LIMIT = 50

export default function UsagePage() {
  const tabs = [
    { id: 'overview', label: "Vue d'ensemble" },
    { id: 'daily', label: 'Par jour' },
    { id: 'requests', label: 'Requêtes' },
    { id: 'anomalies', label: 'Anomalies' },
  ]
  const [tab, setTab] = useTab(tabs)
  const [days, setDays] = useState(30)
  return (
    <div>
      <PageHeader
        title="Consommation"
        description="Chaque appel IA facturé : modèle, jetons, montant débité."
        actions={(tab === 'overview' || tab === 'daily') && (
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-40" options={[
            { value: '7', label: '7 jours' }, { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' },
          ]} />
        )}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview days={days} />}
      {tab === 'daily' && <Daily days={days} />}
      {tab === 'requests' && <Requests />}
      {tab === 'anomalies' && <Requests anomalies />}
    </div>
  )
}

function Overview({ days }: { days: number }) {
  const navigate = useNavigate()
  const b = useLoad(() => api.breakdown(days), [days])
  const s = useLoad(() => api.settings(), [])
  const rows = b.data?.by_model ?? []
  const total = rows.reduce((a, r) => a + r.cost_fcfa, 0)
  const requests = rows.reduce((a, r) => a + r.requests, 0)
  const margin = s.data?.margin ?? 0
  const providerCost = margin > 0 ? total / margin : 0

  const cols = (keyLabel: string, fmt?: (k: string) => string) => [
    { key: 'k', header: keyLabel, render: (r: BreakdownRow) => fmt ? fmt(r.key) : <span className="font-mono text-xs">{r.key}</span> },
    { key: 'n', header: 'Requêtes', align: 'right' as const, render: (r: BreakdownRow) => num(r.requests) },
    { key: 'i', header: 'Entrée', align: 'right' as const, render: (r: BreakdownRow) => num(r.input_tokens) },
    { key: 'h', header: 'Cache', align: 'right' as const, render: (r: BreakdownRow) => <CacheRate rate={r.cache_rate} /> },
    { key: 'o', header: 'Sortie', align: 'right' as const, render: (r: BreakdownRow) => num(r.output_tokens) },
    { key: 'c', header: 'Facturé', align: 'right' as const, render: (r: BreakdownRow) => fcfa(r.cost_fcfa) },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label={`Facturé aux clients (${days} j)`} value={fcfa(total)} tone="primary" />
        <Stat label="Coût fournisseur estimé" value={fcfa(providerCost)} hint={margin ? `Prix de vente = coût × ${margin}` : undefined} />
        <Stat label="Marge estimée" value={fcfa(total - providerCost)} tone="success" />
        <Stat label="Requêtes" value={num(requests)} />
      </div>
      <Panel title="Par modèle" padded={false}><DataTable rows={rows} rowKey={(r) => r.key} loading={b.loading} error={b.error} columns={cols('Modèle')} /></Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Par type d'appel" padded={false}>
          <DataTable rows={b.data?.by_task_type ?? []} rowKey={(r) => r.key} loading={b.loading}
            columns={cols('Type', (k) => label(TASK_LABELS, k)).filter((c) => c.key !== 'i' && c.key !== 'o' && c.key !== 'h')} />
        </Panel>
        <Panel title="Meilleurs clients" padded={false}>
          <DataTable rows={b.data?.top_users ?? []} rowKey={(r) => r.key} loading={b.loading}
            onRowClick={(r) => navigate(`/users/${encodeURIComponent(r.key)}?tab=usage`)}
            columns={cols('Compte', (k) => k).filter((c) => c.key !== 'i' && c.key !== 'o' && c.key !== 'h')} />
        </Panel>
      </div>
    </div>
  )
}

/** Part de l'entrée servie par le cache DeepSeek : au-dessus de 80 %, le préfixe est bien stable. */
function CacheRate({ rate }: { rate?: number }) {
  if (rate === undefined) return <span className="text-foreground-muted">—</span>
  const pct = Math.round(rate * 100)
  const tone = pct >= 80 ? 'text-accent-success' : pct >= 50 ? 'text-accent-warning' : 'text-accent-error'
  return <span className={tone}>{pct} %</span>
}

function Daily({ days }: { days: number }) {
  const d = useLoad(() => api.daily(days), [days])
  const rows = [...(d.data?.days ?? [])].reverse()
  return (
    <Panel padded={false}>
      <DataTable<DailyPoint>
        rows={rows}
        rowKey={(r) => r.day}
        loading={d.loading}
        error={d.error}
        columns={[
          { key: 'd', header: 'Jour', render: (r) => new Date(`${r.day}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }) },
          { key: 'n', header: 'Requêtes', align: 'right', render: (r) => num(r.requests) },
          { key: 't', header: 'Jetons', align: 'right', render: (r) => num(r.tokens) },
          { key: 'c', header: 'Consommation', align: 'right', render: (r) => fcfa(r.cost_fcfa) },
          { key: 'r', header: 'Recharges', align: 'right', render: (r) => <span className={r.recharged_fcfa ? 'text-accent-success' : ''}>{fcfa(r.recharged_fcfa)}</span> },
          { key: 'u', header: 'Nouveaux comptes', align: 'right', render: (r) => num(r.new_users) },
        ]}
      />
    </Panel>
  )
}

function Requests({ anomalies = false }: { anomalies?: boolean }) {
  const [sp, setSp] = useSearchParams()
  const [email, setEmail] = useState('')
  const [model, setModel] = useState('')
  const q = useDebounced(email)
  const offset = Number(sp.get('page') ?? 0)
  const setOffset = (o: number) => { const n = new URLSearchParams(sp); n.set('page', String(o)); setSp(n, { replace: true }) }
  const models = useLoad(() => api.breakdown(90), [])
  const data = useLoad(() => api.usage({ email: q, model, task_type: anomalies ? 'anomalies' : '', limit: LIMIT, offset }),
    [q, model, anomalies, offset])
  const d = data.data
  return (
    <div className="space-y-4">
      {anomalies && (
        <Notice>
          <b>Estimé</b> : le fournisseur n'a pas renvoyé la consommation (coupure, client déconnecté) ; le montant a été calculé
          sur le texte échangé et quand même débité. <b>Échec de débit</b> : l'appel a été servi mais le débit n'a pas pu être
          enregistré ; vérifie le compte et retire le montant à la main si besoin.
        </Notice>
      )}
      {d && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Stat label="Requêtes" value={num(d.total)} />
          <Stat label="Jetons d'entrée" value={num(d.sum_input_tokens)} />
          <Stat label="Jetons de sortie" value={num(d.sum_output_tokens)} />
          <Stat label="Montant" value={fcfa(d.sum_cost_fcfa)} tone="primary" />
        </div>
      )}
      <Panel padded={false}>
        <div className="p-4 border-b border-border-subtle flex flex-wrap gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
            <TextInput className="pl-9" placeholder="Filtrer par e-mail…" value={email}
              onChange={(e) => { setEmail(e.target.value); if (offset) setOffset(0) }} />
          </div>
          <Select className="w-56" value={model} onChange={(e) => { setModel(e.target.value); if (offset) setOffset(0) }}
            options={[{ value: '', label: 'Tous les modèles' }, ...(models.data?.by_model ?? []).map((m) => ({ value: m.key, label: m.key }))]} />
        </div>
        <UsageTable rows={d?.usage ?? []} loading={data.loading} error={data.error} showUser />
        <Pagination total={d?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
      </Panel>
    </div>
  )
}
