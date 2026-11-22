/**
 * Coffre du jeton de session.
 *
 * Règle de sécurité : le JWT n'est JAMAIS écrit dans localStorage (lisible par n'importe
 * quel script de la webview, donc par une XSS dans le rendu Markdown).
 *
 * Le jeton est stocké dans le **trousseau du système** (Keychain macOS, Credential Manager
 * Windows, Secret Service Linux) par une commande Rust : la webview ne reçoit que le jeton
 * dont elle a besoin, jamais la clé d'un coffre. L'ancien montage Stronghold (snapshot
 * chiffré + mot de passe remis au JS par `vault_key_get`) est supprimé : il ajoutait un
 * secret exposé sans protéger davantage, puisque le jeton finissait de toute façon en JS.
 *
 * Si le trousseau est indisponible, la session reste utilisable **en mémoire** jusqu'à la
 * fermeture ; on ne retombe jamais sur localStorage. Les sessions ouvertes avant cette
 * version (snapshot Stronghold) ne sont pas migrées : une reconnexion est nécessaire.
 */
import { invoke } from '@tauri-apps/api/core'

const TOKEN_KEY = 'auth_token'
/** Ancien emplacement du JWT en clair (base64) dans localStorage. */
const LEGACY_TOKEN_LS_KEY = 'anzar_tkn_fb'

/** Jeton conservé en mémoire pour la session en cours (jamais persisté). */
let memoryToken: string | null = null

/** Un trousseau verrouillé ne doit jamais bloquer le démarrage. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('trousseau indisponible (délai dépassé)')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
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
  purgeLegacyToken,

  /**
   * Enregistre le jeton dans le trousseau. Ne lève jamais : si le trousseau est
   * indisponible, la session reste utilisable en mémoire jusqu'à la fermeture.
   * Retourne false quand le jeton n'a pas pu être persisté.
   */
  async setToken(token: string): Promise<boolean> {
    memoryToken = token
    try {
      await withTimeout(invoke('secret_set', { key: TOKEN_KEY, value: token }), 5_000)
      return true
    } catch (e) {
      console.warn('[secureTokenStore] trousseau indisponible : session non persistante', e)
      return false
    }
  },

  /**
   * Lit le jeton du trousseau. Retourne null s'il est absent ou indisponible
   * (l'utilisateur devra se reconnecter). Aucun repli localStorage.
   */
  async getToken(): Promise<string | null> {
    try {
      const value = await withTimeout(invoke<string | null>('secret_get', { key: TOKEN_KEY }), 5_000)
      if (typeof value === 'string' && value.trim()) {
        memoryToken = value
        return value
      }
    } catch (e) {
      console.warn('[secureTokenStore] lecture du trousseau impossible', e)
    }
    return memoryToken
  },

  /** Oublie le jeton (déconnexion). */
  async clearToken(): Promise<void> {
    memoryToken = null
    purgeLegacyToken()
    try {
      await withTimeout(invoke('secret_delete', { key: TOKEN_KEY }), 5_000)
    } catch {
      // Rien à supprimer, ou trousseau indisponible : le jeton n'est plus en mémoire.
    }
  },
}
