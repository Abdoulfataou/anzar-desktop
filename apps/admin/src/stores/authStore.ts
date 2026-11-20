/**
 * Admin Auth Store — Login admin séparé des users normaux.
 * JWT contient is_admin=true, admin_id, role.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AdminRole = 'owner' | 'admin' | 'support' | 'readonly';

export interface AdminUser {
  email: string;
  name: string;
  role: AdminRole;
  admin_id: number;
  must_change_password?: boolean;
}

interface AuthStore {
  token: string | null;
  user: AdminUser | null;
  isLoggedIn: boolean;

  setSession: (data: { token: string; user: AdminUser }) => void;
  clearSession: () => void;
  updateUser: (patch: Partial<AdminUser>) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isLoggedIn: false,

      setSession: ({ token, user }) =>
        set({ token, user, isLoggedIn: true }),

      clearSession: () =>
        set({ token: null, user: null, isLoggedIn: false }),

      updateUser: (patch) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...patch } : null,
        })),
    }),
    {
      name: 'anzar-admin-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
);
