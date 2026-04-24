import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { anzarApi, type AdminRole, type AdminUser, type AdminUserStatus } from '@/api/backend'
import { cn } from '@/lib/utils'
import { Building2, ChevronRight, Filter, RefreshCw, Shield, UserMinus, UserPlus, Users } from 'lucide-react'
import { useOrgStore } from '@/stores/orgStore'

function statusVariant(status: AdminUserStatus) {
  if (status === 'active') return 'success' as const
  if (status === 'suspended') return 'warning' as const
  return 'outline' as const
}

function roleVariant(role: AdminRole) {
  if (role === 'owner') return 'primary' as const
  if (role === 'admin') return 'secondary' as const
  if (role === 'support') return 'outline' as const
  return 'outline' as const
}

function formatDate(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR')
}

export default function UsersPage() {
  const navigate = useNavigate()
  const getUserOrgs = useOrgStore((s) => s.getUserOrgs)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])

  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | 'all'>('all')
  const [roleFilter, setRoleFilter] = useState<AdminRole | 'all'>('all')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await anzarApi.adminListUsers({ q: q.trim() || undefined, limit: 100, offset: 0 })
      setUsers(res.users || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      return true
    })
  }, [users, roleFilter, statusFilter])

  const updateUser = async (id: string, patch: Partial<Pick<AdminUser, 'status' | 'role'>>) => {
    setError(null)
    try {
      const updated = await anzarApi.adminPatchUser(id, patch)
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour user')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-gradient-to-br from-accent-primary/20 to-accent-secondary/10 border border-border flex items-center justify-center">
              <Users className="h-5 w-5 text-accent-primary" />
            </span>
            Users
          </h1>
          <p className="text-foreground-secondary mt-2">
            Comptes, rôles et statut (suspend/disable) — prêt pour brancher un backend admin.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void load()}
            disabled={loading}
          >
            Rafraîchir
          </Button>
          <Button variant="outline" leftIcon={<Building2 className="h-4 w-4" />} onClick={() => navigate('/orgs')}>
            Orgs
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-foreground-secondary">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-accent-secondary" />
              Filtrer
            </span>
            <Badge variant="outline">{filtered.length} users</Badge>
          </CardTitle>
          <CardDescription>Recherche + filtres rapides pour une vue dense.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Input
            placeholder="Rechercher (email, nom)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load()
            }}
          />

          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground-secondary w-16">Statut</span>
            <select
              className="flex-1 px-3 py-2 rounded-md border border-border bg-background-secondary text-foreground-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AdminUserStatus | 'all')}
            >
              <option value="all">Tous</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground-secondary w-16">Rôle</span>
            <select
              className="flex-1 px-3 py-2 rounded-md border border-border bg-background-secondary text-foreground-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as AdminRole | 'all')}
            >
              <option value="all">Tous</option>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="support">Support</option>
              <option value="readonly">Readonly</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liste</CardTitle>
          <CardDescription>
            Actions rapides: suspend/activate + modification rôle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-foreground-secondary">Chargement…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-foreground-secondary">Aucun utilisateur.</p>
          ) : (
            <div className="overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-background-tertiary/40">
                  <tr className="text-left">
                    <th className="p-3 font-medium text-foreground-secondary">User</th>
                    <th className="p-3 font-medium text-foreground-secondary">Orgs</th>
                    <th className="p-3 font-medium text-foreground-secondary">Statut</th>
                    <th className="p-3 font-medium text-foreground-secondary">Rôle</th>
                    <th className="p-3 font-medium text-foreground-secondary">Pays</th>
                    <th className="p-3 font-medium text-foreground-secondary">Last seen</th>
                    <th className="p-3 font-medium text-foreground-secondary">Projets</th>
                    <th className="p-3 font-medium text-foreground-secondary">Crédits</th>
                    <th className="p-3 font-medium text-foreground-secondary"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} className="border-t border-border hover:bg-background-tertiary/30">
                      <td className="p-3">
                        <div className="min-w-[220px]">
                          <p className="font-medium text-foreground-primary truncate">{u.name || u.email}</p>
                          <p className="text-xs text-foreground-secondary truncate">{u.email}</p>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="min-w-[160px] flex flex-wrap gap-1">
                          {getUserOrgs(u.id).length === 0 ? (
                            <span className="text-xs text-foreground-muted">—</span>
                          ) : (
                            getUserOrgs(u.id)
                              .slice(0, 2)
                              .map((o) => (
                                <Badge key={o.id} variant="outline" className="text-xs">
                                  {o.name}
                                </Badge>
                              ))
                          )}
                          {getUserOrgs(u.id).length > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{getUserOrgs(u.id).length - 2}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant={statusVariant(u.status)} className="capitalize">
                          {u.status}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Badge variant={roleVariant(u.role)} className="capitalize">
                            {u.role}
                          </Badge>
                          <select
                            className={cn(
                              'px-2 py-1 rounded-md border border-border bg-background-secondary text-foreground-primary text-xs',
                              'focus:outline-none focus:ring-2 focus:ring-accent-primary'
                            )}
                            value={u.role}
                            onChange={(e) => void updateUser(u.id, { role: e.target.value as AdminRole })}
                          >
                            <option value="owner">Owner</option>
                            <option value="admin">Admin</option>
                            <option value="support">Support</option>
                            <option value="readonly">Readonly</option>
                          </select>
                        </div>
                      </td>
                      <td className="p-3 text-foreground-primary">{u.country || '—'}</td>
                      <td className="p-3 text-foreground-secondary">{formatDate(u.last_seen_at)}</td>
                      <td className="p-3 text-foreground-primary">{u.projects_count ?? '—'}</td>
                      <td className="p-3 text-foreground-primary">
                        {typeof u.credits_balance_fcfa === 'number'
                          ? `${u.credits_balance_fcfa.toLocaleString('fr-FR')} FCFA`
                          : '—'}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-2">
                          {u.status === 'active' ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              leftIcon={<UserMinus className="h-4 w-4" />}
                              onClick={() => void updateUser(u.id, { status: 'suspended' })}
                            >
                              Suspend
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              leftIcon={<UserPlus className="h-4 w-4" />}
                              onClick={() => void updateUser(u.id, { status: 'active' })}
                            >
                              Activate
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            leftIcon={<Shield className="h-4 w-4" />}
                            onClick={() => void updateUser(u.id, { status: 'disabled' })}
                          >
                            Disable
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            rightIcon={<ChevronRight className="h-4 w-4" />}
                            onClick={() => navigate(`/users/${encodeURIComponent(u.id)}`)}
                          >
                            Détails
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
