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

  // Vault (clé locale pour chiffrer le token dans Stronghold)
  // NOTE: ceci n'est pas le token. C'est une clé appareil (persistée) utilisée
  // comme "password" Stronghold. Elle protège le token au repos (fichier vault).
  deviceVaultKey: string;

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

  // Grand public: options avancées cachées
  developerMode: boolean;

  // Allowlist minimale des hôtes externes autorisés à s'ouvrir sans warning
  // (le backend est auto-ajouté).
  externalAllowlistHosts: string[];

  // Cowork/Terminal: mode d'exécution des commandes proposées
  commandExecutionMode: 'manual' | 'always_ask' | 'auto_run';

  // Après application de changements (Preview/Apply), lancer automatiquement "Vérifier le projet"
  autoVerifyAfterApply: boolean;

  // Nettoyer automatiquement les commandes terminées (Command Cards)
  autoCleanFinishedCommands: boolean;
}

interface SettingsStore {
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
  resetSettings: () => void;
  getSetting: <K extends keyof Settings>(key: K) => Settings[K];

  // Auth (mémoire uniquement — jamais persisté)
  authToken: string | null;
  setAuthToken: (token: string | null) => void;
  getAuthToken: () => string | null;

  // Backend
  getBackendUrl: () => string;
  isAPIConfigured: () => boolean;

  // Vault
  getDeviceVaultKey: () => string;

  // Grand public: liens externes
  getExternalAllowlistHosts: () => string[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function generateDeviceVaultKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToBase64(bytes)
}

const defaultSettings: Settings = {
  model: 'fast',
  provider: 'deepseek',
  backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000',
  deviceVaultKey: generateDeviceVaultKey(),
  theme: 'dark',
  language: 'fr',
  fontSize: 14,
  compactMode: false,
  animations: true,
  autoSave: true,
  bandwidthSaver: false,
  offlineMode: false,
  developerMode: false,
  externalAllowlistHosts: [
    'anzar.ai',
    'www.anzar.ai',
  ],
  commandExecutionMode: 'manual',
  autoVerifyAfterApply: true,
  autoCleanFinishedCommands: true,
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
        // Single source of truth = settings.backendUrl (modifiable in UI)
        const configured = (get().settings.backendUrl || '').trim();
        if (configured) return configured;

        // Fallback only
        const envUrl = (import.meta.env.VITE_BACKEND_URL || '').trim();
        return envUrl || 'http://localhost:8000';
      },

      isAPIConfigured: () => {
        return !!get().getBackendUrl();
      },

      // ─── Vault key ───
      getDeviceVaultKey: () => {
        const current = (get().settings.deviceVaultKey || '').trim()
        if (current) return current
        const next = generateDeviceVaultKey()
        set((state) => ({
          settings: { ...state.settings, deviceVaultKey: next },
        }))
        return next
      },

      // ─── External allowlist ───
      getExternalAllowlistHosts: () => {
        return (get().settings.externalAllowlistHosts || []).filter(Boolean)
      },
    }),
    {
      name: 'anzar-settings',
      // Persist UI settings only (no auth token).
      // Tokens ne doivent pas être stockés en clair dans localStorage.
      partialize: (state) => ({
        settings: {
          model: state.settings.model,
          provider: state.settings.provider,
          backendUrl: state.settings.backendUrl,
          deviceVaultKey: state.settings.deviceVaultKey,
          theme: state.settings.theme,
          language: state.settings.language,
          fontSize: state.settings.fontSize,
          compactMode: state.settings.compactMode,
          animations: state.settings.animations,
          autoSave: state.settings.autoSave,
          bandwidthSaver: state.settings.bandwidthSaver,
          offlineMode: state.settings.offlineMode,
          developerMode: state.settings.developerMode,
          externalAllowlistHosts: state.settings.externalAllowlistHosts,
          commandExecutionMode: state.settings.commandExecutionMode,
          autoVerifyAfterApply: state.settings.autoVerifyAfterApply,
          autoCleanFinishedCommands: state.settings.autoCleanFinishedCommands,
        },
      }),
    }
  )
);
