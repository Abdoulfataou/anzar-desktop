/**
 * AuthService — Handles OTP login, legacy password login, and token management.
 * Primary flow: send-code → verify-code (passwordless)
 * Fallback: email + password login (legacy)
 */

import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import { secureTokenStore } from '@/services/secureTokenStore';

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
    const res = await fetch(`${this.getBackendUrl()}/api/auth/send-code`, {
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
    const res = await fetch(`${this.getBackendUrl()}/api/auth/verify-code`, {
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
    const res = await fetch(`${this.getBackendUrl()}/api/auth/register`, {
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
    const res = await fetch(`${this.getBackendUrl()}/api/auth/login`, {
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
      const res = await fetch(`${this.getBackendUrl()}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Logout — clear token and user
   */
  logout(): void {
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
    // Persist token securely (encrypted vault)
    await secureTokenStore.setToken(data.token);

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
   * - Load token from Stronghold
   * - Verify token with backend
   * - If invalid: clear everything and force login
   */
  async bootstrapSession(): Promise<void> {
    const token = await secureTokenStore.getToken();

    if (!token) {
      // Ensure we don't keep a "loggedIn" flag without token
      useSettingsStore.getState().setAuthToken(null);
      useAccountStore.getState().logout();
      return;
    }

    useSettingsStore.getState().setAuthToken(token);
    const ok = await this.verifyToken();
    if (!ok) {
      await secureTokenStore.clearToken();
      useSettingsStore.getState().setAuthToken(null);
      useAccountStore.getState().logout();
      return;
    }

    // token is valid; keep user state as-is (persisted by accountStore)
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

export const authService = new AuthService();
export default AuthService;
