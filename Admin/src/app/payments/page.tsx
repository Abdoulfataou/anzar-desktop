import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { anzarApi, type PaymentIntent } from '@/api/backend'
import { CheckCircle2, CreditCard, RefreshCw } from 'lucide-react'

function statusVariant(status: PaymentIntent['status']) {
  if (status === 'paid') return 'success' as const
  if (status === 'pending') return 'secondary' as const
  return 'outline' as const
}

export default function PaymentsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<PaymentIntent[]>([])
  const [total, setTotal] = useState(0)

  const [status, setStatus] = useState<'pending' | 'paid' | 'failed' | 'cancelled' | 'all'>('pending')

  const [selected, setSelected] = useState<PaymentIntent | null>(null)
  const [providerRef, setProviderRef] = useState('')
  const [description, setDescription] = useState('')
  const [marking, setMarking] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await anzarApi.listPaymentIntents({ status, limit: 100, offset: 0 })
      setItems(res.payment_intents || [])
      setTotal(res.total || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement paiements')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    if (!selected) return
    setProviderRef(selected.provider_ref || '')
    setDescription('')
  }, [selected])

  const pendingCount = useMemo(() => items.filter((i) => i.status === 'pending').length, [items])

  const markPaid = async () => {
    if (!selected) return
    const desc = description.trim()
    if (desc.length < 3) {
      setError('Raison obligatoire (min 3 caractères)')
      return
    }
    setMarking(true)
    setError(null)
    try {
      await anzarApi.markPaymentPaid(selected.id, {
        provider_ref: providerRef.trim(),
        description: desc,
      })
      setSelected(null)
      setProviderRef('')
      setDescription('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur validation paiement')
    } finally {
      setMarking(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Paiements</h1>
          <p className="text-foreground-secondary mt-1">
            Demandes de paiement (mode “pré-intégration”). En attente: {pendingCount} / {total}.
          </p>
        </div>
        <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
          Rafraîchir
        </Button>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-accent-error">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-accent-primary" />
            Liste
          </CardTitle>
          <CardDescription>Filtrer et valider manuellement une demande.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Statut</label>
              <select
                className="w-full md:w-56 h-10 rounded-lg border border-border bg-background-secondary px-3 text-sm text-foreground-primary"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                disabled={loading}
              >
                <option value="pending">En attente</option>
                <option value="paid">Payé</option>
                <option value="failed">Échec</option>
                <option value="cancelled">Annulé</option>
                <option value="all">Tous</option>
              </select>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-foreground-secondary">Chargement…</p>
          ) : items.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-background-tertiary/40">
                  <tr className="text-left">
                    <th className="p-3 font-medium text-foreground-secondary">Email</th>
                    <th className="p-3 font-medium text-foreground-secondary">Montant</th>
                    <th className="p-3 font-medium text-foreground-secondary">Méthode</th>
                    <th className="p-3 font-medium text-foreground-secondary">Statut</th>
                    <th className="p-3 font-medium text-foreground-secondary">Date</th>
                    <th className="p-3 font-medium text-foreground-secondary" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-t border-border hover:bg-background-tertiary/30">
                      <td className="p-3 text-foreground-primary">{p.user_email}</td>
                      <td className="p-3 text-foreground-primary font-medium">
                        {Number(p.amount_fcfa || 0).toLocaleString('fr-FR')} {p.currency || 'XOF'}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="capitalize">
                          {p.method || '—'}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={statusVariant(p.status)} className="capitalize">
                          {p.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-foreground-secondary text-xs">
                        {p.created_at ? new Date(p.created_at).toLocaleString('fr-FR') : '—'}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={<CheckCircle2 className="h-4 w-4" />}
                          disabled={p.status !== 'pending'}
                          onClick={() => setSelected(p)}
                        >
                          Marquer payé
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-foreground-secondary">Aucune demande.</p>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card className="border-accent-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-accent-primary" />
              Valider un paiement
            </CardTitle>
            <CardDescription>
              {selected.user_email} — {Number(selected.amount_fcfa || 0).toLocaleString('fr-FR')} {selected.currency}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground-primary">Référence (optionnel)</label>
                <Input
                  value={providerRef}
                  onChange={(e) => setProviderRef(e.target.value)}
                  placeholder="ex: wave_2026_000123"
                  disabled={marking}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground-primary">Raison (obligatoire)</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Paiement reçu et vérifié"
                  disabled={marking}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelected(null)} disabled={marking}>
                Annuler
              </Button>
              <Button onClick={() => void markPaid()} isLoading={marking}>
                Valider & créditer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

