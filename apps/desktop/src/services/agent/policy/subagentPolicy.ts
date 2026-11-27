/** Politique des outils accessibles aux sous-agents. */
import type { PermissionMode } from './permissions';
import type { Capability } from '../profiles';

/**
 * Outils jamais exposés à un sous-agent : la récursion (un sous-agent ne délègue pas) et la
 * mémoire du projet (ANZAR.md), que l'agent principal tient seul pour éviter les doublons.
 */
export const SUBAGENT_EXCLUDED_TOOLS = new Set([
  'remember',
  'spawn_agent',
  'send_message',
  'stop_agent',
  'wait_agent',
  'list_agents',
]);

/**
 * Outils lourds (export vidéo) réservés aux rôles qui les déclarent dans leur profil :
 * un sous-agent « dev » n'exporte pas de vidéo, le motion designer, si.
 */
export const PROFILE_ONLY_TOOLS = new Set(['export_animation']);

/** `task_done` termine le sous-agent : toujours autorisé, même hors profil. */
const ALWAYS_ALLOWED = new Set(['task_done']);

/** Outils retirés par capacité refusée. Une capacité inconnue ne retire rien (validation). */
export const CAPABILITY_TOOLS: Record<Capability, readonly string[]> = {
  'fs.write': ['write_file', 'edit_file', 'apply_patch', 'delete_file', 'vendor_lib', 'export_animation'],
  'shell.exec': ['run_command', 'bash', 'powershell', 'job_output', 'job_kill', 'start_dev_server', 'stop_dev_server', 'install_tool', 'vendor_lib'],
  'network': ['web_search', 'read_url', 'page_action', 'check_page', 'capture_page'],
};

export interface SubagentPolicyInput {
  allToolNames: Iterable<string>;
  mode?: PermissionMode;
  readOnlyTools: ReadonlySet<string>;
  /**
   * Outils déclarés par le profil du rôle (`tools` du frontmatter). Vide ou absent :
   * la politique du mode s'applique seule. Sinon, le profil restreint encore la liste.
   */
  profileTools?: string[];
  /** Capacités refusées par le manifeste (`deny`). */
  deny?: readonly string[];
}

/**
 * Outils d'un sous-agent = tous les outils du parent, moins la récursion ; les outils lourds
 * seulement si le profil du rôle les déclare. Comme Harness, l'enfant hérite de la frontière
 * d'écriture du parent : il n'est pas mis en lecture seule.
 */
export function subagentAllowedTools(input: SubagentPolicyInput): Set<string> {
  const { allToolNames, profileTools } = input;
  const declaredByProfile = new Set(profileTools ?? []);
  const base = new Set([...allToolNames].filter((name) =>
    !SUBAGENT_EXCLUDED_TOOLS.has(name) && (!PROFILE_ONLY_TOOLS.has(name) || declaredByProfile.has(name))));

  const denied = new Set(
    (input.deny ?? []).flatMap((c) => CAPABILITY_TOOLS[c as Capability] ?? []),
  );
  const afterDeny = [...base].filter((name) => !denied.has(name) || ALWAYS_ALLOWED.has(name));
  if (!profileTools?.length) return new Set(afterDeny);
  const declared = new Set(profileTools);
  return new Set(afterDeny.filter((name) => declared.has(name) || ALWAYS_ALLOWED.has(name)));
}
