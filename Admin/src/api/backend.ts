/**
 * ANZAR Admin — API Client
 * Connecté au vrai backend. Zéro mock.
 */
import { useAuthStore } from '@/stores/authStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Credits = {
  balance_fcfa: number;
  total_recharged?: number;
  total_used?: number;
};

export type AdminLoginResponse = {
  token: string;
  user: {
    email: string;
    name: string;
    role: string;
    admin_id: number;
    must_change_password?: boolean;
  };
};

export type HealthResponse = {
  status: string;
  timestamp?: number;
  version?: string;
  checks?: Record<string, string>;
};

export type ProjectRow = {
  id: string;
  user_email?: string;
  user_name?: string;
  name?: string;
  description?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  cost_fcfa?: number;
  tokens_used?: number;
  plan_json?: string;
  result_json?: string;
};

export type UsageRecord = {
  id?: number;
  user_email?: string;
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  cost_fcfa?: number;
  duration_ms?: number;
  created_at?: string;
  task_type?: string;
};

export type PaymentIntent = {
  id: string;
  user_email: string;
  amount_fcfa: number;
  currency: string;
  method: string;
  status: 'pending' | 'paid' | 'cancelled' | 'failed';
  provider_ref?: string;
  payment_url?: string;
  created_at?: string;
  updated_at?: string;
};

export type AdminUser = {
  id: number;
  email: string;
  name?: string;
  is_active: boolean;
  created_at?: string;
  last_login?: string;
  balance_fcfa?: number;
  total_recharged?: number;
  total_used?: number;
  project_count?: number;
  // Detail fields
  credits?: Credits;
  recent_transactions?: Array<Record<string, unknown>>;
};

export type GlobalStats = {
  users: { active: number; total: number; new_7d: number };
  projects: { total: number; by_status: Record<string, number> };
  credits: { total_balance: number; platform_recharged: number; platform_used: number };
  usage_30d: { total_requests: number; total_tokens: number; total_cost_fcfa: number };
  usage_today: { requests: number; cost_fcfa: number };
};

export type AdminProfile = {
  id: number;
  email: string;
  name: string;
  role: string;
  created_at?: string;
  last_login?: string;
};

export type AgentStatus = {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'idle' | 'cancelled';
  progress: number;
  message?: string;
};

export type PlanRequest = {
  description: string;
  project_name?: string;
  tech_stack?: string[];
  requirements?: string[];
};

export type PlanResponse = {
  project_id: string;
  title: string;
  overview: string;
  files: Array<{ path: string; description?: string; type?: string }>;
  phases: Array<{ name: string; description?: string; duration?: string; tasks?: string[] }>;
  architecture?: Record<string, unknown>;
  tokens_used?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Client
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

function getToken(): string | null {
  return useAuthStore.getState().token;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json');

  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');

  if (!res.ok) {
    const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');
    const message =
      typeof body === 'string'
        ? body
        : body?.error?.message || body?.detail || `Erreur API (${res.status})`;
    throw new Error(message);
  }

  return (isJson ? res.json() : (res.text() as unknown)) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

export const anzarApi = {
  backendUrl: BACKEND_URL,

  // ── Health ──
  async health(): Promise<HealthResponse> {
    return apiFetch<HealthResponse>('/health');
  },

  // ── Admin Auth ──
  async login(email: string, password: string): Promise<AdminLoginResponse> {
    return apiFetch<AdminLoginResponse>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  // ── Admin Profile ──
  async getProfile(): Promise<AdminProfile> {
    return apiFetch<AdminProfile>('/api/admin/me');
  },

  async updateProfile(data: { name?: string; email?: string }): Promise<AdminProfile> {
    return apiFetch<AdminProfile>('/api/admin/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ status: string }> {
    return apiFetch('/api/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  },

  // ── Dashboard Stats ──
  async stats(): Promise<GlobalStats> {
    return apiFetch<GlobalStats>('/api/admin/stats');
  },

  // ── Users Management ──
  async listUsers(params?: { search?: string; status?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    qs.set('limit', String(params?.limit ?? 50));
    qs.set('offset', String(params?.offset ?? 0));
    return apiFetch<{ users: AdminUser[]; total: number }>(`/api/admin/users?${qs}`);
  },

  async getUser(email: string): Promise<AdminUser> {
    return apiFetch<AdminUser>(`/api/admin/users/${encodeURIComponent(email)}`);
  },

  async updateUser(email: string, patch: { name?: string; is_active?: boolean }): Promise<{ status: string }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async grantCredits(email: string, amount: number, description = 'Bonus admin'): Promise<{ status: string; credits: Credits }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(email)}/credits`, {
      method: 'POST',
      body: JSON.stringify({ amount, tx_type: 'bonus', description, external_ref: '' }),
    });
  },

  async adjustCredits(params: {
    email: string;
    amount: number;
    tx_type: 'bonus' | 'refund' | 'recharge';
    description: string;
    external_ref?: string;
  }): Promise<{ status: string; credits: Credits }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(params.email)}/credits`, {
      method: 'POST',
      body: JSON.stringify({
        amount: params.amount,
        tx_type: params.tx_type,
        description: params.description,
        external_ref: params.external_ref || '',
      }),
    });
  },

  // ── Projects Management ──
  async listProjects(params?: { search?: string; status?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    qs.set('limit', String(params?.limit ?? 50));
    qs.set('offset', String(params?.offset ?? 0));
    return apiFetch<{ projects: ProjectRow[]; total: number }>(`/api/admin/projects?${qs}`);
  },

  async getProject(projectId: string): Promise<ProjectRow> {
    return apiFetch<ProjectRow>(`/api/admin/projects/${encodeURIComponent(projectId)}`);
  },

  async deleteProject(projectId: string): Promise<{ status: string }> {
    return apiFetch(`/api/admin/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  },

  // ── Transactions & Usage ──
  async transactions(limit = 100, offset = 0) {
    return apiFetch<{ transactions: Array<Record<string, unknown>> }>(`/api/admin/transactions?limit=${limit}&offset=${offset}`);
  },

  async usage(limit = 100, offset = 0) {
    return apiFetch<{ usage: UsageRecord[] }>(`/api/admin/usage?limit=${limit}&offset=${offset}`);
  },

  // ── Payments (prep) ──
  async listPaymentIntents(params?: { status?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    qs.set('limit', String(params?.limit ?? 50));
    qs.set('offset', String(params?.offset ?? 0));
    return apiFetch<{ payment_intents: PaymentIntent[]; total: number }>(`/api/admin/payments?${qs}`);
  },

  async markPaymentPaid(intentId: string, body: { provider_ref?: string; description: string }) {
    return apiFetch<{ status: string; payment_intent: PaymentIntent }>(`/api/admin/payments/${encodeURIComponent(intentId)}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify({
        provider_ref: body.provider_ref || '',
        description: body.description,
      }),
    });
  },

  // ── Admin Accounts ──
  async listAdmins() {
    return apiFetch<{ admins: AdminProfile[] }>('/api/admin/admins');
  },

  // ── Studio (project planning/execution via user endpoints) ──
  async planProject(body: PlanRequest): Promise<PlanResponse> {
    return apiFetch<PlanResponse>('/api/projects/plan', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async executeProjectStream(params: {
    projectId: string;
    plan: Record<string, unknown>;
    baseDir?: string;
    onAgentsUpdate: (agents: AgentStatus[]) => void;
  }): Promise<void> {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(`${BACKEND_URL}/api/projects/${encodeURIComponent(params.projectId)}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ plan: params.plan, base_dir: params.baseDir }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Erreur exécution (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as { agents?: AgentStatus[] };
          if (parsed.agents) params.onAgentsUpdate(parsed.agents);
        } catch { /* skip */ }
      }
    }
  },
};
