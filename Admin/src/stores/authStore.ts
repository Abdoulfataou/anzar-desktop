import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AuthUser = {
  email: string
  name: string
}

type Credits = {
  balance_fcfa: number
  total_recharged?: number
  total_used?: number
}

type AuthState = {
  token: string | null
  user: AuthUser | null
  credits: Credits | null

  isLoggedIn: boolean

  setSession: (payload: { token: string; user: AuthUser; credits?: Credits }) => void
  clearSession: () => void
  setCredits: (credits: Credits) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      credits: null,
      isLoggedIn: false,

      setSession: ({ token, user, credits }) =>
        set({
          token,
          user,
          credits: credits ?? get().credits,
          isLoggedIn: true,
        }),

      clearSession: () =>
        set({
          token: null,
          user: null,
          credits: null,
          isLoggedIn: false,
        }),

      setCredits: (credits) => set({ credits }),
    }),
    {
      name: 'anzar-admin-auth',
      version: 1,
      partialize: (s) => ({
        token: s.token,
        user: s.user,
        credits: s.credits,
        isLoggedIn: s.isLoggedIn,
      }),
    }
  )
)

