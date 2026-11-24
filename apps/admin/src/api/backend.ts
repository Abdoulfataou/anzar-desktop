/**
 * ANZAR Admin — client de l'API (/api/admin/*). Aucune donnée simulée.
 */
import { useAuthStore } from '@/stores/authStore'

// ── Types ────────────────────────────────────────────────────────────────────

export type Role = 'owner' | 'admin' | 'support' | 'readonly'

export type ErrorStatus = 'new' | 'analysed' | 'fixed' | 'ignored'
export type ErrorGroup = {
  id: number
  kind: 'command' | 'update' | 'tool' | 'crash'
  title: string
  sample: string
  count: number
  users: number
  last_version: string
  last_os: string
  status: ErrorStatus
  analysis: string
  issue_url: string
  fixed_in: string
  first_seen: string | null
  last_seen: string | null
}

export type Credits = { balance_fcfa: number; total_recharged?: number; total_used?: number }

export type AdminLoginResponse = {
  token: string
  user: { email: string; name: string; role: Role; admin_id: number; must_change_password?: boolean; mfa_enabled?: boolean }
}

export type HealthResponse = { status: string; timestamp?: number; version?: string; checks?: Record<string, string> }

export type Transaction = {
  id: number
  user_email: string
  type: 'recharge' | 'usage' | 'bonus' | 'refund'
  amount_fcfa: number
  description?: string
  provider?: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  external_ref?: string | null
  created_at?: string
}

export type UsageRecord = {
  id: number
  user_email: string
  provider: string
  model: string
  task_type: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  cost_fcfa: number
  duration_ms: number
  created_at?: string
}

export type PaymentStatus = 'pending' | 'paid' | 'cancelled' | 'failed'

export type PaymentIntent = {
  id: string
  user_email: string
  amount_fcfa: number
  currency: string
  method: string
  status: PaymentStatus
  provider_ref?: string
  provider?: string
  provider_tx_id?: string
  charged_amount?: number
  charged_currency?: string
  charged_amount_minor?: number | null
  pack_id?: number | null
  pricing_source?: string
  customer_country?: string
  remote_status?: string
  failure_reason?: string
  created_at?: string
  updated_at?: string
}

export type AdminUser = {
  id: number
  email: string
  name?: string
  is_active: boolean
  created_at?: string
  last_login?: string | null
  balance_fcfa?: number
  total_recharged?: number
  total_used?: number
  credits?: Credits
  recent_transactions?: Transaction[]
}

export type GlobalStats = {
  users: { active: number; total: number; new_7d: number }
  credits: { total_balance: number; platform_recharged: number; platform_used: number }
  usage_30d: { total_requests: number; total_tokens: number; total_cost_fcfa: number }
  usage_today: { requests: number; cost_fcfa: number }
  payments_pending: { count: number; amount_fcfa: number }
  debts: { count: number; amount_fcfa: number }
  funded_users: number
  recharged_30d: number
  bonus_30d: number
  billing_anomalies_30d: number
  cache_rate_30d?: number
}

export type DailyPoint = {
  day: string
  requests: number
  tokens: number
  cost_fcfa: number
  recharged_fcfa: number
  new_users: number
}

export type BreakdownRow = {
  key: string; requests: number; input_tokens: number; output_tokens: number; cost_fcfa: number
  cached_input_tokens?: number; cache_rate?: number
}
export type Breakdown = { days: number; by_model: BreakdownRow[]; by_task_type: BreakdownRow[]; top_users: BreakdownRow[] }

export type AdminAccount = {
  id: number
  email: string
  name: string
  role: Role
  is_active?: boolean
  must_change_password?: boolean
  mfa_enabled?: boolean
  created_at?: string
  last_login?: string | null
}

export type AuditEntry = {
  id: number
  admin_email: string
  action: string
  target: string
  details: string
  ip: string
  created_at?: string
}

export type PlatformSettings = {
  version: string
  models: { default: string; pro: string }
  pricing_usd_per_million: Record<'flash' | 'pro', { cache_hit: number; cache_miss: number; output: number }>
  margin: number
  usd_to_fcfa: number
  offpeak_factor: number
  peak_windows_utc: string
  web_tool_cost_fcfa: number
  recharge_bonus_tiers: string
  welcome_bonus_fcfa: number
  max_concurrent_ai_per_user: number
  rate_limit: { per_minute: number; per_day: number }
  jwt_expiry_hours: number
  admin_jwt_expiry_hours: number
  providers: Record<string, boolean>
}

// ── Client HTTP ──────────────────────────────────────────────────────────────

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// ── Multidevise ──

export type ProviderCap = { id: string; label: string; enabled: boolean; granularity: number }
export type AdminCurrency = {
  code: string; name: string; symbol: string; decimals: number; active: boolean; margin_pct: number | null
  fcfa_per_unit: number | null; rate_source: string; rate_at: string | null; rate_fixed: boolean; rate_stale: boolean
  packs: number; providers: ProviderCap[]; payable: boolean
}
export type PricingSettings = { margin_pct: string; max_daily_change_pct: string; max_rate_age_days: string; fallback_currency: string }
export type FxLog = { id: number; at: string; source: string; ok: boolean; updated: number; message: string }
export type AdminPack = {
  id: number; currency: string; label: string; sort: number; active: boolean; price_minor: number; price: string
  credit_fcfa: number; implied_fcfa_per_unit: number | null; market_fcfa_per_unit: number | null
  deviation_pct: number | null; issues: string[]
}
export type OfferPreview = {
  currency: string; decimals: number; fallback_reason: string; pricing_source: string; fcfa_per_unit: number | null
  rate_as_of: string | null; rate_fixed: boolean
  packs: { id: number; label: string; price_minor: number; credit_fcfa: number; bonus_pct: number }[]
  providers: { id: string; label: string }[]
}
export type CurrencyTotals = {
  currency: string; decimals: number; paid_count: number; paid_amount: string; paid_credits_fcfa: number
  pending_count: number; other_count: number
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {})
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const token = useAuthStore.getState().token
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers })
  } catch {
    throw new ApiError('Serveur injoignable. Vérifie ta connexion.', 0)
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json')

  if (!res.ok) {
    const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '')
    const detail = typeof body === 'string' ? body : body?.detail ?? body?.error?.message
    const message = typeof detail === 'string' ? detail : `Erreur API (${res.status})`
    // Session expirée ou compte admin désactivé : retour à l'écran de connexion
    if (res.status === 401 && path !== '/api/admin/login') useAuthStore.getState().clearSession()
    throw new ApiError(message, res.status)
  }
  return (isJson ? res.json() : res.text()) as Promise<T>
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) })

// ── API ──────────────────────────────────────────────────────────────────────

export const api = {
  backendUrl: BACKEND_URL,

  health: () => apiFetch<HealthResponse>('/health'),

  // Connexion et profil
  login: (email: string, password: string, totp_code = '', recovery_code = '') =>
    apiFetch<AdminLoginResponse>('/api/admin/login', post({ email, password, totp_code, recovery_code })),
  me: () => apiFetch<AdminAccount>('/api/admin/me'),
  updateMe: (data: { name?: string; email?: string }) => apiFetch<AdminAccount>('/api/admin/me', patch(data)),
  changePassword: (current_password: string, new_password: string) =>
    apiFetch<{ status: string }>('/api/admin/change-password', post({ current_password, new_password })),
  mfaSetup: () => apiFetch<{ secret: string; otpauth_uri: string; recovery_codes: string[] }>('/api/admin/mfa/setup', post({})),
  mfaEnable: (code: string) => apiFetch<{ status: string; mfa_enabled: boolean }>('/api/admin/mfa/enable', post({ code })),
  mfaDisable: (password: string, code: string) =>
    apiFetch<{ status: string; mfa_enabled: boolean }>('/api/admin/mfa/disable', post({ password, code })),
  mfaReset: (adminId: number) =>
    apiFetch<{ status: string; message: string }>(`/api/admin/admins/${adminId}/mfa-reset`, post({})),
  logout: () => apiFetch<{ status: string }>('/api/admin/logout', post({})),

  // Tableau de bord
  stats: () => apiFetch<GlobalStats>('/api/admin/stats'),
  daily: (days = 30) => apiFetch<{ days: DailyPoint[] }>(`/api/admin/stats/daily${qs({ days })}`),
  breakdown: (days = 30) => apiFetch<Breakdown>(`/api/admin/stats/breakdown${qs({ days })}`),

  // Utilisateurs
  users: (p: { search?: string; status?: string; limit?: number; offset?: number }) =>
    apiFetch<{ users: AdminUser[]; total: number }>(`/api/admin/users${qs(p)}`),
  user: (email: string) => apiFetch<AdminUser>(`/api/admin/users/${encodeURIComponent(email)}`),
  updateUser: (email: string, data: { name?: string; is_active?: boolean }) =>
    apiFetch<{ status: string }>(`/api/admin/users/${encodeURIComponent(email)}`, patch(data)),
  credit: (email: string, data: { amount: number; tx_type: 'recharge' | 'bonus' | 'refund'; description: string; external_ref?: string }) =>
    apiFetch<{ status: string; credits: Credits }>(`/api/admin/users/${encodeURIComponent(email)}/credits`,
      post({ external_ref: '', ...data })),
  debit: (email: string, data: { amount: number; description: string }) =>
    apiFetch<{ status: string; credits: Credits }>(`/api/admin/users/${encodeURIComponent(email)}/debit`, post(data)),

  // Grand livre et consommation
  transactions: (p: { email?: string; type?: string; limit?: number; offset?: number }) =>
    apiFetch<{ transactions: Transaction[]; total: number; sum_credited: number; sum_debited: number }>(
      `/api/admin/transactions${qs(p)}`),
  usage: (p: { email?: string; model?: string; task_type?: string; limit?: number; offset?: number }) =>
    apiFetch<{ usage: UsageRecord[]; total: number; sum_input_tokens: number; sum_output_tokens: number; sum_cost_fcfa: number }>(
      `/api/admin/usage${qs(p)}`),

  // Paiements
  payments: (p: { status?: string; email?: string; currency?: string; limit?: number; offset?: number }) =>
    apiFetch<{ payment_intents: PaymentIntent[]; total: number; sum_amount_fcfa: number; counts: Record<string, number> }>(
      `/api/admin/payments${qs(p)}`),
  markPaid: (id: string, data: { description: string; provider_ref?: string }) =>
    apiFetch<{ status: string; payment_intent: PaymentIntent }>(`/api/admin/payments/${encodeURIComponent(id)}/mark-paid`,
      post({ provider_ref: '', ...data })),
  refreshPayment: (id: string) =>
    apiFetch<{ status: string; payment_intent: PaymentIntent }>(`/api/admin/payments/${encodeURIComponent(id)}/refresh`, post({})),
  cancelPayment: (id: string, reason: string) =>
    apiFetch<{ status: string }>(`/api/admin/payments/${encodeURIComponent(id)}/cancel`, post({ reason })),

  // Journal d'audit
  audit: (p: { admin_email?: string; action?: string; target?: string; limit?: number; offset?: number }) =>
    apiFetch<{ entries: AuditEntry[]; total: number }>(`/api/admin/audit${qs(p)}`),

  // Erreurs remontées par l'app (suivi automatique DeepSeek Harness)
  errors: (p: { status?: ErrorStatus; limit?: number }) =>
    apiFetch<{ groups: ErrorGroup[]; counts: Record<ErrorStatus, number> }>(`/api/admin/errors${qs(p)}`),
  updateError: (id: number, data: { status?: ErrorStatus; fixed_in?: string }) =>
    apiFetch<ErrorGroup>(`/api/admin/errors/${id}`, patch(data)),

  // Comptes admin (owner)
  admins: () => apiFetch<{ admins: AdminAccount[] }>('/api/admin/admins'),
  createAdmin: (data: { email: string; name?: string; role: Role }) =>
    apiFetch<{ admin: AdminAccount; temporary_password: string }>('/api/admin/admins', post(data)),
  updateAdmin: (id: number, data: { name?: string; role?: Role; is_active?: boolean }) =>
    apiFetch<{ admin: AdminAccount }>(`/api/admin/admins/${id}`, patch(data)),
  resetAdminPassword: (id: number) =>
    apiFetch<{ temporary_password: string }>(`/api/admin/admins/${id}/reset-password`, { method: 'POST' }),

  // Paramètres
  settings: () => apiFetch<PlatformSettings>('/api/admin/settings'),

  // Multidevise
  currencies: () => apiFetch<{ currencies: AdminCurrency[]; settings: PricingSettings }>('/api/admin/currencies'),
  updateCurrency: (code: string, data: { active?: boolean; margin_pct?: number; clear_margin?: boolean; symbol?: string }) =>
    apiFetch<{ status: string }>(`/api/admin/currencies/${encodeURIComponent(code)}`, patch(data)),
  fx: () => apiFetch<{ last_success_at: string | null; sources: string[]; log: FxLog[] }>('/api/admin/fx'),
  refreshFx: () => apiFetch<{ ok: boolean; source: string; updated: number; rejected: Record<string, string>; message: string }>(
    '/api/admin/fx/refresh', post({})),
  forceRate: (code: string, fcfa_per_unit: number) =>
    apiFetch<{ status: string }>(`/api/admin/fx/rates/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify({ fcfa_per_unit }) }),
  pricingSettings: () => apiFetch<PricingSettings>('/api/admin/pricing/settings'),
  updatePricingSettings: (data: Partial<PricingSettings>) =>
    apiFetch<PricingSettings>('/api/admin/pricing/settings', { method: 'PUT', body: JSON.stringify(data) }),
  pricingPreview: (currency: string) => apiFetch<OfferPreview>(`/api/admin/pricing/preview${qs({ currency })}`),
  packs: (currency: string) => apiFetch<{ currency: string; decimals: number; packs: AdminPack[] }>(`/api/admin/packs${qs({ currency })}`),
  createPack: (data: { currency: string; price: string; credit_fcfa: number; label?: string; sort?: number }) =>
    apiFetch<{ status: string; id: number }>('/api/admin/packs', post(data)),
  updatePack: (id: number, data: { price?: string; credit_fcfa?: number; label?: string; sort?: number; active?: boolean }) =>
    apiFetch<{ status: string }>(`/api/admin/packs/${id}`, patch(data)),
  deletePack: (id: number) => apiFetch<{ status: string }>(`/api/admin/packs/${id}`, { method: 'DELETE' }),
  paymentsByCurrency: (days = 30) =>
    apiFetch<{ days: number; currencies: CurrencyTotals[] }>(`/api/admin/payments/by-currency${qs({ days })}`),
}
