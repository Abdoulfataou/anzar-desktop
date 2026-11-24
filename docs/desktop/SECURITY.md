# Sécurité — Desktop ANZAR

État : **novembre 2026** — Tauri **2.12.6**, durcissement du jeton/CSP et
migration Tauri 2 effectués. Périmètre : `apps/desktop/`.

---

## 1. Secrets et session

### Ce qui est garanti aujourd'hui

- **Aucune clé IA dans le client.** Toutes les requêtes passent par le proxy
  FastAPI, authentifié par JWT. Le bundle neutralise `VITE_DEEPSEEK_API_KEY`
  (`vite.config.ts`).
- **Le JWT n'est jamais écrit dans `localStorage`.** Il est stocké directement dans le
  **trousseau du système** (Keychain macOS / Credential Manager Windows / Secret Service
  Linux) par les commandes Rust `secret_get` / `secret_set` / `secret_delete`. La webview
  ne reçoit que le jeton dont elle a besoin : elle n'a **aucune** clé de coffre à demander.
  Si le trousseau est indisponible, le jeton reste **en mémoire** pour la session en cours
  et n'est pas persisté (reconnexion au redémarrage) ; on ne retombe jamais sur
  `localStorage`. L'ancienne clé `settings.deviceVaultKey` n'est plus utilisée.
- **Stronghold supprimé.** Le montage précédent (snapshot `anzar.vault.hold` chiffré +
  mot de passe remis au renderer par `vault_key_get`) ajoutait un secret exposé sans
  protéger davantage : le jeton finissait de toute façon en JS pour appeler l'API. Les
  snapshots existants ne sont pas migrés : une **reconnexion est nécessaire** après mise à
  jour. Le fichier `anzar.vault.hold` restant est inerte (plus aucun lecteur).
- **Nettoyage des anciennes installations** : l'ancien jeton base64
  `anzar_tkn_fb` est supprimé de `localStorage` à chaque démarrage et à la
  déconnexion (`secureTokenStore.purgeLegacyToken()`).
- **Ordre de démarrage sûr** : les stores (réglages compris) sont hydratés
  **avant** la restauration de session.
- **Délai d'authentification** : toutes les requêtes d'auth sont bornées à 10 s
  (AbortController), pour qu'un serveur muet ne bloque plus le splash.
- **Trousseau** : les appels au trousseau passent par `spawn_blocking` (une autorisation
  macOS ne doit jamais bloquer le thread principal) et sont bornés à 5 s côté renderer.

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

Reste P1 : le scope FS renderer reste large sur Documents/Desktop (nécessaire aux projets), et le garde-fou des installations/pousses doit encore être testé en conditions réelles. Installations : `npm install|i|ci|add` et `pip install` ne passent dans Rust (`tool_spawn`) qu'avec `approved`, posé par un accord à usage unique (10 min) enregistré quand l'utilisateur accepte la carte d'accord pour cette commande exacte ; `npm exec`, `npm publish` et `cargo install` restent refusés. `mcp.json` est désormais réservé à Rust (lecture masquée côté renderer, fichier 0600) ; le scope `$APPDATA` est limité à `store`, `render`, `browser` et `visuals`.

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
l'IPC Tauri ; `localhost` (serveur Vite, API locale) n'est autorisé qu'en développement, via `app.security.devCsp`. L'ancien domaine `*.railway.app` a été retiré.

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
- **Opener** : `opener:default` seul (URL). Le renderer n'a **plus** de capacité
  d'ouverture de chemin : `opener:allow-open-path` (scope `$HOME/**`) a été retiré, car un
  script injecté pouvait lancer un `.command` ou une application par ce biais. Les chemins
  passent par la commande Rust `reveal_path`, qui canonicalise puis vérifie les racines de
  projet autorisées avant de révéler le fichier (ou d'ouvrir le dossier).
- **Dialog / OS / Updater / Process** : permissions explicites. Le plugin Stronghold et
  ses permissions ont été retirés avec le coffre.
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
  `Command.create`/`spawn` (code 0), écriture d'un secret dans le trousseau ;
- trousseau : entrée `secret:auth_token` créée à la connexion, relue sans réécriture
  au lancement suivant, supprimée à la déconnexion ; aucun fichier de secours.

**Restent à tester manuellement sur macOS et Windows** : login OTP puis
redémarrage (session restaurée depuis le trousseau), ouverture de dossier, éditeur, terminal
et arrêt de processus, connecteurs MCP, mise à jour signée, installeur NSIS.
Voir `MIGRATION_TAURI2.md`.

## Isolation des commandes (novembre 2026)

Sur macOS, chaque commande lancée pour l'agent (`tool_spawn` : npm, node, git, cargo,
python, ffmpeg, rg) passe par `/usr/bin/sandbox-exec` avec le profil Seatbelt de
`src-tauri/src/sandbox.rs` :

| Règle | Effet |
|---|---|
| Écriture | Autorisée seulement dans le dossier du projet, le dossier git du dépôt (worktrees des tickets), les dossiers temporaires et les caches (`~/Library/Caches`, `~/.npm`, `~/.cache`, `~/.cargo`) |
| Git | `.git/hooks` et `.git/config` en lecture seule, y compris pour une worktree |
| Secrets | `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.netrc`, `~/.git-credentials` illisibles |
| Réseau | Filtré par un **proxy local avec liste d'hôtes autorisés** (`src-tauri/src/netproxy.rs`) : les commandes reçoivent `HTTP(S)_PROXY` et `npm_config_*_proxy`. Sur macOS, le profil Seatbelt n'autorise alors que localhost : le proxy est le **seul** chemin vers l'extérieur, et il refuse tout hôte absent de la liste (registres npm/pip/cargo, GitHub, Node.js par défaut, plus les hôtes ajoutés dans Paramètres → Réseau). Si l'utilisateur coupe le réseau, sortant refusé sauf localhost. Sur Windows et Linux, le même filtre s'applique mais n'est **coopératif** (variables d'environnement) : un programme qui ignore le proxy n'est pas arrêté |

- Réglage : Paramètres → Général → « Isoler les commandes » (activé par défaut). Coupé, les
  commandes s'exécutent comme avant.
- Réglage « Réseau des commandes » (ouvert par défaut). La protection contre l'envoi de
  données repose sur les secrets illisibles et sur l'accord demandé après lecture d'un
  contenu externe. Coupé, une connexion refusée ajoute `[ANZAR] Réseau coupé…` à la sortie.
- Quand une écriture est refusée, la sortie de la commande se termine par une ligne
  `[ANZAR] Bloqué par l'isolation des commandes…` que l'agent comprend.
- Quand un hôte est refusé par le filtre réseau, la sortie se termine par
  `[ANZAR] Hôtes bloqués par le filtre réseau : …` : l'agent sait quoi signaler, et
  l'utilisateur peut ajouter l'hôte dans Paramètres → Réseau. Le journal
  (`net_proxy_records`) donne les refus récents avec leur date.
- Limite connue : le réglage est transmis par la webview ; l'isolation est une défense en
  profondeur, en plus de la politique de commandes et des accords.
- Windows : chaque commande tourne dans un « job object » (`src-tauri/src/winjob.rs`).
  Arrêter la commande arrête toute son arborescence de processus, et fermer ANZAR tue ce qui
  reste. Le presse-papiers (lecture et écriture), l'arrêt de la session et les réglages système
  et d'affichage sont inaccessibles. **Les écritures de fichiers ne sont pas encore confinées** :
  l'implémentation AppContainer (profil, ACE sur le projet, `CreateProcessW` suspendu puis job
  object) et ses dix tests de validation sont décrits dans
  [`WINDOWS_SANDBOX.md`](WINDOWS_SANDBOX.md). La CI Windows (`rust-windows`) compile et teste
  désormais le code `#[cfg(windows)]` à chaque PR : c'est le prérequis pour l'écrire sans casser
  la release.
- Linux : pas d'isolation système (l'app n'est pas distribuée pour Linux).

## Dossiers de projet autorisés (novembre 2026)

Le périmètre fichiers de la webview (`capabilities/migrated.json`) est réduit au strict
nécessaire : dossier de données de l'app, `Documents/ANZAR` (espace ANZAR, worktrees) et
dossiers de skills partagés. Les anciens accès larges (`Documents/**`, `Bureau/**`,
`Téléchargements/**`, `~/Projects`, `~/Developer`) sont retirés.

Un dossier de projet n'entre dans le périmètre que par `src-tauri/src/roots.rs` :

| Entrée | Effet |
|---|---|
| `project_pick_folder` / `project_create_folder` | Sélecteur natif lancé par Rust : le dossier choisi par l'utilisateur est validé (dans le dossier personnel, ni le dossier personnel lui-même, ni `~/.ssh`, `~/Library`, `~/.config`…, liens symboliques résolus), autorisé et enregistré dans `allowed_roots.json` (0600) |
| Démarrage | La liste est relue et chaque dossier ré-autorisé (avant : un dossier hors Documents/Bureau/Téléchargements perdait son accès au redémarrage) |
| `project_import_roots` | Migration unique des projets déjà connus ; sans effet une fois la liste créée |
| Glisser-déposer | Les fichiers déposés dans la fenêtre deviennent lisibles (pièces jointes), un par un |
| `tool_spawn` | Une commande de l'agent n'est acceptée que dans un dossier de la liste, `Documents/ANZAR` ou les données de l'app |

Les sélecteurs de fichiers du plugin dialog (pièce jointe, export) autorisent aussi le fichier
choisi, pour la session seulement.

## Contenu externe et injection de consignes (novembre 2026)

Une page web (`web_search`, `read_url`) ou la réponse d'un connecteur MCP peut contenir
des consignes cachées. Défenses (`src/services/agent/policy/untrusted.ts`) :

- **Encadrement** : le contenu arrive entre `<<<DÉBUT CONTENU EXTERNE <id>>>>` et
  `<<<FIN CONTENU EXTERNE <id>>>>`, avec un identifiant aléatoire par bloc. Un faux
  marqueur présent dans le texte est remplacé par `[balise retirée]`.
- **Repérage** : les tournures d'injection connues (« ignore previous instructions »,
  « nouvelles consignes : », `curl … https://`, « envoie le .env »…) ajoutent un
  avertissement au bloc et rendent la source « suspecte ».
- **Accord après lecture** : dès qu'un contenu externe a été lu pendant la demande,
  `run_command`, `start_dev_server`, `spawn_subagents` et les actions de connecteur
  (non déclarées en lecture) demandent l'accord, même en « Accès complet ». La carte
  indique la source. En automatisation, ces actions sont refusées si le contenu est suspect.
  L'écriture de fichiers reste libre : les fichiers écrits puis exécutés sont déjà couverts
  par le garde S3 (`commandGuard`).
- **Prompt** : règle « Contenu externe » dans le prompt système (rappelée aux conversations
  plus anciennes).

Limites : le suivi vaut pour la demande en cours (il repart à zéro au message suivant) ;
un fichier du projet qui contient des consignes (README cloné, par exemple) n'est pas marqué.
