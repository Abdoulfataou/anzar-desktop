import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Ban, CheckCircle2, Minus, Pencil, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  DataTable, ErrorBox, Field, Modal, Pagination, Panel, Spinner, Stat, Tabs, TextInput, useLoad, usePermissions, useTab,
} from '@/components/ui/kit'
import { CancelPaymentModal, CreditModal, MarkPaidModal, bonusFromTiers } from '@/components/actions'
import { api, AuditEntry, PaymentIntent, Transaction, UsageRecord } from '@/api/backend'
import {
  ACTION_LABELS, METHOD_LABELS, PAYMENT_LABELS, TASK_LABELS, TX_LABELS, ago, dateTime, fcfa, label, num,
} from '@/lib/format'

const LIMIT = 50

export default function UserDetailsPage() {
  const { userId = '' } = useParams()
  const email = decodeURIComponent(userId)
  const navigate = useNavigate()
  const perms = usePermissions()
  const user = useLoad(() => api.user(email), [email])
  const tabs = [
    { id: 'overview', label: 'Aperçu' },
    { id: 'ledger', label: 'Mouvements' },
    { id: 'usage', label: 'Consommation' },
    { id: 'payments', label: 'Paiements' },
    { id: 'audit', label: 'Journal', hidden: !perms.canSeeAudit },
  ]
  const [tab, setTab] = useTab(tabs)
  const [money, setMoney] = useState<'credit' | 'debit' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirmToggle, setConfirmToggle] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const u = user.data
  const balance = u?.credits?.balance_fcfa ?? 0
  const refresh = () => { user.reload(); setRefreshKey((k) => k + 1) }

  if (user.loading && !u) return <div className="py-16 text-center"><Spinner /></div>
  if (user.error || !u) return (
    <div className="space-y-4">
      <Button variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/users')}>Utilisateurs</Button>
      <ErrorBox message={user.error ?? 'Utilisateur introuvable'} onRetry={user.reload} />
    </div>
  )

  const toggleActive = async () => {
    try {
      await api.updateUser(email, { is_active: !u.is_active })
      toast.success(u.is_active ? 'Compte désactivé : accès coupé immédiatement' : 'Compte réactivé')
      setConfirmToggle(false)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    }
  }

  return (
    <div>
      <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/users')} className="mb-3">
        Utilisateurs
      </Button>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{u.email}</h1>
            {u.is_active ? <Badge variant="success">Actif</Badge> : <Badge variant="error">Désactivé</Badge>}
            {balance < 0 && <Badge variant="error">En dette</Badge>}
          </div>
          <p className="text-sm text-foreground-secondary mt-1">
            {u.name || 'Sans nom'} · inscrit le {dateTime(u.created_at)} · dernière connexion {ago(u.last_login)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {perms.canManageMoney && <>
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setMoney('credit')}>Créditer</Button>
            <Button variant="secondary" leftIcon={<Minus className="h-4 w-4" />} onClick={() => setMoney('debit')}>Retirer</Button>
            <Button variant="ghost" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setRenaming(true)}>Renommer</Button>
          </>}
          {perms.canToggleUsers && (
            <Button variant={u.is_active ? 'danger' : 'outline'}
              leftIcon={u.is_active ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              onClick={() => setConfirmToggle(true)}>
              {u.is_active ? 'Désactiver' : 'Réactiver'}
            </Button>
          )}
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="Solde" value={fcfa(balance)} tone={balance < 0 ? 'error' : balance > 0 ? 'success' : 'default'}
              hint={balance < 0 ? 'Bloqué jusqu\'à la recharge' : balance === 0 ? 'Ne peut pas utiliser l\'IA' : undefined} />
            <Stat label="Total rechargé" value={fcfa(u.credits?.total_recharged)} />
            <Stat label="Total consommé" value={fcfa(u.credits?.total_used)} />
            <Stat label="Projets serveur" value={num(u.project_count)} />
          </div>
          <Panel title="Derniers mouvements" padded={false} actions={
            <Button size="sm" variant="ghost" onClick={() => setTab('ledger')}>Tout voir</Button>}>
            <TxTable rows={u.recent_transactions?.slice(0, 10) ?? []} />
          </Panel>
        </div>
      )}
      {tab === 'ledger' && <UserLedger email={email} refreshKey={refreshKey} />}
      {tab === 'usage' && <UserUsage email={email} />}
      {tab === 'payments' && <UserPayments email={email} onChanged={refresh} />}
      {tab === 'audit' && <UserAudit email={email} refreshKey={refreshKey} />}

      {money && (
        <CreditModal open email={email} mode={money} balance={balance} onClose={() => setMoney(null)} onDone={refresh} />
      )}
      {renaming && <RenameModal email={email} current={u.name ?? ''} onClose={() => setRenaming(false)} onDone={refresh} />}
      <Modal open={confirmToggle} onClose={() => setConfirmToggle(false)}
        title={u.is_active ? 'Désactiver ce compte ?' : 'Réactiver ce compte ?'}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmToggle(false)}>Annuler</Button>
          <Button variant={u.is_active ? 'danger' : 'primary'} onClick={toggleActive}>{u.is_active ? 'Désactiver' : 'Réactiver'}</Button>
        </>}>
        <p className="text-sm text-foreground-secondary">
          {u.is_active
            ? 'L\'utilisateur est déconnecté immédiatement et ne peut plus se reconnecter. Son solde est conservé.'
            : 'L\'utilisateur pourra de nouveau se connecter et utiliser son solde.'}
        </p>
      </Modal>
    </div>
  )
}

function RenameModal({ email, current, onClose, onDone }: { email: string; current: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api.updateUser(email, { name: name.trim() })
      toast.success('Nom modifié')
      onClose()
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open title="Renommer l'utilisateur" onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Annuler</Button>
      <Button disabled={!name.trim()} isLoading={busy} onClick={save}>Enregistrer</Button>
    </>}>
      <Field label="Nom affiché"><TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
    </Modal>
  )
}

export function TxTable({ rows, loading, showUser = false }: { rows: Transaction[]; loading?: boolean; showUser?: boolean }) {
  const navigate = useNavigate()
  return (
    <DataTable<Transaction>
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading}
      empty="Aucun mouvement"
      onRowClick={showUser ? (r) => navigate(`/users/${encodeURIComponent(r.user_email)}`) : undefined}
      columns={[
        { key: 'date', header: 'Date', className: 'whitespace-nowrap text-foreground-secondary', render: (r) => dateTime(r.created_at) },
        ...(showUser ? [{ key: 'u', header: 'Compte', render: (r: Transaction) => r.user_email }] : []),
        { key: 'type', header: 'Type', render: (r) => (
          <Badge variant={r.type === 'usage' ? 'default' : r.type === 'bonus' ? 'warning' : r.type === 'refund' ? 'secondary' : 'success'}>
            {label(TX_LABELS, r.type)}
          </Badge>
        ) },
        { key: 'desc', header: 'Description', render: (r) => (
          <div className="max-w-[420px]">
            <p className="truncate" title={r.description}>{r.description || '—'}</p>
            {r.external_ref && <p className="text-[11px] text-foreground-muted font-mono truncate">réf. {r.external_ref}</p>}
            {r.type === 'usage' && (r.input_tokens || r.output_tokens) ? (
              <p className="text-[11px] text-foreground-muted">{num(r.input_tokens)} jetons entrée · {num(r.output_tokens)} sortie</p>
            ) : null}
          </div>
        ) },
        { key: 'amount', header: 'Montant', align: 'right', render: (r) => (
          <span className={r.amount_fcfa < 0 ? 'text-foreground-secondary' : 'text-accent-success font-medium'}>
            {r.amount_fcfa > 0 ? '+' : ''}{fcfa(r.amount_fcfa, true)}
          </span>
        ) },
      ]}
    />
  )
}

function useOffset(): [number, (o: number) => void] {
  const [sp, setSp] = useSearchParams()
  const offset = Number(sp.get('page') ?? 0)
  return [offset, (o) => { const n = new URLSearchParams(sp); n.set('page', String(o)); setSp(n, { replace: true }) }]
}

function UserLedger({ email, refreshKey }: { email: string; refreshKey: number }) {
  const [offset, setOffset] = useOffset()
  const data = useLoad(() => api.transactions({ email, limit: LIMIT, offset }), [email, offset, refreshKey])
  return (
    <Panel padded={false} title="Tous les mouvements du compte" description={data.data &&
      `${data.data.total} mouvement(s) · crédité ${fcfa(data.data.sum_credited)} · débité ${fcfa(-data.data.sum_debited)}`}>
      {data.error ? <div className="p-4"><ErrorBox message={data.error} /></div> : <TxTable rows={data.data?.transactions ?? []} loading={data.loading} />}
      <Pagination total={data.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
    </Panel>
  )
}

function UserUsage({ email }: { email: string }) {
  const [offset, setOffset] = useOffset()
  const data = useLoad(() => api.usage({ email, limit: LIMIT, offset }), [email, offset])
  const d = data.data
  return (
    <div className="space-y-4">
      {d && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Stat label="Requêtes" value={num(d.total)} />
          <Stat label="Jetons d'entrée" value={num(d.sum_input_tokens)} />
          <Stat label="Jetons de sortie" value={num(d.sum_output_tokens)} />
          <Stat label="Montant facturé" value={fcfa(d.sum_cost_fcfa)} tone="primary" />
        </div>
      )}
      <Panel padded={false}>
        <UsageTable rows={d?.usage ?? []} loading={data.loading} error={data.error} />
        <Pagination total={d?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
      </Panel>
    </div>
  )
}

export function UsageTable({ rows, loading, error, showUser = false }: { rows: UsageRecord[]; loading?: boolean; error?: string | null; showUser?: boolean }) {
  const navigate = useNavigate()
  return (
    <DataTable<UsageRecord>
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading}
      error={error}
      empty="Aucune consommation"
      onRowClick={showUser ? (r) => navigate(`/users/${encodeURIComponent(r.user_email)}?tab=usage`) : undefined}
      columns={[
        { key: 'date', header: 'Date', className: 'whitespace-nowrap text-foreground-secondary', render: (r) => dateTime(r.created_at) },
        ...(showUser ? [{ key: 'u', header: 'Compte', render: (r: UsageRecord) => r.user_email }] : []),
        { key: 'task', header: 'Type', render: (r) => {
          const bad = r.task_type === 'billing_failed'
          const est = r.task_type.endsWith('estimated')
          return <Badge variant={bad ? 'error' : est ? 'warning' : 'default'}>{label(TASK_LABELS, r.task_type)}</Badge>
        } },
        { key: 'model', header: 'Modèle', render: (r) => <span className="font-mono text-xs">{r.model}</span> },
        { key: 'in', header: 'Entrée', align: 'right', render: (r) => num(r.input_tokens) },
        { key: 'out', header: 'Sortie', align: 'right', render: (r) => num(r.output_tokens) },
        { key: 'dur', header: 'Durée', align: 'right', render: (r) => r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)} s` : '—' },
        { key: 'cost', header: 'Facturé', align: 'right', render: (r) => fcfa(r.cost_fcfa, true) },
      ]}
    />
  )
}

function UserPayments({ email, onChanged }: { email: string; onChanged: () => void }) {
  const perms = usePermissions()
  const data = useLoad(() => api.payments({ status: 'all', email, limit: 100 }), [email])
  const settings = useLoad(() => api.settings(), [])
  const [paying, setPaying] = useState<PaymentIntent | null>(null)
  const [cancelling, setCancelling] = useState<PaymentIntent | null>(null)
  const done = () => { data.reload(); onChanged() }
  return (
    <Panel padded={false}>
      <PaymentsTable rows={data.data?.payment_intents ?? []} loading={data.loading} error={data.error}
        canAct={perms.canManageMoney} onPay={setPaying} onCancel={setCancelling} />
      <MarkPaidModal intent={paying} onClose={() => setPaying(null)} onDone={done}
        bonusPercent={bonusFromTiers(settings.data?.recharge_bonus_tiers)} />
      <CancelPaymentModal intent={cancelling} onClose={() => setCancelling(null)} onDone={done} />
    </Panel>
  )
}

export function PaymentsTable({ rows, loading, error, canAct, onPay, onCancel, showUser = false }: {
  rows: PaymentIntent[]; loading?: boolean; error?: string | null; canAct: boolean
  onPay: (p: PaymentIntent) => void; onCancel: (p: PaymentIntent) => void; showUser?: boolean
}) {
  const navigate = useNavigate()
  return (
    <DataTable<PaymentIntent>
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading}
      error={error}
      empty="Aucune demande de paiement"
      columns={[
        { key: 'date', header: 'Demandé le', className: 'whitespace-nowrap text-foreground-secondary', render: (r) => dateTime(r.created_at) },
        ...(showUser ? [{ key: 'u', header: 'Compte', render: (r: PaymentIntent) => (
          <button className="hover:text-accent-primary text-left" onClick={() => navigate(`/users/${encodeURIComponent(r.user_email)}`)}>{r.user_email}</button>
        ) }] : []),
        { key: 'method', header: 'Moyen', render: (r) => label(METHOD_LABELS, r.method) },
        { key: 'amount', header: 'Montant', align: 'right', render: (r) => <span className="font-medium">{fcfa(r.amount_fcfa)}</span> },
        { key: 'status', header: 'Statut', render: (r) => (
          <Badge variant={r.status === 'paid' ? 'success' : r.status === 'pending' ? 'warning' : 'default'}>{label(PAYMENT_LABELS, r.status)}</Badge>
        ) },
        { key: 'ref', header: 'Référence', render: (r) => <span className="font-mono text-xs text-foreground-secondary">{r.provider_ref || '—'}</span> },
        { key: 'act', header: '', align: 'right', render: (r) => canAct && r.status === 'pending' && (
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => onPay(r)}>Valider</Button>
            <Button size="sm" variant="ghost" onClick={() => onCancel(r)}>Annuler</Button>
          </div>
        ) },
      ]}
    />
  )
}

function UserAudit({ email, refreshKey }: { email: string; refreshKey: number }) {
  const data = useLoad(() => api.audit({ target: email, limit: 100 }), [email, refreshKey])
  return (
    <Panel padded={false} title="Actions des admins sur ce compte">
      <AuditTable rows={data.data?.entries ?? []} loading={data.loading} error={data.error} />
    </Panel>
  )
}

export function AuditTable({ rows, loading, error }: { rows: AuditEntry[]; loading?: boolean; error?: string | null }) {
  return (
    <DataTable<AuditEntry>
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading}
      error={error}
      empty="Aucune action enregistrée"
      columns={[
        { key: 'date', header: 'Date', className: 'whitespace-nowrap text-foreground-secondary', render: (r) => dateTime(r.created_at) },
        { key: 'admin', header: 'Admin', render: (r) => r.admin_email },
        { key: 'action', header: 'Action', render: (r) => (
          <Badge variant={r.action === 'login_failed' || r.action.startsWith('disable') || r.action.startsWith('debit') ? 'error'
            : r.action.startsWith('grant') || r.action.startsWith('mark') ? 'success' : 'default'}>{label(ACTION_LABELS, r.action)}</Badge>
        ) },
        { key: 'target', header: 'Cible', render: (r) => <span className="text-foreground-secondary">{r.target || '—'}</span> },
        { key: 'details', header: 'Détails', render: (r) => <span className="text-xs text-foreground-muted block max-w-[360px] truncate" title={r.details}>{r.details || '—'}</span> },
        { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs text-foreground-muted">{r.ip || '—'}</span> },
      ]}
    />
  )
}

