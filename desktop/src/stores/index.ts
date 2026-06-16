/**
 * Stores Index
 * Central export point for all Zustand stores
 */

// Chat store
export { useChatStore, useActiveConversation, useSortedConversations, useGenerationState } from './chatStore';

// Project store
export { useProjectStore, useActiveProject, useSortedProjects } from './projectStore';

// Settings store
export { useSettingsStore } from './settingsStore';

// Theme store
export { useThemeStore } from './themeStore';

// Account store (profil, crédits, abonnement)
export { useAccountStore } from './accountStore';

// Pending changes (A-mode approval queue)
export { useChangeStore } from './changeStore';

