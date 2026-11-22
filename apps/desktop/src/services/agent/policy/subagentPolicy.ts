/** Politique des outils accessibles aux sous-agents. */
import type { PermissionMode } from './permissions';
import type { Capability } from '../profiles';

/** Outils qui ne doivent jamais être exposés à un sous-agent :
 * spawn (récursion), commandes/processus et export vidéo (effets de bord lourds).
 */
export const SUBAGENT_EXCLUDED_TOOLS = new Set([
  'spawn_subagents',
  'run_command',
  'start_dev_server',
  'export_animation',
]);

/** `task_done` termine le sous-agent : toujours autorisé, même hors profil. */
const ALWAYS_ALLOWED = new Set(['task_done']);

/** Outils retirés par capacité refusée. Une capacité inconnue ne retire rien (validation). */
export const CAPABILITY_TOOLS: Record<Capability, readonly string[]> = {
  'fs.write': ['write_file', 'edit_file', 'delete_file'],
  'shell.exec': ['run_command', 'start_dev_server', 'stop_dev_server', 'install_tool', 'vendor_lib'],
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
 * Outils d'un sous-agent = politique du mode ∩ déclaration du profil.
 *
 * Hors Full : lecture seule. En Full : tout sauf les outils exclus (le parent garde la main
 * sur les commandes, l'export et la récursion). Un profil ne peut que **réduire** ce
 * périmètre, jamais l'élargir.
 */
export function subagentAllowedTools(input: SubagentPolicyInput): Set<string> {
  const { allToolNames, mode, readOnlyTools, profileTools } = input;
  const base = mode !== 'full'
    ? new Set([...readOnlyTools, 'load_skill', ...ALWAYS_ALLOWED])
    : new Set([...allToolNames].filter((name) => !SUBAGENT_EXCLUDED_TOOLS.has(name)));

  const denied = new Set(
    (input.deny ?? []).flatMap((c) => CAPABILITY_TOOLS[c as Capability] ?? []),
  );
  const afterDeny = [...base].filter((name) => !denied.has(name) || ALWAYS_ALLOWED.has(name));
  if (!profileTools?.length) return new Set(afterDeny);
  const declared = new Set(profileTools);
  return new Set(afterDeny.filter((name) => declared.has(name) || ALWAYS_ALLOWED.has(name)));
}
