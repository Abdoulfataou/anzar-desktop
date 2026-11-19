/**
 * AuthService — Handles OTP login, legacy password login, and token management.
 * Primary flow: send-code → verify-code (passwordless)
 * Fallback: email + password login (legacy)
 */

import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import { secureTokenStore } from '@/services/infra/secureTokenStore';

/**
 * Délai maximal d'une requête d'authentification. Sans cela, un serveur qui
 * accepte la connexion sans répondre bloque le démarrage de l'app (splash).
 */
const AUTH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = AUTH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// TYPES
// ============================================================================

interface AuthResponse {
  token: string;
  user: { email: string; name?: string };
  credits?: {
    balance_fcfa: number;
    total_recharged: number;
    total_used: number;
  };
  is_new_user?: boolean;
}

interface SendCodeResponse {
  status: string;
  message: string;
  email: string;
  expires_in_minutes: number;
  is_new_user: boolean;
}

// ============================================================================
// AUTH SERVICE
// ============================================================================

class AuthService {
  private getBackendUrl(): string {
    const store = useSettingsStore.getState();
    return store.getBackendUrl();
  }

  // ──────────────────────────────────────────────────────────
  // OTP FLOW (primary — passwordless)
  // ──────────────────────────────────────────────────────────

  /**
   * Step 1: Send a 6-digit verification code to the user's email.
   * Works for both new and existing users.
   */
  async sendCode(email: string): Promise<SendCodeResponse> {
    const res = await fetchWithTimeout(`${this.getBackendUrl()}/api/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error?.message || data?.detail || "Impossible d'envoyer le code");
    }

    return data;
  }

  /**
   * Step 2: Verify the OTP code and get a JWT token.
   * Auto-creates the account if the email is new.
   */
  async verifyCode(email: string, code: string): Promise<AuthResponse> {
    const res = await fetchWithTimeout(`${this.getBackendUrl()}/api/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error?.message || data?.detail || 'Code invalide ou expiré');
    }

    // Store session
    await this.setSession(data);
    return data;
  }

  // ──────────────────────────────────────────────────────────
  // LEGACY PASSWORD FLOW (fallback)
  // ──────────────────────────────────────────────────────────

  /**
   * Register a new account with password
   */
  async register(email: string, password: string): Promise<AuthResponse> {
    const res = await fetchWithTimeout(`${this.getBackendUrl()}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error?.message || data?.detail || "Erreur lors de l'inscription");
    }

    await this.setSession(data);
    return data;
  }

  /**
   * Login with email + password
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    const res = await fetchWithTimeout(`${this.getBackendUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error?.message || data?.detail || 'Email ou mot de passe incorrect');
    }

    await this.setSession(data);
    return data;
  }

  // ──────────────────────────────────────────────────────────
  // TOKEN MANAGEMENT
  // ──────────────────────────────────────────────────────────

  /**
   * Verify current token is still valid
   */
  async verifyToken(): Promise<boolean> {
    const token = useSettingsStore.getState().getAuthToken();
    if (!token) return false;

    try {
      const res = await fetchWithTimeout(`${this.getBackendUrl()}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Refresh the JWT token before it expires.
   * Returns true if refresh succeeded.
   */
  async refreshToken(): Promise<boolean> {
    const token = useSettingsStore.getState().getAuthToken();
    if (!token) return false;

    try {
      const res = await fetchWithTimeout(`${this.getBackendUrl()}/api/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return false;

      const data = await res.json();
      if (data.token) {
        useSettingsStore.getState().setAuthToken(data.token);
        await secureTokenStore.setToken(data.token);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Start a background timer that refreshes the token periodically.
   * Called once during bootstrapSession.
   */
  private _refreshTimer: ReturnType<typeof setInterval> | null = null;

  private startAutoRefresh(): void {
    // Clear any existing timer
    if (this._refreshTimer) clearInterval(this._refreshTimer);

    // Refresh every 6 hours (tokens typically expire in 24h)
    this._refreshTimer = setInterval(async () => {
      if (!this.isAuthenticated()) {
        if (this._refreshTimer) clearInterval(this._refreshTimer);
        return;
      }
      await this.refreshToken();
    }, 6 * 60 * 60 * 1000);
  }

  /**
   * Logout — clear token and user
   */
  logout(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    // Révoque le jeton côté serveur avant de l'oublier. Fire-and-forget :
    // une coupure réseau ne doit pas empêcher la déconnexion locale.
    const token = useSettingsStore.getState().getAuthToken();
    if (token) {
      void fetchWithTimeout(`${this.getBackendUrl()}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }, 3_000).catch(() => {});
    }
    useSettingsStore.getState().setAuthToken(null);
    useAccountStore.getState().logout();
    void secureTokenStore.clearToken();
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!useSettingsStore.getState().getAuthToken();
  }

  /**
   * Store session data after login/register/verify-code
   */
  private async setSession(data: AuthResponse): Promise<void> {
    useSettingsStore.getState().setAuthToken(data.token);
    // Persiste le jeton dans le coffre chiffré (jamais dans localStorage).
    const persisted = await secureTokenStore.setToken(data.token);
    if (!persisted) {
      const { default: toast } = await import('react-hot-toast');
      toast.error(
        "Connexion réussie, mais le coffre local est indisponible : tu devras te reconnecter au prochain démarrage.",
        { duration: 8000 },
      );
    }

    const accountStore = useAccountStore.getState();
    accountStore.setUser({
      id: data.user.email,
      name: data.user.name || data.user.email.split('@')[0],
      email: data.user.email,
      createdAt: Date.now(),
    });

    // Sync credits from server (source of truth)
    if (data.credits) {
      accountStore.syncCreditsFromServer(data.credits);
    }
  }

  /**
   * Bootstrap session on app startup.
   * - Load token from Stronghold (never localStorage)
   * - Verify token with backend (10 s max)
   * - If token expired (401): clear everything and force login
   * - If network error: keep session alive (offline-friendly)
   */
  async bootstrapSession(): Promise<void> {
    // Nettoyage des installations v2.0.0 : l'ancien JWT base64 ne doit pas survivre.
    secureTokenStore.purgeLegacyToken();

    const token = await secureTokenStore.getToken();

    if (!token) {
      // No token stored anywhere — user must log in
      useSettingsStore.getState().setAuthToken(null);
      useAccountStore.getState().logout();
      return;
    }

    // Set token in memory so API calls work
    useSettingsStore.getState().setAuthToken(token);

    // Try to verify with backend
    try {
      const res = await fetchWithTimeout(`${this.getBackendUrl()}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        // Token is valid — start auto-refresh and continue
        this.startAutoRefresh();
        return;
      }

      if (res.status === 401 || res.status === 403) {
        // Token expired — try to refresh it (7-day grace window)
        const refreshed = await this.refreshToken();
        if (refreshed) {
          this.startAutoRefresh();
          return;
        }
        // Refresh failed — force re-login
        await secureTokenStore.clearToken();
        useSettingsStore.getState().setAuthToken(null);
        useAccountStore.getState().logout();
        return;
      }

      // Server error (500, 503...) — keep session alive, don't punish the user
      // They'll get proper errors when they try to use the API
    } catch {
      // Network error (offline, DNS failure, etc.) — keep session alive
      // The user can still browse cached data, and API calls will
      // show proper error messages when attempted
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

export const authService = new AuthService();
export default AuthService;
