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
import type { ExternalSource } from '../policy/untrusted';
import { PERSONAL_SPACE_TOOLS } from '@/services/workspace/personalSpace';
import { fileConflict, noteFileRead, noteFileWrite } from '../policy/fileConflicts';
import { readPathForTool, writePathsForTool } from './filePaths';

export interface GenericToolResult {
  output: string;
  isError?: boolean;
  failed?: boolean;
  isDone?: boolean;
  costFCFA?: number;
  images?: { label: string; dataUrl: string }[];
  media?: { path: string; kind: 'video' | 'image' };
  /** Contenu externe (web, connecteur) lu par cet outil. */
  external?: ExternalSource;
}

export interface GenericToolOptions {
  agentRoot: string | null;
  workspacePath: string | null;
  signal?: AbortSignal;
  onFileChanged?: (relativePath: string, action: 'create' | 'edit' | 'delete') => void;
  permissionMode?: ToolExecutionContext['permissionMode'];
  childBudget?: ToolExecutionContext['childBudget'];
  customAgents?: ToolExecutionContext['customAgents'];
  escalated?: boolean;
  convId?: string;
  agentId?: string;
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
    const paths = writePathsForTool(call.function.name, args);
    if (options.convId && options.agentId) {
      for (const path of paths) {
        const conflict = fileConflict(options.convId, options.agentId, path);
        if (conflict) return { output: conflict, isError: true };
      }
    }
    const result = await executeToolCall(call, {
      projectRoot: options.agentRoot,
      signal: options.signal,
      onFileChanged: (rel, _c, action) => {
        if (options.workspacePath) options.onFileChanged?.(rel, action);
      },
      permissionMode: options.permissionMode,
      escalated: options.escalated,
      convId: options.convId,
      agentId: options.agentId,
      runSubagent: runAgentSession,
      childBudget: options.childBudget,
      customAgents: options.customAgents,
    });
    if (!result.isError && options.convId && options.agentId) {
      const readPath = readPathForTool(call.function.name, args);
      if (readPath) noteFileRead(options.convId, options.agentId, readPath);
      for (const path of paths) noteFileWrite(options.convId, options.agentId, path);
    }
    return result;
  }

  return { output: 'Aucun dossier de travail ouvert.', isError: true };
}
