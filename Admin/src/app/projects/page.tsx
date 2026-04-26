import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { anzarApi, type ProjectRow } from '@/api/backend'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Search, Trash2, Eye, RefreshCw, FolderOpen } from 'lucide-react'

type StatusFilter = 'all' | 'pending' | 'planning' | 'generating' | 'testing' | 'complete' | 'error' | 'cancelled'

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [total, setTotal] = useState(0)

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await anzarApi.listProjects({
        search: searchQuery.trim() || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit: 100,
        offset: 0,
      })
      setProjects(res.projects || [])
      setTotal(res.total || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement des projets')
    } finally {
      setLoading(false)
    }
  }, [searchQuery, statusFilter])

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  const handleDelete = async (projectId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce projet ?')) return

    setDeleting(projectId)
    try {
      await anzarApi.deleteProject(projectId)
      setProjects(projects.filter(p => p.id !== projectId))
      setTotal(Math.max(0, total - 1))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la suppression')
    } finally {
      setDeleting(null)
    }
  }

  const statusVariant = (status?: string): 'default' | 'secondary' | 'error' | 'outline' => {
    if (!status) return 'outline'
    if (status === 'complete' || status === 'completed') return 'default'
    if (status === 'error' || status === 'failed') return 'error'
    if (status === 'generating' || status === 'testing') return 'secondary'
    return 'outline'
  }

  const statusLabels: Record<StatusFilter, string> = {
    all: 'Tous',
    pending: 'En attente',
    planning: 'Planification',
    generating: 'Génération',
    testing: 'Test',
    complete: 'Complété',
    error: 'Erreur',
    cancelled: 'Annulé',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary">Projets</h1>
          <p className="text-foreground-secondary mt-1">
            Inspecter les projets générés et leurs statuts
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchProjects()}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4" />
            Actualiser
          </Button>
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-4 py-2 rounded-lg border border-border bg-background text-foreground-primary"
        >
          {(Object.keys(statusLabels) as StatusFilter[]).map(status => (
            <option key={status} value={status}>
              {statusLabels[status]}
            </option>
          ))}
        </select>
      </div>

      {/* Error Message */}
      {error && (
        <Card className="border-accent-error/20 bg-accent-error/5">
          <CardContent className="p-4 text-sm text-accent-error">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Projects Table */}
      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-foreground-secondary">Chargement des projets…</CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card className="text-center">
          <CardContent className="py-12">
            <div className="mx-auto w-16 h-16 rounded-full bg-background-secondary flex items-center justify-center mb-4">
              <FolderOpen className="h-8 w-8 text-foreground-secondary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground-primary mb-2">Aucun projet</h3>
            <p className="text-foreground-secondary mb-6">
              Lance un premier projet depuis le Studio pour voir apparaître l’historique ici.
            </p>
            <Button onClick={() => navigate('/studio')}>
              Ouvrir le Studio
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Nom</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Utilisateur</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Status</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Coût FCFA</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Tokens</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Créé le</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-b border-border hover:bg-background-tertiary transition-colors">
                    <td className="p-4">
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
                    </td>
                    <td className="p-4 text-sm text-foreground-primary">
                      <div>
                        <div>{project.user_name || '—'}</div>
                        <div className="text-xs text-foreground-secondary">{project.user_email || '—'}</div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={statusVariant(project.status)}>
                        {project.status || 'unknown'}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm text-foreground-primary">
                      {typeof project.cost_fcfa === 'number'
                        ? `${project.cost_fcfa.toLocaleString('fr-FR')} FCFA`
                        : '—'}
                    </td>
                    <td className="p-4 text-sm text-foreground-primary">
                      {typeof project.tokens_used === 'number'
                        ? project.tokens_used.toLocaleString('fr-FR')
                        : '—'}
                    </td>
                    <td className="p-4 text-sm text-foreground-secondary">
                      {project.created_at
                        ? new Date(project.created_at).toLocaleString('fr-FR')
                        : '—'}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/projects/${project.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                          Voir détails
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(project.id)}
                          disabled={deleting === project.id}
                          className="text-accent-error hover:text-accent-error/80"
                        >
                          <Trash2 className="h-4 w-4" />
                          {deleting === project.id ? 'Suppression…' : 'Supprimer'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Total Count */}
      {!loading && projects.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 text-sm text-foreground-secondary">
          <span>Affichage de {projects.length} sur {total} projet{total !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  )
}
