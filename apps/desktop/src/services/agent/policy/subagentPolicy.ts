/** Politique des outils accessibles aux sous-agents. */
import type { PermissionMode } from './permissions';

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

export interface SubagentPolicyInput {
  allToolNames: Iterable<string>;
  mode?: PermissionMode;
  readOnlyTools: ReadonlySet<string>;
  /**
   * Outils déclarés par le profil du rôle (`tools` du frontmatter). Vide ou absent :
   * la politique du mode s'applique seule. Sinon, le profil restreint encore la liste.
   */
  profileTools?: string[];
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

  if (!profileTools?.length) return base;
  const declared = new Set(profileTools);
  return new Set([...base].filter((name) => declared.has(name) || ALWAYS_ALLOWED.has(name)));
}
