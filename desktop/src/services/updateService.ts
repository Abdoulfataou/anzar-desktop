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

  const { checkUpdate } = await import('@tauri-apps/api/updater')
  const { shouldUpdate, manifest } = await checkUpdate()

  const result: UpdateCheckResult = {
    supported: true,
    shouldUpdate: !!shouldUpdate,
    manifest: (manifest || null) as any,
  }

  localStorage.setItem(LS_LAST_CHECK, String(Date.now()))
  localStorage.setItem(LS_LAST_RESULT, JSON.stringify(result))

  return result
}

export async function installUpdateAndRelaunch(): Promise<void> {
  if (!isTauri()) return
  const { installUpdate } = await import('@tauri-apps/api/updater')
  const { relaunch } = await import('@tauri-apps/api/process')
  await installUpdate()
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

