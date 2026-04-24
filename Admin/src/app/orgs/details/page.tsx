import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { anzarApi, type AdminRole, type AdminUser } from '@/api/backend'
import { useOrgStore, type OrgPlan, type OrgQuota, type OrgStatus } from '@/stores/orgStore'
import { ArrowLeft, Trash2, UserMinus, UserPlus } from 'lucide-react'

function formatDate(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR')
}

export default function OrgDetailsPage() {
  const { orgId } = useParams()
  const navigate = useNavigate()

  const org = useOrgStore((s) => s.orgs.find((o) => o.id === orgId))
  const members = useOrgStore((s) => (orgId ? s.membersByOrg[orgId] || [] : []))
  const invites = useOrgStore((s) => (orgId ? s.invitesByOrg[orgId] || [] : []))

  const updateOrg = useOrgStore((s) => s.updateOrg)
  const deleteOrg = useOrgStore((s) => s.deleteOrg)
  const addMember = useOrgStore((s) => s.addMember)
  const removeMember = useOrgStore((s) => s.removeMember)
  const updateMemberRole = useOrgStore((s) => s.updateMemberRole)
  const invite = useOrgStore((s) => s.invite)
  const revokeInvite = useOrgStore((s) => s.revokeInvite)
  const acceptInviteMock = useOrgStore((s) => s.acceptInviteMock)

  const [name, setName] = useState(org?.name || '')
  const [plan, setPlan] = useState<OrgPlan>(org?.plan || 'free')
  const [status, setStatus] = useState<OrgStatus>(org?.status || 'active')

  const [quotaMonth, setQuotaMonth] = useState(String(org?.quota?.monthly_fcfa ?? ''))
  const [quotaTokens, setQuotaTokens] = useState(String(org?.quota?.daily_tokens ?? ''))
  const [quotaProjects, setQuotaProjects] = useState(String(org?.quota?.max_projects_per_day ?? ''))
  const [quotaConcurrent, setQuotaConcurrent] = useState(String(org?.quota?.max_concurrent_runs ?? ''))

  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<AdminRole>('readonly')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<AdminRole>('readonly')
  const [error, setError] = useState<string | null>(null)

  const quota: OrgQuota = useMemo(() => {
    const monthly_fcfa = Number(quotaMonth)
    const daily_tokens = Number(quotaTokens)
    const max_projects_per_day = Number(quotaProjects)
    const max_concurrent_runs = Number(quotaConcurrent)
    return {
      monthly_fcfa: Number.isFinite(monthly_fcfa) ? monthly_fcfa : undefined,
      daily_tokens: Number.isFinite(daily_tokens) ? daily_tokens : undefined,
      max_projects_per_day: Number.isFinite(max_projects_per_day) ? max_projects_per_day : undefined,
      max_concurrent_runs: Number.isFinite(max_concurrent_runs) ? max_concurrent_runs : undefined,
    }
  }, [quotaConcurrent, quotaMonth, quotaProjects, quotaTokens])

  const saveOrg = () => {
    if (!orgId) return
    setError(null)
    updateOrg(orgId, {
      name: name.trim() || org?.name || 'Org',
      plan,
      status,
      quota,
    })
  }

  const addMemberByEmail = async () => {
    if (!orgId) return
    setError(null)
    const email = memberEmail.trim()
    if (!email) return

    // On tente de mapper via admin users (mock fallback possible)
    let user: Pick<AdminUser, 'id' | 'email' | 'name'> | null = null
    try {
      const u = await anzarApi.adminGetUser(email)
      user = { id: u.id, email: u.email, name: u.name }
    } catch {
      user = { id: email, email, name: undefined }
    }

    addMember(orgId, user, memberRole)
    setMemberEmail('')
    setMemberRole('readonly')
  }

  const doInvite = () => {
    if (!orgId) return
    const email = inviteEmail.trim()
    if (!email) return
    invite(orgId, email, inviteRole)
    setInviteEmail('')
    setInviteRole('readonly')
  }

  if (!orgId || !org) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/orgs')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
          Retour
        </Button>
        <Card>
          <CardContent className="p-6 text-sm text-foreground-secondary">Organisation introuvable.</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/orgs')} aria-label="Retour">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground-primary truncate">{org.name}</h1>
              <p className="text-sm text-foreground-secondary truncate">
                {org.id} • créé {formatDate(org.created_at)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={saveOrg}>
            Enregistrer
          </Button>
          <Button
            variant="danger"
            leftIcon={<Trash2 className="h-4 w-4" />}
            onClick={() => {
              deleteOrg(orgId)
              navigate('/orgs')
            }}
          >
            Supprimer
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-foreground-secondary">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Organisation</CardTitle>
            <CardDescription>Infos + état + plan.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground-primary">Nom</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Statut</label>
              <select
                className="w-full px-3 py-2 rounded-md border border-border bg-background-secondary text-foreground-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                value={status}
                onChange={(e) => setStatus(e.target.value as OrgStatus)}
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Plan</label>
              <select
                className="w-full px-3 py-2 rounded-md border border-border bg-background-secondary text-foreground-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                value={plan}
                onChange={(e) => setPlan(e.target.value as OrgPlan)}
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground-primary">Membres</p>
              <Badge variant="secondary">{members.length}</Badge>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground-primary">Invitations</p>
              <Badge variant="outline">{invites.filter((i) => i.status === 'pending').length} pending</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quotas</CardTitle>
            <CardDescription>Limites org (V1).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Budget mensuel (FCFA)</label>
              <Input value={quotaMonth} onChange={(e) => setQuotaMonth(e.target.value)} placeholder="150000" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Tokens/jour</label>
              <Input value={quotaTokens} onChange={(e) => setQuotaTokens(e.target.value)} placeholder="250000" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Projets/jour</label>
              <Input value={quotaProjects} onChange={(e) => setQuotaProjects(e.target.value)} placeholder="40" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Runs simultanés</label>
              <Input value={quotaConcurrent} onChange={(e) => setQuotaConcurrent(e.target.value)} placeholder="5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Membres</CardTitle>
            <CardDescription>Ajouter/retirer + rôle par membre.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="email@…" />
              <select
                className="px-3 py-2 rounded-md border border-border bg-background-secondary text-foreground-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value as AdminRole)}
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="support">Support</option>
                <option value="readonly">Readonly</option>
              </select>
              <Button leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => void addMemberByEmail()} disabled={!memberEmail.trim()}>
                Add
              </Button>
            </div>

            {members.length === 0 ? (
              <p className="text-sm text-foreground-secondary">Aucun membre.</p>
            ) : (
              <div className="overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-background-tertiary/40">
                    <tr className="text-left">
                      <th className="p-3 font-medium text-foreground-secondary">Membre</th>
                      <th className="p-3 font-medium text-foreground-secondary">Rôle</th>
                      <th className="p-3 font-medium text-foreground-secondary">Ajouté</th>
                      <th className="p-3 font-medium text-foreground-secondary"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.userId} className="border-t border-border hover:bg-background-tertiary/30">
                        <td className="p-3">
                          <p className="font-medium text-foreground-primary truncate">{m.name || m.email}</p>
                          <p className="text-xs text-foreground-secondary truncate">{m.email}</p>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="capitalize">
                              {m.role}
                            </Badge>
                            <select
                              className="px-2 py-1 rounded-md border border-border bg-background-secondary text-foreground-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent-primary"
                              value={m.role}
                              onChange={(e) => updateMemberRole(orgId, m.userId, e.target.value as AdminRole)}
                            >
                              <option value="owner">Owner</option>
                              <option value="admin">Admin</option>
                              <option value="support">Support</option>
                              <option value="readonly">Readonly</option>
                            </select>
                          </div>
                        </td>
                        <td className="p-3 text-foreground-secondary">{formatDate(m.added_at)}</td>
                        <td className="p-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<UserMinus className="h-4 w-4" />}
                            onClick={() => removeMember(orgId, m.userId)}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
            <CardDescription>Invite par email (mock) + accept/revoke.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="invite@…" />
              <select
                className="px-3 py-2 rounded-md border border-border bg-background-secondary text-foreground-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as AdminRole)}
              >
                <option value="admin">Admin</option>
                <option value="support">Support</option>
                <option value="readonly">Readonly</option>
              </select>
              <Button onClick={doInvite} disabled={!inviteEmail.trim()}>
                Invite
              </Button>
            </div>

            {invites.length === 0 ? (
              <p className="text-sm text-foreground-secondary">Aucune invitation.</p>
            ) : (
              <div className="overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-background-tertiary/40">
                    <tr className="text-left">
                      <th className="p-3 font-medium text-foreground-secondary">Email</th>
                      <th className="p-3 font-medium text-foreground-secondary">Rôle</th>
                      <th className="p-3 font-medium text-foreground-secondary">Statut</th>
                      <th className="p-3 font-medium text-foreground-secondary"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((i) => (
                      <tr key={i.id} className="border-t border-border hover:bg-background-tertiary/30">
                        <td className="p-3">
                          <p className="font-medium text-foreground-primary truncate">{i.email}</p>
                          <p className="text-xs text-foreground-secondary truncate">{formatDate(i.created_at)}</p>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="capitalize">
                            {i.role}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge variant={i.status === 'pending' ? 'warning' : i.status === 'accepted' ? 'success' : 'outline'}>
                            {i.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-right">
                          {i.status === 'pending' ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  // Accept = créer un "user" mock via email
                                  const user = { id: i.email, email: i.email, name: undefined } satisfies Pick<AdminUser, 'id' | 'email' | 'name'>
                                  acceptInviteMock(orgId, i.id, user)
                                }}
                              >
                                Accept (mock)
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => revokeInvite(orgId, i.id)}>
                                Revoke
                              </Button>
                            </div>
                          ) : (
                            <Button variant="ghost" size="sm" disabled>
                              —
                            </Button>
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
      </div>
    </div>
  )
}

