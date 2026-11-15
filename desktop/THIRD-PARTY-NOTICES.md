# Avis de tiers

## ZCode (Z.ai)

Certaines parties de l'interface d'ANZAR reprennent des valeurs et des règles de
présentation du projet ZCode :

- jetons de couleur des thèmes « Zai Light » et « Zai Dark »
  (`packages/ui/src/styles.css`) ;
- échelle typographique `text-ui-*` et règles d'arrondi (`DESIGN.md`) ;
- présentation des messages, du Markdown (titres, listes, tableaux, citations),
  des lignes d'outils, du résumé des fichiers modifiés, des lignes de tâches et
  du champ de saisie (`packages/ui/src/components/ai-elements/*`,
  `ToolCallBlocks/ToolSummaryRow.tsx`, `MessageChangeSummaryPanel.tsx`,
  `TaskListItem.tsx`, `prompt-editor/ChatPromptEditor.tsx`).

Ces éléments ont été adaptés (pas copiés tels quels) aux composants d'ANZAR.

Source : https://github.com/zai-org/ZCode
Copyright Z.ai. Distribué sous licence Apache License 2.0 :
https://www.apache.org/licenses/LICENSE-2.0

Les noms, logos et marques de ZCode et de Z.ai ne sont pas utilisés par ANZAR.
