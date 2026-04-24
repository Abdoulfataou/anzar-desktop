import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { anzarApi, type HealthResponse, type ProjectsListResponse } from '@/api/backend'
import { useAuthStore } from '@/stores/authStore'
import { Activity, FolderKanban, Sparkles, Wallet, Server, ChevronRight } from 'lucide-react'

export default function DashboardPage() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [projects, setProjects] = useState<ProjectsListResponse | null>(null)
  const [usageStats, setUsageStats] = useState<Record<string, unknown> | null>(null)

  const credits = useAuthStore((s) => s.credits)
  const setCredits = useAuthStore((s) => s.setCredits)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const [h, p, c, u] = await Promise.all([
          anzarApi.health(),
          anzarApi.listProjects(50),
          anzarApi.credits().catch(() => null),
          anzarApi.usageStats(30).catch(() => null),
        ])
        if (!alive) return
        setHealth(h)
        setProjects(p)
        if (c) setCredits(c)
        if (u) setUsageStats(u)
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [setCredits])

  const projectCount = projects?.count ?? projects?.projects?.length ?? 0
  const creditsBalance = typeof credits?.balance_fcfa === 'number' ? credits.balance_fcfa : null
  const healthVariant = health?.status === 'healthy' ? 'success' : health?.status ? 'warning' : 'outline'

  const usageSnippet = useMemo(() => {
    if (!usageStats) return null
    // On ne sait pas exactement la forme, on affiche un extrait lisible.
    const keys = Object.keys(usageStats).slice(0, 6)
    const reduced: Record<string, unknown> = {}
    for (const k of keys) reduced[k] = usageStats[k]
    return reduced
  }, [usageStats])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Dashboard</h1>
          <p className="text-foreground-secondary mt-1">
            Vue d’ensemble (backend, crédits, projets, usage)
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="group hover:border-accent-primary/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground-secondary">Backend</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-2xl font-bold text-foreground-primary">
                    {loading ? '…' : health?.status || 'unknown'}
                  </span>
                  <Badge variant={healthVariant} className="text-xs">
                    /health
                  </Badge>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-accent-primary/10">
                <Server className="h-6 w-6 text-accent-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="group hover:border-accent-primary/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground-secondary">Crédits</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-2xl font-bold text-foreground-primary">
                    {creditsBalance === null ? '—' : `${creditsBalance.toLocaleString('fr-FR')} FCFA`}
                  </span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-accent-secondary/10">
                <Wallet className="h-6 w-6 text-accent-secondary" />
              </div>
            </div>
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate('/credits')}>
              Ouvrir Credits <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>

        <Card className="group hover:border-accent-primary/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground-secondary">Projets</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl font-bold text-foreground-primary">{loading ? '…' : projectCount}</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-accent-success/10">
                <FolderKanban className="h-6 w-6 text-accent-success" />
              </div>
            </div>
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate('/projects')}>
              Voir Projects <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>

        <Card className="group hover:border-accent-primary/30 transition-colors">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground-secondary">Usage (30j)</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-2xl font-bold text-foreground-primary">{usageSnippet ? 'OK' : '—'}</span>
                  <Badge variant="outline" className="text-xs">
                    stats
                  </Badge>
                </div>
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
              Signal (30 jours)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap break-words bg-background-primary border border-border rounded-lg p-4 overflow-auto">
              {usageSnippet ? JSON.stringify(usageSnippet, null, 2) : '—'}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
