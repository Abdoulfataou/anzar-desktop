import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { anzarApi } from '@/api/backend'
import { Receipt, Wallet, AlertCircle } from 'lucide-react'

interface PlatformStats {
  credits: {
    total_balance: number
    platform_recharged: number
    platform_used: number
  }
}

interface Transaction {
  id: number
  user_email: string
  type: string
  amount_fcfa: number
  description: string
  provider?: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  created_at: string
}

export default function CreditsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [statsData, txData] = await Promise.all([
          anzarApi.stats(),
          anzarApi.transactions(50, 0),
        ])
        if (!alive) return
        setStats(statsData)
        const txs = (txData as any)?.transactions
        setTransactions(Array.isArray(txs) ? (txs as Transaction[]) : [])
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
  }, [])

  const balanceText = useMemo(() => {
    const b = stats?.credits.total_balance
    if (typeof b !== 'number') return '—'
    return `${b.toLocaleString('fr-FR')} FCFA`
  }, [stats?.credits.total_balance])

  const rechargedText = useMemo(() => {
    const r = stats?.credits.platform_recharged
    if (typeof r !== 'number') return '—'
    return `${r.toLocaleString('fr-FR')} FCFA`
  }, [stats?.credits.platform_recharged])

  const usedText = useMemo(() => {
    const u = stats?.credits.platform_used
    if (typeof u !== 'number') return '—'
    return `${u.toLocaleString('fr-FR')} FCFA`
  }, [stats?.credits.platform_used])

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateString
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Crédits</h1>
          <p className="text-foreground-secondary mt-1">Vue d'ensemble des crédits de la plateforme.</p>
        </div>
        <Badge variant="primary" className="text-sm px-3 py-1">
          {balanceText}
        </Badge>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-accent-error flex-shrink-0 mt-0.5" />
            <p className="text-sm text-accent-error">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="p-6 text-center text-foreground-secondary">
            Chargement des statistiques…
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Statistics Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-accent-primary" />
                  Solde total
                </CardTitle>
                <CardDescription>Crédits disponibles sur la plateforme</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-4xl font-bold text-foreground-primary">{balanceText}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-accent-secondary" />
                  Rechargements
                </CardTitle>
                <CardDescription>Total rechargé sur la plateforme</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-3xl font-bold text-accent-secondary">{rechargedText}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-accent-warning" />
                  Consommés
                </CardTitle>
                <CardDescription>Total consommé sur la plateforme</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-3xl font-bold text-accent-warning">{usedText}</p>
              </CardContent>
            </Card>
          </div>

          {/* Transactions Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-accent-primary" />
                Transactions récentes
              </CardTitle>
              <CardDescription>Historique des recharges et consommations par utilisateur</CardDescription>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <p className="text-sm text-foreground-secondary text-center py-6">
                  Aucune transaction enregistrée
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 font-semibold text-foreground-primary">Date</th>
                        <th className="text-left py-3 px-4 font-semibold text-foreground-primary">Utilisateur</th>
                        <th className="text-left py-3 px-4 font-semibold text-foreground-primary">Type</th>
                        <th className="text-left py-3 px-4 font-semibold text-foreground-primary">Description</th>
                        <th className="text-right py-3 px-4 font-semibold text-foreground-primary">Montant</th>
                        <th className="text-left py-3 px-4 font-semibold text-foreground-primary">Détails</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx) => (
                        <tr key={tx.id} className="border-b border-border hover:bg-background-secondary/30 transition">
                          <td className="py-3 px-4 text-foreground-secondary">
                            {formatDate(tx.created_at)}
                          </td>
                          <td className="py-3 px-4 text-foreground-primary font-mono text-xs">
                            {tx.user_email}
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant={tx.type === 'usage' ? 'secondary' : 'primary'}>
                              {tx.type}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-foreground-secondary max-w-xs truncate">
                            {tx.description}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold">
                            <span className={tx.type === 'usage' ? 'text-accent-error' : 'text-accent-primary'}>
                              {tx.type === 'usage' ? '-' : '+'}
                              {Math.abs(tx.amount_fcfa).toLocaleString('fr-FR')} FCFA
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs text-foreground-secondary">
                            {tx.provider && (
                              <div className="flex items-center gap-1">
                                <span className="inline-block px-2 py-1 bg-background-tertiary rounded">
                                  {tx.provider}
                                </span>
                              </div>
                            )}
                            {tx.model && (
                              <div className="flex items-center gap-1 mt-1">
                                <span className="inline-block px-2 py-1 bg-background-tertiary rounded">
                                  {tx.model}
                                </span>
                              </div>
                            )}
                            {(tx.input_tokens || tx.output_tokens) && (
                              <div className="flex items-center gap-1 mt-1">
                                <span className="inline-block px-2 py-1 bg-background-tertiary rounded">
                                  {tx.input_tokens ?? 0}in + {tx.output_tokens ?? 0}out
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
