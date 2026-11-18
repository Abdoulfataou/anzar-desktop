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
| `src/services/agent/toolCallAssembler.ts` | assemble les tool_calls fragmentés du SSE |
| `src/services/agent/history.ts` | compaction compatible cache, taille d'historique, réparation des tool_calls orphelins |
| `src/services/agent/permissions.ts` | `PermissionMode`, catégories d'outils, `needsApproval` |

Les deux boucles importent ces modules. La compaction de `agentLoop` utilise
désormais la version compatible avec le cache fournisseur (au lieu de tronquer
les résultats à chaque étape), et les deux boucles partagent le même assembleur.

## 2. Tests

Le desktop n'avait aucun test. `vitest` est installé et la CI exécute désormais :

```bash
npm test
```

Couverture actuelle (26 tests) :

- `toolCallAssembler.test.ts` : fragments, multi-appels, id généré ;
- `history.test.ts` : `shrinkText`, compaction, protection des résultats récents,
  arguments longs, tool_calls orphelins, taille ;
- `permissions.test.ts` : modes `ask` / `auto` / `plan` / `full` ;
- `autoRouter.test.ts` : routage fast/thinking/max/pro, mode plan, escalade ;
- `agentLoop.test.ts` : réponse finale, tool_call, `task_done` + vérification,
  échec de vérification, budget d’étapes, annulation (avec mocks des services
  Tauri/réseau).

`npm run smoke` exécute désormais : lint (sécurité + a11y + TypeScript) → tests →
build.

## 3. Ce qui reste pour unifier complètement

La boucle principale (`useAgentChat`) reste un hook de plus de 1 000 lignes, car
elle porte des décisions produit (approbation interactive, questions, plan,
connecteurs, coûts, reprise). La prochaine étape naturelle est un **moteur de
session** générique :

1. Définir `AgentSessionOptions` avec des callbacks :
   `beforeTool`, `executeTool`, `onText`, `onToolEvent`, `onUsage`, `onPlan`,
   `onApproval`, `verify`.
2. Extraire la mécanique de boucle (streaming, assemblage, compaction, max steps,
   gestion d'erreurs, `task_done`) dans `agentSession.ts`.
3. Faire de `useAgentChat` un adaptateur UI de ce moteur ; faire de `agentLoop`
   un adaptateur « sous-agent ».
4. Ajouter des tests de non-régression sur les parcours UI critiques (approbation,
   annulation, reprise) avec React Testing Library + mocks Tauri.

Tant que cette étape n'est pas faite, les deux boucles partagent les primitives
mais gardent leurs orchestrateurs distincts.
