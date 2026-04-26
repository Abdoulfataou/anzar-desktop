import { invoke } from '@tauri-apps/api/tauri'
import { appDataDir } from '@tauri-apps/api/path'
import { useSettingsStore } from '@/stores/settingsStore'

const CLIENT_NAME = 'anzar-client'
const STORE_KEY = 'auth_token'

function toBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

function fromBytes(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes))
}

async function getSnapshotPath(): Promise<string> {
  const dir = await appDataDir()
  // Keep a dedicated stronghold snapshot file
  return `${dir}/anzar.vault.hold`
}

async function ensureClient(snapshotPath: string, password: string): Promise<void> {
  // Initialize (loads existing snapshot if present, otherwise creates new)
  await invoke('plugin:stronghold|initialize', { snapshotPath, password })

  try {
    await invoke('plugin:stronghold|load_client', { snapshotPath, client: CLIENT_NAME })
  } catch {
    await invoke('plugin:stronghold|create_client', { snapshotPath, client: CLIENT_NAME })
  }
}

/**
 * Secure token store (Stronghold).
 *
 * Note: This protects the token at rest (encrypted vault). It does NOT protect against
 * malicious JS execution inside the app (XSS/injection). That's why we also hardened
 * terminal/fs earlier.
 */
export const secureTokenStore = {
  async setToken(token: string): Promise<void> {
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
  },

  async getToken(): Promise<string | null> {
    const snapshotPath = await getSnapshotPath()
    const password = useSettingsStore.getState().getDeviceVaultKey()

    try {
      await ensureClient(snapshotPath, password)
      const bytes = (await invoke('plugin:stronghold|get_store_record', {
        snapshotPath,
        client: CLIENT_NAME,
        key: STORE_KEY,
      })) as number[] | null

      if (!bytes || bytes.length === 0) return null
      return fromBytes(bytes)
    } catch {
      return null
    }
  },

  async clearToken(): Promise<void> {
    const snapshotPath = await getSnapshotPath()
    const password = useSettingsStore.getState().getDeviceVaultKey()

    try {
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

