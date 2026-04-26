import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { anzarApi, type UsageRecord as ApiUsageRecord, type GlobalStats } from '@/api/backend'
import { Activity, AlertCircle, CheckCircle, RefreshCw, Server, Timer } from 'lucide-react'

interface HealthStatus {
  status: string
  version: string
  checks: {
    database: string
    deepseek: string
    kimi: string
  }
}

export default function ObservabilityPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [usage, setUsage] = useState<ApiUsageRecord[]>([])
  const [stats, setStats] = useState<GlobalStats | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [h, u, s] = await Promise.all([
        anzarApi.health(),
        anzarApi.usage(50, 0),
        anzarApi.stats(),
      ])
      setHealth(h as HealthStatus)
      setUsage(((u as any)?.usage || []) as ApiUsageRecord[])
      setStats(s as GlobalStats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur observabilité')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const healthVariant =
    health?.status === 'healthy' ? 'success' : health?.status === 'degraded' ? 'warning' : ('outline' as const)

  const getCheckVariant = (status: string) => {
    if (status === 'healthy') return 'success'
    if (status === 'degraded') return 'warning'
    return 'error'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Observabilité</h1>
          <p className="text-foreground-secondary mt-1">Santé du backend, usage et coûts.</p>
        </div>
        <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()}>
          Rafraîchir
        </Button>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-accent-error">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-accent-primary" />
              Santé du backend
            </CardTitle>
            <CardDescription>Statut des services critiques</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-foreground-secondary">Chargement…</p>
            ) : health ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    {health.status === 'healthy' ? (
                      <CheckCircle className="h-5 w-5 text-success" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-warning" />
                    )}
                    <Badge variant={healthVariant} className="capitalize">
                      {health.status}
                    </Badge>
                  </div>
                  {health.version && <Badge variant="outline">v{health.version}</Badge>}
                </div>

                <div className="space-y-2 bg-background-secondary/50 rounded-lg p-4">
                  <h4 className="font-medium text-sm text-foreground-primary">Vérifications</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground-secondary">Base de données</span>
                      <Badge variant={getCheckVariant(health.checks.database)} className="capitalize">
                        {health.checks.database}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground-secondary">Deepseek</span>
                      <Badge variant={getCheckVariant(health.checks.deepseek)} className="capitalize">
                        {health.checks.deepseek}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground-secondary">Kimi</span>
                      <Badge variant={getCheckVariant(health.checks.kimi)} className="capitalize">
                        {health.checks.kimi}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground-secondary">Impossible de charger l'état du backend.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-accent-secondary" />
              Statistiques d'usage
            </CardTitle>
            <CardDescription>Résumé des 30 derniers jours</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-foreground-secondary">Chargement…</p>
            ) : stats ? (
              <div className="space-y-4">
                <div className="bg-background-secondary/50 rounded-lg p-4 space-y-2">
                  <p className="text-xs font-medium text-foreground-secondary uppercase">Usage (30 jours)</p>
                  <p className="text-2xl font-bold text-foreground-primary">
                    {stats.usage_30d.total_requests.toLocaleString('fr-FR')}
                  </p>
                </div>
                <div className="bg-background-secondary/50 rounded-lg p-4 space-y-2">
                  <p className="text-xs font-medium text-foreground-secondary uppercase">Usage (aujourd'hui)</p>
                  <p className="text-2xl font-bold text-foreground-primary">
                    {stats.usage_today.requests.toLocaleString('fr-FR')}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground-secondary">Impossible de charger les statistiques.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-accent-primary" />
            Dernières requêtes
          </CardTitle>
          <CardDescription>Les 50 derniers enregistrements d'usage</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-foreground-secondary">Chargement…</p>
          ) : usage.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-background-tertiary/40">
                  <tr className="text-left">
                    <th className="p-3 font-medium text-foreground-secondary">Email</th>
                    <th className="p-3 font-medium text-foreground-secondary">Fournisseur</th>
                    <th className="p-3 font-medium text-foreground-secondary">Modèle</th>
                    <th className="p-3 font-medium text-foreground-secondary">Tokens</th>
                    <th className="p-3 font-medium text-foreground-secondary">Coût (FCFA)</th>
                    <th className="p-3 font-medium text-foreground-secondary">Durée (ms)</th>
                    <th className="p-3 font-medium text-foreground-secondary">Type</th>
                    <th className="p-3 font-medium text-foreground-secondary">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((record) => (
                    <tr key={record.id} className="border-t border-border hover:bg-background-tertiary/30">
                      <td className="p-3 text-foreground-primary">{record.user_email}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {record.provider}
                        </Badge>
                      </td>
                      <td className="p-3 text-foreground-secondary text-xs">{record.model}</td>
                      <td className="p-3 text-foreground-secondary text-xs">
                        {((record.input_tokens ?? 0) + (record.output_tokens ?? 0)).toLocaleString('fr-FR')}
                      </td>
                      <td className="p-3 text-foreground-primary font-medium">
                        {(record.cost_fcfa ?? 0).toFixed(0)} FCFA
                      </td>
                      <td className="p-3 text-foreground-secondary text-xs">
                        {(record.duration_ms ?? 0).toLocaleString('fr-FR')}
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary" className="text-xs capitalize">
                          {record.task_type}
                        </Badge>
                      </td>
                      <td className="p-3 text-foreground-secondary text-xs">
                        {record.created_at ? new Date(record.created_at).toLocaleString('fr-FR') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-foreground-secondary">Aucun usage enregistré.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
