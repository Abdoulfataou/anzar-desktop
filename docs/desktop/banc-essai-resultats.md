# Banc d'essai — résultats et protocole

Ce fichier consigne les résultats du banc décrit dans
[`banc-essai-agent.md`](banc-essai-agent.md). Il distingue trois choses :

1. les vérifications automatiques, exécutées ici et maintenant ;
2. le banc **scripté** du harnais (modèle simulé), qui vérifie la mécanique ;
3. le banc **réel** (ANZAR et Harness avec le vrai modèle), qui reste à lancer
   depuis l'application : il demande une session modèle, des crédits et le
   parcours guidé ci-dessous.

## 1. État au 24/11/2026

| Élément | Valeur |
|---|---|
| Commit ANZAR mesuré | `main` après la refonte de l'agent (24/11/2026) |
| Modèle | DeepSeek V4 (non lancé ici) |
| Machine | Mac Apple Silicon, macOS |
| Vérifications | `tsc --noEmit` 0 erreur ; `vitest run` 475 tests / 72 fichiers ; `cargo test` 46 tests ; `cargo clippy --all-targets -- -D warnings` 0 avertissement ; `check-security.mjs` OK |
| Banc scripté | 14 tâches, 36 appels modèle simulés, 31 commandes, 36 FCFA simulés — 15 tests OK |
| Banc réel | **non exécuté** : il faut l'application, une session modèle et des crédits |

Aucune mesure de crédits réelle n'est donc revendiquée ici. Les chiffres
automatiques vérifient que le harnais ne casse pas ; ils ne mesurent pas la
qualité du modèle.

## 2. Ce que le banc scripté vérifie

Le banc `apps/desktop/bench/bench.test.ts` exécute le vrai `AgentRunner` avec un
modèle scripté, sur 14 scénarios : réponse simple, lecture puis fin, écriture,
édition puis tests, build déjà cassé, nouvelle erreur, répétition identique,
budget épuisé, texte sans `task_done`, mode plan, ciblage des tests, fichier
global, commande simple. Il vérifie que :

- la boucle s'arrête sur `task_done`, `final_answer`, `plan` ou `budget_exhausted` ;
- une répétition identique **n'arrête plus** la session : la tâche va au bout et
  un rappel est injecté (scénario `boucle-identique`) ;
- le budget coupe au bon moment, sans appel de synthèse payant ;
- la vérification ciblée ne bloque pas un projet déjà cassé.

## 3. Protocole du banc réel

Pour chaque tâche de `banc-essai-agent.md` :

1. préparer deux dossiers identiques, `~/Desktop/banc-anzar/<tâche>` et
   `~/Desktop/banc-dsh/<tâche>` ;
2. lancer ANZAR (version mesurée) et Harness (profil `standard`), même modèle et
   même effort de réflexion ;
3. coller la demande exacte, sans aide ;
4. noter les interventions humaines (cartes d'accord, questions) ;
5. exécuter le critère objectif de la tâche et remplir une ligne du CSV ;
6. refaire trois passages, garder la médiane.

Le relevé se fait dans `docs/desktop/banc-essai-resultats.csv` (à créer au
premier passage) avec les colonnes définies dans le banc.

## 4. Points de comparaison attendus (à confirmer par la mesure)

Ces attentes viennent de l'analyse du code, pas d'une mesure. Elles servent à
interpréter le CSV, pas à le remplacer.

| Tâche | Avant (code `e058e56`) | Après (ce commit) | Ce qu'il faut regarder |
|---|---|---|---|
| T3 — test rouge | deux exécutions identiques du même test pouvaient être bloquées puis arrêter la session | les exécutions sont permises, un rappel arrive après 3 répétitions | `appels_bloques`, `arret_boucle`, `boucles_identiques` |
| T1 — Flutter + git | nombreuses commandes séparées, carte possible pour `git push`/`git config` | `bash` enchaîne les commandes, `git init` reste permis, les hooks restent protégés | `appels_outils`, `refus`, `contournements` |
| T5 — renommage | un `edit_file` par fichier, imports oubliés | `apply_patch` fait le renommage en un appel | `appels_outils`, `diff_lignes`, `qualite` |
| T4 — dépendances | carte d'installation, relance réseau, risque de `--offline` | carte seulement pour le risque, proxy réparé, refus réseau actionnable | `interventions_humaines`, `contournements` |
| T10 — hors projet | refus puis tentatives de contournement | refus immédiat, message qui dit quoi faire, shell qui refuse les secrets | `refus_sans_alternative`, `contournements` |

## 5. Ce qui reste à faire

- Lancer le banc réel sur au moins T3, T1, T5 et T10 avant/après : ce sont les
  tâches qui mesurent les boucles, les contournements et le coût en appels.
- Remplir le CSV et comparer les médianes.
- Si un écart négatif apparaît (par exemple plus d'appels sur T2), l'ajouter ici
  avec la cause avant de conclure.
