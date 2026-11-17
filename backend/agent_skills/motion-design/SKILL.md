---
name: motion-design
description: Animer une interface ou créer une animation (entrée de page, transitions, micro-interactions, texte animé, logo animé) avec un mouvement fluide et utile. À charger avant d'ajouter ou de régler des animations.
---

# Motion design : un mouvement qui a une raison

Une animation sert à guider l'œil, montrer ce qui a changé ou donner du caractère. Si elle ne fait aucune de ces trois choses, supprime-la.

## 1. Choisir où animer

- **Une seule séquence orchestrée** vaut mieux que des effets partout : par exemple l'entrée de la page d'accueil, ou la confirmation d'une commande.
- **Les réponses aux actions** sont toujours bienvenues : ouvrir, fermer, ajouter au panier, valider. Elles montrent ce qui a changé.
- **À éviter** : chaque bloc qui glisse en apparaissant au défilement, des survols animés sur toutes les cartes, des boucles infinies qui distraient.

## 2. Durées

| Usage | Durée |
|---|---|
| Survol, état d'un bouton | 100 à 150 ms |
| Petits éléments (menu, infobulle, case) | 150 à 250 ms |
| Panneaux, fenêtres, changements de page | 250 à 400 ms |
| Séquence d'entrée complète | 600 à 1200 ms au total |
| Animation narrative (logo, vidéo) | selon le récit, avec des temps de pause |

Plus un élément est grand ou parcourt de distance, plus il peut durer. Sortir est plus rapide qu'entrer (environ 70 % de la durée).

## 3. Courbes d'accélération

Jamais `linear` pour un mouvement (seulement pour une rotation continue ou une barre de progression).
- Entrée : décélération, `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Sortie : accélération, `cubic-bezier(0.4, 0, 1, 1)`.
- Déplacement d'un point à un autre : `cubic-bezier(0.65, 0, 0.35, 1)`.
- Un léger rebond (ressort) seulement pour un élément ludique, jamais pour du texte à lire.

## 4. Chorégraphie

- Décalage entre éléments d'une liste : 30 à 60 ms, 6 éléments au plus, sinon c'est trop long.
- Un élément principal bouge en premier, les détails suivent.
- Le mouvement a une direction cohérente : ce qui vient de droite repart à droite.
- Combiner un petit déplacement (8 à 24 px) et l'opacité, plutôt qu'un grand déplacement.

## 5. Fluidité sur les téléphones modestes

- N'anime que `transform` et `opacity`. Jamais `width`, `height`, `top`, `left`, `margin` ni `box-shadow` en boucle.
- `will-change` seulement pendant l'animation, pas en permanence.
- Pas de flou animé (`filter: blur`) sur de grandes surfaces.
- Respecte `@media (prefers-reduced-motion: reduce)` : supprime les déplacements, garde au plus un fondu court.

## 6. Outils

- **CSS** (`@keyframes`, `transition`) : le premier choix, léger, figeable par `capture_page`.
- **Web Animations API** (`element.animate()`) : pour piloter en JavaScript, aussi figeable.
- **Framer Motion** dans un projet React ; **GSAP** pour des séquences complexes (timeline). Attention : les animations GSAP ne peuvent pas être figées à un instant exact par `capture_page` (captures en temps réel, approximatives).
- **Lottie** pour une animation fournie par un graphiste.

## 7. Vérifier image par image

Après avoir animé, appelle `capture_page` avec `frames` : le début, un ou deux instants pendant le mouvement, et la fin (par exemple `[0, 120, 300, 800]`). Vérifie :
- Rien ne saute ni ne déborde à mi-parcours.
- L'état final est propre et identique à la page sans animation.
- L'ordre d'arrivée des éléments est celui que tu voulais.
- La version téléphone reste lisible pendant le mouvement.

Corrige, revérifie, deux rounds au plus.
