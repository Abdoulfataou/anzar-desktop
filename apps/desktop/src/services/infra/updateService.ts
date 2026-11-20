import type { Update } from '@tauri-apps/plugin-updater'
import { isTauri } from '@/lib/utils'
import toast from 'react-hot-toast'

const LS_LAST_CHECK = 'anzar_updater_last_check_ms'
const LS_LAST_RESULT = 'anzar_updater_last_result'

export type UpdateManifest = {
  version?: string
  date?: string
  body?: string
}

export type UpdateCheckResult =
  | { supported: false }
  | { supported: true; shouldUpdate: boolean; manifest: UpdateManifest | null }

/**
 * La mise à jour annoncée par `check()` porte une ressource côté Rust qu'il faut
 * conserver pour lancer l'installation (API updater v2). On la garde en mémoire
 * jusqu'à l'installation ou la prochaine vérification.
 */
let pendingUpdate: Update | null = null

export function getLastUpdateCheckMs(): number {
  const raw = localStorage.getItem(LS_LAST_CHECK)
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export function getCachedUpdateResult(): UpdateCheckResult | null {
  const raw = localStorage.getItem(LS_LAST_RESULT)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!isTauri()) return { supported: false }

  // Libère la ressource de la vérification précédente si elle n'a pas servi.
  if (pendingUpdate) {
    await pendingUpdate.close().catch(() => {})
    pendingUpdate = null
  }

  const { check } = await import('@tauri-apps/plugin-updater')
  pendingUpdate = await check()

  const result: UpdateCheckResult = {
    supported: true,
    shouldUpdate: !!pendingUpdate,
    manifest: pendingUpdate
      ? { version: pendingUpdate.version, date: pendingUpdate.date, body: pendingUpdate.body }
      : null,
  }

  localStorage.setItem(LS_LAST_CHECK, String(Date.now()))
  localStorage.setItem(LS_LAST_RESULT, JSON.stringify(result))

  return result
}

export async function installUpdateAndRelaunch(): Promise<void> {
  if (!isTauri()) return

  // L'utilisateur peut cliquer sur « Installer » sans avoir rouvert les Paramètres :
  // on refait alors la vérification, plutôt que d'échouer sur une ressource absente.
  if (!pendingUpdate) {
    const { check } = await import('@tauri-apps/plugin-updater')
    pendingUpdate = await check()
  }
  if (!pendingUpdate) throw new Error('Aucune mise à jour disponible.')

  try {
    // Sur Windows, l'installeur peut redémarrer l'app lui-même.
    await pendingUpdate.downloadAndInstall()
  } finally {
    await pendingUpdate.close().catch(() => {})
    pendingUpdate = null
  }

  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

/**
 * Check updates at most once per day.
 * If an update exists, show a small notification (no provider mention).
 */
export async function autoCheckOncePerDay(): Promise<void> {
  if (!isTauri()) return

  const last = getLastUpdateCheckMs()
  const ONE_DAY = 24 * 60 * 60 * 1000
  if (last && Date.now() - last < ONE_DAY) return

  try {
    const res = await checkForUpdates()
    if (res.supported && res.shouldUpdate) {
      toast('Mise à jour disponible. Va dans Paramètres → À propos pour installer.', {
        duration: 6000,
      })
    }
  } catch (e: any) {
    // Silent fail: never block app startup.
    console.warn('Auto-update check failed:', e?.message || e)
  }
}
