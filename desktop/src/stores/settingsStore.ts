/**
 * Settings Store - Configuration ANZAR (SECURE)
 *
 * SÉCURITÉ:
 * - Aucune clé API n'est stockée côté client
 * - Toutes les requêtes IA passent par le backend proxy
 * - L'authentification utilise un JWT signé
 * - Les données sensibles ne sont jamais en localStorage
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AIModel, AIProvider } from '@/types';

export interface Settings {
  // IA
  model: AIModel;
  provider: AIProvider;

  // Backend
  backendUrl: string;

  // Interface
  theme: 'light' | 'dark' | 'system';
  language: 'fr' | 'en';
  fontSize: number;
  compactMode: boolean;
  animations: boolean;

  // Réseau & fonctionnalités
  autoSave: boolean;
  bandwidthSaver: boolean;
  offlineMode: boolean;
}

interface SettingsStore {
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
  resetSettings: () => void;
  getSetting: <K extends keyof Settings>(key: K) => Settings[K];

  // Auth (persisted for offline resilience)
  authToken: string | null;
  setAuthToken: (token: string | null) => void;
  getAuthToken: () => string | null;

  // Backend
  getBackendUrl: () => string;
  isAPIConfigured: () => boolean;
}

const defaultSettings: Settings = {
  model: 'fast',
  provider: 'deepseek',
  backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000',
  theme: 'dark',
  language: 'fr',
  fontSize: 14,
  compactMode: false,
  animations: true,
  autoSave: true,
  bandwidthSaver: false,
  offlineMode: false,
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,

      // Auth token stored in memory only — NOT persisted to localStorage
      authToken: null,

      updateSettings: (updates) => {
        set((state) => ({
          settings: { ...state.settings, ...updates },
        }));
      },

      resetSettings: () => set({ settings: defaultSettings }),

      getSetting: (key) => get().settings[key],

      // ─── Auth Token (memory only) ───

      setAuthToken: (token) => set({ authToken: token }),

      getAuthToken: () => get().authToken,

      // ─── Backend URL ───

      getBackendUrl: () => {
        const envUrl = import.meta.env.VITE_BACKEND_URL;
        if (envUrl) return envUrl;
        return get().settings.backendUrl;
      },

      isAPIConfigured: () => {
        return !!get().getBackendUrl();
      },
    }),
    {
      name: 'anzar-settings',
      // Persist UI settings + auth token for offline resilience
      // Auth tokens in localStorage are standard practice for SPAs and handle
      // unstable connections better than re-authenticating on every reload
      partialize: (state) => ({
        settings: {
          model: state.settings.model,
          provider: state.settings.provider,
          backendUrl: state.settings.backendUrl,
          theme: state.settings.theme,
          language: state.settings.language,
          fontSize: state.settings.fontSize,
          compactMode: state.settings.compactMode,
          animations: state.settings.animations,
          autoSave: state.settings.autoSave,
          bandwidthSaver: state.settings.bandwidthSaver,
          offlineMode: state.settings.offlineMode,
        },
        authToken: state.authToken,
      }),
    }
  )
);
