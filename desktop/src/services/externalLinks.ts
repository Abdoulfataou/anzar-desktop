import { isTauri } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'

// Session allowlist (évite de redemander 10 fois la confirmation)
const sessionAllowedHosts = new Set<string>()

function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    // Block localhost in production? Keep allowed for dev; still confirm below.
    return true
  } catch {
    return false
  }
}

/**
 * Open external URL with a safety confirmation (grand public).
 * - Blocks non-http(s) schemes.
 * - Confirms if host not in allowlist (settings.externalAllowlistHosts + backend host).
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isSafeHttpUrl(url)) {
    throw new Error('Lien bloqué pour raisons de sécurité (URL invalide)')
  }

  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  const u = new URL(url)
  const settings = useSettingsStore.getState()
  const allow = new Set<string>((settings.getExternalAllowlistHosts?.() || []).map((h) => h.toLowerCase()))
  try {
    const backendHost = new URL(settings.getBackendUrl()).hostname.toLowerCase()
    allow.add(backendHost)
  } catch {
    // ignore
  }

  const host = u.hostname.toLowerCase()
  const allowed = allow.has(host) || sessionAllowedHosts.has(host)

  if (!allowed) {
    const { confirm } = await import('@tauri-apps/api/dialog')
    const ok = await confirm(
      `Tu vas ouvrir un lien externe:\n\n${host}\n\nN’ouvre ce lien que si tu lui fais confiance.`,
      { title: 'Ouvrir un lien externe', type: 'warning' }
    )
    if (!ok) return
    // Ne plus redemander pendant cette session (moins "tique" utilisateur)
    sessionAllowedHosts.add(host)
  }

  const { open } = await import('@tauri-apps/api/shell')
  await open(url)
}
