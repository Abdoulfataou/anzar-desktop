# Rapport de corrections (branche `refonte-agent`)

Aucun push, aucun tag, aucune publication. Un commit par étape :

| Étape | Commit |
|---|---|
| 1 — tests indépendants du Mac | `850fdfa` |
| 2 — réseau et shell | `dde069c` |
| 3 — écritures concurrentes des sous-agents | `94d35a4` |
| 4 — Windows | `f7379f7` |

## 1. Tests indépendants du Mac

- `bashTool.confinedShellAvailable()` ne répond `true` que sur macOS/Darwin,
  c'est-à-dire là où Rust (`sandbox::available`) isole réellement. Linux/X11 ne
  propose plus un shell que Rust refuserait.
- `src/test/setup.ts` accepte `ANZAR_TEST_PLATFORM=linux|mac` et simule
  `navigator.platform` / `navigator.userAgent` pour toute la suite.
- Le test d'escalade d'`AgentRunner` force explicitement macOS ; un test dédié
  vérifie que le shell est refusé en Linux et accepté en Mac.
- Un test Windows vérifie que `run_command` est proposé et `bash` absent.

Vérifié :

```
ANZAR_TEST_PLATFORM=linux npx vitest run  → 68 fichiers, 427 tests
ANZAR_TEST_PLATFORM=mac   npx vitest run  → 68 fichiers, 427 tests
```

## 2. Réseau et shell

Le proxy réseau avait été supprimé à l'étape précédente. Il ne restait que des
dépendances mortes, retirées ici :

- `netproxy.rs` supprimé ;
- paramètres `approved` / `network` / `proxy` / `proxyHosts` / `direct` retirés de
  `tool_spawn` et des appels de `terminal.ts` ;
- champs `networkOpen` retirés de `RuntimeFacts`, du prompt et de `turn.ts` ;
- plus de marqueur `[ANZAR] Réseau…`, de relance automatique ni de diagnostic réseau
  dans `toolHost.ts` ;
- commentaires de `tool_runner.rs` et `sandbox.rs` corrigés.

Les commandes, y compris `bash`, sortent donc directement : c'est le comportement
de Harness. Aucun accord « réseau coupé » ne subsiste, et aucun test ne dépend
d'une relance réseau supprimée.

## 3. Écritures concurrentes des sous-agents

Harness le dit explicitement (`packages/subagent/tool-subagent/README.md`) :
« Bash, formatters, code generators, and scripts can overwrite concurrent edits
without conflict detection; coordinate their changes explicitly. » Il n'y a donc
rien à copier : Harness ne gère pas ce conflit.

Minimum ajouté, conforme à la demande :

- registre par conversation (`policy/fileConflicts.ts`) : version d'un fichier,
  dernier écrivain, version lue par chaque agent ;
- un agent qui a lu un fichier et dont un **autre** agent l'a modifié depuis ne peut
  plus l'écrire ; le message lui dit de le relire avec `read_file` ;
- le même agent peut réécrire sans relire ; un fichier jamais lu reste autorisé ;
- l'identité est portée par `agentId` : `lead` pour le parent, id du sous-agent
  vivant, `conv:sub:n` pour `spawn_subagents` ;
- le contrôle est appliqué dans `executeGenericTool` (chat) et dans `agentLoop`
  (sous-agents), donc les deux chemins sont couverts ;
- limites : le registre est en mémoire et ne voit pas les modifications faites par
  un script ou un formateur hors outils.

Tests : `fileConflicts.test.ts` (conflit, relecture, même auteur, conversation
isolée) et `toolExecution.test.ts` (lecture parent, écriture enfant, écriture
parent refusée).

## 4. Windows

### Ce que fait Harness

`packages/sandbox/sandbox-windows-acl` utilise un **jeton restreint**
(`WRITE_RESTRICTED`), un SID/ACL par workspace, un répertoire temporaire privé,
puis `CreateProcessW` suspendu et un job object. Le backend rapporte
`enforcement: partial` (liens durs, limites AppContainer, lectures non confinées).

### Décision

**Non implémenté dans cette étape.** Ce n'est pas une décision de confort :

- le code vit sous `cfg(windows)` et ne peut pas être testé sur cette machine
  macOS ; l'écrire sans exécution réelle serait une fausse garantie ;
- il touche à la création de processus, aux ACL et aux SID : une erreur peut
  bloquer toutes les commandes ou ouvrir une écriture hors workspace ;
- la CI Windows actuelle compile le code `#[cfg(windows)]`, mais n'exécute pas les
  tests Seatbelt/ACL nécessaires.

### Plan

1. Ajouter un job CI Windows x64 qui exécute les tests ACL sur un workspace
   temporaire (écriture autorisée dans le workspace, refusée dans le home).
2. Porter `sandbox-windows-acl` en Rust/Tauri : création du SID workspace,
   ACE sur le projet et le temp, jeton restreint, `CreateProcessW` suspendu,
   assignation au job object, nettoyage des ACE à la fermeture.
3. Faire choisir le backend par `sandbox::available()` ; si l'ACL échoue,
   **fail closed** : pas de commande non confinée.
4. Ajouter les tests de refus d'écriture hors workspace, de lien dur et de
   suppression de fichier.
5. Garder l'avertissement actuel tant que ce backend n'est pas livré.

### Cohérence de l'agent sous Windows

- `toolList` propose `run_command`, jamais `bash` ;
- le prompt ne décrit que l'outil réellement proposé (`systemPrompt.ts`) ;
- les tests couvrent Windows (`run_command` présent, `bash` absent) et macOS
  (inverse) ;
- l'avertissement « isolation des écritures non garantie » reste visible dans les
  Paramètres et dans le prompt.

## 5. Vérifications finales

- `npx tsc --noEmit` : 0 erreur (les deux plateformes simulées) ;
- Vitest Linux simulé : 427 tests / 68 fichiers ;
- Vitest Mac simulé : 427 tests / 68 fichiers ;
- `cargo test` : 22 tests ;
- `cargo clippy --all-targets -- -D warnings -A clippy::too_many_arguments` :
  0 avertissement ;
- `node scripts/check-security.mjs` : OK ;
- `npx vite build` : OK.

Les tests de plateforme ne changent pas le comportement de l'app : seule la
disponibilité réelle du shell est corrigée (macOS uniquement), et le prompt suit
les outils réellement offerts.
