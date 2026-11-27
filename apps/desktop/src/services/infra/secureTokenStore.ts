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
 * fermeture ; on ne retombe jamais sur localStorage.
 *
 * macOS peut afficher une fenêtre « ANZAR veut utiliser des informations confidentielles »
 * (première lecture par une nouvelle version, ou accès accordé une seule fois). L'appel reste
 * alors bloqué tant que l'utilisateur n'a pas répondu : on l'attend (READ_WAIT_MS) au lieu
 * d'abandonner au bout de quelques secondes, ce qui renvoyait à l'écran de connexion alors
 * que le jeton était bien là. `onKeychainWait` permet à l'écran de démarrage de l'expliquer. Les sessions ouvertes avant cette
 * version (snapshot Stronghold) ne sont pas migrées : une reconnexion est nécessaire.
 */
import { invoke } from '@tauri-apps/api/core'

const TOKEN_KEY = 'auth_token'
/** Ancien emplacement du JWT en clair (base64) dans localStorage. */
const LEGACY_TOKEN_LS_KEY = 'anzar_tkn_fb'

/** Jeton conservé en mémoire pour la session en cours (jamais persisté). */
let memoryToken: string | null = null

/** Temps laissé pour répondre à la fenêtre d'autorisation du trousseau. */
export const READ_WAIT_MS = 120_000
export const WRITE_WAIT_MS = 60_000
/** Au-delà, l'appel attend très probablement une réponse de l'utilisateur. */
const PROMPT_LIKELY_MS = 1_500

let waiting = 0
const waitListeners = new Set<(waiting: boolean) => void>()
function setWaiting(delta: number): void {
  const before = waiting > 0
  waiting = Math.max(0, waiting + delta)
  if (before !== waiting > 0) for (const l of waitListeners) l(waiting > 0)
}

/** Prévient quand un accès au trousseau semble attendre la réponse de l'utilisateur. */
export function onKeychainWait(listener: (waiting: boolean) => void): () => void {
  waitListeners.add(listener)
  listener(waiting > 0)
  return () => { waitListeners.delete(listener) }
}

/** Appel au trousseau : signale l'attente probable d'une autorisation, borne la durée. */
async function keychainCall<T>(promise: Promise<T>, ms: number): Promise<T> {
  let flagged = false
  const flag = setTimeout(() => { flagged = true; setWaiting(+1) }, PROMPT_LIKELY_MS)
  try {
    return await withTimeout(promise, ms)
  } finally {
    clearTimeout(flag)
    if (flagged) setWaiting(-1)
  }
}

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
  onKeychainWait,

  /**
   * Enregistre le jeton dans le trousseau. Ne lève jamais : si le trousseau est
   * indisponible, la session reste utilisable en mémoire jusqu'à la fermeture.
   * Retourne false quand le jeton n'a pas pu être persisté.
   */
  async setToken(token: string): Promise<boolean> {
    memoryToken = token
    try {
      await keychainCall(invoke('secret_set', { key: TOKEN_KEY, value: token }), WRITE_WAIT_MS)
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
      const value = await keychainCall(invoke<string | null>('secret_get', { key: TOKEN_KEY }), READ_WAIT_MS)
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
      await keychainCall(invoke('secret_delete', { key: TOKEN_KEY }), WRITE_WAIT_MS)
    } catch {
      // Rien à supprimer, ou trousseau indisponible : le jeton n'est plus en mémoire.
    }
  },
}
