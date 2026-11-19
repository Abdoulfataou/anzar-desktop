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

/**
 * Hors Full : lecture seule. En Full : tous les outils sauf les outils exclus
 * (le parent garde la main sur les commandes, l'export et la récursion).
 */
export function subagentAllowedTools(
  allToolNames: Iterable<string>,
  mode: PermissionMode | undefined,
  readOnlyTools: ReadonlySet<string>,
): Set<string> {
  if (mode !== 'full') return new Set([...readOnlyTools, 'task_done', 'load_skill']);
  return new Set([...allToolNames].filter((name) => !SUBAGENT_EXCLUDED_TOOLS.has(name)));
}
