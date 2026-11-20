import { useState } from 'react'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Notice, PageHeader, Pagination, Panel, Tabs, TextInput, useDebounced, useLoad, usePermissions, useTab } from '@/components/ui/kit'
import { CancelPaymentModal, MarkPaidModal, bonusFromTiers } from '@/components/actions'
import { api, PaymentIntent } from '@/api/backend'
import { fcfa } from '@/lib/format'
import { PaymentsTable } from '@/app/users/details/page'

const LIMIT = 50

export default function PaymentsPage() {
  const perms = usePermissions()
  const [sp, setSp] = useSearchParams()
  const base = [
    { id: 'pending', label: 'En attente' },
    { id: 'paid', label: 'Payés' },
    { id: 'cancelled', label: 'Annulés' },
    { id: 'all', label: 'Tous' },
  ]
  const [tab, setTab] = useTab(base)
  const [email, setEmail] = useState('')
  const q = useDebounced(email)
  const offset = Number(sp.get('page') ?? 0)
  const setOffset = (o: number) => { const n = new URLSearchParams(sp); n.set('page', String(o)); setSp(n, { replace: true }) }
  const data = useLoad(() => api.payments({ status: tab, email: q, limit: LIMIT, offset }), [tab, q, offset])
  const settings = useLoad(() => api.settings(), [])
  const [paying, setPaying] = useState<PaymentIntent | null>(null)
  const [cancelling, setCancelling] = useState<PaymentIntent | null>(null)
  const refresh = async (p: PaymentIntent) => {
    try {
      const r = await api.refreshPayment(p.id)
      const st = r.payment_intent.status
      toast.success(st === 'paid' ? 'Paiement confirmé : compte crédité' : st === 'pending'
        ? 'Toujours en attente chez le fournisseur' : `Statut : ${st}`)
      data.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Vérification impossible')
    }
  }

  const counts = data.data?.counts ?? {}
  const tabs = base.map((t) => ({
    ...t,
    count: t.id === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[t.id] ?? 0,
  }))

  return (
    <div>
      <PageHeader
        title="Paiements"
        description="Recharges depuis l'app. Les paiements automatiques (FedaPay, Stripe) se créditent seuls ; « Vérifier » relit leur statut. Les demandes manuelles se valident après réception de l'argent."
        actions={<Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={data.reload}>Actualiser</Button>}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'pending' && (counts.pending ?? 0) > 0 && (
        <div className="mb-4">
          <Notice tone="warning">
            {counts.pending} demande(s) en attente
            {data.data && tab === 'pending' ? ` · ${fcfa(data.data.sum_amount_fcfa)} au total` : ''}. Ne valide une demande
            qu'après avoir vu l'argent arriver sur ton compte Mobile Money : la validation crédite le client immédiatement.
          </Notice>
        </div>
      )}
      <Panel padded={false}>
        <div className="p-4 border-b border-border-subtle flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
            <TextInput className="pl-9" placeholder="Filtrer par e-mail…" value={email}
              onChange={(e) => { setEmail(e.target.value); if (offset) setOffset(0) }} />
          </div>
          {data.data && <span className="text-xs text-foreground-secondary">{data.data.total} demande(s) · {fcfa(data.data.sum_amount_fcfa)}</span>}
        </div>
        <PaymentsTable rows={data.data?.payment_intents ?? []} loading={data.loading} error={data.error}
          canAct={perms.canManageMoney} onPay={setPaying} onCancel={setCancelling} onRefresh={refresh} showUser />
        <Pagination total={data.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
      </Panel>
      <MarkPaidModal intent={paying} onClose={() => setPaying(null)} onDone={data.reload}
        bonusPercent={bonusFromTiers(settings.data?.recharge_bonus_tiers)} />
      <CancelPaymentModal intent={cancelling} onClose={() => setCancelling(null)} onDone={data.reload} />
    </div>
  )
}
