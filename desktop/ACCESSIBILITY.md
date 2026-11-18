# Accessibilité — Desktop ANZAR

État : novembre 2026. Ce document décrit les motifs appliqués et ce qui reste à auditer.

---

## 1. Structure et navigation

- **Landmarks** : `TitleBar` est `role="banner"`, la sidebar est un `<aside>` étiqueté
  « Navigation des projets et tâches », le contenu est un `<main id="main-content">`.
- **Lien d'évitement** : « Aller au contenu » est le premier élément focusable
  (`AppLayout`), visible uniquement au clavier.
- **Focus visible** : la règle globale `:focus-visible` de `index.css` s'applique à
  tous les contrôles.

## 2. Dialogues

`src/hooks/useFocusTrap.ts` fournit un piège de focus réutilisable :

- focus initial sur le premier contrôle ;
- `Tab` / `Shift+Tab` cycliques ;
- `Échap` ferme ;
- restauration du focus à la fermeture.

Il est utilisé par :

- `ConfirmModal` (déjà),
- `RechargeModal`,
- `WorktreesDialog`,
- `CommandPalette`,
- les dialogues Git (`Commit`, `Push`),
- la visionneuse plein écran des visuels.

Chaque dialogue porte `role="dialog"`, `aria-modal="true"` et un titre
`aria-labelledby` (ou `aria-label`).

## 3. Menus et sélecteurs

- `ChatInput` : menus modèle/permissions en `role="menu"`, options
  `role="menuitemradio"` avec `aria-checked`, bouton `aria-haspopup`/`aria-expanded`.
- `ProjectPicker` et le sélecteur de branche Git : `role="menu"`, `role="menuitem"`,
  `aria-current` pour l'élément sélectionné.
- `WorkspacePanel` : barre d'onglets `role="tablist"`, onglets `role="tab"` avec
  `aria-selected`, `tabIndex` roving et navigation flèches/Home/End.
- `Sidebar` : les lignes projet/tâche sont de vrais `<button>` ; les actions
  (nouvelle tâche, supprimer) sont des boutons frères, plus de bouton imbriqué.
- `GitPanel` : l'en-tête d'un fichier est un bouton `aria-expanded` ; les actions
  sont des boutons séparés.

## 4. Libellés et annonces

- Tous les boutons icône utilisés dans les parcours principaux ont un
  `aria-label` explicite (joindre, envoyer, arrêter, fermer, rafraîchir, etc.).
- Le composeur (`textarea`) et les champs de dialogue (montant, message de commit,
  branche, filtre) ont un libellé.
- `SettingsPage` : chaque `Row` expose son libellé comme nom du groupe de contrôles
  (`role="group" aria-labelledby`).
- `MessageList` : région étiquetée « Conversation » et `role="status"
  aria-live="polite"` pour annoncer « ANZAR travaille… » sans lire chaque token.
- `QuestionPanel` : le compte à rebours repart à chaque interaction ; les choix
  déjà faits sont conservés à l'expiration.

## 5. Garde-fou automatique

`npm run a11y:check` (inclus dans `npm run lint`) vérifie :

- les invariants des dialogues (rôle, `aria-modal`, focus trap) ;
- les landmarks et le lien d'évitement ;
- la présence de `role="region"`/`aria-live` sur la conversation ;
- l'absence de `<div>`/`<span>` cliquables avec `cursor-pointer` sans rôle ni
  `tabIndex`.

```bash
cd desktop
npm run a11y:check
npm run lint   # sécurité + accessibilité + TypeScript
```

## 6. Reste à auditer

- Test lecteur d'écran réel (VoiceOver macOS / NVDA Windows) sur les parcours
  login → chat → agent → Git → paiement.
- Contraste des couleurs dans les deux thèmes (les jetons sont centralisés, mais
  aucun outil de contraste n'est intégré).
- Arborescence de fichiers : la sémantique `tree`/`treeitem` n'est pas encore
  appliquée ; les éléments sont des boutons navigables.
- Glisser-déposer : prévoir une alternative clavier complète.
- Liste virtualisée des messages : vérifier l'annonce des nouveaux messages avec
  un lecteur d'écran.
- `prefers-reduced-motion` est déjà respecté globalement (animations ramenées à
  120 ms).
