import { isTauri } from ‘@/lib/utils’
import { desktopDir, documentDir, downloadDir, homeDir } from ‘@tauri-apps/api/path’

function normalize(p: string): string {
  return p.replace(/\\/g, ‘/’).replace(/\/+$/, ‘’)
}

/**
 * Vérifie si un chemin projet est dans un des répertoires autorisés par tauri.conf.json:
 * - Documents/**
 * - Desktop/**
 * - Downloads/**
 * - $HOME/**
 *
 * L’utilisateur peut importer n’importe quel dossier depuis ces emplacements.
 */
export async function isAllowedProjectRoot(selectedPath: string): Promise<boolean> {
  const selected = normalize(selectedPath)

  // En mode web (non-tauri), on n’applique pas ce contrôle
  if (!isTauri()) return true

  try {
    const [documents, desktop, downloads, home] = await Promise.all([
      documentDir?.(),
      desktopDir?.(),
      downloadDir?.(),
      homeDir?.(),
    ])

    const roots = [
      documents ? normalize(documents) : null,
      desktop ? normalize(desktop) : null,
      downloads ? normalize(downloads) : null,
      home ? normalize(home) : null,
    ].filter(Boolean) as string[]

    return roots.some((r) => selected.startsWith(r))
  } catch {
    // Si l’API path n’est pas dispo, fallback permissif pour éviter un blocage total.
    return true
  }
}

export async function showPathNotAllowedMessage(): Promise<void> {
  try {
    const { message } = await import(‘@tauri-apps/api/dialog’)
    await message(
      "Pour des raisons de sécurité, ANZAR n’ouvre que les projets situés dans ton dossier utilisateur (Documents, Bureau, Téléchargements, etc.).\n\nVérifie que le dossier sélectionné est bien dans ton répertoire personnel.",
      { title: ‘Dossier non autorisé’, type: ‘warning’ }
    )
  } catch {
    alert(
      "Dossier non autorisé.\n\nVérifie que le dossier sélectionné est dans ton répertoire personnel (Documents, Bureau, Téléchargements, etc.)."
    )
  }
}
