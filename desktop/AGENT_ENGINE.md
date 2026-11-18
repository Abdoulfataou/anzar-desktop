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

Couverture actuelle (103 tests) :

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
- `VisualBlock.test.ts` : Mermaid filtré (scripts/foreignObject/onclick).
- `agentLoop.test.ts` : réponse finale, tool_call, `task_done` + vérification,
  échec de vérification, budget d’étapes, annulation (avec mocks des services
  Tauri/réseau).

`npm run smoke` exécute désormais : lint (sécurité + a11y + TypeScript) → tests →
build.

## 3. Ce qui reste

Le moteur de boucle est unifié, mais `useAgentChat` reste un gros adaptateur
(>1 000 lignes) à cause des décisions produit. Prochaines étapes :

1. Tester les pièces jointes de bout en bout dans le hook (copie + contenu).
2. Tester `agentSession` avec un scénario multi-outils réel (build/lint) en
   environnement Tauri de test, puis valider manuellement sur un projet.
3. Réduire encore l'adaptateur (reprise, prompt de reprise, comptabilité).
