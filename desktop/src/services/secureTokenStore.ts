import { invoke } from '@tauri-apps/api/tauri'
import { appDataDir } from '@tauri-apps/api/path'
import { useSettingsStore } from '@/stores/settingsStore'

const CLIENT_NAME = 'anzar-client'
const STORE_KEY = 'auth_token'
const LS_FALLBACK_KEY = 'anzar_tkn_fb'

function toBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

function fromBytes(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes))
}

async function getSnapshotPath(): Promise<string> {
  const dir = await appDataDir()
  return `${dir}/anzar.vault.hold`
}

async function ensureClient(snapshotPath: string, password: string): Promise<void> {
  await invoke('plugin:stronghold|initialize', { snapshotPath, password })
  try {
    await invoke('plugin:stronghold|load_client', { snapshotPath, client: CLIENT_NAME })
  } catch {
    await invoke('plugin:stronghold|create_client', { snapshotPath, client: CLIENT_NAME })
  }
}

// ── localStorage fallback (light obfuscation, not encryption) ──
function lsSet(token: string): void {
  try {
    localStorage.setItem(LS_FALLBACK_KEY, btoa(token))
  } catch { /* quota exceeded or private mode */ }
}
function lsGet(): string | null {
  try {
    const v = localStorage.getItem(LS_FALLBACK_KEY)
    if (!v) return null
    return atob(v)
  } catch { return null }
}
function lsClear(): void {
  try { localStorage.removeItem(LS_FALLBACK_KEY) } catch { /* ignore */ }
}

/**
 * Secure token store with Stronghold + localStorage fallback.
 *
 * Primary: Tauri Stronghold vault (encrypted at rest)
 * Fallback: localStorage (base64 obfuscated) — used when Stronghold
 * is unavailable (dev mode, plugin not loaded, vault corrupted).
 *
 * This ensures the user stays logged in across app restarts.
 */
export const secureTokenStore = {
  async setToken(token: string): Promise<void> {
    // Always store in localStorage fallback
    lsSet(token)

    // Try Stronghold (may fail in dev or if plugin missing)
    try {
      const snapshotPath = await getSnapshotPath()
      const password = useSettingsStore.getState().getDeviceVaultKey()
      await ensureClient(snapshotPath, password)

      await invoke('plugin:stronghold|save_store_record', {
        snapshotPath,
        client: CLIENT_NAME,
        key: STORE_KEY,
        value: toBytes(token),
      })

      await invoke('plugin:stronghold|save', { snapshotPath })
    } catch {
      // Stronghold unavailable — localStorage fallback is already set
    }
  },

  async getToken(): Promise<string | null> {
    // Try Stronghold first
    try {
      const snapshotPath = await getSnapshotPath()
      const password = useSettingsStore.getState().getDeviceVaultKey()
      await ensureClient(snapshotPath, password)

      const bytes = (await invoke('plugin:stronghold|get_store_record', {
        snapshotPath,
        client: CLIENT_NAME,
        key: STORE_KEY,
      })) as number[] | null

      if (bytes && bytes.length > 0) {
        const token = fromBytes(bytes)
        // Sync to localStorage in case Stronghold breaks later
        lsSet(token)
        return token
      }
    } catch {
      // Stronghold unavailable — fall through to localStorage
    }

    // Fallback: localStorage
    return lsGet()
  },

  async clearToken(): Promise<void> {
    lsClear()

    try {
      const snapshotPath = await getSnapshotPath()
      const password = useSettingsStore.getState().getDeviceVaultKey()
      await ensureClient(snapshotPath, password)
      await invoke('plugin:stronghold|remove_store_record', {
        snapshotPath,
        client: CLIENT_NAME,
        key: STORE_KEY,
      })
      await invoke('plugin:stronghold|save', { snapshotPath })
    } catch {
      // ignore
    }
  },
}
