/**
 * Exécution générique d'un outil approuvé : web, connecteur MCP ou outil local.
 * L'approbation, les outils spéciaux (ask_user, load_skill, propose_plan) et les
 * snapshots restent dans l'adaptateur de chat.
 */
import type { ToolCall } from '@/types';
import { executeToolCall, type ToolExecutionContext } from './index';
import { runAgentSession } from '../engine/agentLoop';
import { executeWebTool, WEB_TOOL_NAMES } from './webTools';
import { callMcpTool, isMcpTool } from '@/services/mcp/manager';
import { PERSONAL_SPACE_TOOLS } from '@/services/workspace/personalSpace';

export interface GenericToolResult {
  output: string;
  isError?: boolean;
  isDone?: boolean;
  costFCFA?: number;
  images?: { label: string; dataUrl: string }[];
  media?: { path: string; kind: 'video' | 'image' };
}

export interface GenericToolOptions {
  agentRoot: string | null;
  workspacePath: string | null;
  signal?: AbortSignal;
  onFileChanged?: (relativePath: string, action: 'create' | 'edit' | 'delete') => void;
  onSubagentProgress?: ToolExecutionContext['onSubagentProgress'];
  permissionMode?: ToolExecutionContext['permissionMode'];
}

export async function executeGenericTool(
  call: ToolCall,
  args: Record<string, any>,
  options: GenericToolOptions,
): Promise<GenericToolResult> {
  if (WEB_TOOL_NAMES.has(call.function.name)) {
    return executeWebTool(call.function.name, args, options.signal);
  }

  if (isMcpTool(call.function.name)) {
    return callMcpTool(call.function.name, args, options.signal);
  }

  if (options.agentRoot && (options.workspacePath || PERSONAL_SPACE_TOOLS.has(call.function.name))) {
    return executeToolCall(call, {
      projectRoot: options.agentRoot,
      signal: options.signal,
      onFileChanged: (rel, _c, action) => {
        if (options.workspacePath) options.onFileChanged?.(rel, action);
      },
      onSubagentProgress: call.function.name === 'spawn_subagents' ? options.onSubagentProgress : undefined,
      permissionMode: options.permissionMode,
      runSubagent: runAgentSession,
    });
  }

  return { output: 'Aucun dossier de travail ouvert.', isError: true };
}
