import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { anzarApi, type AdminRole, type AdminUser, type AdminUserStatus } from '@/api/backend'
import { ArrowLeft, RefreshCw, Shield, UserMinus, UserPlus } from 'lucide-react'
import { useOrgStore } from '@/stores/orgStore'

function statusVariant(status: AdminUserStatus) {
  if (status === 'active') return 'success' as const
  if (status === 'suspended') return 'warning' as const
  return 'outline' as const
}

function formatDate(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR')
}

export default function UserDetailsPage() {
  const { userId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<AdminUser | null>(null)

  const [nameDraft, setNameDraft] = useState('')
  const [countryDraft, setCountryDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const orgs = useOrgStore((s) => s.orgs)
  const getUserOrgs = useOrgStore((s) => s.getUserOrgs)
  const addMember = useOrgStore((s) => s.addMember)
  const removeMember = useOrgStore((s) => s.removeMember)
  const membersByOrg = useOrgStore((s) => s.membersByOrg)

  const [orgToAdd, setOrgToAdd] = useState<string>('')

  const load = async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const u = await anzarApi.adminGetUser(decodeURIComponent(userId))
      setUser(u)
      setNameDraft(u.name || '')
      setCountryDraft(u.country || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement user')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const canSave = useMemo(() => {
    if (!user) return false
    return (nameDraft || '') !== (user.name || '') || (countryDraft || '') !== (user.country || '')
  }, [countryDraft, nameDraft, user])

  const patch = async (patchData: Partial<Pick<AdminUser, 'status' | 'role' | 'name' | 'country'>>) => {
    if (!user) return
    setError(null)
    setSaving(true)
    try {
      const updated = await anzarApi.adminPatchUser(user.id, patchData)
      setUser(updated)
      setNameDraft(updated.name || '')
      setCountryDraft(updated.country || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/users')} aria-label="Retour">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground-primary truncate">{user?.email || userId}</h1>
              <p className="text-sm text-foreground-secondary truncate">{user?.name || '—'}</p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
            Rafraîchir
          </Button>
          {user?.status === 'active' ? (
            <Button
              variant="secondary"
              leftIcon={<UserMinus className="h-4 w-4" />}
              onClick={() => void patch({ status: 'suspended' })}
              isLoading={saving}
            >
              Suspend
            </Button>
          ) : (
            <Button
              variant="secondary"
              leftIcon={<UserPlus className="h-4 w-4" />}
              onClick={() => void patch({ status: 'active' })}
              isLoading={saving}
            >
              Activate
            </Button>
          )}
          <Button
            variant="outline"
            leftIcon={<Shield className="h-4 w-4" />}
            onClick={() => void patch({ status: 'disabled' })}
            isLoading={saving}
          >
            Disable
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-foreground-secondary">{error}</CardContent>
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
                <CardTitle>Profil</CardTitle>
                <CardDescription>Informations administrables (UI).</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground-primary">Nom</label>
                  <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Nom" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground-primary">Pays</label>
                  <Input value={countryDraft} onChange={(e) => setCountryDraft(e.target.value)} placeholder="SN" />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground-primary">Statut</p>
                  <Badge variant={statusVariant(user.status)} className="capitalize">
                    {user.status}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground-primary">Rôle</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {user.role}
                    </Badge>
                    <select
                      className="px-2 py-1 rounded-md border border-border bg-background-secondary text-foreground-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent-primary"
                      value={user.role}
                      onChange={(e) => void patch({ role: e.target.value as AdminRole })}
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="support">Support</option>
                      <option value="readonly">Readonly</option>
                    </select>
                  </div>
                </div>

                <div className="md:col-span-2 flex justify-end">
                  <Button
                    onClick={() => void patch({ name: nameDraft || undefined, country: countryDraft || undefined })}
                    disabled={!canSave || saving}
                    isLoading={saving}
                  >
                    Enregistrer
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Résumé</CardTitle>
                <CardDescription>Vue dense d’un coup d’œil.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-foreground-secondary">Créé</span>
                  <span className="text-foreground-primary">{formatDate(user.created_at)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground-secondary">Dernière activité</span>
                  <span className="text-foreground-primary">{formatDate(user.last_seen_at)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground-secondary">Projets</span>
                  <span className="text-foreground-primary">{user.projects_count ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground-secondary">Crédits</span>
                  <span className="text-foreground-primary">
                    {typeof user.credits_balance_fcfa === 'number'
                      ? `${user.credits_balance_fcfa.toLocaleString('fr-FR')} FCFA`
                      : '—'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Organisations</CardTitle>
              <CardDescription>Appartenance org + gestion (V1 UI).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <select
                  className="md:col-span-2 px-3 py-2 rounded-md border border-border bg-background-secondary text-foreground-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  value={orgToAdd}
                  onChange={(e) => setOrgToAdd(e.target.value)}
                >
                  <option value="">Choisir une org…</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.plan})
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() => {
                    if (!orgToAdd) return
                    addMember(orgToAdd, { id: user.id, email: user.email, name: user.name }, user.role)
                    setOrgToAdd('')
                  }}
                  disabled={!orgToAdd}
                >
                  Ajouter
                </Button>
              </div>

              {getUserOrgs(user.id).length === 0 ? (
                <p className="text-sm text-foreground-secondary">Aucune org.</p>
              ) : (
                <div className="overflow-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-background-tertiary/40">
                      <tr className="text-left">
                        <th className="p-3 font-medium text-foreground-secondary">Org</th>
                        <th className="p-3 font-medium text-foreground-secondary">Plan</th>
                        <th className="p-3 font-medium text-foreground-secondary">Rôle dans l’org</th>
                        <th className="p-3 font-medium text-foreground-secondary"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {getUserOrgs(user.id).map((o) => {
                        const member = (membersByOrg[o.id] || []).find((m) => m.userId === user.id)
                        return (
                          <tr key={o.id} className="border-t border-border hover:bg-background-tertiary/30">
                            <td className="p-3">
                              <p className="font-medium text-foreground-primary">{o.name}</p>
                              <p className="text-xs text-foreground-secondary">{o.id}</p>
                            </td>
                            <td className="p-3">
                              <Badge variant="outline" className="capitalize">
                                {o.plan}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <Badge variant="secondary" className="capitalize">
                                {member?.role || '—'}
                              </Badge>
                            </td>
                            <td className="p-3 text-right">
                              <Button variant="ghost" size="sm" onClick={() => removeMember(o.id, user.id)}>
                                Retirer
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes (à brancher)</CardTitle>
              <CardDescription>
                À compléter quand le backend exposera les endpoints admin (audit log, sessions, reset password, quotas…).
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-foreground-secondary space-y-2">
              <p>• Reset password / force logout</p>
              <p>• Quotas (tokens/jour, crédits max, projets max)</p>
              <p>• Audit log (qui a modifié le user)</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
