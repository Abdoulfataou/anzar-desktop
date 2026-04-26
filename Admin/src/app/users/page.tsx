import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { anzarApi, AdminUser } from '@/api/backend'
import { Search, UserCheck, UserX, Gift, RefreshCw } from 'lucide-react'

const LIMIT = 50

function formatDate(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR')
}

function formatCredits(value?: number) {
  if (typeof value !== 'number') return '—'
  return `${value.toLocaleString('fr-FR')} FCFA`
}

function statusBadge(is_active: boolean) {
  if (is_active) return 'success' as const
  return 'destructive' as const
}

export default function UsersPage() {
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'disabled'>('all')
  const [offset, setOffset] = useState(0)

  const loadUsers = useCallback(
    async (newSearch?: string, newStatus?: 'all' | 'active' | 'disabled') => {
      const s = newSearch !== undefined ? newSearch : search
      const st = newStatus !== undefined ? newStatus : status

      setLoading(true)
      setError(null)
      setUsers([])
      setOffset(0)

      try {
        const res = await anzarApi.listUsers({
          search: s.trim() || undefined,
          status: st === 'all' ? undefined : st,
          limit: LIMIT,
          offset: 0,
        })
        setUsers(res.users || [])
        setTotal(res.total || 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur chargement utilisateurs')
      } finally {
        setLoading(false)
      }
    },
    [search, status]
  )

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    setError(null)

    try {
      const newOffset = offset + LIMIT
      const res = await anzarApi.listUsers({
        search: search.trim() || undefined,
        status: status === 'all' ? undefined : status,
        limit: LIMIT,
        offset: newOffset,
      })
      setUsers((prev) => [...prev, ...(res.users || [])])
      setOffset(newOffset)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement supplémentaire')
    } finally {
      setLoadingMore(false)
    }
  }, [search, status, offset])

  useEffect(() => {
    void loadUsers()
  }, [])

  const handleSearch = (value: string) => {
    setSearch(value)
    void loadUsers(value, status)
  }

  const handleStatusChange = (newStatus: 'all' | 'active' | 'disabled') => {
    setStatus(newStatus)
    void loadUsers(search, newStatus)
  }

  const toggleUserStatus = async (user: AdminUser) => {
    setError(null)
    try {
      await anzarApi.updateUser(user.email, { is_active: !user.is_active })
      setUsers((prev) =>
        prev.map((u) => (u.email === user.email ? { ...u, is_active: !u.is_active } : u))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour utilisateur')
    }
  }

  const [grantingEmail, setGrantingEmail] = useState<string | null>(null)
  const [grantAmount, setGrantAmount] = useState('')

  const handleGrantCredits = async (userEmail: string) => {
    if (!grantAmount.trim()) {
      setError('Veuillez entrer un montant')
      return
    }

    const amount = parseFloat(grantAmount)
    if (isNaN(amount) || amount <= 0) {
      setError('Montant invalide')
      return
    }

    setError(null)
    try {
      await anzarApi.grantCredits(userEmail, amount, 'Admin grant')
      setUsers((prev) =>
        prev.map((u) =>
          u.email === userEmail ? { ...u, balance_fcfa: (u.balance_fcfa || 0) + amount } : u
        )
      )
      setGrantingEmail(null)
      setGrantAmount('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur allocation crédits')
    }
  }

  const hasMore = offset + LIMIT < total

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-gradient-to-br from-accent-primary/20 to-accent-secondary/10 border border-border flex items-center justify-center">
              <UserCheck className="h-5 w-5 text-accent-primary" />
            </span>
            Utilisateurs
          </h1>
          <p className="text-foreground-secondary mt-2">
            Gestion des comptes, crédits et statut actif/désactivé
          </p>
        </div>

        <Button
          variant="secondary"
          leftIcon={<RefreshCw className="h-4 w-4" />}
          onClick={() => void loadUsers()}
          disabled={loading}
        >
          Rafraîchir
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-600">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Filtrer
            </span>
            <Badge variant="outline">
              {users.length} / {total}
            </Badge>
          </CardTitle>
          <CardDescription>Recherche par email ou nom</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Recherche</label>
            <Input
              placeholder="Email ou nom…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Statut</label>
            <select
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as any)}
            >
              <option value="all">Tous</option>
              <option value="active">Actifs</option>
              <option value="disabled">Désactivés</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liste des utilisateurs</CardTitle>
          <CardDescription>Email, nom, statut, crédits et actions rapides</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-sm text-foreground-secondary">
              Chargement…
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-sm text-foreground-secondary">
              Aucun utilisateur trouvé
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-background-tertiary">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                        Email
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                        Nom
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                        Statut
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-foreground-secondary">
                        Crédits FCFA
                      </th>
                      <th className="px-4 py-3 text-center font-medium text-foreground-secondary">
                        Projets
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-foreground-secondary">
                        Dernière connexion
                      </th>
                      <th className="px-4 py-3 text-center font-medium text-foreground-secondary">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-background-tertiary/30 transition">
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-foreground-secondary truncate">
                            {u.email}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-foreground-primary">
                          {u.name || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={statusBadge(u.is_active)}>
                            {u.is_active ? 'Actif' : 'Désactivé'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-primary font-medium">
                          {formatCredits(u.balance_fcfa)}
                        </td>
                        <td className="px-4 py-3 text-center text-foreground-primary">
                          {u.project_count ?? 0}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground-secondary">
                          {formatDate(u.last_login)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant={u.is_active ? 'secondary' : 'outline'}
                              leftIcon={
                                u.is_active ? (
                                  <UserX className="h-4 w-4" />
                                ) : (
                                  <UserCheck className="h-4 w-4" />
                                )
                              }
                              onClick={() => void toggleUserStatus(u)}
                            >
                              {u.is_active ? 'Désactiver' : 'Activer'}
                            </Button>

                            {grantingEmail === u.email ? (
                              <div className="flex gap-1 items-center">
                                <Input
                                  type="number"
                                  placeholder="Montant"
                                  value={grantAmount}
                                  onChange={(e) => setGrantAmount(e.target.value)}
                                  className="w-24"
                                />
                                <Button
                                  size="sm"
                                  onClick={() => void handleGrantCredits(u.email)}
                                  disabled={!grantAmount.trim()}
                                >
                                  OK
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setGrantingEmail(null)
                                    setGrantAmount('')
                                  }}
                                >
                                  ✕
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                leftIcon={<Gift className="h-4 w-4" />}
                                onClick={() => setGrantingEmail(u.email)}
                              >
                                Crédits
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasMore && (
                <div className="mt-4 text-center">
                  <Button
                    variant="secondary"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Chargement…' : 'Charger plus'}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
