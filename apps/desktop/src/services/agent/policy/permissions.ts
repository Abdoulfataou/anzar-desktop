/**
 * Politique de permission des outils de l'agent.
 * Module pur, partagé par le hook de chat et testable indépendamment.
 */

export type PermissionMode = 'ask' | 'auto' | 'plan' | 'full';

/** Outils qui écrivent sur le disque. */
export const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'apply_patch', 'delete_file', 'remember', 'export_animation']);
/** Outils qui exécutent du code ou lancent des processus. */
export const COMMAND_TOOLS = new Set(['run_command', 'bash', 'spawn_subagents', 'spawn_agent', 'send_message', 'start_dev_server']);
/** Outils sûrs, seuls autorisés en mode plan. */
export const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_dir', 'glob', 'search_files', 'get_diagnostics', 'explore',
  'dev_server_logs', 'web_search', 'read_url', 'capture_page', 'job_output', 'list_agents', 'wait_agent',
]);

export function needsApproval(mode: PermissionMode, tool: string): boolean {
  // `ask` : chaque écriture et chaque commande. `auto` : aucune demande générique —
  // seuls les risques (installation, programme inconnu, git, contenu externe) et les
  // connecteurs « toujours demander » passent par une carte. `full` : rien.
  if (mode === 'ask') return EDIT_TOOLS.has(tool) || COMMAND_TOOLS.has(tool);
  return false;
}

/**
 * Choix unique de l'utilisateur : le mode d'accord et l'isolation des commandes
 * ensemble. « Accès complet » est le `danger-full-access` de Harness : il retire
 * l'isolation système, après un avertissement unique accepté.
 */
export type PermissionChoice = PermissionMode;

/** Ce que le sélecteur doit afficher pour l'état courant. */
export function permissionChoiceOf(mode: PermissionMode, _sandbox: boolean): PermissionChoice {
  return mode;
}

/** Mode d'accord correspondant au choix. */
export function modeOfChoice(choice: PermissionChoice): PermissionMode {
  return choice;
}

/** Le choix garde-t-il l'isolation des commandes ? Seul « Accès complet » la retire. */
export function choiceKeepsSandbox(choice: PermissionChoice): boolean {
  return choice !== 'full';
}
