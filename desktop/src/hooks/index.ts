/**
 * Hooks Index
 * Central export point for all custom hooks
 */

// Network and offline hooks
export { useOffline } from './useOffline';
export type { UseOfflineReturn } from './useOffline';

// AI service is accessed via aiService from @/services

// Agent session — pilotage du moteur agentique (Phase 1)
export { useAgentSession } from './useAgentSession';
export type { AgentSessionState, AgentSessionActions, StartAgentOptions, AgentLogEntry } from './useAgentSession';
