# Moteur agent — état et feuille de route

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

Couverture actuelle (55 tests) :

- `toolCallAssembler.test.ts` : fragments, multi-appels, id généré ;
- `history.test.ts` : `shrinkText`, compaction, protection des résultats récents,
  arguments longs, tool_calls orphelins, taille ;
- `permissions.test.ts` : modes `ask` / `auto` / `plan` / `full` ;
- `autoRouter.test.ts` : routage fast/thinking/max/pro, mode plan, escalade ;
- `agentSession.test.ts` : réponse finale, outil, plan, vérification, nudge, retry, budget, annulation ;
- `toolPolicy.test.ts` : refus en mode plan, approbations ask/auto, espace ANZAR, automatisations ;
- `toolExecution.test.ts` : dispatch web, MCP, outil local, absence de projet ;
- `toolDisplay.test.ts` : résumés, chemins, deltas ;
- `useAgentChat.test.ts` : hook réel avec mocks — réponse finale, approbation, `ask_user`, plan, annulation, reprise après erreur, images `capture_page`, escalade Auto, `task_done`.
- `agentLoop.test.ts` : réponse finale, tool_call, `task_done` + vérification,
  échec de vérification, budget d’étapes, annulation (avec mocks des services
  Tauri/réseau).

`npm run smoke` exécute désormais : lint (sécurité + a11y + TypeScript) → tests →
build.

## 3. Ce qui reste

Le moteur de boucle est unifié, mais `useAgentChat` reste un gros adaptateur
(>1 000 lignes) à cause des décisions produit. Prochaines étapes :

1. Poursuivre le découpage : outils spéciaux (`ask_user`, `load_skill`,
   `propose_plan`), puis UI timeline/coûts (`chatSession.ts`).
2. Compléter les tests du hook sur l'espace ANZAR (sans projet) et les pièces
   jointes.
3. Tester `agentSession` avec un scénario multi-outils réel (build/lint) en
   environnement Tauri de test, puis valider manuellement sur un projet.
