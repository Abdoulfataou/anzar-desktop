/**
 * Agent — Moteur agentique tool-use d'ANZAR (Phase 1)
 */

export { runAgentSession } from './agentLoop';
export type {
  AgentEvent,
  AgentStopReason,
  AgentSessionOptions,
  AgentSessionResult,
} from './agentLoop';

export { AGENT_TOOLS, executeToolCall } from './agentTools';
export type { ToolExecutionContext, ToolResult } from './agentTools';

export { buildAgentSystemPrompt } from './agentPrompts';
export type { AgentPromptContext } from './agentPrompts';

export { runVerification, detectVerifyCommands } from './agentVerifier';
export type { VerifyReport, VerifyCommand, VerifyCommandResult } from './agentVerifier';

export { buildAgentContext, loadProjectMemory, appendProjectMemory, MEMORY_FILENAME } from './agentContext';
export type { AgentProjectContext } from './agentContext';
