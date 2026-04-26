import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Activity, Search, Settings, Sparkles } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Badge } from '../ui/Badge'
import { anzarApi } from '@/api/backend'
import { useAuthStore } from '@/stores/authStore'

export function Header() {
  const [searchQuery, setSearchQuery] = useState('')
  const [health, setHealth] = useState<'ok' | 'degraded' | 'down'>('down')
  const [healthLabel, setHealthLabel] = useState('Backend: inconnu')
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const pageTitle = useMemo(() => {
    const path = location.pathname
    if (path.startsWith('/studio')) return 'Studio'
    if (path.startsWith('/projects')) return 'Projects'
    if (path.startsWith('/credits')) return 'Credits'
    if (path.startsWith('/observability')) return 'Observability'
    if (path.startsWith('/settings')) return 'Settings'
    return 'Dashboard'
  }, [location.pathname])

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        const res = await anzarApi.health()
        if (!alive) return
        setHealth(res.status === 'healthy' ? 'ok' : 'degraded')
        setHealthLabel(`Backend: ${res.status}`)
      } catch {
        if (!alive) return
        setHealth('down')
        setHealthLabel('Backend: down')
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background-secondary/80 backdrop-blur-lg">
      <div className="flex items-center justify-between h-14 px-6">
        {/* Left: Search */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="min-w-0">
            <p className="text-xs text-foreground-secondary">ANZAR Admin</p>
            <h2 className="text-sm font-semibold text-foreground-primary truncate">{pageTitle}</h2>
          </div>

          <div className="hidden md:block flex-1 max-w-xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-foreground-secondary" />
              <Input
                type="search"
                placeholder="Rechercher projets, commandes, IDs…"
                className="pl-10 bg-background-tertiary border-border-subtle"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Sparkles className="h-4 w-4" />}
            onClick={() => navigate('/studio')}
            className="hidden sm:inline-flex"
          >
            Nouveau projet
          </Button>

          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} aria-label="Paramètres">
            <Settings className="h-4 w-4" />
          </Button>

          {/* Status Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background-tertiary">
            <div
              className={[
                'h-2 w-2 rounded-full animate-pulse-subtle',
                health === 'ok' ? 'bg-accent-success' : health === 'degraded' ? 'bg-accent-warning' : 'bg-accent-error',
              ].join(' ')}
            />
            <span className="text-xs font-medium text-foreground-primary">{healthLabel}</span>
          </div>

          {user?.role && (
            <Badge variant="primary" className="hidden lg:inline-flex">
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
            </Badge>
          )}
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="h-8 px-6 border-t border-border-subtle bg-background-tertiary/50 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3 text-foreground-secondary">
          <Activity className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Astuce:</span>
          <span className="truncate">
            Utilise le Studio pour planifier → générer → exécuter (et suivre les agents en streaming).
          </span>
        </div>
        <Badge variant="outline" className="text-xs hidden sm:inline-flex">
          {anzarApi.backendUrl}
        </Badge>
      </div>
    </header>
  )
}
