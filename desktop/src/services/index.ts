/**
 * Services Index
 * Central export point for all services
 */

// AI Router — point d'entrée principal (routage intelligent)
export { aiRouter } from './router';
export type { default as AIRouter } from './router';

// AI service bas niveau (accès direct, sans routage)
export { aiService } from './ai';
export type { default as AIService } from './ai';

// Legacy aliases (backward compat)
export { aiService as deepseekService } from './ai';

// Storage service with Tauri fallback
export { storageService, StorageService } from './storage';

// Multi-agent orchestration service
export { agentService, AgentService } from './agents';

// Terminal service — exécution de commandes, dépendances, processus
export { terminalService } from './terminal';

// Diagnostic service — détection d'erreurs et résolution IA
export { diagnosticService } from './diagnostic';
