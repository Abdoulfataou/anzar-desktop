import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { anzarApi, type AgentStatus, type PlanResponse } from '@/api/backend'
import { cn } from '@/lib/utils'
import {
  Sparkles,
  Wand2,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FolderKanban,
} from 'lucide-react'

type ChipListProps = {
  label: string
  placeholder: string
  value: string[]
  onChange: (next: string[]) => void
}

function ChipList({ label, placeholder, value, onChange }: ChipListProps) {
  const [draft, setDraft] = useState('')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground-primary">{label}</label>
        {value.length > 0 && (
          <button
            className="text-xs text-foreground-secondary hover:text-foreground-primary"
            onClick={() => onChange([])}
            type="button"
          >
            Effacer
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {value.map((chip) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1 rounded-full bg-background-secondary border border-border px-3 py-1 text-xs text-foreground-primary"
          >
            {chip}
            <button
              className="text-foreground-secondary hover:text-foreground-primary"
              type="button"
              onClick={() => onChange(value.filter((v) => v !== chip))}
              aria-label={`Retirer ${chip}`}
              title="Retirer"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const raw = draft.trim()
              if (!raw) return
              const next = Array.from(new Set([...value, raw]))
              onChange(next)
              setDraft('')
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const raw = draft.trim()
            if (!raw) return
            const next = Array.from(new Set([...value, raw]))
            onChange(next)
            setDraft('')
          }}
        >
          Ajouter
        </Button>
      </div>
    </div>
  )
}

function AgentRail({ agents }: { agents: AgentStatus[] }) {
  const order = ['orchestrator', 'planner', 'coder', 'tester', 'executor']

  const sorted = [...agents].sort((a, b) => {
    const ai = order.indexOf(a.name)
    const bi = order.indexOf(b.name)
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  const badgeVariant = (s: AgentStatus['status']) => {
    if (s === 'done') return 'success'
    if (s === 'running') return 'primary'
    if (s === 'error') return 'error'
    if (s === 'cancelled') return 'warning'
    if (s === 'idle') return 'secondary'
    return 'outline'
  }

  return (
    <div className="space-y-3">
      {sorted.map((a) => (
        <div key={a.name} className="p-3 rounded-lg border border-border bg-background-secondary/30">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground-primary truncate">{a.name}</p>
              {a.message && <p className="text-xs text-foreground-secondary truncate">{a.message}</p>}
            </div>
            <Badge variant={badgeVariant(a.status)} className="shrink-0">
              {a.status}
            </Badge>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-background-tertiary overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                a.status === 'error'
                  ? 'bg-accent-error'
                  : a.status === 'done'
                    ? 'bg-accent-success'
                    : 'bg-accent-primary'
              )}
              style={{ width: `${Math.max(0, Math.min(100, a.progress))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function StudioPage() {
  const navigate = useNavigate()

  const [projectName, setProjectName] = useState('my_project')
  const [description, setDescription] = useState('')
  const [techStack, setTechStack] = useState<string[]>(['React', 'FastAPI'])
  const [requirements, setRequirements] = useState<string[]>(['auth', 'API REST'])

  const [planning, setPlanning] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [agents, setAgents] = useState<AgentStatus[]>([])
  const [error, setError] = useState<string | null>(null)

  const canPlan = description.trim().length > 3 && projectName.trim().length > 0

  const planSummary = useMemo(() => {
    if (!plan) return null
    const fileCount = plan.files?.length || 0
    const phaseCount = plan.phases?.length || 0
    return { fileCount, phaseCount }
  }, [plan])

  const handlePlan = async () => {
    setError(null)
    setPlan(null)
    setAgents([])
    setPlanning(true)
    try {
      const result = await anzarApi.planProject({
        description: description.trim(),
        project_name: projectName.trim(),
        tech_stack: techStack,
        requirements,
      })
      setPlan(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur planification')
    } finally {
      setPlanning(false)
    }
  }

  const handleExecute = async () => {
    if (!plan) return
    setError(null)
    setExecuting(true)
    setAgents([])

    try {
      await anzarApi.executeProjectStream({
        projectId: plan.project_id,
        plan: plan as unknown as Record<string, unknown>,
        onAgentsUpdate: (next) => setAgents(next),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur exécution')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground-primary flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-gradient-to-br from-accent-primary/20 to-accent-secondary/10 border border-border flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-accent-primary" />
            </span>
            Studio Vibecoding
          </h1>
          <p className="text-foreground-secondary mt-2 max-w-2xl">
            Décris une application → génère un plan → exécute la pipeline multi-agents (coder/tester/executor) et suis
            l’avancement en direct.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            leftIcon={<FolderKanban className="h-4 w-4" />}
            onClick={() => navigate('/projects')}
          >
            Voir les projets
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-accent-error/30">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-accent-error mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground-primary">Erreur</p>
              <p className="text-sm text-foreground-secondary mt-1">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Request */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none opacity-60">
            <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-accent-primary/10 blur-2xl" />
            <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-accent-secondary/10 blur-2xl" />
          </div>

          <CardHeader className="relative">
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-accent-primary" />
              Brief projet
            </CardTitle>
            <CardDescription>Ce que tu veux générer (le backend fera le reste).</CardDescription>
          </CardHeader>
          <CardContent className="relative space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Nom du projet</label>
              <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="my_project" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground-primary">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Une app de gestion de tâches avec auth, API, et UI moderne…"
                className={cn(
                  'w-full min-h-[140px] rounded-md border border-border bg-background-secondary px-3 py-2 text-sm',
                  'text-foreground-primary placeholder:text-foreground-muted',
                  'focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent'
                )}
              />
            </div>

            <ChipList
              label="Tech stack (optionnel)"
              placeholder="Ex: PostgreSQL"
              value={techStack}
              onChange={setTechStack}
            />
            <ChipList
              label="Exigences (optionnel)"
              placeholder="Ex: paiements"
              value={requirements}
              onChange={setRequirements}
            />

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button
                leftIcon={planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                isLoading={planning}
                disabled={!canPlan || planning || executing}
                onClick={handlePlan}
              >
                Générer le plan
              </Button>
              <Button
                variant="secondary"
                leftIcon={executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                isLoading={executing}
                disabled={!plan || planning || executing}
                onClick={handleExecute}
              >
                Exécuter
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Right: Plan + Execution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-accent-success" />
                Plan & exécution
              </span>
              {plan && (
                <Badge variant="outline" className="text-xs">
                  {plan.project_id}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {planSummary
                ? `${planSummary.phaseCount} phases • ${planSummary.fileCount} fichiers (prévision)`
                : 'Commence par générer un plan.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {!plan && !planning && (
              <div className="rounded-lg border border-border bg-background-secondary/30 p-4">
                <p className="text-sm text-foreground-secondary">
                  Astuce: écris un brief court mais précis. Ensuite, clique “Générer le plan”, vérifie, puis “Exécuter”.
                </p>
              </div>
            )}

            {plan && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-background-secondary/30 p-4">
                  <p className="text-sm font-semibold text-foreground-primary">{plan.title}</p>
                  <p className="text-sm text-foreground-secondary mt-1">{plan.overview}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-background-secondary/30 p-3">
                    <p className="text-xs text-foreground-secondary">Fichiers</p>
                    <p className="text-xl font-bold text-foreground-primary">{plan.files?.length || 0}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-background-secondary/30 p-3">
                    <p className="text-xs text-foreground-secondary">Tokens (plan)</p>
                    <p className="text-xl font-bold text-foreground-primary">{plan.tokens_used ?? '—'}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground-primary">Phases</p>
                  <div className="space-y-2">
                    {plan.phases?.slice(0, 6).map((p, idx) => (
                      <div key={`${p.name}-${idx}`} className="flex items-center justify-between gap-3">
                        <p className="text-sm text-foreground-primary truncate">{p.name}</p>
                        <Badge variant="secondary">{(p.tasks || []).length || 1} tâches</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {(executing || agents.length > 0) && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground-primary">Agents (stream)</p>
                <AgentRail agents={agents} />
              </div>
            )}

            {plan && !executing && agents.length > 0 && (
              <Button
                variant="outline"
                onClick={() => navigate(`/projects/${plan.project_id}`)}
                className="w-full"
              >
                Ouvrir la fiche projet
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

