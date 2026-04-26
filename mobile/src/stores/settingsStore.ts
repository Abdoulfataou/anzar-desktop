import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { zustandStorage } from './storage'

type SettingsState = {
  backendUrl: string
  setBackendUrl: (url: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      backendUrl: 'http://localhost:8000',
      setBackendUrl: (url) => set({ backendUrl: url }),
    }),
    {
      name: 'anzar-mobile-settings',
      storage: zustandStorage as any,
    }
  )
)

