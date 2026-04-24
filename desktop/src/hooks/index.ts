/**
 * Hooks Index
 * Central export point for all custom hooks
 */

// Chat and messaging hooks
export { useChat, useChatInput, useMessageActions } from './useChat';
export type { UseChatReturn } from './useChat';

// Theme hook
export { useTheme } from './useTheme';
export type { UseThemeReturn } from './useTheme';

// Network and offline hooks
export { useOffline, useConnectionQuality, useBandwidthSaver } from './useOffline';
export type { UseOfflineReturn } from './useOffline';

// AI service is accessed via aiService from @/services
