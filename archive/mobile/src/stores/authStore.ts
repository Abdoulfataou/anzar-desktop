import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { zustandStorage } from './storage'

export type MobileUser = {
  email: string
  name?: string
}

type AuthState = {
  token: string | null
  user: MobileUser | null
  isLoggedIn: boolean
  setSession: (token: string, user: MobileUser) => void
  clearSession: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isLoggedIn: false,
      setSession: (token, user) => set({ token, user, isLoggedIn: true }),
      clearSession: () => set({ token: null, user: null, isLoggedIn: false }),
    }),
    {
      name: 'anzar-mobile-auth',
      storage: zustandStorage as any,
      partialize: (s) => ({ token: s.token, user: s.user, isLoggedIn: s.isLoggedIn }),
    }
  )
)

