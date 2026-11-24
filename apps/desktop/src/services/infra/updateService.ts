import type { Update } from '@tauri-apps/plugin-updater'
import { create } from 'zustand'
import { isTauri } from '@/lib/utils'

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

/**
 * État partagé de la mise à jour : lu par le bandeau de l'app (UpdateBanner) et par
 * Paramètres → À propos. « Plus tard » masque le bandeau pour cette version jusqu'au
 * prochain lancement.
 */
export type UpdatePhase = 'idle' | 'available' | 'downloading' | 'installing' | 'error'
interface UpdateState {
  phase: UpdatePhase
  version?: string
  notes?: string
  /** 0 à 100 pendant le téléchargement ; null si la taille est inconnue */
  progress: number | null
  dismissedVersion?: string
  error?: string
}
export const useUpdateStore = create<UpdateState>(() => ({ phase: 'idle', progress: null }))
export function dismissUpdate(): void {
  useUpdateStore.setState((s) => ({ dismissedVersion: s.version }))
}

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

  const phase = useUpdateStore.getState().phase
  if (phase !== 'downloading' && phase !== 'installing') {
    useUpdateStore.setState(pendingUpdate
      ? { phase: 'available', version: pendingUpdate.version, notes: pendingUpdate.body || undefined, error: undefined }
      : { phase: 'idle', version: undefined, notes: undefined, error: undefined })
  }
  return result
}

/** Explique l'échec d'une installation avec la raison réelle, en mots simples. */
export function updateErrorMessage(e: unknown): string {
  const brut = (e instanceof Error ? e.message : String(e ?? '')).trim()
  const m = brut.toLowerCase()
  if (/signature|minisign|key id|identifier|pubkey|public key/.test(m))
    return "Cette mise à jour n'est pas signée avec la clé attendue. Télécharge la dernière version sur getanzar.com."
  if (/read-only|read only|permission denied|operation not permitted|access is denied|apptranslocation/.test(m))
    return "ANZAR ne peut pas se remplacer : place l'app dans le dossier Applications, puis réessaie."
  if (/network|timed? ?out|connection|dns|request|status code|404|403|500/.test(m))
    return 'Téléchargement interrompu. Vérifie ta connexion et réessaie.'
  return brut ? `L'installation n'a pas abouti : ${brut.slice(0, 160)}` : "L'installation n'a pas abouti. Réessaie plus tard."
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

  let total = 0
  let recu = 0
  useUpdateStore.setState({ phase: 'downloading', progress: null, error: undefined })
  try {
    // Sur Windows, l'installeur peut redémarrer l'app lui-même.
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0
      } else if (event.event === 'Progress') {
        recu += event.data.chunkLength
        if (total > 0) useUpdateStore.setState({ progress: Math.min(100, Math.round((recu / total) * 100)) })
      } else if (event.event === 'Finished') {
        useUpdateStore.setState({ phase: 'installing', progress: 100 })
      }
    })
  } catch (e) {
    useUpdateStore.setState({ phase: 'error', progress: null, error: updateErrorMessage(e) })
    throw e
  } finally {
    await pendingUpdate?.close().catch(() => {})
    pendingUpdate = null
  }

  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

/**
 * Surveillance des mises à jour : une vérification peu après le lancement, puis toutes
 * les 6 heures tant que l'app reste ouverte. Une mise à jour trouvée s'affiche dans le
 * bandeau de l'app (UpdateBanner). Jamais bloquant : un échec réseau est ignoré.
 */
export function startUpdateWatcher(): () => void {
  if (!isTauri()) return () => {}
  const SIX_HEURES = 6 * 60 * 60 * 1000
  const verifier = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    checkForUpdates().catch((e: any) => console.warn('Vérification des mises à jour impossible :', e?.message || e))
  }
  const premier = setTimeout(verifier, 8_000)
  const regulier = setInterval(verifier, SIX_HEURES)
  return () => { clearTimeout(premier); clearInterval(regulier) }
}
