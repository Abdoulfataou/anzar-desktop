/**
 * Limites et helpers communs : chemins confinés au projet, troncature, fichiers ignorés.
 */
import { invoke } from '@tauri-apps/api/core';
import { isPathWithin } from '@/lib/pathGuard';

export const MAX_FILE_READ_CHARS = 32_000;      // ~8k tokens par lecture (relire par tranches avec offset/limit)
export const MAX_COMMAND_OUTPUT_CHARS = 12_000;
export const MAX_SEARCH_RESULTS = 40;
export const MAX_LIST_ENTRIES = 300;
export const COMMAND_TIMEOUT_MS = 120_000;


// ============================================================================
// HELPERS
// ============================================================================

/**
 * Joint projectRoot + chemin relatif en bloquant les évasions.
 * Le chemin réel est canonicalisé (symlinks) et doit rester sous le projet.
 */
export async function resolvePath(root: string, relPath: string | undefined): Promise<string> {
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const rel = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (rel.split('/').some((seg) => seg === '..')) {
    throw new Error(`Chemin non autorisé (sortie du projet): ${relPath}`);
  }
  const abs = !rel || rel === '.' ? cleanRoot : `${cleanRoot}/${rel}`;
  const realRoot = await invoke<string>('fs_realpath', { path: cleanRoot }).catch(() => cleanRoot);
  let realAbs: string;
  try {
    realAbs = await invoke<string>('fs_realpath', { path: abs });
  } catch {
    // Fichier/dossier à créer : canonicalise le plus proche ancêtre existant.
    let dir = abs;
    const suffix: string[] = [];
    for (;;) {
      try {
        const realDir = await invoke<string>('fs_realpath', { path: dir });
        realAbs = suffix.reverse().reduce((p, s) => `${p}/${s}`, realDir);
        break;
      } catch {
        const idx = dir.lastIndexOf('/');
        if (idx <= 0) throw new Error(`Dossier de travail introuvable: ${relPath}`);
        suffix.push(dir.slice(idx + 1));
        dir = dir.slice(0, idx);
      }
    }
  }
  if (!isPathWithin(realAbs, realRoot)) {
    throw new Error(`Chemin réel hors du projet (lien symbolique refusé): ${relPath}`);
  }
  return realAbs;
}

/** Interdit les écritures dans les répertoires qui contrôlent Git (hooks/config). */
export function isProtectedWritePath(relPath: string): boolean {
  const segments = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/').map((s) => s.toLowerCase());
  return segments.includes('.git') || segments.includes('.husky');
}

export async function resolveWritePath(root: string, relPath: string | undefined): Promise<string> {
  if (isProtectedWritePath(String(relPath || ''))) {
    throw new Error(`Écriture interdite dans un dossier de hooks Git: ${relPath}`);
  }
  return resolvePath(root, relPath);
}

export function truncate(text: string, max: number, label = 'sortie'): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [${label} tronquée: ${text.length - max} caractères restants]`;
}

export function isTextFile(name: string): boolean {
  return !/\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tar|rar|7z|exe|dll|so|dylib|woff2?|ttf|eot|mp[34]|avi|mov|bin|lock)$/i.test(name);
}

export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', '__pycache__', '.venv', 'venv', 'coverage']);
