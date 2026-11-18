/**
 * Coffre du jeton de session.
 *
 * Règle de sécurité : le JWT n'est JAMAIS écrit dans localStorage (lisible par
 * n'importe quel script de la webview, donc par une XSS dans le rendu Markdown).
 * Il vit uniquement dans le coffre chiffré Stronghold, avec un repli en mémoire
 * pour la session en cours si le coffre est indisponible.
 *
 * La clé du coffre est elle aussi sortie de localStorage : elle est conservée
 * dans `store/vault.key`, dans le dossier de données privé de l'application.
 * L'ancienne clé `settings.deviceVaultKey` est migrée automatiquement puis effacée.
 *
 * Limite connue (documentée dans SECURITY.md) : ce fichier protège le jeton d'une
 * lecture de localStorage, pas d'un attaquant local capable de lire le dossier de
 * données. Le passage à la clé du trousseau du système (Keychain / Credential
 * Manager) se fera avec la migration Tauri 2.
 */
import { invoke } from '@tauri-apps/api/tauri'
import { appDataDir } from '@tauri-apps/api/path'
import { readText, writeText } from '@/lib/fileStore'
import { useSettingsStore } from '@/stores/settingsStore'

const CLIENT_NAME = 'anzar-client'
const STORE_KEY = 'auth_token'
/** Clé du coffre, hors localStorage. */
const VAULT_KEY_FILE = 'vault.key'
/** Ancien emplacement du JWT en clair (base64) dans localStorage. */
const LEGACY_TOKEN_LS_KEY = 'anzar_tkn_fb'

/** Jeton conservé en mémoire pour la session en cours (jamais persisté). */
let memoryToken: string | null = null

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

/**
 * Récupère la clé du coffre, par ordre de priorité :
 *   1. `store/vault.key` (emplacement actuel, hors localStorage) ;
 *   2. l'ancienne clé `settings.deviceVaultKey` (migrée puis effacée) ;
 *   3. une nouvelle clé aléatoire.
 */
async function getVaultKey(): Promise<VaultKey> {
  const fromFile = await readText(VAULT_KEY_FILE).catch(() => null)
  if (fromFile?.trim()) return { key: fromFile.trim(), persistent: true }

  const legacy = (useSettingsStore.getState().settings.deviceVaultKey || '').trim()
  if (legacy) {
    // On ne retire l'ancienne clé de localStorage que si elle est bien copiée sur le disque.
    const saved = await writeText(VAULT_KEY_FILE, legacy).then(() => true).catch(() => false)
    if (saved) {
      useSettingsStore.getState().updateSettings({ deviceVaultKey: '' })
    }
    return { key: legacy, persistent: true }
  }

  const key = generateVaultKey()
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
      await ensureClient(snapshotPath, vault.key)

      await invoke('plugin:stronghold|save_store_record', {
        snapshotPath,
        client: CLIENT_NAME,
        key: STORE_KEY,
        value: toBytes(token),
      })

      await invoke('plugin:stronghold|save', { snapshotPath })
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
      await ensureClient(snapshotPath, vault.key)

      const bytes = (await invoke('plugin:stronghold|get_store_record', {
        snapshotPath,
        client: CLIENT_NAME,
        key: STORE_KEY,
      })) as number[] | null

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
      await ensureClient(snapshotPath, vault.key)
      await invoke('plugin:stronghold|remove_store_record', {
        snapshotPath,
        client: CLIENT_NAME,
        key: STORE_KEY,
      })
      await invoke('plugin:stronghold|save', { snapshotPath })
    } catch {
      // rien à supprimer / coffre indisponible
    }
  },
}
