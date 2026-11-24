/**
 * Politique de permission des outils de l'agent.
 * Module pur, partagé par le hook de chat et testable indépendamment.
 */

export type PermissionMode = 'ask' | 'auto' | 'plan' | 'full';

/** Outils qui écrivent sur le disque. */
export const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'remember', 'export_animation']);
/** Outils qui exécutent du code ou lancent des processus. */
export const COMMAND_TOOLS = new Set(['run_command', 'bash', 'spawn_subagents', 'start_dev_server']);
/** Outils sûrs, seuls autorisés en mode plan. */
export const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_dir', 'search_files', 'get_diagnostics', 'explore',
  'dev_server_logs', 'web_search', 'read_url', 'capture_page', 'job_output',
]);

export function needsApproval(mode: PermissionMode, tool: string): boolean {
  // `ask` : chaque écriture et chaque commande. `auto` : aucune demande générique —
  // seuls les risques (installation, programme inconnu, git, contenu externe) et les
  // connecteurs « toujours demander » passent par une carte. `full` : rien.
  if (mode === 'ask') return EDIT_TOOLS.has(tool) || COMMAND_TOOLS.has(tool);
  return false;
}
