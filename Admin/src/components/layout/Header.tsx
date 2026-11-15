import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api } from '@/api/backend'

const TITLES: [string, string][] = [
  ['/users', 'Utilisateurs'],
  ['/credits', 'Crédits'],
  ['/payments', 'Paiements'],
  ['/usage', 'Consommation'],
  ['/audit', "Journal d'audit"],
  ['/admins', 'Administrateurs'],
  ['/settings', 'Paramètres'],
]

export function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [health, setHealth] = useState<'ok' | 'degraded' | 'down' | 'unknown'>('unknown')

  const title = useMemo(
    () => TITLES.find(([p]) => location.pathname.startsWith(p))?.[1] ?? 'Tableau de bord',
    [location.pathname],
  )

  useEffect(() => {
    let alive = true
    const check = () => api.health().then(
      (r) => alive && setHealth(r.status === 'healthy' ? 'ok' : 'degraded'),
      () => alive && setHealth('down'),
    )
    check()
    const t = setInterval(check, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  // Recherche rapide d'un client par e-mail ou nom
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    navigate(`/users?q=${encodeURIComponent(q)}`)
    setQuery('')
  }

  const dot = { ok: 'bg-accent-success', degraded: 'bg-accent-warning', down: 'bg-accent-error', unknown: 'bg-foreground-muted' }[health]
  const text = { ok: 'Serveur en ligne', degraded: 'Serveur dégradé', down: 'Serveur injoignable', unknown: 'Vérification…' }[health]

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background-secondary/80 backdrop-blur-lg">
      <div className="flex items-center justify-between gap-4 h-14 px-6">
        <h2 className="text-sm font-semibold truncate">{title}</h2>
        <form onSubmit={submit} className="hidden md:block flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
            <input
              type="search"
              placeholder="Chercher un client (e-mail, nom)… puis Entrée"
              className="w-full h-9 rounded-md border border-border-subtle bg-background-tertiary pl-9 pr-3 text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-primary"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </form>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background-tertiary">
          <div className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="text-xs">{text}</span>
        </div>
      </div>
    </header>
  )
}
