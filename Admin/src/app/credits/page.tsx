import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { anzarApi, type Credits } from '@/api/backend'
import { useAuthStore } from '@/stores/authStore'
import { CreditCard, Receipt, Wallet } from 'lucide-react'

export default function CreditsPage() {
  const credits = useAuthStore((s) => s.credits)
  const setCredits = useAuthStore((s) => s.setCredits)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [amount, setAmount] = useState('500')
  const [paymentRef, setPaymentRef] = useState('')
  const [recharging, setRecharging] = useState(false)

  const [tx, setTx] = useState<unknown[]>([])

  const balanceText = useMemo(() => {
    const b = credits?.balance_fcfa
    if (typeof b !== 'number') return '—'
    return `${b.toLocaleString('fr-FR')} FCFA`
  }, [credits?.balance_fcfa])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [c, t] = await Promise.all([
          anzarApi.credits(),
          anzarApi.creditTransactions(50, 0),
        ])
        if (!alive) return
        setCredits(c)
        setTx(Array.isArray(t.transactions) ? t.transactions : [])
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Erreur chargement crédits')
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [setCredits])

  const doRecharge = async () => {
    setError(null)
    setRecharging(true)
    try {
      const amountNum = Number(amount)
      if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('Montant invalide')

      const res = await anzarApi.rechargeCredits({
        amount_fcfa: amountNum,
        payment_ref: paymentRef.trim(),
        payment_method: 'manual',
      })

      const nextCredits: Credits = {
        balance_fcfa: res.balance_fcfa,
        total_recharged: credits?.total_recharged,
        total_used: credits?.total_used,
      }
      setCredits(nextCredits)

      const t = await anzarApi.creditTransactions(50, 0)
      setTx(Array.isArray(t.transactions) ? t.transactions : [])
      setPaymentRef('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur recharge')
    } finally {
      setRecharging(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Credits</h1>
          <p className="text-foreground-secondary mt-1">Solde prépayé (FCFA) + historique.</p>
        </div>
        <Badge variant="primary" className="text-sm px-3 py-1">
          {balanceText}
        </Badge>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-foreground-secondary">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-accent-primary" />
              Solde
            </CardTitle>
            <CardDescription>Source de vérité = backend.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-4xl font-bold text-foreground-primary">{balanceText}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Rechargé: {credits?.total_recharged ?? '—'}</Badge>
              <Badge variant="outline">Utilisé: {credits?.total_used ?? '—'}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-accent-secondary" />
              Recharger (manuel)
            </CardTitle>
            <CardDescription>
              Ce bouton appelle <code className="text-xs">POST /api/credits/recharge</code>. En prod, ça doit être
              déclenché après validation paiement (Wave/OM/etc.).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Montant (FCFA)</label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground-primary">Référence paiement (optionnel)</label>
              <Input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="WAVE-XXXX" />
            </div>

            <div className="md:col-span-3 flex justify-end">
              <Button onClick={() => void doRecharge()} isLoading={recharging} disabled={recharging || loading}>
                Recharger
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-accent-primary" />
            Transactions
          </CardTitle>
          <CardDescription>Recharges + usages (selon implémentation backend).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-foreground-secondary">Chargement…</p>
          ) : tx.length === 0 ? (
            <p className="text-sm text-foreground-secondary">Aucune transaction.</p>
          ) : (
            <pre className="text-xs whitespace-pre-wrap break-words bg-background-primary border border-border rounded-lg p-4 overflow-auto">
              {JSON.stringify(tx.slice(0, 50), null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

