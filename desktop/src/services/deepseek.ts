/**
 * Legacy compatibility layer
 * Re-exports from the new multi-provider AI service
 */
export { aiService, aiService as deepseekService } from './ai';
export type { default as AIService } from './ai';
