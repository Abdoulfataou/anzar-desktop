# Mission : rendre l'agent d'ANZAR aussi capable que celui de DeepSeek Harness

Réponds-moi toujours en français. Tu travailles dans le dépôt ANZAR (`~/Desktop/ANZAR`).
Divise le travail en étapes ; quand tu as fini une étape, présente-la et attends « continue ».

## 1. Le constat

ANZAR est une app de bureau (Tauri 2 + React/TypeScript + Rust) : un agent de « vibecoding »
100 % DeepSeek (modèles DeepSeek V4 via le serveur ANZAR, crédits prépayés). Les utilisateurs
sont des débutants : tout doit marcher par défaut, sans aller dans les Paramètres.

**Problème :** l'agent d'ANZAR est nettement moins efficace que celui de DeepSeek Harness
(et que ZCode), à modèle égal. Il n'a jamais été repris de Harness : sa boucle, ses consignes,
ses outils et ses garde-fous ont été écrits pour ANZAR, couche par couche. Résultat :

- **Il tourne en rond.** Une commande est refusée → l'agent ne sait pas ce qui EST permis →
  il essaie une variante → nouveau refus → le détecteur de boucles bloque ou coupe la tâche.
- **Il contourne les garde-fous.** Exemple réel (24/11/2026) : dans un projet sans dépôt,
  l'isolation empêchait `git init` (écriture de `.git/config` et `.git/hooks`). L'agent a écrit
  « je crée la structure du dépôt à la main pour contourner », a tenté d'écrire `.git/config`,
  puis a utilisé `git init --separate-git-dir=.gitstore`, ce qui sortait le dépôt des chemins
  protégés. (Corrigé depuis : `git init` simple autorisé, options qui déplacent le dépôt refusées.)
- **Les garde-fous se gênent entre eux.** Exemples réels du même jour, tous corrigés à la main :
  - `flutter pub get` échouait (« socket error … pub.dev ») à cause du proxy réseau local ;
    l'agent a alors basculé en `--offline` au lieu de signaler le problème ;
  - « Accès complet » demandait encore des autorisations ;
  - le bouton Stop n'arrêtait pas la commande en cours ;
  - `python` était introuvable sur Mac (seul `python3` existe), d'où un échec puis un nouvel essai.
- **Pas de vrai shell.** L'agent n'a qu'un `run_command` : un seul programme par appel, pris dans
  une liste blanche, sans `&&`, sans pipe ni redirection. Harness donne au modèle un **shell Bash
  confiné** (et un éditeur `str_replace`) : c'est sa configuration « Minimal », celle de ses
  benchmarks.

## 2. Les garde-fous actuels d'ANZAR (à inventorier, juger et simplifier)

Lis chaque fichier avant de juger. Tous les chemins sont relatifs à `apps/desktop/`.

| Couche | Où | Ce qu'elle fait |
|---|---|---|
| Liste blanche de programmes + règles par sous-commande | `src/services/agent/policy/commands.json`, `commandPolicy.ts` ; en Rust `src-tauri/src/tool_runner.rs` (`is_allowed_program`, `validate_args`, `is_denied_program`) | Programme hors liste = carte d'accord ; refus de `node -e`, `python -c`, `git config`, `git push`, `git reset --hard`, `git clean`, `npm exec/publish`, options git `-C/--git-dir/--separate-git-dir/--template`… ; installations (`npm install`, `flutter pub get`…) seulement avec accord |
| Analyse de risque des commandes (« garde S3 ») | `src/services/agent/policy/commandGuard.ts` | Accord demandé si la commande exécute un fichier écrit par l'agent, un script de build modifié, une installation, une sortie réseau git… |
| Modes de permission | `policy/permissions.ts`, `policy/toolPolicy.ts` (`approvalDecision`) | `ask` / `auto` / `plan` / `full` ; « Accès complet » ne demande plus rien après un avertissement, sauf pour les connecteurs « toujours demander » et après un contenu externe suspect |
| Contenu externe (web, connecteurs) | `policy/untrusted.ts` | Marqué comme donnée ; accord demandé ensuite pour les commandes (en Full seulement si une injection est repérée) |
| Isolation des processus (macOS) | `src-tauri/src/sandbox.rs` (Seatbelt) | Écriture limitée au projet, au dépôt git, aux dossiers temporaires et aux caches d'outils ; hooks et config git en lecture seule (`GIT_PROTECT`) ; `~/.ssh`, `~/.aws`… illisibles ; ports locaux de GIMP, Blender et OBS bloqués |
| Réseau | `sandbox.rs` (`NETWORK_RULES`, `network_allowed`), `src-tauri/src/netproxy.rs`, `command_policy.rs` | Sortie directe coupée ; passage par un proxy local avec liste d'hôtes ; internet seulement pour les téléchargements et les installations acceptées ; autodiagnostic (hôte injoignable → nouvel essai, outil qui ignore le proxy → relance directe) |
| Accords à usage unique | `src/services/runtime/terminal.ts` (`grantInstall`, `grantNetwork`, `grantDirect`) | Rust refuse une installation sans le drapeau d'accord |
| Détecteur de boucles | `src/services/agent/engine/` (`agentSession.ts` : `loop.before/after/exhausted`, `maxConsecutiveErrors`) | **Bloque** un appel identique déjà vu ou déjà refusé, et coupe la session |
| Explications après un refus | `terminal.ts` (`withSandboxHint`) | Ajoute un texte « [ANZAR] … » à la sortie |
| Système de fichiers | `src-tauri/capabilities/migrated.json` (`fs:scope`, liste deny) | `.env`, clés, `.ssh`… interdits |
| Connecteurs MCP | `src-tauri/src/mcp.rs` (lanceurs `npx`/`uvx`, versions figées, outils refusés), `src/services/mcp/config.ts` | Outils qui exécutent du code refusés ; `alwaysAsk` sur GIMP, Blender, Inkscape, Audacity, OBS |
| Vérification après le tour | `src/services/agent/verify/agentVerifier.ts`, `runtime/turnVerify.ts` | lint, build et tests après modification ; `task_done` refusé si échec |

Cœur de l'agent : `src/services/agent/engine/agentSession.ts` (boucle),
`runtime/turn.ts`, `turnStart.ts`, `toolHost.ts` (exécution des outils et accords),
`context/systemPrompt.ts`, `context/agentPrompts.ts` (consignes), `tools/definitions.ts` et
`tools/*.ts` (outils), `subagents/`.

## 3. Ce que fait DeepSeek Harness (à étudier dans le code, MIT)

```bash
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git /tmp/dsh
```

Ce que j'y ai déjà vu (à vérifier et à approfondir) :

- **Isolation simple, à trois modes** (`packages/sandbox/*`, `docs/subsystems/sandbox.md`) :
  `read-only`, `workspace-write` (écriture dans l'espace de travail et les dossiers temporaires),
  `danger-full-access`. Seatbelt sur macOS, bwrap/Landlock sur Linux, jeton restreint et ACL sur
  Windows. Le niveau d'application réel (`full`/`partial`) est rapporté, pas supposé. Un refus est
  remonté au modèle **comme un fait**. Un **nouvel essai avec élévation**, à usage unique et
  approuvé, remplace le contournement improvisé.
- **Accords** (`packages/interaction/user-approval`, `docs/subsystems/approval.md`) : un seul
  service. Réponses `allowed-once` / `rejected` / `cancelled` / `unavailable`, et refus par défaut
  en cas de doute. Politique par session : `ask` ou `never` (mode sans surveillance).
- **Profils de permissions** (`packages/interaction/permission-presets`) : un seul sélecteur
  « Permissions » qui règle **ensemble** l'isolation et la politique d'accord. C'est l'équivalent
  propre des modes d'ANZAR.
- **Boucles** (`packages/guard/repeat-tool-reminder`) : un simple **rappel**, qui ne bloque jamais.
  Au bout de N appels identiques, il demande au modèle de relire le résultat et de changer
  d'approche ou de finir. `timeout-policy` donne une erreur claire au lieu d'une attente sans fin.
- **Shell** (`packages/shell/bash-sandbox`) : un vrai Bash, confiné par l'isolation, au premier
  plan ou en arrière-plan avec relecture de la sortie. Pas de liste blanche de programmes.
- **Fichiers** : `packages/fs/tool-str-replace-editor`, `fs-patch`, `fs-sandbox`.
- **Consignes système** (`packages/core/system-prompt`) : sections ordonnées, faits d'exécution,
  schémas d'outils ; seul le texte nouveau ou modifié est renvoyé (cache des préfixes DeepSeek).
- **Contexte long** (`packages/compaction/*`), **sous-agents** (`packages/subagent`),
  **profils d'agent** (`packages/preset`), **plan** et **todo**.
- `SAFETY.md`, `BENCHMARK.md`, `AGENTS.md` et `docs/subsystems/tools.md` : à lire en premier.

## 4. Travail demandé, par étapes

**Étape 1 — Étude (aucune modification).** Lis le code et la doc de Harness cités plus haut,
puis le cœur de l'agent d'ANZAR. Rends un tableau comparatif sur ces points : consignes système,
outils (shell, fichiers, recherche), boucle, contexte et compaction, sous-agents, isolation,
accords, boucles, réseau, erreurs vues par le modèle. Pour chaque écart, indique ce qui explique
la différence d'efficacité, et ce que tu proposes de reprendre (avec les fichiers sources).

**Étape 2 — Banc d'essai.** Écris `docs/desktop/banc-essai-agent.md` avec une dizaine de tâches
réelles. Exemples :
- créer un projet Flutter avec `git init` et un premier commit ;
- créer une app Vite + React et la lancer ;
- corriger un bug signalé par un test qui échoue ;
- ajouter une dépendance pub et npm ;
- renommer un module sur plusieurs fichiers ;
- lire un projet inconnu et le résumer ;
- trouver la cause d'une erreur de build Gradle ;
- écrire un script Python et l'exécuter ;
- une tâche longue qui demande la compaction du contexte.

Pour chaque tâche, définis comment mesurer : réussite, nombre d'appels d'outils, refus, boucles,
contournements, crédits consommés. Je les lancerai dans ANZAR et dans Harness.

**Étape 3 — Portage de l'agent.** Reprends de Harness (licence MIT : garde la mention dans
`THIRD_PARTY_NOTICES` et en tête des fichiers repris) ce qui fait la différence :
- consignes système et descriptions d'outils ;
- un outil **shell confiné** à la place du `run_command` en liste blanche, avec arrière-plan et
  relecture de la sortie ;
- l'éditeur `str_replace` ;
- la compaction ;
- le rappel de boucle (non bloquant) ;
- les délais clairs.

Adapte à ANZAR : appels du modèle via le serveur ANZAR (facturation en crédits, voir
`src/services/ai/ai.ts`), langue de réponse (`context/replyLanguage.ts`), connecteurs MCP,
compétences, rapports d'erreurs (`services/infra/errorReports.ts`), bouton Stop (signal
d'arrêt jusqu'au processus : `terminal.ts` + `tool_kill`).

**Étape 4 — Garde-fous simplifiés.** Remplace l'empilement actuel par le modèle de Harness :
- un sélecteur de permissions (isolation + accords ensemble) ;
- un seul service d'accord ;
- l'isolation au niveau du système d'exploitation comme vraie frontière ;
- un nouvel essai avec élévation, approuvé et à usage unique, au lieu des contournements.

Chaque refus doit dire au modèle **ce qui est permis et quoi faire à la place**. Supprime les
règles en double. Ces invariants doivent rester vrais :
1. Rien n'écrit hors du projet, des dossiers temporaires et des caches d'outils, sauf élévation
   approuvée.
2. `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.netrc`, `~/.git-credentials`, `.env` et les clés
   restent illisibles pour l'agent.
3. Les hooks et la config git du projet ne sont jamais écrits par l'agent (un hook s'exécuterait
   plus tard dans le Git de l'utilisateur, hors isolation). `git init` simple reste permis.
4. Le contenu web ou de connecteur est une donnée. Une consigne cachée qui y est repérée déclenche
   une demande d'accord, même en Accès complet.
5. « Accès complet » = un avertissement accepté une fois, puis plus aucune demande (en dehors du
   point 4 et des connecteurs réglés « toujours demander »).
6. Les connecteurs gardent leurs outils refusés (exécution de code de GIMP, Blender, Inkscape ;
   clé de diffusion d'OBS ; micro d'Audacity) et leurs ports bloqués pour les commandes.
7. Mac et Windows : ce que l'isolation ne peut pas garantir sous Windows est signalé, pas supposé.

**Étape 5 — Mesure et livraison.** Relance le banc d'essai, compare avec les mesures avant et
après, puis prépare les notes de version dans `apps/desktop/NOUVEAUTES.md`.

## 5. Règles du dépôt

- Commite localement, avec des messages clairs en français. Je pousse moi-même (`git push`).
- Jamais de secret ni de clé dans le code ou dans un commit.
- Ne casse pas les Dockerfile : celui du site contient volontairement `setcap -r /usr/bin/caddy`
  et tourne sans root ; garde ces deux points.
- Vérifie avant de dire que c'est fini :
  - `npx tsc --noEmit` et `npx vitest run` dans `apps/desktop` ;
  - `cargo test` et `cargo clippy --all-targets -- -D warnings -A clippy::too_many_arguments`
    dans `apps/desktop/src-tauri` ;
  - `pytest` dans `services/api` si le serveur change.
- Les tests réels de Seatbelt ne tournent que sur macOS (en CI : `.github/workflows/ci.yml`).
- Publication d'une version : `./scripts/nouvelle-version.sh X.Y.Z`, puis je pousse le tag.
- Utilisateurs débutants : messages courts, clairs, en français, sans jargon.
