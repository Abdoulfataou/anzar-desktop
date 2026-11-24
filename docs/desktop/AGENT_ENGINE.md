# Moteur agent — état et feuille de route

## 0. Organisation du code (novembre 2026)

```text
src/services/agent/
├── engine/      boucle générique (agentSession), adaptateur sous-agents (agentLoop),
│                assemblage des tool_calls, historique et compaction, timeline et coûts
├── tools/       registre (index.ts) + un fichier par famille d'outils :
│                fsTools, globTool, patchTool, shellTools, bashTool,
│                browserTools, mediaTools, metaTools,
│                definitions (schémas envoyés au modèle), shared (chemins confinés), types
├── policy/      modes d'approbation, décision d'approbation, garde des commandes,
│                politique des sous-agents
├── context/     prompts système, carte du code + ANZAR.md, pièces jointes, dossier de travail
├── subagents/   explorateurs (lecture seule) et spawn_subagents
├── verify/      détection et exécution lint / build / tests
├── runtime/     une conversation, sans React :
│                agentRunner (session : état, accords, questions, reprise),
│                turn (déroulé d'un tour : boucle, replis),
│                turnStart (dossier, pièces jointes, messages, budget, skills, connecteurs),
│                turnFinish (réponse finale, coût, chemins d'erreur),
│                turnVerify (référence de vérification, contrôle ciblé),
│                turnTypes (types publics), sessionSetup (prompt + historique),
│                toolList (outils exposés selon le mode), toolHost (exécution d'un appel),
│                turnFallbacks (sauvetage export, synthèse forcée), turnAccounting (coût),
│                sessionStore (sessions durables)
└── profiles/    un fichier Markdown par rôle d'agent (explorer, motion-designer, dev, redaction)
src/services/skills/
├── index.ts     chargement des skills (projet, personnelles, intégrées)
├── format.ts    lecture/écriture SKILL.md (agentskills.io, `allowed-tools` compris)
├── installer.ts installation depuis GitHub
├── remote.ts    skills servies par l'API
└── pack/        pack intégré + bibliothèques vendées (GSAP)
```

Règles :

- **Une seule boucle** : `engine/agentSession.ts` (`runAgentEngine`). Le chat, les sous-agents,
  les explorateurs et le sauvetage export en sont des adaptateurs. Les outils sans effet de
  bord (lecture, recherche, diagnostic, web en lecture) d'un même lot partent ensemble, 10 au
  plus ; tout outil qui écrit ou exécute forme une barrière et s'exécute seul, dans l'ordre.
  C'est le `isConcurrencySafe` de Harness, adapté aux outils d'ANZAR.
- **Pas de cycle d'imports** : les outils ne connaissent pas la boucle. Le lanceur de
  sous-agents leur est transmis par `ToolExecutionContext.runSubagent`.
- **Budget** : `engine/budget.ts` (`BudgetLedger`) borne un tour en étapes, tokens, FCFA et
  durée. Un sous-agent reçoit une **enveloppe dérivée** : `budget.child(share)` calcule une
  fraction du budget restant (80 % répartis entre les sous-agents, le parent garde 20 %) ; les
  tokens et FCFA consommés remontent au parent (comptabilité unique), les étapes restent
  locales pour ne pas consommer la boucle du parent. Le moteur vérifie le budget **avant chaque étape** et s'arrête en `budget_exhausted`
  sans lancer de synthèse payante ; le dépassement est coopératif (on refuse le pas suivant,
  on ne coupe pas un flux en cours). Budget interactif : 1 200 FCFA / 45 min. Travail de fond :
  200 FCFA / 15 min, surchargeable par automatisation (`budgetFCFA`, `maxMinutes`) et par
  ticket (`budgetFCFA`, `maxMinutes`). Le compteur FCFA du tour s'affiche sous la zone de
  saisie (`components/chat/BudgetBadge.tsx`).
- **Deux chemins de commande** : `policy/commands.json` reste la source de la liste blanche
  de `run_command` (TypeScript et Rust l'incluent), et le pré-contrôle TypeScript refuse avant
  la carte d'accord. Sur macOS, `bash` exécute une ligne `bash -c` sous Seatbelt : pas de liste
  blanche, mais l'écriture reste confinée au projet, aux temporaires et aux caches ; les
  opérations réservées à l'utilisateur (git push, reset --hard, clean -f, sudo) et les secrets
  évidents sont refusés par Rust. Windows et Linux gardent `run_command` et sa liste.
  Après un refus de Seatbelt, l'agent peut demander une **élévation à usage unique**
  (`sandbox_permissions: "danger-full-access"` + justification) : l'écriture est élargie hors
  du projet pour cet appel, tandis que secrets, hooks/config Git et réseau restent protégés ;
  une carte l'approuve hors Accès complet, l'appel suivant retrouve la politique normale.
- **Un seul sélecteur de permissions** : « Permissions » règle ensemble le mode d'accord et
  l'isolation. « Accès complet » est le `danger-full-access` de Harness : il retire Seatbelt
  et les demandes, après un avertissement unique et la confirmation native de Rust. Tout
  autre mode réactive l'isolation. L'élévation ponctuelle reste disponible hors Accès
  complet pour élargir une seule écriture sans changer de mode.
- **Rappel de boucle** : `engine/loopGuard.ts`. Après chaque appel, la signature
  `(outil, arguments normalisés)` est comparée au précédent : aux seuils 3, 5 et 8 appels
  identiques consécutifs, un rappel est ajouté après le lot d'outils. Il ne bloque rien et
  n'arrête jamais la session : le modèle relit le résultat et décide. Le budget du tour reste
  le seul plafond ; une répétition légitime (relancer le même test après une correction) est
  donc permise.
- **Sous-agents vivants** : `subagents/live.ts` tient un registre par conversation
  (8 actifs au plus, profondeur 1). Un enfant garde son historique, reçoit des messages
  (`send_message`), peut être attendu (`wait_agent`), listé (`list_agents`) et arrêté
  (`stop_agent`) ; il reprend après un message au lieu de repartir de zéro. Une fin de
  travail pousse une notification consommée au début du pas suivant par le parent
  (`beforeStep`). Le registre est persisté dans `localStorage` par conversation : les enfants
  au repos sont restaurés au redémarrage, ceux qui tournaient passent à `stopped`. Un
  `output_schema` optionnel fait valider un bloc ```json``` par `wait_agent`.
- **Accords à quatre issues** : `requestApproval` renvoie `allowed-once`, `rejected`,
  `cancelled` ou `unavailable` (vocabulaire de Harness). Le refus affiché au modèle distingue
  « l'utilisateur a refusé », « la demande a été annulée » et « aucun canal n'est disponible ».
- **Vérification** : à la fin du tour (réponse texte naturelle ou `task_done`), si l'agent a
  modifié le projet et que le réglage « vérifier après application » est actif, lint / build /
  tests sont lancés ; un échec renvoie les erreurs à l'agent (3 tentatives). `task_done` est
  optionnel : une réponse claire termine aussi le tour. Une commande qui exécute du code modifié par l'agent demande un accord.
- **Référence persistée** : la ligne de base (2 h) est écrite dans `store/baselines/` et relue
  au démarrage, au lieu d'être recapturée à chaque lancement (3 commandes par projet).
- **Vérification ciblée** : `verify/targeted.ts`. Les fichiers modifiés par l'agent (suivis par
  les snapshots) restreignent le contrôle : lint et tests limités aux fichiers concernés quand
  le script du projet utilise un outil reconnu (eslint/stylelint/ruff, vitest/jest/mocha),
  tests et typecheck écartés si seuls des styles changent, tout écarté si seuls des documents
  changent. Un fichier de configuration (package.json, tsconfig, lockfile…) force la
  vérification complète ; sinon les commandes restent entières. La référence complète et le
  contrôle ciblé sont comparés par **label** (`lint`, `test`, `build`), pas par ligne de
  commande, pour que le ciblage n'invente pas de « nouvel échec ».
- **Ligne de base de vérification** : `verify/baseline.ts`. Juste avant la **première écriture**
  du tour, les commandes de vérification sont lancées une fois (`Référence · …` dans la
  chronologie, plafond 2 min) et le résultat est mis en cache par projet. Au `task_done`, seuls
  les **nouveaux** échecs bloquent : un projet déjà rouge peut enfin atteindre `task_done`, et
  un échec identique déplacé de quelques lignes (chemin absolu, `ligne:colonne` et durées
  normalisés) est reconnu comme préexistant. Le résumé réinjecté ne contient que les erreurs
  imputables à l'agent.
- **Le harnais ne dépend pas de React** : `runtime/agentRunner.ts` (174 lignes) ne garde que
  la **session** — historique API, mode, accords et questions en attente, reprise — et expose
  un `TurnHost` au tour. `runtime/turnStart.ts` ouvre le tour (dossier, pièces jointes,
  messages, budget, route Auto, skills, connecteurs) et rend deux objets : `session` (ce qui
  est figé) et `progress` (ce qui évolue). `runtime/turn.ts` ne garde que la boucle et les
  replis ; `turnFinish` et `turnVerify` en sont les deux extrémités. Le reste est déjà
  découpé (`sessionSetup`, `toolList`, `toolHost`, `turnFallbacks`, `turnAccounting`,
  `sessionStore`, `turnTypes`). `hooks/useAgentChat.ts` n'est qu'un adaptateur
  (`useSyncExternalStore`). Les tickets (`services/superagent/ticketQueue.ts`)
  et les automatisations (`services/background/automationQueue.ts`) créent leur propre
  `AgentRunner`, sans composant ; `startBackgroundQueues()` les démarre avec la session.
- **Sessions durables** : `runtime/sessionStore.ts` écrit après chaque étape l'historique API
  complet de la conversation et un journal d'événements (`store/sessions/<id>.json` et
  `.events.jsonl`). Au redémarrage, une conversation reprend avec tout son contexte ; une réponse
  coupée par la fermeture de l'app est marquée et « continue » repart du bon endroit.
- **Carte du code** : `context/repoRank.ts` classe les fichiers par PageRank sur le graphe des
  imports (comme la repo map d'Aider). Le graphe est construit par `filesystem/codeIndexer.ts`.
  Les **symboles** (fonctions, classes, interfaces, types, énumérations, constantes,
  composants, hooks) viennent de **tree-sitter en WASM** (`filesystem/treeSitter.ts`) pour
  TypeScript, TSX, JavaScript et Python : grammaires chargées **paresseusement**, uniquement
  pour les langages présents, depuis `public/wasm/` (5,8 Mo, non inclus dans le bundle JS).
  Si une grammaire manque ou échoue, `indexProject` garde l'extraction regex : la carte ne
  peut pas disparaître. Le graphe d'imports reste l'analyseur regex — testé — avec les
  `export const` et les ré-exports (`export * from './x'`) corrigés en novembre 2026.
  **Indexation incrémentale** : `indexProjectIncremental(root, files)` compare une empreinte du
  contenu par fichier et ne re-parse que les fichiers modifiés (symboles repris du cache) ; le
  graphe est recalculé, car la résolution d'un import dépend de l'ensemble des fichiers (un
  fichier créé peut résoudre une arête inconnue). Tests : `codeIndexer.incremental.test.ts`.
  La carte générale reste identique d'un message à l'autre
  (cache DeepSeek) ; les indices de la tâche utilisent un PageRank personnalisé par les fichiers
  trouvés, qui fait remonter leurs voisins importants (store, utilitaires, types).
- **Condenser** : `engine/condenser.ts`. Le seuil est mesuré en jetons estimés (40 000) ;
  les vieux résultats d'outils sont d'abord élagués en gardant le début et la fin, puis
  réduits si nécessaire, et seulement ensuite le début de la session est résumé par
  `deepseek-flash` (réflexion courte, huit sections : demande, décisions, fichiers, erreurs,
  travail en cours, suites, contexte critique). Les 12 derniers messages restent intacts et
  chaque appel d'outil garde sa réponse. Si le résumé échoue, repli sur une compaction plus
  forte. Le coût du résumé est compté dans la réponse.
- **Fermer la fenêtre pendant un travail de fond** propose de la réduire (le travail continue)
  ou de quitter (le ticket reprendra au prochain lancement) : `services/background/closeGuard.ts`.
- **Ajouter un rôle d'agent** : créer `profiles/<nom>.md`, rien d'autre. Le frontmatter est
  appliqué : `kind` (`subagent` ou `explorer`), `tools` (le rôle ne peut **que réduire** les
  outils autorisés par le mode — `task_done` reste toujours disponible), `model` et
  `reasoning` (transmis au moteur du sous-agent), `max_steps`, `budget_fcfa` (plafonne
  l'enveloppe de budget dérivée du parent), `deny` (capacités refusées : `fs.write`,
  `shell.exec`, `network`), `output_max_chars` (longueur du résumé renvoyé au parent),
  `skills` (injectées dans son prompt), `keywords` (servent à deviner le rôle quand l'agent
  ne le précise pas). **Validation** : `profiles/validate.ts` vérifie nom, `kind`,
  description, outils connus, modèle et réflexion, bornes de `max_steps`, budget, capacités
  de `deny` et `output_max_chars` — un manifeste incohérent est signalé au lieu d'être
  silencieusement ignoré. `deny` est appliqué **par capacité** (`CAPABILITY_TOOLS` dans
  `policy/subagentPolicy.ts`) : un rôle interdit l'écriture ou le réseau sans lister chaque
  outil, et `task_done` reste toujours autorisé. La liste
  `SUBAGENT_ROLES` et l'énumération de l'outil `spawn_subagents` sont **dérivées du dossier** :
  un fichier `kind: subagent` crée un rôle sélectionnable.

Les chemins de la section suivante sont ceux d'avant cette réorganisation.

## 1. Ce qui a été consolidé

Le moteur existait sous deux formes :

- `src/hooks/useAgentChat.ts` — boucle principale, très riche (approbations, MCP,
  skills, `ask_user`, plan, espace ANZAR, coûts, reprise) ;
- `src/services/agent/agentLoop.ts` — boucle simplifiée utilisée par
  `spawn_subagents` (sous-agents).

Les briques purement techniques étaient dupliquées. Elles sont maintenant
partagées :

| Module | Rôle |
|---|---|
| `src/services/agent/agentSession.ts` | moteur générique : streaming, assemblage, boucle, erreurs, vérification, nudges |
| `src/services/agent/toolCallAssembler.ts` | assemble les tool_calls fragmentés du SSE |
| `src/services/agent/history.ts` | compaction compatible cache, taille d'historique, réparation des tool_calls orphelins |
| `src/services/agent/permissions.ts` | `PermissionMode`, catégories d'outils, `needsApproval` |
| `src/services/agent/toolPolicy.ts` | décision d'approbation (plan, ask, auto, MCP, risque, automatisation) |
| `src/services/agent/toolExecution.ts` | dispatch web / MCP / outil local |
| `src/services/agent/toolDisplay.ts` | résumé, chemin cliquable et delta de lignes |
| `src/services/agent/chatSession.ts` | timeline sérialisable, estimation de tokens et calcul du coût FCFA |
| `src/services/agent/attachments.ts` | contenu des pièces jointes borné et formaté |
| `src/services/agent/agentRoot.ts` | projet ouvert ou ouverture automatique de l'espace ANZAR |
| `src/services/agent/systemPrompt.ts` | prompt agent / sans projet et contexte de tâche |

Les deux boucles sont maintenant des adaptateurs de `runAgentEngine` :

- `agentLoop` fournit le stream, `executeToolCall`, et la vérification
  `runVerification` ;
- `useAgentChat` fournit le stream (modèle auto-routé), l'exécution complète des
  outils (approbations, MCP, skills, questions, plan, snapshots) et les callbacks
  UI (texte, raisonnement, coût, images, reprise).

La compaction de `agentLoop` utilise la version compatible avec le cache
fournisseur (au lieu de tronquer les résultats à chaque étape), et les deux
boucles partagent le même assembleur.

## 2. Tests

Le desktop n'avait aucun test. `vitest` est installé et la CI exécute désormais :

```bash
npm test
```

Couverture actuelle (121 tests) :

- `toolCallAssembler.test.ts` : fragments, multi-appels, id généré ;
- `history.test.ts` : `shrinkText`, compaction, protection des résultats récents,
  arguments longs, tool_calls orphelins, taille ;
- `permissions.test.ts` : modes `ask` / `auto` / `plan` / `full` ;
- `autoRouter.test.ts` : routage fast/thinking/max/pro, mode plan, escalade ;
- `agentSession.test.ts` : réponse finale, outil, plan, vérification, nudge, retry, budget, annulation ;
- `toolPolicy.test.ts` : refus en mode plan, approbations ask/auto, espace ANZAR, automatisations ;
- `toolExecution.test.ts` : dispatch web, MCP, outil local, absence de projet ;
- `toolDisplay.test.ts` : résumés, chemins, deltas ;
- `questions.test.ts` : normalisation des questions et formatage des réponses ;
- `specialTools.test.ts` : ask_user, load_skill et propose_plan ;
- `chatSession.test.ts` : timeline, snapshots, tokens et coût exact/solde/estimation ;
- `attachments.test.ts` : images, troncature, copie projet ;
- `agentRoot.test.ts` : projet, création ANZAR, fichier joint, arrière-plan ;
- `systemPrompt.test.ts` : prompt avec/sans projet, cache, mode plan, espace ANZAR.
- `useAgentChat.test.ts` : hook réel avec mocks — réponse finale, approbation, `ask_user`, plan, annulation, reprise après erreur, images `capture_page`, escalade Auto, espace ANZAR, `task_done` ;
- `commandGuard.test.ts` : `npx` refusé, installations/push risqués, capacités shell ;
- `webTools.test.ts` : refus loopback/privé/metadata ;
- `manager.test.ts` : `alwaysAsk` prioritaire, annotations MCP non fiables ;
- `VisualBlock.test.ts` : Mermaid filtré (scripts/foreignObject/onclick) ;
- `subagentPolicy.test.ts` : sous-agents Full avec écriture et shell, mais sans run_command/spawn/export ; lecture seule hors Full ;
- `commandPolicy.test.ts` : motifs interdits, chemins absolus, tokenisation et scope Tauri ;
- `pathSymlink.test.ts` : rejet d’un lien symbolique sortant du projet.
- `agentLoop.test.ts` : réponse finale, tool_call, `task_done` + vérification,
  échec de vérification, budget d’étapes, annulation (avec mocks des services
  Tauri/réseau).

`npm run smoke` exécute désormais : lint (sécurité + a11y + TypeScript) → tests →
build.

## 3. Ce qui reste

**Fait (21 novembre 2026).**

- L'adaptateur est découpé en trois temps : `agentRunner.ts` passe de 1 215 à 813 lignes (tour
  réparti dans `sessionSetup`, `toolList`, `toolHost`, `turnFallbacks`, `turnAccounting`), puis
  à **174 lignes** (session seule ; le tour dans `turn.ts`, ses extrémités dans `turnFinish.ts`
  et `turnVerify.ts`, reliées par `TurnHost`), puis la préparation sort dans `turnStart.ts`
  (`session` + `progress`) : `turn.ts` passe de 683 à 451 lignes de pure orchestration.
  Aucun de ces modules n'importe React ni un store ; `turnTypes`, `toolList`, `sessionSetup`
  et `turnAccounting` sont purs, seuls `toolHost` et `turnFallbacks` touchent encore les
  adaptateurs (terminal, service IA) — c'est ce que les ports viendront remplacer.
  Tests : `agentRunner.test.ts` (coût exact, vérification refusée puis acceptée, refus
  d'accord, boucle, `isGenerating`), `toolList.test.ts`, `sessionSetup.test.ts`,
  `turnAccounting.test.ts`.
- Budget de première classe : `engine/budget.ts`, vérifié avant chaque étape, affiché en
  FCFA, appliqué aux automatisations comme aux tickets, et **dérivé pour les sous-agents**.
- Détection de boucle : `engine/loopGuard.ts`, appels identiques bloqués, séries d'échecs
  arrêtées, synthèse de bilan, arrêt propagé aux tickets et automatisations.
- Profils d'agents réellement déclaratifs : rôles dérivés des fichiers, `tools` / `model` /
  `reasoning` / `keywords` appliqués, politique du mode intersectée avec le profil.
- Politique de commandes unique (`policy/commands.json`) partagée TypeScript/Rust, avec un
  test de parité dans chaque langage.
- Ligne de base de vérification : `verify/baseline.ts`, référence prise avant la première
  écriture et mise en cache par projet ; seuls les nouveaux échecs bloquent `task_done`.
- Vérification ciblée : `verify/targeted.ts`, lint et tests restreints aux fichiers modifiés,
  avec repli systématique sur la vérification complète en cas de doute.
- Carte du code : symboles extraits par **tree-sitter WASM** (TS/TSX/JS/Python, chargement
  paresseux, repli regex), `export const` indexés, ré-exports comptés comme dépendances.
  Tests : `treeSitter.test.ts` (grammaires, composants/hooks, Python) et
  `codeIndexer.test.ts` (résolution `./x`, `@/x`, index, `../`, PageRank).

- Budgets dérivés des sous-agents : enveloppe calculée sur le budget restant, consommation
  remontée au parent, étapes locales (`runtime/turn.ts` → `ToolRunContext.childBudget`).
- Sauvetage d'export : ce n'est plus un chemin d'exécution parallèle. Il reçoit l'hôte
  d'outils du tour (`executeTool`, `onToolCall`) et n'est qu'une variante à outils restreints
  (`export_animation` uniquement) de la même boucle.
- CI Rust : `cargo test --all-targets` et `clippy -D warnings` sur macOS.

**Prochaines étapes, dans l'ordre :**

1. **Registre à manifestes** : remplacer la lecture de fichiers Markdown par le manifeste
   validé décrit dans `docs/audits/2026-11-21-audit-architecture.md` (§6), avec isolation
   par agent.
2. **`turn.ts` sous 400 lignes** : en sortir les constantes et l'état des conversations de
   confiance (cosmétique, le fichier n'est plus qu'une boucle).
