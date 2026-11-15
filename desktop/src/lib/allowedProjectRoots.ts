import { isTauri } from '@/lib/utils'
import { isPathWithin } from '@/lib/pathGuard'
import { desktopDir, documentDir, downloadDir, homeDir } from '@tauri-apps/api/path'

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Checks if a project path is within allowed directories (tauri.conf.json scope).
 * Allowed: Documents, Desktop, Downloads, $HOME.
 */
export async function isAllowedProjectRoot(selectedPath: string): Promise<boolean> {
  const selected = normalize(selectedPath)

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

    return roots.some((r) => isPathWithin(selected, r))
  } catch {
    return true
  }
}

export async function showPathNotAllowedMessage(): Promise<void> {
  try {
    const { message } = await import('@tauri-apps/api/dialog')
    await message(
      "Dossier non autorisé. Vérifie que le dossier est dans ton répertoire personnel (Documents, Bureau, etc.).",
      { title: 'Dossier non autorisé', type: 'warning' }
    )
  } catch {
    alert(
      "Dossier non autorisé. Vérifie que le dossier est dans ton répertoire personnel."
    )
  }
}
