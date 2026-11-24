/**
 * Registre des outils de l'agent ANZAR : définitions envoyées au modèle et exécuteurs locaux.
 *
 * Chaque famille d'outils vit dans son propre fichier (fsTools, shellTools, browserTools,
 * mediaTools, metaTools) ; spawn_subagents est dans services/agent/subagents/spawn.ts.
 */
import type { ToolCall } from '@/types';
import type { ToolExecutionContext, ToolResult } from './types';
import { execCapturePage, execCheckPage, execDevServerLogs, execPageAction, execStartDevServer, execStopDevServer } from './browserTools';
import { execDeleteFile, execEditFile, execGetDiagnostics, execListDir, execReadFile, execSearchFiles, execWriteFile } from './fsTools';
import { execGlob } from './globTool';
import { execApplyPatch } from './patchTool';
import { execExportAnimation, execVendorLib } from './mediaTools';
import { execExplore, execRemember, execTaskDone } from './metaTools';
import { execInstallTool, execRunCommand } from './shellTools';
import { execBash, execJobKill, execJobOutput } from './bashTool';
import { execSpawnSubagents } from '../subagents/spawn';
import { execListAgents, execSendMessage, execSpawnAgent, execStopAgent, execWaitAgent } from '../subagents/liveTools';

export type { SubagentProgress, ToolExecutionContext, ToolResult } from './types';
export { AGENT_TOOLS, BASH_TOOLS } from './definitions';
export { resolvePath, isProtectedWritePath } from './shared';
export { compileSearchPattern } from './fsTools';
export { execGlob, globToRegExp, globToRegExpSource } from './globTool';
export { applyHunks, execApplyPatch, isProtectedPatchPath, parsePatch, patchTouchedPaths, validatePatchPath } from './patchTool';
export { precheckCommand } from './shellTools';

type ToolExecutor = (args: any, ctx: ToolExecutionContext) => Promise<ToolResult>;

const EXECUTORS: Record<string, ToolExecutor> = {
  install_tool: execInstallTool,
  vendor_lib: execVendorLib,
  read_file: execReadFile,
  write_file: execWriteFile,
  edit_file: execEditFile,
  apply_patch: execApplyPatch,
  delete_file: execDeleteFile,
  list_dir: execListDir,
  glob: execGlob,
  search_files: execSearchFiles,
  get_diagnostics: execGetDiagnostics,
  explore: execExplore,
  start_dev_server: execStartDevServer,
  dev_server_logs: execDevServerLogs,
  stop_dev_server: execStopDevServer,
  check_page: execCheckPage,
  capture_page: execCapturePage,
  export_animation: execExportAnimation,
  page_action: execPageAction,
  run_command: execRunCommand,
  bash: execBash,
  job_output: execJobOutput,
  job_kill: execJobKill,
  spawn_subagents: execSpawnSubagents,
  spawn_agent: execSpawnAgent,
  send_message: execSendMessage,
  wait_agent: execWaitAgent,
  stop_agent: execStopAgent,
  list_agents: execListAgents,
  remember: execRemember,
  task_done: execTaskDone,
};

/**
 * Exécute un ToolCall du modèle et renvoie le résultat à réinjecter.
 * Ne throw jamais : toute erreur devient un ToolResult isError que
 * l'agent peut lire et corriger.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  ctx: ToolExecutionContext
): Promise<ToolResult> {
  const name = toolCall.function.name;
  const executor = EXECUTORS[name];
  if (!executor) {
    return { output: `Erreur: outil inconnu "${name}". Outils disponibles: ${Object.keys(EXECUTORS).join(', ')}`, isError: true };
  }

  let args: any = {};
  try {
    args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    return { output: `Erreur: arguments JSON invalides pour ${name}: ${toolCall.function.arguments?.slice(0, 300)}`, isError: true };
  }

  if (ctx.signal?.aborted) {
    return { output: 'Session annulée par l’utilisateur.', isError: true };
  }

  try {
    return await executor(args, ctx);
  } catch (e: any) {
    return { output: `Erreur ${name}: ${e?.message || String(e)}`, isError: true };
  }
}
