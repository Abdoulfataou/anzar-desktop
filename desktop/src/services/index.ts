/**
 * Services Index
 * Central export point for all services
 */

// AI Router — point d'entrée principal (routage intelligent)
export { aiRouter } from './router';
export type { default as AIRouter } from './router';

// AI service bas niveau (accès direct, sans routage)
export { aiService } from './ai/ai';
export type { default as AIService } from './ai/ai';

// Legacy aliases (backward compat)
export { aiService as deepseekService } from './ai/ai';

// Storage service with Tauri fallback
export { storageService, StorageService } from './infra/storage';

// Multi-agent orchestration service
export { agentService, AgentService } from './ai/agents';

// Terminal service — exécution de commandes, dépendances, processus
export { terminalService } from './terminal';

// Diagnostic service — détection d'erreurs et résolution IA
export { diagnosticService } from './infra/diagnostic';
