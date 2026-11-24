/**
 * Classification des outils pour l'exécution en parallèle.
 *
 * Adapté de `isConcurrencySafe` de DeepSeek Harness (MIT) : seuls les outils sans
 * effet de bord peuvent partager un lot avec un autre. Tout le reste forme une
 * barrière et s'exécute seul, dans l'ordre du modèle.
 */
export const MAX_PARALLEL_TOOL_CALLS = 10;

/**
 * Outils sûrs à exécuter ensemble : lecture, recherche, diagnostic, web en lecture,
 * attente d'un travail déjà lancé. Aucun ne modifie le projet ni l'état du tour.
 */
const CONCURRENCY_SAFE = new Set([
  'read_file',
  'list_dir',
  'glob',
  'search_files',
  'get_diagnostics',
  'web_search',
  'read_url',
  'job_output',
]);

/** L'outil peut-il être exécuté en même temps qu'un autre outil sûr ? */
export function isConcurrencySafe(toolName: string): boolean {
  return CONCURRENCY_SAFE.has(toolName);
}
