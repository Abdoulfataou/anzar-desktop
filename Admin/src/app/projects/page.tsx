import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { 
  Search, 
  Grid, 
  List, 
  FolderKanban,
  Clock,
  ChevronRight,
  MoreVertical
} from 'lucide-react'
import { anzarApi, type ProjectRow } from '@/api/backend'

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectRow[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await anzarApi.listProjects(100)
        if (!alive) return
        setProjects(res.projects || [])
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Erreur chargement projets')
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => {
      const name = (p.name || p.id || '').toLowerCase()
      const desc = (p.description || '').toLowerCase()
      return name.includes(q) || desc.includes(q)
    })
  }, [projects, searchQuery])

  const statusVariant = (status?: string) => {
    if (!status) return 'outline' as const
    if (status === 'complete' || status === 'completed') return 'success' as const
    if (status === 'generating' || status === 'running') return 'primary' as const
    if (status === 'error' || status === 'failed') return 'error' as const
    if (status === 'cancelled') return 'warning' as const
    if (status === 'planning') return 'secondary' as const
    return 'outline' as const
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Projects</h1>
          <p className="text-foreground-secondary mt-1">
            Inspecter les projets générés et leurs statuts
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/studio')}>Nouveau projet</Button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-foreground-secondary" />
            <Input
              type="search"
              placeholder="Rechercher un projet…"
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-border bg-background-tertiary p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'grid'
                  ? 'bg-background-secondary text-foreground-primary'
                  : 'text-foreground-secondary hover:text-foreground-primary'
              }`}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-background-secondary text-foreground-primary'
                  : 'text-foreground-secondary hover:text-foreground-primary'
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Projects Grid/List */}
      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-foreground-secondary">
            {error}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-foreground-secondary">Chargement…</CardContent>
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((project) => (
            <Card key={project.id} className="group hover:border-accent-primary/30 transition-all duration-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-background-secondary">
                      <FolderKanban className="h-5 w-5 text-accent-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground-primary group-hover:text-accent-primary transition-colors">
                        {project.name || project.id}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={statusVariant(project.status)} className="text-xs">
                          {project.status || 'unknown'}
                        </Badge>
                        {typeof project.cost_fcfa === 'number' && (
                          <Badge variant="secondary" className="text-xs">
                            {project.cost_fcfa.toLocaleString('fr-FR')} FCFA
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <button className="p-1.5 rounded-md hover:bg-background-tertiary text-foreground-secondary">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  {project.description && (
                    <p className="text-sm text-foreground-secondary line-clamp-2">{project.description}</p>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3 text-foreground-secondary" />
                      <span className="text-xs text-foreground-secondary">
                        {project.created_at ? new Date(project.created_at).toLocaleString('fr-FR') : '—'}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      rightIcon={<ChevronRight className="h-3 w-3" />}
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      Ouvrir
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Project</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Status</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Créé</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Coût</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((project) => (
                  <tr key={project.id} className="border-b border-border hover:bg-background-tertiary transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-background-secondary">
                          <FolderKanban className="h-4 w-4 text-accent-primary" />
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-foreground-primary block truncate">
                            {project.name || project.id}
                          </span>
                          {project.description && (
                            <span className="text-xs text-foreground-secondary block truncate">
                              {project.description}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={statusVariant(project.status)}>
                        {project.status || 'unknown'}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-foreground-secondary">
                        <Clock className="h-3 w-3" />
                        {project.created_at ? new Date(project.created_at).toLocaleString('fr-FR') : '—'}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-foreground-primary">
                        {typeof project.cost_fcfa === 'number' ? `${project.cost_fcfa.toLocaleString('fr-FR')} FCFA` : '—'}
                      </span>
                    </td>
                    <td className="p-4">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${project.id}`)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Empty State (when no projects) */}
      {!loading && filtered.length === 0 && (
        <Card className="text-center py-12">
          <CardContent>
            <div className="mx-auto w-16 h-16 rounded-full bg-background-secondary flex items-center justify-center mb-4">
              <FolderKanban className="h-8 w-8 text-foreground-secondary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground-primary mb-2">Aucun projet</h3>
            <p className="text-foreground-secondary mb-6 max-w-md mx-auto">
              Lance un premier projet depuis le Studio pour voir apparaître l’historique ici.
            </p>
            <Button onClick={() => navigate('/studio')}>
              Ouvrir le Studio
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
