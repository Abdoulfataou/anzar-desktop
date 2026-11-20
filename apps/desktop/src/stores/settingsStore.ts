/**
 * Settings Store - Configuration ANZAR (SECURE)
 *
 * SÉCURITÉ:
 * - Aucune clé API n'est stockée côté client
 * - Toutes les requêtes IA passent par le backend proxy
 * - L'authentification utilise un JWT signé
 * - Les données sensibles ne sont jamais en localStorage
 */
import { safeStorage } from '@/lib/safeStorage';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AIModel, AIProvider } from '@/types';

export interface Settings {
  // IA
  model: AIModel;
  provider: AIProvider;

  // Backend
  backendUrl: string;

  /**
   * @deprecated Ancienne clé du coffre Stronghold, autrefois persistée en
   * localStorage. Migrée vers `store/vault.key` au premier démarrage puis
   * effacée (voir services/infra/secureTokenStore.ts). Conservée dans le type
   * uniquement pour lire les installations existantes.
   */
  deviceVaultKey: string;

  /** L'agent peut chercher sur le web et lire des pages (Search / Fetch DeepSeek) */
  webTools?: boolean;

  /** Erreurs de code (TypeScript, Python) vérifiées après chaque fichier écrit par l'agent */
  codeDiagnostics?: boolean;

  /** Commandes de l'agent isolées par le système (macOS) : écriture limitée au projet */
  sandboxCommands?: boolean;

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

  // Grand public: liens externes
  getExternalAllowlistHosts: () => string[];
}

const defaultSettings: Settings = {
  model: 'auto', // ANZAR choisit pour chaque demande (services/ai/autoRouter.ts)
  provider: 'deepseek',
  backendUrl: import.meta.env.VITE_BACKEND_URL || 'https://anzar-api.issalanhub.com',
  // Vide : la clé du coffre vit désormais dans store/vault.key, hors localStorage.
  deviceVaultKey: '',
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
        let configured = (get().settings.backendUrl || '').trim();
        // L'ancien serveur Railway a été remplacé par le VPS : une adresse Railway
        // sauvegardée sur une installation existante est ignorée.
        if (/\.up\.railway\.app/i.test(configured)) configured = '';

        // If user explicitly set a non-default URL in settings, use it
        // But ignore stale localhost defaults — prefer env variable
        if (configured && !configured.includes('localhost')) {
          return configured;
        }

        // Env variable takes priority over localhost fallback
        const envUrl = (import.meta.env.VITE_BACKEND_URL || '').trim();
        if (envUrl) return envUrl;

        // Final fallback
        return configured || 'https://anzar-api.issalanhub.com';
      },

      isAPIConfigured: () => {
        return !!get().getBackendUrl();
      },

      // ─── External allowlist ───
      getExternalAllowlistHosts: () => {
        return (get().settings.externalAllowlistHosts || []).filter(Boolean)
      },
    }),
    {
      name: 'anzar-settings',
      storage: safeStorage,
      // Persist UI settings only (no auth token).
      // Tokens ne doivent pas être stockés en clair dans localStorage.
      partialize: (state) => ({
        settings: {
          model: state.settings.model,
          webTools: state.settings.webTools,
          codeDiagnostics: state.settings.codeDiagnostics,
          sandboxCommands: state.settings.sandboxCommands,
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
          developerMode: state.settings.developerMode,
          externalAllowlistHosts: state.settings.externalAllowlistHosts,
          commandExecutionMode: state.settings.commandExecutionMode,
          autoVerifyAfterApply: state.settings.autoVerifyAfterApply,
          autoCleanFinishedCommands: state.settings.autoCleanFinishedCommands,
        },
      }),
      // ANZAR est 100 % DeepSeek : un ancien réglage (Kimi, OpenRouter) revient à DeepSeek.
      merge: (persisted, current) => {
        const saved = (persisted as { settings?: Partial<Settings> } | undefined)?.settings ?? {}
        return { ...current, settings: { ...current.settings, ...saved, provider: 'deepseek' } }
      },
    }
  )
);
