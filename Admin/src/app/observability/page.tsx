import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { anzarApi, type HealthResponse, type UsageListResponse } from '@/api/backend'
import { Activity, RefreshCw, Server, Timer } from 'lucide-react'

export default function ObservabilityPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [usage, setUsage] = useState<UsageListResponse | null>(null)
  const [usageStats, setUsageStats] = useState<Record<string, unknown> | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [h, u, s] = await Promise.all([
        anzarApi.health(),
        anzarApi.usage(50, 0),
        anzarApi.usageStats(30),
      ])
      setHealth(h)
      setUsage(u)
      setUsageStats(s)
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
    health?.status === 'healthy' ? 'success' : health?.status ? 'warning' : ('outline' as const)

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Observability</h1>
          <p className="text-foreground-secondary mt-1">Santé backend + usage + signaux de coûts.</p>
        </div>
        <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()}>
          Rafraîchir
        </Button>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-foreground-secondary">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-accent-primary" />
              Backend health
            </CardTitle>
            <CardDescription>/health</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-foreground-secondary">Chargement…</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant={healthVariant}>{health?.status || 'unknown'}</Badge>
                  {health?.version && <Badge variant="outline">v{health.version}</Badge>}
                  {typeof health?.timestamp === 'number' && (
                    <Badge variant="outline">
                      {new Date(health.timestamp * 1000).toLocaleString('fr-FR')}
                    </Badge>
                  )}
                </div>

                <pre className="text-xs whitespace-pre-wrap break-words bg-background-primary border border-border rounded-lg p-4 overflow-auto">
                  {JSON.stringify(health, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-accent-secondary" />
              Usage (30j)
            </CardTitle>
            <CardDescription>/api/usage/stats</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-foreground-secondary">Chargement…</p>
            ) : (
              <pre className="text-xs whitespace-pre-wrap break-words bg-background-primary border border-border rounded-lg p-4 overflow-auto">
                {JSON.stringify(usageStats, null, 2)}
              </pre>
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
          <CardDescription>/api/usage</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-foreground-secondary">Chargement…</p>
          ) : usage?.records?.length ? (
            <pre className="text-xs whitespace-pre-wrap break-words bg-background-primary border border-border rounded-lg p-4 overflow-auto">
              {JSON.stringify(usage.records.slice(0, 50), null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-foreground-secondary">Aucun usage enregistré.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

