# Sécurité — Desktop ANZAR

État : **novembre 2026**, après le durcissement « axe 1 » (jeton + CSP).
Périmètre : application Tauri du dossier `desktop/`.

---

## 1. Secrets et session

### Ce qui est garanti aujourd'hui

- **Aucune clé IA dans le client.** Toutes les requêtes passent par le proxy
  FastAPI, authentifié par JWT. Le bundle neutralise même `VITE_DEEPSEEK_API_KEY`
  (`vite.config.ts`).
- **Le JWT n'est jamais écrit dans `localStorage`.** Il est stocké dans le coffre
  chiffré Stronghold (`anzar.vault.hold`). En cas d'indisponibilité du coffre,
  il reste **en mémoire** pour la session en cours, et n'est pas persisté.
- **La clé du coffre a quitté `localStorage`.** Elle vit dans
  `store/vault.key`, dans le dossier de données de l'application. L'ancienne clé
  `settings.deviceVaultKey` est migrée automatiquement au premier démarrage,
  puis effacée des réglages persistés.
- **Nettoyage des anciennes installations** : l'ancien jeton base64
  `anzar_tkn_fb` est supprimé de `localStorage` à chaque démarrage et à la
  déconnexion (`secureTokenStore.purgeLegacyToken()`).
- **Ordre de démarrage sûr** : les stores (réglages compris) sont hydratés
  **avant** la restauration de session, sinon l'URL backend et l'ancienne clé
  de coffre seraient lues sur leurs valeurs par défaut.
- **Délai d'authentification** : toutes les requêtes d'auth sont bornées à 10 s
  (AbortController), pour qu'un serveur muet ne bloque plus le splash.

### Limite connue

`store/vault.key` protège le jeton d'une lecture de `localStorage` (scraping,
export de données, XSS qui ne lit que le stockage web). Il ne protège pas d'un
attaquant local capable de lire le dossier de données de l'application, ni d'une
XSS qui disposerait des permissions Tauri FS.

**Correctif prévu** : déplacer cette clé dans le trousseau du système
(Keychain macOS / Credential Manager Windows) lors de la migration Tauri 2, et
restreindre les capabilities FS.

---

## 2. CSP Tauri

La CSP de `src-tauri/tauri.conf.json` est fermée :

```text
default-src 'self'
script-src 'self' 'wasm-unsafe-eval'
object-src 'none'
base-uri 'self'
form-action 'self'
frame-ancestors 'none'
```

`connect-src` n'autorise que le backend ANZAR, GitHub (updater/liens), Sentry et
le dev server local. L'ancien domaine `*.railway.app` a été retiré.

---

## 3. Liens externes

Un seul point de sortie applicatif : `openExternalUrl()`
(`src/services/infra/externalLinks.ts`). Il :

- refuse tout schéma autre que `http(s)` ;
- confirme l'ouverture d'un hôte inconnu ;
- mémorise l'accord pour la session.

Les pages Connecteurs et l'aperçu du workspace passent désormais par ce
garde-fou au lieu d'appeler `shell.open` directement.

---

## 4. Garde-fou automatique

`scripts/check-security.mjs` est exécuté par `npm run lint` (donc par la CI) et
échoue si :

- un jeton est écrit dans `localStorage` ;
- `secureTokenStore.ts` réintroduit une écriture `localStorage` ou perd son
  repli mémoire ;
- la CSP perd `object-src`, `base-uri`, `frame-ancestors` ou `form-action` ;
- `*.railway.app` réapparaît.

Commandes de vérification :

```bash
cd desktop
npm run lint        # sécurité + TypeScript strict
npm run build       # build Vite
```

---

## 5. Risques résiduels et prochaines étapes (Tauri 2)

| Risque | État | Correctif prévu |
|---|---|---|
| Tauri 1.8.3 (fin de maintenance) | **ouvert** | Migration Tauri 2 + capabilities |
| `shell.open` sans scope, `path.all`, FS large | **ouvert** | Capacités Tauri 2 + allowlist de chemins |
| Clé du coffre dans un fichier local | **atténué** | Keychain / Credential Manager |
| Secrets des connecteurs MCP en clair (`store/mcp.json`) | **ouvert** | Coffre système ou Stronghold |
| LSP et Playwright lancés via `npx …@latest` | **ouvert** | Épingler les versions |
| Jeton lisible par une XSS qui a déjà l'IPC Tauri | **atténué** | Capabilities + CSP + audit du rendu Markdown |
| Processus enfants non tués en groupe | **ouvert** | `portable-pty` / kill par groupe |

### Inventaire de migration Tauri 2 (mesuré sur le code actuel)

| API v1 | Occurrences | Cible v2 |
|---|---:|---|
| `@tauri-apps/api/fs` | 30 | `@tauri-apps/plugin-fs` (API `readDir` différente : `isDirectory`) |
| `@tauri-apps/api/path` | 14 | inchangé |
| `@tauri-apps/api/dialog` | 11 | `@tauri-apps/plugin-dialog` |
| `@tauri-apps/api/tauri` (`invoke`) | 9 | inchangé |
| `@tauri-apps/api/event` | 6 | inchangé |
| `@tauri-apps/api/shell` | 3 (dont 1 `open` centralisé) | `@tauri-apps/plugin-shell` (`Command.create`) |
| `@tauri-apps/api/updater` | 2 | `@tauri-apps/plugin-updater` |
| `@tauri-apps/api/os` | 2 | `@tauri-apps/plugin-os` |
| `@tauri-apps/api/window` / `process` | 2 | plugins v2 |

Points de rupture à traiter dans la migration :

1. `readDir` v2 ne renvoie plus d'arborescence `children` : réécrire
   `fileSystem.readDirectoryTree`.
2. Shell : convertir les 120 validateurs de `tauri.conf.json` en capabilities
   `shell:allow-execute` (une entrée par binaire et par nombre d'arguments).
3. Stronghold : l'API v2 diffère ; réécrire `secureTokenStore` sur le client v2.
4. Updater : nouvelle API et nouvelles clés de signature.
5. Config : `tauri.conf.json` v2 + `src-tauri/capabilities/default.json`.
6. Validation obligatoire sur **macOS et Windows** avant fusion.

La migration doit être faite sur une branche dédiée (`security/tauri2`), avec un
build signé de chaque plateforme. Elle n'est pas incluse dans ce durcissement.
