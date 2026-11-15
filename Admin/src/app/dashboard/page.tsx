import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CreditCard, RefreshCw, TrendingUp, Users, Wallet, Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { DataTable, ErrorBox, PageHeader, Panel, Select, Spinner, Stat, useLoad } from '@/components/ui/kit'
import { api, Transaction } from '@/api/backend'
import { ago, compact, fcfa, label, num, TX_LABELS } from '@/lib/format'
import { useState } from 'react'

const tooltipStyle = {
  contentStyle: { background: '#14141B', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#94A3B8' },
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [days, setDays] = useState(30)
  const stats = useLoad(() => api.stats(), [])
  const daily = useLoad(() => api.daily(days), [days])
  const breakdown = useLoad(() => api.breakdown(days), [days])
  const recent = useLoad(() => api.transactions({ limit: 8 }), [])
  const health = useLoad(() => api.health(), [])

  const reload = () => { stats.reload(); daily.reload(); breakdown.reload(); recent.reload(); health.reload() }
  const s = stats.data
  const series = (daily.data?.days ?? []).map((d) => ({ ...d, label: d.day.slice(5).split('-').reverse().join('/') }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        description="Activité, argent encaissé et consommation de la plateforme."
        actions={<>
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-52" options={[
            { value: '7', label: '7 derniers jours' },
            { value: '30', label: '30 derniers jours' },
            { value: '90', label: '90 derniers jours' },
          ]} />
          <Button variant="secondary" size="md" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={reload}>Actualiser</Button>
        </>}
      />

      {stats.error && <ErrorBox message={stats.error} onRetry={stats.reload} />}

      {/* Alertes à traiter */}
      {s && (s.payments_pending.count > 0 || s.debts.count > 0 || s.billing_anomalies_30d > 0) && (
        <div className="grid gap-3 md:grid-cols-3">
          {s.payments_pending.count > 0 && (
            <button onClick={() => navigate('/payments')} className="text-left rounded-lg border border-accent-warning/40 bg-accent-warning/10 p-4">
              <p className="text-sm font-medium text-accent-warning">{s.payments_pending.count} paiement(s) à valider</p>
              <p className="text-xs text-foreground-secondary mt-1">{fcfa(s.payments_pending.amount_fcfa)} en attente de vérification</p>
            </button>
          )}
          {s.debts.count > 0 && (
            <button onClick={() => navigate('/users?status=debt')} className="text-left rounded-lg border border-accent-error/40 bg-accent-error/10 p-4">
              <p className="text-sm font-medium text-accent-error">{s.debts.count} compte(s) en dette</p>
              <p className="text-xs text-foreground-secondary mt-1">{fcfa(s.debts.amount_fcfa)} au total (bloqués jusqu'à la recharge)</p>
            </button>
          )}
          {s.billing_anomalies_30d > 0 && (
            <button onClick={() => navigate('/usage?tab=anomalies')} className="text-left rounded-lg border border-border-strong bg-background-tertiary p-4">
              <p className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-accent-warning" />{s.billing_anomalies_30d} facturation(s) à vérifier</p>
              <p className="text-xs text-foreground-secondary mt-1">Coûts estimés ou débits échoués (30 j)</p>
            </button>
          )}
        </div>
      )}

      {/* Chiffres clés */}
      {!s && stats.loading ? <div className="py-10 text-center"><Spinner /></div> : s && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Stat label="Argent encaissé (30 j)" value={fcfa(s.recharged_30d)} icon={<Wallet className="h-4 w-4" />} tone="success"
            hint={`Crédité depuis le début (bonus compris) : ${fcfa(s.credits.platform_recharged)}`} onClick={() => navigate('/credits?type=recharge')} />
          <Stat label="Consommation facturée (30 j)" value={fcfa(s.usage_30d.total_cost_fcfa)} icon={<Zap className="h-4 w-4" />} tone="primary"
            hint={`Aujourd'hui : ${fcfa(s.usage_today.cost_fcfa)} · ${num(s.usage_today.requests)} requêtes`} onClick={() => navigate('/usage')} />
          <Stat label="Crédit restant chez les clients" value={fcfa(s.credits.total_balance)} icon={<CreditCard className="h-4 w-4" />}
            hint={`${num(s.funded_users)} compte(s) avec du crédit`} />
          <Stat label="Utilisateurs" value={num(s.users.total)} icon={<Users className="h-4 w-4" />}
            hint={`${num(s.users.active)} actifs · +${num(s.users.new_7d)} cette semaine`} onClick={() => navigate('/users')} />
          <Stat label="Requêtes IA (30 j)" value={compact(s.usage_30d.total_requests)} hint={`${compact(s.usage_30d.total_tokens)} jetons`} />
          <Stat label="Bonus offerts (30 j)" value={fcfa(s.bonus_30d)} tone={s.bonus_30d > 0 ? 'warning' : 'default'} />
          <Stat label="Paiements en attente" value={num(s.payments_pending.count)} tone={s.payments_pending.count ? 'warning' : 'default'}
            hint={fcfa(s.payments_pending.amount_fcfa)} onClick={() => navigate('/payments')} />
          <Stat label="Comptes en dette" value={num(s.debts.count)} tone={s.debts.count ? 'error' : 'default'}
            hint={fcfa(s.debts.amount_fcfa)} onClick={() => navigate('/users?status=debt')} />
        </div>
      )}

      {/* Graphiques */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Consommation et recharges par jour" description="En FCFA · consommation à gauche, recharges à droite">
          {daily.error ? <ErrorBox message={daily.error} /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ left: -10, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00D9FF" stopOpacity={0.35} /><stop offset="100%" stopColor="#00D9FF" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gRech" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00C853" stopOpacity={0.3} /><stop offset="100%" stopColor="#00C853" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis yAxisId="c" tick={{ fill: '#00D9FF', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v)} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fill: '#00C853', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => compact(v)} />
                  <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [fcfa(v), n === 'cost_fcfa' ? 'Consommation' : 'Recharges']} />
                  <Area yAxisId="r" type="monotone" dataKey="recharged_fcfa" stroke="#00C853" fill="url(#gRech)" strokeWidth={2} />
                  <Area yAxisId="c" type="monotone" dataKey="cost_fcfa" stroke="#00D9FF" fill="url(#gCost)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <Panel title="Requêtes IA et nouveaux comptes par jour">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [num(v), n === 'requests' ? 'Requêtes' : 'Nouveaux comptes']} />
                <Bar dataKey="requests" fill="#B829DD" radius={[3, 3, 0, 0]} />
                <Bar dataKey="new_users" fill="#00D9FF" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Meilleurs clients" description={`Consommation sur ${days} jours`} padded={false}>
          <DataTable
            rows={breakdown.data?.top_users ?? []}
            rowKey={(r) => r.key}
            loading={breakdown.loading}
            empty="Aucune consommation"
            onRowClick={(r) => navigate(`/users/${encodeURIComponent(r.key)}`)}
            columns={[
              { key: 'u', header: 'Compte', render: (r) => <span className="truncate block max-w-[180px]">{r.key}</span> },
              { key: 'n', header: 'Req.', align: 'right', render: (r) => num(r.requests) },
              { key: 'c', header: 'Montant', align: 'right', render: (r) => fcfa(r.cost_fcfa) },
            ]}
          />
        </Panel>
        <Panel title="Par modèle" description={`${days} jours`} padded={false}>
          <DataTable
            rows={breakdown.data?.by_model ?? []}
            rowKey={(r) => r.key}
            loading={breakdown.loading}
            empty="Aucune consommation"
            columns={[
              { key: 'm', header: 'Modèle', render: (r) => <span className="font-mono text-xs">{r.key}</span> },
              { key: 'n', header: 'Req.', align: 'right', render: (r) => num(r.requests) },
              { key: 'c', header: 'Montant', align: 'right', render: (r) => fcfa(r.cost_fcfa) },
            ]}
          />
        </Panel>
        <Panel title="Derniers mouvements" padded={false} actions={
          <Button size="sm" variant="ghost" onClick={() => navigate('/credits')}><TrendingUp className="h-4 w-4 mr-1" />Tout voir</Button>}>
          <DataTable<Transaction>
            rows={recent.data?.transactions ?? []}
            rowKey={(r) => r.id}
            loading={recent.loading}
            empty="Aucun mouvement"
            onRowClick={(r) => navigate(`/users/${encodeURIComponent(r.user_email)}`)}
            columns={[
              { key: 'u', header: 'Compte', render: (r) => <div><p className="truncate max-w-[150px]">{r.user_email}</p><p className="text-[11px] text-foreground-muted">{ago(r.created_at)}</p></div> },
              { key: 't', header: 'Type', render: (r) => <Badge variant={r.type === 'usage' ? 'default' : r.type === 'bonus' ? 'warning' : 'success'}>{label(TX_LABELS, r.type)}</Badge> },
              { key: 'a', header: 'Montant', align: 'right', render: (r) => <span className={r.amount_fcfa < 0 ? 'text-foreground-secondary' : 'text-accent-success'}>{fcfa(r.amount_fcfa)}</span> },
            ]}
          />
        </Panel>
      </div>

      {health.data && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
          <span>Services :</span>
          {Object.entries(health.data.checks ?? {}).map(([k, v]) => (
            <Badge key={k} variant={v === 'ok' || v === 'configured' ? 'success' : v === 'not_configured' ? 'default' : 'error'}>
              {k} : {v === 'ok' || v === 'configured' ? 'OK' : v === 'not_configured' ? 'non configuré' : v}
            </Badge>
          ))}
          <span className="ml-auto">Serveur v{health.data.version}</span>
        </div>
      )}
    </div>
  )
}
