# Sécurité — Desktop ANZAR

État : **novembre 2026** — Tauri **2.12.6**, durcissement du jeton/CSP et
migration Tauri 2 effectués. Périmètre : `desktop/`.

---

## 1. Secrets et session

### Ce qui est garanti aujourd'hui

- **Aucune clé IA dans le client.** Toutes les requêtes passent par le proxy
  FastAPI, authentifié par JWT. Le bundle neutralise `VITE_DEEPSEEK_API_KEY`
  (`vite.config.ts`).
- **Le JWT n'est jamais écrit dans `localStorage`.** Il est stocké dans le coffre
  chiffré Stronghold (`anzar.vault.hold`). En cas d'indisponibilité du coffre,
  il reste **en mémoire** pour la session en cours, et n'est pas persisté.
- **La clé du coffre est dans le trousseau du système** (Keychain macOS /
  Credential Manager Windows), plus dans `localStorage`. En cas de trousseau
  indisponible, un repli fichier (`store/vault-key.dat`) puis mémoire est utilisé.
  L'ancienne clé `settings.deviceVaultKey` est migrée automatiquement au premier
  démarrage, puis effacée des réglages persistés.
- **Nettoyage des anciennes installations** : l'ancien jeton base64
  `anzar_tkn_fb` est supprimé de `localStorage` à chaque démarrage et à la
  déconnexion (`secureTokenStore.purgeLegacyToken()`).
- **Ordre de démarrage sûr** : les stores (réglages compris) sont hydratés
  **avant** la restauration de session.
- **Délai d'authentification** : toutes les requêtes d'auth sont bornées à 10 s
  (AbortController), pour qu'un serveur muet ne bloque plus le splash.
- **Coffre Tauri 2** : Stronghold utilise désormais le client JS v2
  (`Stronghold.load`, `loadClient`, `getStore`), avec un repli mémoire explicite.

### Limite connue

Le trousseau système protège la clé du coffre contre une lecture de fichiers ou de
`localStorage`. Le repli fichier reste possible si le trousseau est verrouillé ou
indisponible ; dans ce cas, la clé est dans le dossier de données de l'application
(protégé par les permissions du compte, mais lisible par un attaquant local).

---

## 2. CSP Tauri

La CSP (`app.security.csp`) est fermée :

```text
default-src 'self'
script-src 'self' 'wasm-unsafe-eval'
object-src 'none'
base-uri 'self'
form-action 'self'
frame-ancestors 'none'
```

`connect-src` n'autorise que le backend ANZAR, GitHub (updater/liens), Sentry,
le dev server local et l'IPC Tauri. L'ancien domaine `*.railway.app` a été retiré.

---

## 3. Surface Tauri 2 (capabilities)

Le fichier `src-tauri/capabilities/migrated.json` remplace l'allowlist v1 :

- **FS** : scope limité aux dossiers Documents/Bureau/Téléchargements/Projects/
  Developer, à `$APPDATA` et aux skills ; deny list `.ssh`, `.aws`, `.env`,
  `*.pem`, `*.key`, identifiants Git/npm…
- **Shell** : `shell:allow-execute` **et** `shell:allow-spawn` avec les mêmes
  **120 entrées** v1 (`npm-2`, `python-3`…), plus `shell:allow-kill` pour
  l'arrêt des processus. `shell:allow-open` a été retiré (les liens passent par
  l'opener).
- **Opener** : `opener:default` + `opener:allow-open-path`, avec un scope limité
  à `$HOME`, `$APPDATA`, `$DOCUMENT`, `$DESKTOP`, `$DOWNLOAD` et une deny list
  de fichiers sensibles.
- **Dialog / OS / Updater / Process / Stronghold** : permissions explicites ;
  `stronghold:allow-remove-store-record` est ajouté pour la déconnexion.
- **Fenêtre** : les commandes utilisées par la barre de titre
  (`is-maximized`, `toggle-maximize`, drag, close…) sont autorisées.

Le plugin shell v2 résout une commande par le **nom de son entrée de scope**
(`npm-2`), pas par le binaire : `terminal.ts` conserve donc ce nom pour que les
validateurs d'arguments restent exacts.

---

## 4. Liens externes

Un seul point de sortie applicatif : `openExternalUrl()`
(`src/services/infra/externalLinks.ts`). Il :

- refuse tout schéma autre que `http(s)` et `mailto:` ;
- confirme l'ouverture d'un hôte inconnu ;
- mémorise l'accord pour la session.

Les pages Connecteurs et l'aperçu du workspace passent par ce garde-fou.

---

## 5. Garde-fou automatique

`scripts/check-security.mjs` est exécuté par `npm run lint` (donc par la CI) et
échoue si :

- un jeton est écrit dans `localStorage` ;
- `secureTokenStore.ts` réintroduit une écriture `localStorage` ou perd son
  repli mémoire ;
- la CSP perd `object-src`, `base-uri`, `frame-ancestors` ou `form-action` ;
- `*.railway.app` réapparaît.

Le script lit la CSP v2 (`app.security.csp`) et accepte encore l'ancien chemin
v1 (`tauri.security.csp`) pour les garde-fous historiques.

Commandes de vérification :

```bash
cd desktop
npm run lint                 # sécurité + TypeScript strict
npm run build                # build Vite
cd src-tauri && cargo check  # runtime Rust
npx tauri build --debug --no-bundle
```

---

## 6. Risques résiduels

| Risque | État | Correctif prévu |
|---|---|---|
| Tauri 1.8.3 (fin de maintenance) | **corrigé** | migré en Tauri 2.12.6 |
| `shell.open` sans scope / API large | **corrigé** | opener + capabilities + scope |
| Clé du coffre dans un fichier local | **corrigé** | trousseau système + repli fichier |
| Secrets des connecteurs MCP en clair (`store/mcp.json`) | **ouvert** | Coffre système ou Stronghold |
| LSP et Playwright lancés via `npx …@latest` | **ouvert** | Épingler les versions |
| Jeton lisible par une XSS qui a déjà l'IPC Tauri | **atténué** | capabilities + CSP + audit du rendu Markdown |
| Processus enfants non tués en groupe | **corrigé** | `processGroup: true` dans le plugin shell |

---

## 7. Validation de la migration

Effectuée sur macOS :

- `npm run lint` (garde-fou + `tsc --noEmit`) ;
- `npm run build` ;
- `cargo check` ;
- `npx tauri build --debug --no-bundle` ;
- lancement du binaire : webview chargée, pas de crash ;
- sondes runtime : `readDir` sur le dossier de données, `npm --version` via
  `Command.create`/`spawn` (code 0), écriture de la clé de coffre et ouverture
  Stronghold ;
- trousseau : entrée Keychain créée au premier lancement, relue sans réécriture
  au lancement suivant (`mdat` inchangé), aucun fichier de secours.

**Restent à tester manuellement sur macOS et Windows** : login OTP puis
redémarrage (restauration Stronghold), ouverture de dossier, éditeur, terminal
et arrêt de processus, connecteurs MCP, mise à jour signée, installeur NSIS.
Voir `MIGRATION_TAURI2.md`.
