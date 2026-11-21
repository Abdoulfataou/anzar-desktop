# Banc d'essai du harnais

Exécute le **vrai `AgentRunner`** sur des scénarios déterministes et vérifie que les mécanismes
du harnais se comportent comme prévu. Lancer :

```bash
cd apps/desktop
npm run bench          # ou : npx vitest run bench --reporter=verbose
```

## Ce que le banc mesure

| Mécanisme | Scénarios |
|---|---|
| Boucle et arrêt | réponse texte, lecture → `task_done`, commande → `task_done` |
| Vérification | build vert, build déjà cassé (ligne de base), nouvel échec (refus ×3 → `verify_failed`) |
| Vérification ciblée | documentation seule (aucune commande), test associé (`npm test -- src/a.test.ts`), fichier de configuration (vérification complète) |
| Détection de boucle | appel d'outil identique répété → `loop_detected` |
| Budget | plafond FCFA atteint avant la fin → `budget_exhausted` |
| Mode plan | `propose_plan` → arrêt `plan` |
| Fin de tour | texte sans `task_done` → `final_answer` |

Chaque exécution affiche un récapitulatif : tâches, appels au modèle, commandes lancées et coût
FCFA **simulé**.

## Ce que le banc ne mesure pas

- **La qualité du modèle** : le script décrit ce que le modèle fait, pas comment il le décide.
  Le coût affiché est simulé (1 FCFA par appel) ; il sert à détecter une dérive du nombre
  d'étapes, pas à estimer une facture.
- **Les vrais fichiers et le vrai shell** : le dépôt est en mémoire, les commandes répondent
  selon l'état de ce dépôt. C'est délibéré : le banc tourne hors ligne, en quelques secondes,
  et ne dépend d'aucun outil installé.
- **Les composants** : le banc passe par `AgentRunner`, pas par l'interface.

Un défaut de l'application (Tauri, Rust) ne sera pas vu ici ; les tests unitaires et
`cargo test` couvrent ces couches.

## Ajouter une tâche

Une entrée dans [`tasks.ts`](tasks.ts) : dépôt de départ, script du modèle (une action par
appel), vérifications simulées, attentes.

```ts
{
  id: 'ma-tache',
  prompt: 'Passe x à 3.',
  files: { 'package.json': '…', 'src/a.ts': 'export const x = 1;' },
  script: [
    { a: 'edit', path: 'src/a.ts', old: 'x = 1', new: 'x = 3' },
    { a: 'done', summary: 'x = 3.' },
  ],
  checks: [{ command: 'npm test', ok: (repo) => repo['src/a.ts'].includes('x = 3'), failure: 'x ≠ 3' }],
  expect: { stop: 'task_done', files: { 'src/a.ts': 'x = 3' } },
}
```

Actions disponibles : `read`, `write`, `edit`, `cmd`, `done`, `text`, `plan`, `repeat`.
Attentes : `stop`, `files`, `command`, `notCommand`, `noCommands`, `minCalls`, `maxCalls`.
Un `budget` optionnel par tâche permet de tester l'arrêt sur plafond.

## Limites assumées et suite

- Le script est **déterministe** : il ne teste pas la robustesse à un modèle imprévisible.
- Prochaine étape : enregistrer des transcriptions réelles (SSE) de quelques tâches et les
  rejouer, pour mesurer le harnais face au vrai modèle sans dépendre du réseau.
