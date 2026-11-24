/**
 * Présentation des appels d'outils dans le chat : chemin cliquable, résumé
 * d'arguments, delta de lignes. Fonctions pures, testables sans Tauri.
 */

const PATCH_SECTION_RE = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm;

/** Chemins visés par les sections d'un patch (sans validation : affichage seulement). */
function patchSectionPaths(patch: unknown): string[] {
  if (typeof patch !== 'string') return [];
  const paths = new Set<string>();
  for (const match of patch.matchAll(PATCH_SECTION_RE)) {
    const path = match[1].trim();
    if (path) paths.add(path);
  }
  return [...paths];
}

/** Chemin cliquable d'un outil (ouvre l'éditeur ou la visionneuse média). */
export function toolFilePath(name: string, args: Record<string, any>): string | undefined {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return args.path || args.file_path || undefined;
    case 'apply_patch': {
      const paths = patchSectionPaths(args.patch);
      return paths.length === 1 ? paths[0] : undefined;
    }
    case 'export_animation': {
      if (args.output) return String(args.output);
      const ext = args.format === 'png' ? 'png' : args.format === 'gif' ? 'gif' : 'mp4';
      return `export/animation.${ext}`;
    }
    default:
      return undefined;
  }
}

export function summarizeArgs(name: string, args: Record<string, any>): string {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'delete_file':
      return args.path || args.file_path || '';
    case 'apply_patch': {
      const count = patchSectionPaths(args.patch).length;
      return count ? `${count} fichier${count > 1 ? 's' : ''}` : 'patch';
    }
    case 'glob':
      return args.pattern || '';
    case 'list_dir':
      return args.path || '.';
    case 'search_files':
      return args.query || args.pattern || '';
    case 'web_search':
      return args.query || '';
    case 'read_url':
      return args.url || '';
    case 'run_command':
    case 'bash':
      return args.command || '';
    case 'job_output':
    case 'job_kill':
      return args.job_id || args.id || '';
    case 'start_dev_server':
      return args.command || 'commande du projet';
    case 'check_page':
      return args.url || 'serveur du projet';
    case 'export_animation':
      return `${args.file ? `${args.file} → ` : ''}${String(args.output || (args.format === 'png' ? 'export/visuel.png' : `export/animation.${args.format === 'gif' ? 'gif' : 'mp4'}`))}`;
    case 'capture_page':
      return `${args.file || args.url || 'page ouverte'}${Array.isArray(args.frames) && args.frames.length ? ` · ${args.frames.length} instants` : ''}`;
    case 'page_action':
      return [args.action, args.element || args.target, args.text].filter(Boolean).join(' · ');
    case 'explore':
      return (args.questions || []).length ? `${(args.questions || []).length} question${(args.questions || []).length > 1 ? 's' : ''} en parallèle` : '';
    case 'spawn_subagents':
      return (args.tasks || []).length ? `${(args.tasks || []).length} sous-tâches` : '';
    case 'spawn_agent':
      return String(args.name || args.task || '').slice(0, 100);
    case 'send_message':
    case 'wait_agent':
    case 'stop_agent':
      return args.agent || args.name || '';
    case 'list_agents':
      return '';
    case 'remember':
      return String(args.content || '').slice(0, 80);
    case 'ask_user':
      return (args.questions || []).map((q: any) => q?.question).filter(Boolean).join(' · ').slice(0, 140);
    case 'load_skill':
      return args.file ? `${args.name || ''} · ${args.file}` : String(args.name || '');
    case 'task_done':
      return String(args.summary || '').slice(0, 100);
    default:
      return JSON.stringify(args).slice(0, 100);
  }
}

/**
 * Delta de lignes affiché à côté d'un outil d'écriture.
 * Sans replace_all, edit_file ne fait qu'un remplacement : on affiche le minimum.
 */
export function toolDelta(
  name: string,
  args: Record<string, any>,
  isError: boolean | undefined,
): [number, number] | undefined {
  if (isError) return undefined;
  if (name === 'write_file' && typeof args.content === 'string') {
    return [args.content.split('\n').length, 0];
  }
  if (name === 'edit_file') {
    const oldLines = typeof args.old_text === 'string' ? args.old_text.split('\n').length : 0;
    const newLines = typeof args.new_text === 'string' ? args.new_text.split('\n').length : 0;
    return [newLines, oldLines];
  }
  return undefined;
}
