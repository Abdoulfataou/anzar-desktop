import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { anzarApi, type ProjectRow } from '@/api/backend'
import { ArrowLeft, FileJson2, FolderKanban, RefreshCw, Trash2 } from 'lucide-react'

function tryParseJson(text?: string) {
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export default function ProjectDetailsPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const planJson = useMemo(() => tryParseJson(project?.plan_json), [project?.plan_json])
  const resultJson = useMemo(() => tryParseJson(project?.result_json), [project?.result_json])

  const refresh = async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const p = await anzarApi.getProject(projectId)
      setProject(p)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement projet')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!projectId) return
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce projet ? Cette action est irréversible.')) {
      return
    }
    setDeleting(true)
    try {
      await anzarApi.deleteProject(projectId)
      navigate('/projects')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur suppression projet')
      setDeleting(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/projects')} aria-label="Retour">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground-primary truncate">
                {project?.name || projectId}
              </h1>
              <p className="text-sm text-foreground-secondary truncate">
                {project?.description || '—'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()}>
            Rafraîchir
          </Button>
          <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? 'Suppression…' : 'Supprimer'}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 text-sm text-foreground-secondary">{error}</CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-foreground-secondary">Chargement…</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderKanban className="h-5 w-5 text-accent-primary" />
                  Métadonnées
                </CardTitle>
                <CardDescription>Infos stockées côté backend.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-foreground-secondary">ID</p>
                  <p className="text-foreground-primary font-medium">{project?.id}</p>
                </div>
                <div>
                  <p className="text-foreground-secondary">Statut</p>
                  <Badge variant="outline">{project?.status || 'unknown'}</Badge>
                </div>
                <div>
                  <p className="text-foreground-secondary">Utilisateur</p>
                  <p className="text-foreground-primary">{project?.user_name || project?.user_email || '—'}</p>
                </div>
                <div>
                  <p className="text-foreground-secondary">Email</p>
                  <p className="text-foreground-primary text-xs break-all">{project?.user_email || '—'}</p>
                </div>
                <div>
                  <p className="text-foreground-secondary">Créé</p>
                  <p className="text-foreground-primary">
                    {project?.created_at ? new Date(project.created_at).toLocaleString('fr-FR') : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-foreground-secondary">Mis à jour</p>
                  <p className="text-foreground-primary">
                    {project?.updated_at ? new Date(project.updated_at).toLocaleString('fr-FR') : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-foreground-secondary">Tokens utilisés</p>
                  <p className="text-foreground-primary">{project?.tokens_used ?? '—'}</p>
                </div>
                <div>
                  <p className="text-foreground-secondary">Coût (FCFA)</p>
                  <p className="text-foreground-primary">{project?.cost_fcfa ?? '—'}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileJson2 className="h-5 w-5 text-accent-secondary" />
                  JSON
                </CardTitle>
                <CardDescription>Plan & résultat bruts (si disponibles).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge variant={planJson ? 'success' : 'outline'}>plan_json</Badge>
                <Badge variant={resultJson ? 'success' : 'outline'}>result_json</Badge>
                <p className="text-xs text-foreground-secondary">
                  Si ces champs sont vides, le backend ne les a pas encore persistés (ou la génération a été annulée).
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Plan (JSON)</CardTitle>
                <CardDescription>Ce qui a été planifié avant exécution.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap break-words bg-background-primary border border-border rounded-lg p-4 overflow-auto">
                  {planJson ? JSON.stringify(planJson, null, 2) : '—'}
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Résultat (JSON)</CardTitle>
                <CardDescription>Ce qui a été exécuté / écrit sur disque.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="text-xs whitespace-pre-wrap break-words bg-background-primary border border-border rounded-lg p-4 overflow-auto">
                  {resultJson ? JSON.stringify(resultJson, null, 2) : '—'}
                </pre>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
