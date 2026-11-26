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

## Permissions et isolation (aligné sur Harness, novembre 2026)

ANZAR reprend le modèle de permissions de DeepSeek Harness : le mode d'isolation et la
politique d'accord sont deux réglages, regroupés dans un seul sélecteur.

### Les quatre choix d'ANZAR

| Choix | Isolation | Demandes | Ce que l'agent peut faire |
|---|---|---|---|
| **Écriture projet · accord** (`ask`) | `workspace-write` | accord pour élargir | écrire et exécuter dans le projet, les temporaires et les caches ; réseau et lectures libres. Une commande refusée hors projet peut être relancée **une fois** avec `sandbox_permissions: "danger-full-access"` + justification, après accord. |
| **Écriture projet · sans accord** (`auto`) | `workspace-write` | aucune (équivalent `never`) | la même chose, mais aucun élargissement : ce qui sort du projet est refusé sans carte. |
| **Plan guidé** (`plan`) | `workspace-write` | accord pour élargir | **tous** les outils restent disponibles ; le mode plan est une consigne, pas une restriction. L'agent propose un plan puis exécute. |
| **Accès complet** (`full`) | `danger-full-access` | aucune | plus d'isolation : écritures partout, lectures de `~/.ssh`, `.env`, clés, réseau direct, hooks/config Git modifiables. Seuls les connecteurs « toujours demander » demandent encore. |

### Ce que l'isolation couvre

Sur macOS uniquement, Seatbelt (`src-tauri/src/sandbox.rs`) limite les **écritures** au
dossier du projet, au dossier git du dépôt, aux dossiers temporaires et aux caches
d'outils (`~/Library/Caches`, `~/.npm`, `~/.cache`, `~/.cargo`, etc.).

Elle ne couvre **pas** :

- les **lectures** : aucun fichier n'est rendu illisible (ni `.env`, ni `~/.ssh`, ni une clé) ;
- le **réseau** : aucune restriction, aucun proxy, aucune liste d'hôtes ;
- les **processus** : pas de garantie uniforme de visibilité ;
- **Git** : `.git/hooks` et `.git/config` sont des fichiers du projet, écrivables ;
- les **commandes** : pas de liste blanche, pas de refus de `sudo`, `git push`,
  `git reset --hard`, `git clean -f`, `npm publish`, etc. ;
- les **secrets** : aucune liste ni aucun refus.

C'est exactement le comportement de Harness. Les seules règles qui restent sont celles des
**connecteurs ANZAR** : ports 9876 (Blender), 9877 (GIMP), 4455 (OBS) et tube Audacity
bloqués pour les commandes, outils MCP qui exécutent du code refusés, et `alwaysAsk`.

### Refus et élévation

Quand Seatbelt refuse une écriture, la sortie se termine par :

```
[sandbox: file access denied under workspace-write mode]
[sandbox: escalation available — retry this exact command once with sandbox_permissions ("danger-full-access") + justification; the approval prompt asks the user]
```

L'agent peut relancer **la même commande** avec `sandbox_permissions: "danger-full-access"`
et une justification. En `ask` et `plan`, une carte demande l'accord ; en `auto`, c'est
refusé sans carte ; en `full`, l'isolation est déjà retirée. L'élévation ne dure que pour
cet appel.

### Windows et Linux

- **Windows** : les commandes tournent dans un job object (arrêt de l'arborescence,
  presse-papiers et réglages système bloqués), mais **elles ne peuvent pas être confinées au
  projet**. Comme Harness quand l'isolation manque (fail-closed), ANZAR ne les lance donc
  jamais en silence hors Accès complet (`policy/isolation.ts`) :
  - « Demander » et plan : chaque commande (et le serveur de dev) passe par l'élévation à
    usage unique, donc par une carte d'accord ;
  - « Modifier automatiquement » : la commande est refusée, avec la marche à suivre ;
  - « Accès complet » : les commandes partent sans confinement, comme l'avertissement le dit ;
  - les vérifications automatiques (lint, build, tests) ne tournent qu'en Accès complet.
  Cette règle est appliquée par l'app (TypeScript), pas par le système : la vraie
  isolation Windows (jeton restreint et ACL de Harness) reste à faire.
- **Linux** : pas d'isolation système ; l'app n'est pas distribuée pour Linux.

## Dossiers de projet autorisés (novembre 2026)

Le périmètre fichiers de la webview (`capabilities/migrated.json`) est réduit au strict
nécessaire : dossier de données de l'app, `Documents/ANZAR` (espace ANZAR, worktrees) et
dossiers de skills partagés. Les anciens accès larges (`Documents/**`, `Bureau/**`,
`Téléchargements/**`, `~/Projects`, `~/Developer`) sont retirés.

Un dossier de projet n'entre dans le périmètre que par `src-tauri/src/roots.rs` :

| Entrée | Effet |
|---|---|
| `project_pick_folder` / `project_create_folder` | Sélecteur natif lancé par Rust : le dossier choisi par l'utilisateur est validé (dans le dossier personnel, pas le dossier personnel lui-même, liens symboliques résolus), autorisé et enregistré dans `allowed_roots.json` (0600) |
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
- **Aucun accord supplémentaire** : comme Harness, une lecture externe ne bloque pas les
  commandes suivantes. L'encadrement et l'avertissement restent une défense en profondeur
  pour le modèle, pas une permission.
- **Prompt** : règle « Contenu externe » dans le prompt système (rappelée aux conversations
  plus anciennes).

Limites : le suivi vaut pour la demande en cours (il repart à zéro au message suivant) ;
un fichier du projet qui contient des consignes (README cloné, par exemple) n'est pas marqué.

## Connecteur GIMP (gimp3-mcp)

Le plugin GIMP écoute sur `localhost:9877` sans authentification et son outil `call_api`
exécute du Python arbitraire avec les droits de l'utilisateur. Protections d'ANZAR :

- **Lancement** : seul `uvx gimp3-mcp@0.2.0` est accepté (`mcp.rs`, `ALLOWED_UVX`), version
  épinglée, aucun autre argument. Toute nouvelle version passe par une relecture du code.
- **Outil bloqué** : `call_api` est refusé par Rust dans `mcp_send` (`denied_tools`), y compris
  dans un lot JSON-RPC ; il n'est pas non plus présenté au modèle (`deniedMcpTools`).
- **Accord** : connecteur en `alwaysAsk` : chaque action de l'agent dans GIMP est confirmée.
- **Commandes de l'agent** : sous Seatbelt, le port 9877 est bloqué (`BLOCKED_LOCAL_PORTS`,
  testé en vrai sur macOS). En Accès complet et sous Windows, cette barrière système
  disparaît ; seul le connecteur reste protégé par `alwaysAsk`.
- **Limite connue** : tant que le serveur MCP est démarré dans GIMP, un autre programme de
  l'ordinateur peut piloter GIMP. La fiche du connecteur demande de l'arrêter après usage.

## Connecteurs Blender (mcp-for-blender) et Inkscape (inkscape-mcp)

Même méthode que GIMP : paquet et version relus et épinglés dans `mcp.rs` (`UVX_SERVERS`),
accord avant chaque action (`alwaysAsk`).

- **Blender 2.3.1** : `execute_blender_code` (Python arbitraire) et `record_trajectory_feedback`
  (envoie les phrases de l'utilisateur à l'éditeur du connecteur) sont refusés. Rust impose
  `DISABLE_TELEMETRY=true`. L'add-on écoute sur `localhost:9876` ; Seatbelt interdit ce port
  aux commandes. En Accès complet ou sous Windows, cette barrière disparaît ; le connecteur
  reste en `alwaysAsk`. Les autres outils envoient des scripts fixes du connecteur.
- **Inkscape 2.0.0** : outils « fourre-tout » à opérations. Refusés : `inkscape_live` avec
  `operation = execute_inkex`, et tout appel à `inkscape_system` / `inkscape_extension` dont les
  arguments (forme JSON canonique, échappements compris) mentionnent l'extension
  `org.inkscape.mcp.execute`. Pas de port réseau : le mode « fenêtre » passe par D-Bus.
- Pour ajouter une version : lire le code, mettre à jour `UVX_SERVERS` et les tests
  `uvx_only_runs_pinned_reviewed_servers` / `code_execution_tools_are_blocked`.

## Connecteurs Audacity (audacity-mcp-server) et OBS Studio (obs-mcp)

- **Audacity 3 — `uvx --from audacity-mcp-server==0.1.23 audacity-mcp`** (ligne exacte) :
  aucun outil de commande brute ni Nyquist ; `transport_record` (micro) est refusé. Le tube
  `/tmp/audacity_script_pipe.*` accepte n'importe quelle commande Audacity : Seatbelt en
  interdit la lecture et l'écriture aux commandes de l'agent. Les exports refusent les
  dossiers système mais peuvent écrire ailleurs dans le dossier utilisateur : chaque action
  est confirmée (`alwaysAsk`). Audacity 4 n'a plus d'interface de scripting : non pris en charge.
- **OBS — `uvx obs-mcp@0.2.0`** : mot de passe obs-websocket stocké comme secret (masqué,
  fusionné par Rust). Refusés : lecture et modification de la clé de diffusion
  (`get/set_stream_service_settings`), paramètres de profil (`get/set_profile_parameter`),
  requêtes de plugins arbitraires (`call_vendor_request`). Port 4455 interdit aux commandes
  de l'agent. Le direct et l'enregistrement restent possibles, avec confirmation.
