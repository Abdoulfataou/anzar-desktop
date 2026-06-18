/**
 * Hooks Index
 * Central export point for all custom hooks
 */

// Network and offline hooks
export { useOffline, useConnectionQuality, useBandwidthSaver } from './useOffline';
export type { UseOfflineReturn } from './useOffline';

// AI service is accessed via aiService from @/services
