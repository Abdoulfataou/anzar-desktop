# Sécurité — Desktop ANZAR

État : **novembre 2026** — Tauri **2.12.6**, durcissement du jeton/CSP et
migration Tauri 2 effectués. Périmètre : `apps/desktop/`.

---

## 1. Secrets et session

### Ce qui est garanti aujourd'hui

- **Aucune clé IA dans le client.** Toutes les requêtes passent par le proxy
  FastAPI, authentifié par JWT. Le bundle neutralise `VITE_DEEPSEEK_API_KEY`
  (`vite.config.ts`).
- **Le JWT n'est jamais écrit dans `localStorage`.** Il est stocké dans le coffre
  chiffré Stronghold (`anzar.vault.hold`). En cas d'indisponibilité du coffre,
  il reste **en mémoire** pour la session en cours, et n'est pas persisté.
- **La clé du coffre est uniquement dans le trousseau du système** (Keychain
  macOS / Credential Manager Windows), plus dans `localStorage`. Aucun repli
  fichier n'est écrit : si le trousseau est indisponible, la clé reste en mémoire
  et la session n'est pas persistée (reconnexion au redémarrage). L'ancienne clé
  `settings.deviceVaultKey` n'est plus utilisée.
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
`localStorage`. Les fichiers du dossier `store` sont durcis en `0600` (dossiers
`0700`) au démarrage et après l'écriture d'un secret, mais un processus du même
compte peut encore les lire. Le renderer ne doit donc jamais pouvoir exécuter de
script arbitraire ; la CSP et la sanitation des contenus restent la première
barrière.

---

## 1 bis. Durcissement P0 appliqué (18 novembre 2026)

- `npx` retiré des commandes agent ; `node --eval`, `bash/sh -c`, `npx -c` refusés. La webview n'a plus aucune capacité shell.
- `mcp_spawn` : lanceur sans chemin, paquets npx allowlistés, environnement nettoyé, `cwd` contenu dans le répertoire utilisateur, options inline refusées.
- `mcp_http` : HTTPS obligatoire, hôtes privés/loopback refusés (littéral et DNS), redirections désactivées.
- PDF.js mis à jour vers `6.2.108` (CVE high corrigée), worker local uniquement.
- Mermaid filtré par DOMPurify avant `innerHTML`.
- Mode par défaut `auto` (plus `full`), les automatisations refusent désormais les actions qui demanderaient une approbation, les tickets ne tournent plus en Full.
- Sous-agents hors Full : outils en lecture seule ; le moteur refuse aussi un outil non autorisé.
- Clé de coffre : plus aucun repli `vault-key.dat` ; fichier local supprimé du chemin de lecture.
- Permissions `0700`/`0600` appliquées au démarrage et après écriture d'un secret (`secure_app_secrets`).

Reste P1 : le scope FS renderer reste large sur Documents/Desktop (nécessaire aux projets), et le garde-fou des installations/pousses doit encore être testé en conditions réelles. `mcp.json` est désormais réservé à Rust (lecture masquée côté renderer, fichier 0600) ; le scope `$APPDATA` est limité à `store`, `render`, `browser` et `visuals`.

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
- **Shell** : **aucune capacité shell**. Le plugin shell a été retiré de
  l'application ; `terminal.ts` passe par `tool_spawn` / `tool_wait` / `tool_kill`
  dans Rust. La politique (programmes allowlistés, arguments interdits, cwd sous
  le projet et sous le home) est appliquée avant `Command::new`.
- **Opener** : `opener:default` + `opener:allow-open-path`, avec un scope limité
  à `$HOME`, `$APPDATA`, `$DOCUMENT`, `$DESKTOP`, `$DOWNLOAD` et une deny list
  de fichiers sensibles.
- **Dialog / OS / Updater / Process / Stronghold** : permissions explicites ;
  `stronghold:allow-remove-store-record` est ajouté pour la déconnexion.
- **Fenêtre** : les commandes utilisées par la barre de titre
  (`is-maximized`, `toggle-maximize`, drag, close…) sont autorisées.

Le runner Rust n'utilise pas de shell intermédiaire (`sh -c`/`cmd /C`), applique
un environnement minimal et tue le groupe de processus à l'arrêt.

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
cd apps/desktop
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
| Clé du coffre dans un fichier local | **corrigé** | trousseau système uniquement, aucun repli fichier |
| Secrets des connecteurs MCP (`store/mcp.json`) | **corrigé côté renderer** | broker Rust, valeurs masquées, fichier 0600 ; chiffrement au repos P2 |
| LSP et Playwright lancés via `npx` | **atténué** | paquets npx allowlistés ; épingler les versions `@latest` restantes |
| Jeton lisible par une XSS qui a déjà l'IPC Tauri | **atténué** | PDF.js corrigé, Mermaid filtré, CSP, capabilities ; scope FS encore large |
| Liens symboliques dans les projets | **corrigé côté agent** | `fs_realpath` Rust + `resolvePath` canonique et confinement au projet |
| Processus enfants non tués en groupe | **corrigé** | runner Rust, groupe de processus et `tool_kill` |

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
