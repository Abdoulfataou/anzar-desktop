# Banc réel — ANZAR (avant/après) contre DeepSeek Harness

Ce dossier fait tourner le **vrai agent d'ANZAR** (le vrai `AgentRunner`, le vrai modèle,
les vraies commandes) et le **vrai CLI dsh** hors interface, sur les tâches de
[`docs/desktop/banc-essai-agent.md`](../../../docs/desktop/banc-essai-agent.md), puis
remplit [`docs/desktop/banc-essai-resultats.csv`](../../../docs/desktop/banc-essai-resultats.csv).

Rien n'est simulé sauf en mode fumée : chaque passage appelle le modèle et consomme des
crédits. Aucun jeton n'est jamais écrit dans un fichier (variables d'environnement
uniquement).

## 1. Ce qui est en place

| Fichier | Rôle |
|---|---|
| `bench-real.test.ts` | Banc ANZAR : prépare un dossier par passage, exécute un tour du vrai `AgentRunner`, relève les mesures, écrit un rapport |
| `tauriHost.ts` | Shim du backend Rust de l'app (commandes, fichiers, événements) : les commandes de l'agent partent dans le **même sandbox-exec Seatbelt** que l'app, avec la politique du commit mesuré |
| `seatbelt.ts` | Profils Seatbelt des deux variantes, recopiés de `src-tauri/src/sandbox.rs` (`avant` : e058e56 — hooks git protégés, secrets illisibles ; `après` : refonte — `.git` inscriptible, réseau libre, shell confiné) |
| `commands-avant.json` | Copie de `commands.json` à e058e56 (supprimé depuis) : la liste de programmes de la variante `avant` |
| `shim.test.ts` | Fidélité du shim : refus npm/git/python de l'« avant », exception `git init`, isolation Seatbelt réelle — zéro crédit |
| `runner.ts` | Un passage : dossier vierge, `AgentRunner`, critère objectif (`verifier.sh`), mesures, rapport JSON |
| `tasks.ts` | Les 4 tâches (demandes exactes, fixtures, critères) |
| `measures.ts` | Mesures du banc (§3 de la doc) depuis le journal de session et l'historique API |
| `dsh-bench.test.ts` + `dsh.ts` | Banc Harness : `dsh --profile headless --json --permission-mode workspace-write`, mesures depuis le flux NDJSON |
| `collect.test.ts` | Rapports → CSV du dépôt + médianes par (agent, tâche) |
| `smoke.ts` | Modèle simulé local : valide la plomberie **sans aucun crédit** (mode fumée) |

## 2. Prérequis

- macOS avec `/usr/bin/sandbox-exec` (l'isolation des commandes, comme l'app).
- Flutter, Node, git sur le PATH (les tâches T1, T3, T5 les utilisent).
- `~/Desktop/banc` : racine du banc (dossiers de passage, store, rapports).
- Worktree « avant » : `git worktree add ~/Desktop/banc/avant e058e56`, puis copier
  `apps/desktop/bench/real` et `bench/fixtures` dedans et `npm install` dans son
  `apps/desktop`. (Déjà fait sur cette machine.)
- Deux secrets, **en variables d'environnement** :
  - `ANZAR_BENCH_TOKEN` : jeton de session du serveur ANZAR (celui de l'app connectée) ;
  - `DEEPSEEK_API_KEY` : clé API DeepSeek officielle pour `dsh --profile headless`
    (le profil headless n'utilise ni le compte de l'app ni son stockage de clés —
    vérifié dans sa config : `deepseek-account` et `credentials-local` y sont désactivés).

Sans `ANZAR_BENCH_TOKEN`, le banc ANZAR **s'arrête avec une explication** au lieu de
tourner : aucun résultat n'est inventé. Sans `DEEPSEEK_API_KEY`, même chose côté dsh.

## 3. Lancer

Toutes les commandes se lancent depuis `apps/desktop` d'un worktree.

```bash
# 0. Valider la plomberie sans dépenser un crédit (modèle simulé) :
ANZAR_BENCH_REAL=1 ANZAR_BENCH_SMOKE=1 ANZAR_BENCH_TASKS=t3 npx vitest run bench/real

# 1. ANZAR « après » (ce worktree, refonte-agent) :
ANZAR_BENCH_REAL=1 ANZAR_BENCH_TOKEN="<jeton>" \
  npx vitest run bench/real/bench-real.test.ts --testTimeout=3600000

# 2. ANZAR « avant » (worktree e058e56) :
cd ~/Desktop/banc/avant/apps/desktop
ANZAR_BENCH_REAL=1 ANZAR_BENCH_VARIANT=avant ANZAR_BENCH_TOKEN="<jeton>" \
  npx vitest run bench/real/bench-real.test.ts --testTimeout=3600000

# 3. Harness (dsh headless) :
export DEEPSEEK_API_KEY="<clé DeepSeek>"
ANZAR_BENCH_REAL=1 npx vitest run bench/real/dsh-bench.test.ts --testTimeout=3600000

# 4. Remplir le CSV du dépôt + afficher les médianes :
ANZAR_BENCH_COLLECT=1 npx vitest run bench/real/collect.test.ts
```

Variables communes : `ANZAR_BENCH_TASKS` (`t1,t3,t5,t10` par défaut), `ANZAR_BENCH_PASSES`
(3 par défaut), `ANZAR_BENCH_WORK` (`~/Desktop/banc`), `ANZAR_BENCH_FIXTURES`,
`ANZAR_BENCH_DSH` (chemin du CLI dsh).

Un passage déjà fait (rapport présent dans `~/Desktop/banc/results/`) est **sauté** :
une campagne interrompue reprend où elle s'était arrêtée.

## 4. Égalité des conditions (vérifiée)

- **Modèle** : `deepseek-flash`, effort de réflexion `high` des deux côtés — ANZAR avec
  `model: 'thinking'` (fixé par le banc, pas de routage Auto), dsh avec le défaut de son
  profil headless (lu dans la session persistée d'un passage de calibrage :
  `model: deepseek-flash, reasoningEffort: high`).
- **Isolation** : ANZAR isole chaque commande avec le profil Seatbelt de son commit ;
  dsh tourne en `--permission-mode workspace-write` (son sandbox standard).
- **Approbations** : personne ne répond. Côté ANZAR, les cartes sont refusées et comptées
  comme interventions ; côté dsh, la politique `ask` sans répondant refuse l'action
  (`unavailable`, fail closed — comportement du profil, vérifié dans son code).
- **Demandes et dossiers** : mêmes textes mot pour mot (`tasks.ts`), dossiers recréés
  vierges depuis les mêmes fixtures à chaque passage.
- **Coûts** : ANZAR lit son coût exact sur son serveur ; dsh n'expose pas de coût —
  le CSV note « coût estimé » (grille ANZAR, 250/1000 FCFA par 1M tokens entrée/sortie).

## 5. Ce que le banc mesure

Toutes les colonnes de la §3 de la doc : réussite (critère objectif), qualité, appels
d'outils, étapes modèle, tokens, crédits, durée, interventions humaines, refus (et refus
sans alternative), boucles identiques, appels bloqués, arrêt sur boucle, contournements,
erreurs d'outil, faux échecs. Les mesures ANZAR viennent du journal de session
(`.events.jsonl`) et de l'historique API ; les mesures dsh viennent du flux `--json`
(format du paquet `dsh-headless`). Les traces brutes sont conservées dans
`~/Desktop/banc/results/traces/` pour l'analyse des causes (§ étape 4 du banc).

## 6. Limites connues

- Le relais réseau de l'« avant » (netproxy, e058e56) n'est pas répliqué : ses
  installations sont refusées avant tout accès réseau par le gate d'accord, et aucune
  tâche du banc ne dépend de son filtrage d'hôtes.
- Le coût dsh est une estimation de grille, pas une facture : la comparaison des
  crédits ANZAR/dsh est indicative (le banc le dit aussi).
- Les tâches T1 et T2 utilisent le réseau réel (pub, npm) : le banc exige la même
  connexion pour tout le monde.
