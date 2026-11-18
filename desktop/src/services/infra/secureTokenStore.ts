/**
 * Coffre du jeton de session.
 *
 * Règle de sécurité : le JWT n'est JAMAIS écrit dans localStorage (lisible par
 * n'importe quel script de la webview, donc par une XSS dans le rendu Markdown).
 * Il vit uniquement dans le coffre chiffré Stronghold, avec un repli en mémoire
 * pour la session en cours si le coffre est indisponible.
 *
 * La clé du coffre est elle aussi sortie de localStorage : elle est conservée
 * dans `store/vault-key.dat`, dans le dossier de données privé de l'application.
 * L'ancienne clé `settings.deviceVaultKey` est migrée automatiquement puis effacée.
 *
 * Limite connue (documentée dans SECURITY.md) : ce fichier protège le jeton d'une
 * lecture de localStorage, pas d'un attaquant local capable de lire le dossier de
 * données. La clé est désormais conservée dans le trousseau du système
 * (Keychain macOS / Credential Manager Windows), avec un repli fichier.
 */
import { appDataDir } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { Client, Stronghold } from '@tauri-apps/plugin-stronghold'
import { readText, removeEntry, writeText } from '@/lib/fileStore'
import { useSettingsStore } from '@/stores/settingsStore'

const CLIENT_NAME = 'anzar-client'
const STORE_KEY = 'auth_token'
/** Clé du coffre, hors localStorage. */
const VAULT_KEY_FILE = 'vault-key.dat'
/** Ancien emplacement du JWT en clair (base64) dans localStorage. */
const LEGACY_TOKEN_LS_KEY = 'anzar_tkn_fb'

/** Jeton conservé en mémoire pour la session en cours (jamais persisté). */
let memoryToken: string | null = null

/** Handle Stronghold réutilisé entre les appels (le plugin garde l'état côté Rust). */
let cachedHandle: { path: string; password: string; instance: Stronghold; client: Client } | null = null

function toBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

function fromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

async function getSnapshotPath(): Promise<string> {
  const dir = await appDataDir()
  return `${dir}/anzar.vault.hold`
}

async function openVault(snapshotPath: string, password: string): Promise<{
  instance: Stronghold
  client: Client
}> {
  if (cachedHandle?.path === snapshotPath && cachedHandle.password === password) {
    return cachedHandle
  }

  const instance = await Stronghold.load(snapshotPath, password)
  let client: Client
  try {
    client = await instance.loadClient(CLIENT_NAME)
  } catch {
    try {
      client = await instance.createClient(CLIENT_NAME)
    } catch {
      // Rechargement à chaud de la webview : le client Rust existe déjà.
      client = new Client(snapshotPath, CLIENT_NAME)
    }
  }

  cachedHandle = { path: snapshotPath, password, instance, client }
  return cachedHandle
}

/** Clé aléatoire de 32 octets, en hexadécimal. */
function generateVaultKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface VaultKey {
  key: string
  /** false : le disque est indisponible, le jeton restera en mémoire seulement. */
  persistent: boolean
}

/** Un trousseau verrouillé ne doit jamais bloquer le démarrage. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('keychain timeout')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Lit la clé du coffre dans le trousseau du système, si elle existe. */
async function getKeychainKey(): Promise<string | null> {
  try {
    const key = await withTimeout(invoke<string | null>('vault_key_get'), 5_000)
    return typeof key === 'string' && key.trim() ? key.trim() : null
  } catch {
    return null
  }
}

/** Enregistre la clé dans le trousseau. false si le trousseau est indisponible. */
async function setKeychainKey(key: string): Promise<boolean> {
  try {
    await withTimeout(invoke('vault_key_set', { key }), 5_000)
    return true
  } catch {
    return false
  }
}

/**
 * Récupère la clé du coffre, par ordre de priorité :
 *   1. le trousseau du système (Keychain / Credential Manager) ;
 *   2. `store/vault-key.dat` (migration, puis suppression si le trousseau l'accepte) ;
 *   3. l'ancienne clé `settings.deviceVaultKey` (migrée puis effacée) ;
 *   4. une nouvelle clé aléatoire.
 */
async function getVaultKey(): Promise<VaultKey> {
  const keychain = await getKeychainKey()
  if (keychain) return { key: keychain, persistent: true }

  const fromFile = await readText(VAULT_KEY_FILE).catch(() => null)
  if (fromFile?.trim()) {
    const key = fromFile.trim()
    // Migration : on ne supprime le fichier que si le trousseau a bien accepté la clé.
    if (await setKeychainKey(key)) {
      await removeEntry(VAULT_KEY_FILE).catch(() => {})
    }
    return { key, persistent: true }
  }

  const legacy = (useSettingsStore.getState().settings.deviceVaultKey || '').trim()
  if (legacy) {
    if (await setKeychainKey(legacy)) {
      useSettingsStore.getState().updateSettings({ deviceVaultKey: '' })
    } else {
      await writeText(VAULT_KEY_FILE, legacy).catch(() => {})
    }
    return { key: legacy, persistent: true }
  }

  const key = generateVaultKey()
  if (await setKeychainKey(key)) return { key, persistent: true }

  // Trousseau indisponible : repli fichier, puis mémoire seulement.
  const saved = await writeText(VAULT_KEY_FILE, key).then(() => true).catch(() => false)
  return { key, persistent: saved }
}

/**
 * Supprime l'ancien jeton de localStorage. Appelé à chaque démarrage et à la
 * déconnexion : une installation mise à jour est nettoyée même si l'utilisateur
 * ne se reconnecte jamais.
 */
export function purgeLegacyToken(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_LS_KEY)
  } catch {
    /* stockage indisponible */
  }
}

export const secureTokenStore = {
  /** Supprime l'ancien JWT base64 de localStorage (installations ≤ 2.0.0). */
  purgeLegacyToken,

  /**
   * Enregistre le jeton dans le coffre. Ne lève jamais : si le coffre est
   * indisponible, la session reste utilisable en mémoire jusqu'à la fermeture.
   * Retourne false quand le jeton n'a pas pu être persisté.
   */
  async setToken(token: string): Promise<boolean> {
    memoryToken = token

    const vault = await getVaultKey().catch(() => null)
    if (!vault?.persistent) {
      console.warn('[secureTokenStore] coffre indisponible : session non persistante')
      return false
    }

    try {
      const snapshotPath = await getSnapshotPath()
      const { instance, client } = await openVault(snapshotPath, vault.key)
      await client.getStore().insert(STORE_KEY, toBytes(token))
      await instance.save()
      return true
    } catch (e) {
      // Le jeton reste en mémoire pour cette session ; on ne retombe JAMAIS sur localStorage.
      console.warn('[secureTokenStore] écriture du coffre impossible : session non persistante', e)
      return false
    }
  },

  /**
   * Lit le jeton du coffre. Retourne null si le coffre est indisponible ou vide
   * (l'utilisateur devra se reconnecter). Aucun repli localStorage.
   */
  async getToken(): Promise<string | null> {
    const vault = await getVaultKey().catch(() => null)
    if (!vault?.persistent) return memoryToken

    try {
      const snapshotPath = await getSnapshotPath()
      const { client } = await openVault(snapshotPath, vault.key)
      const bytes = await client.getStore().get(STORE_KEY)
      if (bytes && bytes.length > 0) {
        memoryToken = fromBytes(bytes)
        return memoryToken
      }
    } catch {
      // Coffre absent, corrompu ou clé changée : on repart d'une session propre.
    }

    return memoryToken
  },

  async clearToken(): Promise<void> {
    memoryToken = null
    purgeLegacyToken()

    const vault = await getVaultKey().catch(() => null)
    if (!vault?.persistent) return

    try {
      const snapshotPath = await getSnapshotPath()
      const { instance, client } = await openVault(snapshotPath, vault.key)
      await client.getStore().remove(STORE_KEY)
      await instance.save()
    } catch {
      // rien à supprimer / coffre indisponible
    }
  },
}
