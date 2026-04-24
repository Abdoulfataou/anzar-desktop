import { useAuthStore } from '@/stores/authStore'

// ─────────────────────────────────────────────────────────────────────────────
// Types (alignés sur le backend ANZAR)
// ─────────────────────────────────────────────────────────────────────────────

export type Credits = {
  balance_fcfa: number
  total_recharged?: number
  total_used?: number
}

export type LoginResponse = {
  token: string
  user: {
    email: string
    name: string
  }
  credits?: Credits
}

export type HealthResponse = {
  status: string
  timestamp?: number
  version?: string
  checks?: Record<string, string>
}

export type ProjectRow = {
  id: string
  user_email?: string
  name?: string
  description?: string
  status?: string
  created_at?: string
  updated_at?: string
  cost_fcfa?: number
  tokens_used?: number
  plan_json?: string
  result_json?: string
}

export type ProjectsListResponse = {
  projects: ProjectRow[]
  count: number
}

export type UsageRecord = {
  id?: string
  provider?: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  cost_usd?: number
  cost_fcfa?: number
  duration_ms?: number
  created_at?: string
  task_type?: string
}

export type UsageListResponse = {
  records: UsageRecord[]
  count: number
}

export type UsageStats = Record<string, unknown>

export type PlanRequest = {
  description: string
  project_name?: string
  tech_stack?: string[]
  requirements?: string[]
}

export type PlanResponse = {
  project_id: string
  title: string
  overview: string
  files: Array<{ path: string; description?: string; type?: string }>
  phases: Array<{ name: string; description?: string; duration?: string; tasks?: string[] }>
  architecture?: Record<string, unknown>
  tokens_used?: number
}

export type ExecuteRequest = {
  plan: Record<string, unknown>
  base_dir?: string
}

export type AgentStatus = {
  name: string
  status: 'pending' | 'running' | 'done' | 'error' | 'idle' | 'cancelled'
  progress: number
  message?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin (Users/Orgs) - contrat UI (le backend peut ne pas encore exposer ces routes)
// ─────────────────────────────────────────────────────────────────────────────

export type AdminUserStatus = 'active' | 'suspended' | 'disabled'
export type AdminRole = 'owner' | 'admin' | 'support' | 'readonly'

export type AdminUser = {
  id: string
  email: string
  name?: string
  country?: string
  status: AdminUserStatus
  role: AdminRole
  created_at?: string
  last_seen_at?: string
  projects_count?: number
  credits_balance_fcfa?: number
}

export type AdminUsersListResponse = {
  users: AdminUser[]
  count: number
}

export type AdminUserPatch = Partial<Pick<AdminUser, 'name' | 'country' | 'status' | 'role'>>

// ─────────────────────────────────────────────────────────────────────────────
// Client HTTP
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

function getToken(): string | null {
  return useAuthStore.getState().token
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {})
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json')

  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers })
  const isJson = (res.headers.get('content-type') || '').includes('application/json')

  if (!res.ok) {
    // Backend renvoie souvent { error: { message } }
    const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '')
    const message =
      typeof body === 'string'
        ? body
        : body?.error?.message || body?.detail || `Erreur API (${res.status})`
    throw new Error(message)
  }

  return (isJson ? res.json() : (res.text() as unknown)) as T
}

function isLikelyMissingEndpoint(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('404') ||
    msg.toLowerCase().includes('not found') ||
    msg.toLowerCase().includes('cannot get') ||
    msg.toLowerCase().includes('no route')
  )
}

const mockUsers: AdminUser[] = [
  {
    id: 'u_01',
    email: 'owner@anzar.dev',
    name: 'Owner',
    country: 'SN',
    status: 'active',
    role: 'owner',
    created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
    last_seen_at: new Date(Date.now() - 10 * 60000).toISOString(),
    projects_count: 12,
    credits_balance_fcfa: 24500,
  },
  {
    id: 'u_02',
    email: 'support@anzar.dev',
    name: 'Support',
    country: 'CI',
    status: 'active',
    role: 'support',
    created_at: new Date(Date.now() - 18 * 86400000).toISOString(),
    last_seen_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    projects_count: 3,
    credits_balance_fcfa: 1200,
  },
  {
    id: 'u_03',
    email: 'user1@example.com',
    name: 'User One',
    country: 'TG',
    status: 'active',
    role: 'readonly',
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    last_seen_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    projects_count: 1,
    credits_balance_fcfa: 0,
  },
  {
    id: 'u_04',
    email: 'user2@example.com',
    name: 'User Two',
    country: 'ML',
    status: 'suspended',
    role: 'readonly',
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    last_seen_at: new Date(Date.now() - 12 * 86400000).toISOString(),
    projects_count: 5,
    credits_balance_fcfa: 500,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// API ANZAR (Admin UI)
// ─────────────────────────────────────────────────────────────────────────────

export const anzarApi = {
  backendUrl: BACKEND_URL,

  async health(): Promise<HealthResponse> {
    return apiFetch<HealthResponse>('/health', { method: 'GET' })
  },

  async login(email: string, password: string): Promise<LoginResponse> {
    return apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },

  async credits(): Promise<Credits> {
    return apiFetch<Credits>('/api/credits', { method: 'GET' })
  },

  async rechargeCredits(payload: { amount_fcfa: number; payment_ref?: string; payment_method?: string }) {
    return apiFetch<{ status: string; balance_fcfa: number }>(`/api/credits/recharge`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  async usageStats(days = 30): Promise<UsageStats> {
    return apiFetch<UsageStats>(`/api/usage/stats?days=${encodeURIComponent(String(days))}`, { method: 'GET' })
  },

  async usage(limit = 50, offset = 0): Promise<UsageListResponse> {
    return apiFetch<UsageListResponse>(`/api/usage?limit=${limit}&offset=${offset}`, { method: 'GET' })
  },

  async creditTransactions(limit = 50, offset = 0): Promise<{ transactions: unknown[]; count: number }> {
    return apiFetch<{ transactions: unknown[]; count: number }>(
      `/api/credits/transactions?limit=${limit}&offset=${offset}`,
      { method: 'GET' }
    )
  },

  async listProjects(limit = 50): Promise<ProjectsListResponse> {
    return apiFetch<ProjectsListResponse>(`/api/projects?limit=${encodeURIComponent(String(limit))}`, { method: 'GET' })
  },

  async getProject(projectId: string): Promise<ProjectRow> {
    return apiFetch<ProjectRow>(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'GET' })
  },

  async planProject(body: PlanRequest): Promise<PlanResponse> {
    return apiFetch<PlanResponse>('/api/projects/plan', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  /**
   * Lance l'exécution et stream les updates agents.
   * Le backend renvoie une suite de JSON séparés par des retours à la ligne.
   */
  async executeProjectStream(params: {
    projectId: string
    plan: Record<string, unknown>
    baseDir?: string
    onAgentsUpdate: (agents: AgentStatus[]) => void
  }): Promise<void> {
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')

    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const res = await fetch(`${BACKEND_URL}/api/projects/${encodeURIComponent(params.projectId)}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        plan: params.plan,
        base_dir: params.baseDir,
      } satisfies ExecuteRequest),
    })

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Erreur exécution (${res.status})`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Traiter ligne par ligne
      let idx = buffer.indexOf('\n')
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        idx = buffer.indexOf('\n')

        if (!line) continue
        try {
          const parsed = JSON.parse(line) as { agents?: AgentStatus[] }
          if (parsed.agents) params.onAgentsUpdate(parsed.agents)
        } catch {
          // ignorer les lignes non JSON
        }
      }
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Admin users (UI-first). Si le backend ne supporte pas encore /api/admin/*,
  // on renvoie des mocks pour permettre l'intégration UI sans casser l'app.
  // ───────────────────────────────────────────────────────────────────────────

  async adminListUsers(params?: { q?: string; limit?: number; offset?: number }): Promise<AdminUsersListResponse> {
    const q = params?.q?.trim()
    const limit = params?.limit ?? 50
    const offset = params?.offset ?? 0
    try {
      const url =
        `/api/admin/users?limit=${encodeURIComponent(String(limit))}` +
        `&offset=${encodeURIComponent(String(offset))}` +
        (q ? `&q=${encodeURIComponent(q)}` : '')
      return await apiFetch<AdminUsersListResponse>(url, { method: 'GET' })
    } catch (err) {
      if (!isLikelyMissingEndpoint(err)) throw err
      const filtered = q
        ? mockUsers.filter((u) => (u.email + ' ' + (u.name || '')).toLowerCase().includes(q.toLowerCase()))
        : mockUsers
      return { users: filtered.slice(offset, offset + limit), count: filtered.length }
    }
  },

  async adminGetUser(userIdOrEmail: string): Promise<AdminUser> {
    try {
      return await apiFetch<AdminUser>(`/api/admin/users/${encodeURIComponent(userIdOrEmail)}`, { method: 'GET' })
    } catch (err) {
      if (!isLikelyMissingEndpoint(err)) throw err
      const found =
        mockUsers.find((u) => u.id === userIdOrEmail) || mockUsers.find((u) => u.email === userIdOrEmail)
      if (!found) throw new Error('Utilisateur introuvable (mock)')
      return found
    }
  },

  async adminPatchUser(userIdOrEmail: string, patch: AdminUserPatch): Promise<AdminUser> {
    try {
      return await apiFetch<AdminUser>(`/api/admin/users/${encodeURIComponent(userIdOrEmail)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    } catch (err) {
      if (!isLikelyMissingEndpoint(err)) throw err
      // mock update (en mémoire uniquement)
      const idx = mockUsers.findIndex((u) => u.id === userIdOrEmail || u.email === userIdOrEmail)
      if (idx === -1) throw new Error('Utilisateur introuvable (mock)')
      mockUsers[idx] = { ...mockUsers[idx], ...patch }
      return mockUsers[idx]
    }
  },
}
