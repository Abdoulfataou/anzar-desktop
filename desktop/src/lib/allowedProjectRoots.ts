import { isTauri } from '@/lib/utils'
import { desktopDir, documentDir, downloadDir } from '@tauri-apps/api/path'

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Vérifie si un chemin projet est dans un des répertoires autorisés par tauri.conf.json:
 * - Documents/ANZAR/**
 * - Desktop/ANZAR/**
 * - Downloads/ANZAR/**
 *
 * But: réduire drastiquement la surface FS accessible à l’app.
 */
export async function isAllowedProjectRoot(selectedPath: string): Promise<boolean> {
  const selected = normalize(selectedPath)

  // En mode web (non-tauri), on n'applique pas ce contrôle
  if (!isTauri()) return true

  try {
    const [documents, desktop, downloads] = await Promise.all([
      documentDir?.(),
      desktopDir?.(),
      downloadDir?.(),
    ])

    const roots = [
      documents ? `${normalize(documents)}/ANZAR` : null,
      desktop ? `${normalize(desktop)}/ANZAR` : null,
      downloads ? `${normalize(downloads)}/ANZAR` : null,
    ].filter(Boolean) as string[]

    return roots.some((r) => selected.startsWith(r))
  } catch {
    // Si l’API path n’est pas dispo, fallback permissif pour éviter un blocage total.
    // (Mais en prod, ce code devrait toujours tourner en Tauri.)
    return true
  }
}

export async function showPathNotAllowedMessage(): Promise<void> {
  try {
    const { message } = await import('@tauri-apps/api/dialog')
    await message(
      "Pour des raisons de sécurité, ANZAR n’ouvre que les projets situés dans:\n\n- Documents/ANZAR\n- Bureau/ANZAR\n- Téléchargements/ANZAR\n\nDéplace ton projet dans un de ces dossiers puis réessaie.",
      { title: 'Dossier non autorisé', type: 'warning' }
    )
  } catch {
    alert(
      "Dossier non autorisé.\n\nDéplace ton projet dans Documents/ANZAR (ou Desktop/ANZAR / Downloads/ANZAR) puis réessaie."
    )
  }
}
