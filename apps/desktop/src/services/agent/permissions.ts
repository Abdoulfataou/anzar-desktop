/**
 * Politique de permission des outils de l'agent.
 * Module pur, partagé par le hook de chat et testable indépendamment.
 */

export type PermissionMode = 'ask' | 'auto' | 'plan' | 'full';

/** Outils qui écrivent sur le disque. */
export const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'remember', 'export_animation']);
/** Outils qui exécutent du code ou lancent des processus. */
export const COMMAND_TOOLS = new Set(['run_command', 'spawn_subagents', 'start_dev_server']);
/** Outils sûrs, seuls autorisés en mode plan. */
export const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_dir', 'search_files', 'get_diagnostics', 'explore',
  'dev_server_logs', 'web_search', 'read_url', 'capture_page',
]);

export function needsApproval(mode: PermissionMode, tool: string): boolean {
  if (mode === 'ask') return EDIT_TOOLS.has(tool) || COMMAND_TOOLS.has(tool);
  if (mode === 'auto') return COMMAND_TOOLS.has(tool);
  return false;
}
