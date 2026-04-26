import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { anzarApi, type HealthResponse } from '@/api/backend'
import { useAuthStore } from '@/stores/authStore'
import { Activity, FolderKanban, Sparkles, Wallet, Server, ChevronRight, AlertCircle } from 'lucide-react'

interface StatsResponse {
  users: { active: number; total: number; new_7d: number }
  projects: { total: number; by_status: Record<string, number> }
  credits: { total_balance: number; platform_recharged: number; platform_used: number }
  usage_30d: { total_requests: number; total_tokens: number; total_cost_fcfa: number }
  usage_today: { requests: number; cost_fcfa: number }
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [h, s] = await Promise.all([
          anzarApi.health(),
          anzarApi.stats(),
        ])
        if (!alive) return
        setHealth(h)
        setStats(s as StatsResponse)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Erreur de chargement')
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const healthVariant = health?.status === 'healthy' ? 'success' : health?.status ? 'warning' : 'outline'

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground-primary">Dashboard</h1>
            <p className="text-foreground-secondary mt-1">Vue d’ensemble de la plateforme</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" leftIcon={<Activity className="h-4 w-4" />} onClick={() => navigate('/observability')}>
              Observability
            </Button>
            <Button leftIcon={<Sparkles className="h-4 w-4" />} onClick={() => navigate('/studio')}>
              Studio
            </Button>
          </div>
        </div>
        <Card className="border-accent-error/20 bg-accent-error/5">
          <CardContent className="p-6 flex items-center gap-4">
            <AlertCircle className="h-6 w-6 text-accent-error" />
            <div>
              <p className="font-medium text-foreground-primary">Erreur de chargement</p>
              <p className="text-sm text-accent-error">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Dashboard</h1>
          <p className="text-foreground-secondary mt-1">
            Bienvenue {user?.name} {user?.role ? `(${user.role})` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" leftIcon={<Activity className="h-4 w-4" />} onClick={() => navigate('/observability')}>
            Observability
          </Button>
          <Button leftIcon={<Sparkles className="h-4 w-4" />} onClick={() => navigate('/studio')}>
            Studio
          </Button>
        </div>
      </div>

      {/* Welcome Card */}
      <Card className="bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border-accent-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-secondary">Bonjour</p>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-2xl font-bold text-foreground-primary">
                  {loading ? '…' : user?.name || 'Administrateur'}
                </span>
                <span className="text-sm text-foreground-secondary">
                  {user?.role && `Rôle: ${user.role}`}
                </span>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-accent-primary/20">
              <Sparkles className="h-6 w-6 text-accent-primary" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Health Status Card */}
      <Card className="group hover:border-accent-primary/30 transition-colors">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-secondary">État du Backend</p>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-2xl font-bold text-foreground-primary">
                  {loading ? '…' : health?.status || 'unknown'}
                </span>
                <Badge variant={healthVariant} className="text-xs">
                  v{health?.version || '—'}
                </Badge>
              </div>
              {health?.checks && (
                <div className="mt-3 text-xs text-foreground-secondary space-y-1">
                  {Object.entries(health.checks).map(([key, value]) => (
                    <div key={key}>
                      {key}: {typeof value === 'boolean' ? (value ? '✓' : '✗') : String(value)}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3 rounded-lg bg-accent-primary/10">
              <Server className="h-6 w-6 text-accent-primary" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Users Card */}
        <Card className="group hover:border-accent-primary/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm text-foreground-secondary">Utilisateurs Actifs</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl font-bold text-foreground-primary">
                    {loading ? '…' : stats?.users?.active ?? '—'}
                  </span>
                  <span className="text-xs text-foreground-secondary">
                    sur {loading ? '…' : stats?.users?.total ?? '—'}
                  </span>
                </div>
                {stats?.users?.new_7d !== undefined && (
                  <p className="text-xs text-foreground-secondary mt-2">
                    +{stats.users.new_7d} cette semaine
                  </p>
                )}
              </div>
              <div className="p-3 rounded-lg bg-accent-primary/10">
                <Activity className="h-6 w-6 text-accent-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Projects Card */}
        <Card className="group hover:border-accent-primary/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm text-foreground-secondary">Projets Totaux</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl font-bold text-foreground-primary">
                    {loading ? '…' : stats?.projects?.total ?? '—'}
                  </span>
                </div>
                {stats?.projects?.by_status && Object.keys(stats.projects.by_status).length > 0 && (
                  <div className="text-xs text-foreground-secondary mt-2 space-y-1">
                    {Object.entries(stats.projects.by_status).slice(0, 2).map(([status, count]) => (
                      <div key={status}>{status}: {count}</div>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-3 rounded-lg bg-accent-success/10">
                <FolderKanban className="h-6 w-6 text-accent-success" />
              </div>
            </div>
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate('/projects')}>
              Voir Projets <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>

        {/* Credits Card */}
        <Card className="group hover:border-accent-primary/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm text-foreground-secondary">Solde Crédits</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-2xl font-bold text-foreground-primary">
                    {loading ? '…' : stats?.credits?.total_balance ? `${(stats.credits.total_balance).toLocaleString('fr-FR')}` : '—'}
                  </span>
                  <span className="text-xs text-foreground-secondary">FCFA</span>
                </div>
                {stats?.credits && (
                  <div className="text-xs text-foreground-secondary mt-2 space-y-1">
                    <div>Rechargé: {(stats.credits?.platform_recharged ?? 0).toLocaleString('fr-FR')}</div>
                    <div>Utilisé: {(stats.credits?.platform_used ?? 0).toLocaleString('fr-FR')}</div>
                  </div>
                )}
              </div>
              <div className="p-3 rounded-lg bg-accent-secondary/10">
                <Wallet className="h-6 w-6 text-accent-secondary" />
              </div>
            </div>
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate('/credits')}>
              Gérer Crédits <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>

        {/* Usage Card */}
        <Card className="group hover:border-accent-primary/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm text-foreground-secondary">Usage Aujourd’hui</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-2xl font-bold text-foreground-primary">
                    {loading ? '…' : stats?.usage_today?.requests ?? '—'}
                  </span>
                  <span className="text-xs text-foreground-secondary">requêtes</span>
                </div>
                {stats?.usage_today && (
                  <p className="text-xs text-foreground-secondary mt-2">
                    Coût: {(stats.usage_today?.cost_fcfa ?? 0).toLocaleString('fr-FR')} FCFA
                  </p>
                )}
              </div>
              <div className="p-3 rounded-lg bg-accent-warning/10">
                <Activity className="h-6 w-6 text-accent-warning" />
              </div>
            </div>
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate('/observability')}>
              Détails <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent-primary" />
              Démarrage rapide
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-foreground-secondary">
            <p>
              1) Va dans <span className="text-foreground-primary font-medium">Studio</span> et génère un plan.
            </p>
            <p>
              2) Clique <span className="text-foreground-primary font-medium">Exécuter</span> pour lancer la pipeline.
            </p>
            <p>
              3) Inspecte le résultat dans <span className="text-foreground-primary font-medium">Projects</span> (plan/result JSON).
            </p>
            <div className="pt-2">
              <Button onClick={() => navigate('/studio')}>Ouvrir Studio</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-accent-secondary" />
              Usage (30 jours)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {loading ? (
              <p className="text-foreground-secondary">…</p>
            ) : stats?.usage_30d ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-foreground-secondary">Requêtes:</span>
                  <span className="font-medium text-foreground-primary">
                    {(stats.usage_30d?.total_requests ?? 0).toLocaleString('fr-FR')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-foreground-secondary">Tokens:</span>
                  <span className="font-medium text-foreground-primary">
                    {(stats.usage_30d?.total_tokens ?? 0).toLocaleString('fr-FR')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-foreground-secondary">Coût:</span>
                  <span className="font-medium text-foreground-primary">
                    {(stats.usage_30d?.total_cost_fcfa ?? 0).toLocaleString('fr-FR')} FCFA
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-foreground-secondary">—</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
