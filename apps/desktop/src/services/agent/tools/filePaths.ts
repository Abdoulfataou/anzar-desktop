import { patchTouchedPaths } from './patchTool';

/** Chemins écrits par un outil, pour le suivi des conflits entre agents. */
export function writePathsForTool(name: string, args: Record<string, any>): string[] {
  if (name === 'write_file' || name === 'edit_file' || name === 'delete_file') {
    const path = args.path || args.file_path;
    return path ? [String(path)] : [];
  }
  if (name === 'apply_patch' && typeof args.patch === 'string') {
    try { return patchTouchedPaths(args.patch); } catch { return []; }
  }
  return [];
}

/** Chemin lu par un outil de lecture. */
export function readPathForTool(name: string, args: Record<string, any>): string | undefined {
  if (name !== 'read_file') return undefined;
  const path = args.path || args.file_path;
  return path ? String(path) : undefined;
}
