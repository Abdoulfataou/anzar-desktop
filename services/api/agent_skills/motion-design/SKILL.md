---
name: motion-design
description: Animer une interface ou créer une animation (entrée de page, transitions, micro-interactions, texte animé, logo animé) avec un mouvement fluide et utile. À charger avant d'ajouter ou de régler des animations.
---

# Motion design : un mouvement qui a une raison

Une animation sert à guider l'œil, montrer ce qui a changé ou donner du caractère. Si elle ne fait aucune de ces trois choses, supprime-la.

## 0. Écrire le storyboard avant le code

Avant d'animer, écris en quelques lignes la séquence : qui bouge, dans quel ordre, à quel moment (en ms), et ce que l'œil doit retenir à la fin. Exemple :
- 0 ms : fond seul.
- 100 → 500 ms : le titre monte de 24 px et apparaît.
- 350 → 750 ms : la photo du produit glisse depuis la droite, en léger décalage.
- 700 → 900 ms : le bouton « Commander » apparaît, puis un seul petit rebond.
- 900 ms : tout est en place et lisible.
Ce plan sert ensuite à choisir les instants de vérification (`frames`).

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

## 4 bis. Les principes qui donnent de la vie

- **Anticipation** : un très léger mouvement inverse avant un grand mouvement (un bouton qui se tasse de 2 % avant de s'agrandir).
- **Chevauchement** : les éléments liés ne s'arrêtent pas tous en même temps ; le détail finit 50 à 100 ms après le principal.
- **Arcs** : un objet qui se déplace en diagonale suit une légère courbe, pas une ligne droite.
- **Exagération mesurée** : pour un ton ludique (commerce, enfants), un dépassement de 4 à 8 % puis retour ; pour un ton sérieux (banque, santé), aucun.
- **Temps de lecture** : un texte doit rester immobile assez longtemps pour être lu (environ 3 mots par seconde, 1 seconde au minimum).

## 5. Fluidité sur les téléphones modestes

- N'anime que `transform` et `opacity`. Jamais `width`, `height`, `top`, `left`, `margin` ni `box-shadow` en boucle.
- `will-change` seulement pendant l'animation, pas en permanence.
- Pas de flou animé (`filter: blur`) sur de grandes surfaces.
- Respecte `@media (prefers-reduced-motion: reduce)` : supprime les déplacements, garde au plus un fondu court.

## 6. Outils

- **CSS** (`@keyframes`, `transition`) : le premier choix, léger, figeable par `capture_page`.
- **Web Animations API** (`element.animate()`) : pour piloter en JavaScript, aussi figeable.
- **Framer Motion** dans un projet React (ses animations de `transform` et `opacity` passent par les Web Animations, donc figeables).
- **GSAP** pour des séquences complexes (timeline).
- **Canvas, three.js, particules** pour les effets riches.
- Tout est vérifiable et exportable image par image : `capture_page` et `export_animation` utilisent une horloge virtuelle (requestAnimationFrame, setTimeout, Date et les animations CSS avancent ensemble, au rythme exact). Seuls une vidéo ou un GIF animé intégrés dans la page ne la suivent pas.

## 7. Vérifier image par image

Après avoir animé, appelle `capture_page` avec `frames` (et `file` pour un fichier HTML, sans serveur) : le début, un ou deux instants pendant le mouvement, et la fin (par exemple `[0, 120, 300, 800]`). Vérifie :
- Rien ne saute ni ne déborde à mi-parcours.
- L'état final est propre et identique à la page sans animation.
- L'ordre d'arrivée des éléments est celui que tu voulais.
- La version téléphone reste lisible pendant le mouvement.

Corrige, revérifie, deux rounds au plus.

## 8. Livrer une vidéo

Si l'utilisateur veut partager l'animation (réseaux, WhatsApp, présentation), exporte-la avec `export_animation` : MP4 (ou GIF court), au bon format (`story`, `carre`, `portrait`, `paysage`). Les animations doivent alors démarrer seules au chargement de la page, sans clic. Pour une vidéo de pub complète, charge la skill `video-motion`.
