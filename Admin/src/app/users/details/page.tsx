import { useEffect, useState } from ‘react’
import { useNavigate, useParams } from ‘react-router-dom’
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from ‘@/components/ui/Card’
import { Button } from ‘@/components/ui/Button’
import { Badge } from ‘@/components/ui/Badge’
import { Input } from ‘@/components/ui/Input’
import { anzarApi } from ‘@/api/backend’
import { ArrowLeft, CreditCard, RefreshCw, Toggle2, Wallet } from ‘lucide-react’

interface AdminUser {
  id: string
  email: string
  name?: string
  is_active: boolean
  created_at: string
  last_login?: string
  credits: {
    balance_fcfa: number
    total_recharged: number
    total_used: number
  }
  recent_transactions: Transaction[]
  project_count: number
}

interface Transaction {
  id: string
  amount: number
  type: string
  description: string
  created_at: string
}

function formatDate(value?: string) {
  if (!value) return ‘—‘
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ‘—‘
  return d.toLocaleString(‘fr-FR’)
}

export default function UserDetailsPage() {
  const { userId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<AdminUser | null>(null)
  const [saving, setSaving] = useState(false)
  const [grantAmount, setGrantAmount] = useState(‘’)
  const [grantDescription, setGrantDescription] = useState(‘’)
  const [granting, setGranting] = useState(false)

  const load = async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const u = await anzarApi.getUser(decodeURIComponent(userId))
      setUser(u as AdminUser)
    } catch (err) {
      setError(err instanceof Error ? err.message : ‘Erreur chargement utilisateur’)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const toggleActiveStatus = async () => {
    if (!user) return
    setError(null)
    setSaving(true)
    try {
      await anzarApi.updateUser(user.email, { is_active: !user.is_active })
      setUser({ ...user, is_active: !user.is_active })
    } catch (err) {
      setError(err instanceof Error ? err.message : ‘Erreur mise à jour statut’)
    } finally {
      setSaving(false)
    }
  }

  const grantCredits = async () => {
    if (!user || !grantAmount || !grantDescription) return
    setError(null)
    setGranting(true)
    try {
      const amount = parseFloat(grantAmount)
      if (isNaN(amount) || amount <= 0) {
        setError(‘Montant invalide’)
        setGranting(false)
        return
      }
      await anzarApi.grantCredits(user.email, amount, grantDescription)
      setGrantAmount(‘’)
      setGrantDescription(‘’)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : ‘Erreur lors de l\’attribution de crédits’)
    } finally {
      setGranting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(‘/users’)} aria-label="Retour">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground-primary truncate">{user?.email || userId}</h1>
              <p className="text-sm text-foreground-secondary truncate">{user?.name || ‘—‘}</p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
            Rafraîchir
          </Button>
          <Button
            variant={user?.is_active ? ‘secondary’ : ‘outline’}
            leftIcon={<Toggle2 className="h-4 w-4" />}
            onClick={() => void toggleActiveStatus()}
            isLoading={saving}
          >
            {user?.is_active ? ‘Désactiver’ : ‘Activer’}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-accent-error">{error}</CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-foreground-secondary">Chargement…</CardContent>
        </Card>
      ) : !user ? (
        <Card>
          <CardContent className="p-6 text-sm text-foreground-secondary">Utilisateur introuvable.</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Informations utilisateur</CardTitle>
                <CardDescription>Détails du compte et status</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground-primary">Email</label>
                    <p className="text-sm text-foreground-primary">{user.email}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground-primary">Nom</label>
                    <p className="text-sm text-foreground-primary">{user.name || ‘—‘}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground-primary">Statut</label>
                    <div className="flex items-center gap-2">
                      <Badge variant={user.is_active ? ‘success’ : ‘outline’}>
                        {user.is_active ? ‘Actif’ : ‘Inactif’}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground-primary">Projets</label>
                    <p className="text-sm text-foreground-primary">{user.project_count}</p>
                  </div>
                </div>
                <div className="pt-2 border-t border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground-secondary">Créé le</span>
                    <span className="text-sm text-foreground-primary">{formatDate(user.created_at)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground-secondary">Dernière connexion</span>
                    <span className="text-sm text-foreground-primary">{formatDate(user.last_login)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-accent-secondary" />
                  Crédits
                </CardTitle>
                <CardDescription>Solde et historique</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-background-secondary/50 rounded-lg p-4 space-y-2">
                  <p className="text-xs font-medium text-foreground-secondary uppercase">Solde actuel</p>
                  <p className="text-2xl font-bold text-foreground-primary">
                    {user.credits.balance_fcfa.toLocaleString(‘fr-FR’)} FCFA
                  </p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Total recharges</span>
                    <span className="text-foreground-primary">{user.credits.total_recharged.toLocaleString(‘fr-FR’)} FCFA</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Total utilisé</span>
                    <span className="text-foreground-primary">{user.credits.total_used.toLocaleString(‘fr-FR’)} FCFA</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-accent-primary" />
                Attribuer des crédits
              </CardTitle>
              <CardDescription>Ajouter des crédits au compte utilisateur</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground-primary">Montant (FCFA)</label>
                  <Input
                    type="number"
                    placeholder="1000"
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    min="0"
                    step="100"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground-primary">Description</label>
                  <Input
                    placeholder="Bonus, recharge manuelle, etc."
                    value={grantDescription}
                    onChange={(e) => setGrantDescription(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={() => void grantCredits()}
                    disabled={!grantAmount || !grantDescription}
                    isLoading={granting}
                    className="w-full"
                  >
                    Attribuer
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {user.recent_transactions && user.recent_transactions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Transactions récentes</CardTitle>
                <CardDescription>Derniers mouvements de crédits</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-background-tertiary/40">
                      <tr className="text-left">
                        <th className="p-3 font-medium text-foreground-secondary">Type</th>
                        <th className="p-3 font-medium text-foreground-secondary">Description</th>
                        <th className="p-3 font-medium text-foreground-secondary">Montant</th>
                        <th className="p-3 font-medium text-foreground-secondary">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {user.recent_transactions.map((transaction) => (
                        <tr key={transaction.id} className="border-t border-border hover:bg-background-tertiary/30">
                          <td className="p-3">
                            <Badge variant={transaction.type === ‘credit’ ? ‘success’ : ‘secondary’} className="capitalize">
                              {transaction.type}
                            </Badge>
                          </td>
                          <td className="p-3 text-foreground-secondary">{transaction.description}</td>
                          <td className="p-3 text-foreground-primary font-medium">
                            {(transaction.type === ‘credit’ ? ‘+’ : ‘-’)}
                            {Math.abs(transaction.amount).toLocaleString(‘fr-FR’)} FCFA
                          </td>
                          <td className="p-3 text-foreground-secondary text-xs">
                            {formatDate(transaction.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
