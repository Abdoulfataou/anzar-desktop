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

// Storage service with Tauri fallback
export { storageService, StorageService } from './infra/storage';

// Terminal service — exécution de commandes, dépendances, processus
export { terminalService } from './terminal';
