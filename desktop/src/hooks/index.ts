/**
 * Hooks Index
 * Central export point for all custom hooks
 */

// Theme hook
export { useTheme } from './useTheme';
export type { UseThemeReturn } from './useTheme';

// Network and offline hooks
export { useOffline, useConnectionQuality, useBandwidthSaver } from './useOffline';
export type { UseOfflineReturn } from './useOffline';

// AI service is accessed via aiService from @/services
