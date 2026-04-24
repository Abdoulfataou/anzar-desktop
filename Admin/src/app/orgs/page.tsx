import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Building2, ChevronRight, Plus, Users } from 'lucide-react'
import { useOrgStore, type OrgPlan } from '@/stores/orgStore'

export default function OrgsPage() {
  const navigate = useNavigate()
  const orgs = useOrgStore((s) => s.orgs)
  const membersByOrg = useOrgStore((s) => s.membersByOrg)
  const createOrg = useOrgStore((s) => s.createOrg)

  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [plan, setPlan] = useState<OrgPlan>('free')
  const [quotaMonth, setQuotaMonth] = useState('0')

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return orgs
    return orgs.filter((o) => (o.name + ' ' + o.id).toLowerCase().includes(query))
  }, [orgs, q])

  const create = () => {
    const n = name.trim()
    if (!n) return
    const monthly = Number(quotaMonth)
    const org = createOrg({
      name: n,
      plan,
      quota: { monthly_fcfa: Number.isFinite(monthly) ? monthly : undefined },
    })
    setCreateOpen(false)
    setName('')
    setPlan('free')
    setQuotaMonth('0')
    navigate(`/orgs/${encodeURIComponent(org.id)}`)
  }

  const planVariant = (p: OrgPlan) => {
    if (p === 'enterprise') return 'primary' as const
    if (p === 'pro') return 'secondary' as const
    return 'outline' as const
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-gradient-to-br from-accent-primary/20 to-accent-secondary/10 border border-border flex items-center justify-center">
              <Building2 className="h-5 w-5 text-accent-primary" />
            </span>
            Orgs
          </h1>
          <p className="text-foreground-secondary mt-2">
            Organisations/teams (V1 complète côté UI): création, quotas, membres, invitations.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/users')}>
            Users
          </Button>
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            New org
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recherche</CardTitle>
          <CardDescription>Filtrer rapidement.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input placeholder="Rechercher org…" value={q} onChange={(e) => setQ(e.target.value)} />
        </CardContent>
      </Card>

      {createOpen && (
        <Card className="border-accent-primary/30">
          <CardHeader>
            <CardTitle>Créer une organisation</CardTitle>
            <CardDescription>V1 (UI). Branchage backend ensuite.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Nom</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Startup CI" />
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
              <label className="text-sm font-medium text-foreground-primary">Quota mensuel (FCFA)</label>
              <Input value={quotaMonth} onChange={(e) => setQuotaMonth(e.target.value)} placeholder="150000" />
            </div>

            <div className="md:col-span-3 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>
                Annuler
              </Button>
              <Button onClick={create} disabled={!name.trim()}>
                Créer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((org) => (
          <Card key={org.id} className="hover:border-accent-primary/30 transition-colors">
            <CardHeader>
              <CardTitle className="truncate">{org.name}</CardTitle>
              <CardDescription className="truncate">{org.id}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-secondary">Plan</span>
                <Badge variant={planVariant(org.plan)} className="capitalize">
                  {org.plan}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-secondary">Users</span>
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {(membersByOrg[org.id] || []).length}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-secondary">Quota mensuel</span>
                <span className="text-foreground-primary">
                  {typeof org.quota?.monthly_fcfa === 'number'
                    ? `${org.quota.monthly_fcfa.toLocaleString('fr-FR')} FCFA`
                    : '—'}
                </span>
              </div>

              <Button
                variant="ghost"
                className="w-full justify-between"
                onClick={() => navigate(`/orgs/${encodeURIComponent(org.id)}`)}
              >
                Détails <ChevronRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
