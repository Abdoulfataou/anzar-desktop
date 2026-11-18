/**
 * toolsRuntime — Outils binaires curés d'ANZAR (même modèle que Node géré).
 *
 * Catalogue vérifié (URL + empreinte SHA-256 épinglées côté Rust) :
 * ffmpeg (vidéo rapide), ripgrep (recherche rapide). Téléchargés une fois,
 * rangés dans les fichiers de l'app, jamais installés sur le système.
 */
import { invoke } from '@tauri-apps/api/tauri';
import { isTauri } from '@/lib/utils';

export interface ToolInfo {
  name: string;
  label: string;
  installed: boolean;
  version: string | null;
  size_mb: number;
  available: boolean;
}

export async function toolsCatalog(): Promise<ToolInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<ToolInfo[]>('tools_catalog');
  } catch {
    return [];
  }
}

export async function toolInstall(name: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (!isTauri()) return { ok: false, error: "Installation disponible uniquement dans l'app desktop." };
  try {
    const version = await invoke<string>('tool_install', { name });
    return { ok: true, version };
  } catch (e: any) {
    return { ok: false, error: String(e) };
  }
}

/** Accord de l'utilisateur avant tout téléchargement (même UX que Node). */
export async function confirmToolInstall(info: ToolInfo): Promise<boolean> {
  try {
    const { ask } = await import('@tauri-apps/api/dialog');
    return await ask(
      `ANZAR peut installer ${info.label}.\n\n`
      + `Téléchargement depuis la source officielle (${info.size_mb} Mo, une seule fois), empreinte vérifiée, `
      + `rangé dans les fichiers d'ANZAR — rien d'installé sur le système, aucun mot de passe.\n\nTélécharger maintenant ?`,
      { title: `Installer ${info.name}`, type: 'info' },
    );
  } catch {
    return false;
  }
}
