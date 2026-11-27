# Parcours client

**Pour :** ce que fait une personne à chaque étape d'une expérience, et **ce qu'elle ressent**. Par exemple : découvrir la boutique sur Facebook, commander sur WhatsApp, payer par Mobile Money, être livré, revenir. La courbe d'émotion est l'élément qui compte. Si tu ne peux pas nommer un ressenti à chaque étape, fais plutôt un **processus** ou une **chronologie**.

## Disposition (de haut en bas, pour une seule personne type)

- **En-têtes d'étapes** : 5 colonnes au plus (6 au maximum), de même largeur. Chaque colonne porte un surtitre (`ÉTAPE 1`…) au-dessus du nom de l'étape (`.nom`), tous deux centrés.
- **Bande d'émotion** (l'élément essentiel) : 160 px de haut, sous les en-têtes. Trois filets horizontaux (`.filet`) marquent `CONTENT`, `NEUTRE` et `FRUSTRÉ`, en `.surtitre` aligné à droite (`text-anchor="end"`, x = 104) dans une marge gauche de 120 px. Une courbe lisse (`fill:none; stroke:var(--gris); stroke-width:1.5`) passe par un point (`r=5`) par étape. Chaque valeur prend l'un de 5 niveaux nommés (content, plutôt content, neutre, plutôt frustré, frustré). **Le point le plus bas et le segment qui y mène sont en accent.** Jamais d'émoji, jamais d'échelle chiffrée.
- **Lignes de contenu** : 3 au plus, sous la bande. Chacune a son intitulé en surtitre dans la marge gauche, jamais à la verticale :
  - `ACTION` : ce que fait la personne, une phrase courte par étape (`.sous`, 2 lignes de 26 caractères au plus) ;
  - `CANAL` : où ça se passe (WhatsApp, boutique, appel, application) (`.sous`) ;
  - facultatif : `QUI` (qui s'en occupe) ou un chiffre.
  Les intitulés restent courts (6 lettres environ) pour tenir dans la marge.
  Les lignes sont séparées par des filets sur toute la largeur.
- **Points de friction** : sous l'étape la plus basse seulement, une petite étiquette en tirets (`fill:var(--accent-teinte); stroke:var(--accent); stroke-dasharray:3 3; rx=2`) qui nomme le problème, en `.etiq` couleur accent (« attente du livreur »). Deux au plus.
- **Légende** en bas : la courbe, le point le plus bas, l'étiquette de friction.

La courbe d'émotion est une donnée, pas une flèche : la règle des angles droits ne s'y applique pas. Utilise un tracé lissé (`C` ou `Q`) entre les points.

## Mesures (format `large`, 1280 × 720, conseillé)

- Marge gauche de 120 px, puis 5 colonnes de 200 px avec 24 px d'écart : `x_colonne = 120 + i × 224`, centre = x_colonne + 100. Les filets vont de x = 120 à x = 1216.
- En-têtes en y = 132 (surtitre) et 156 (nom). Bande d'émotion de y = 184 à y = 344 (CONTENT à 184, plutôt content à 224, NEUTRE à 264, plutôt frustré à 304, FRUSTRÉ à 344).
- Courbe : entre deux points voisins, `C xm,y1 xm,y2 x2,y2` (xm = milieu en x). Les tangentes horizontales donnent une courbe calme.
- Lignes de contenu : filet en y = 368, ACTION (texte en y = 396 et 414, étiquette de friction de y = 432 à 452), filet en y = 472, CANAL (texte en y = 500), filet en y = 520. Légende vers y = 624.
- Le nom d'une étape n'est pas répété dans la ligne ACTION.
- Si les ressentis sont supposés (pas tirés d'entretiens ou d'avis clients), dis-le dans une `.note` : « Ressentis supposés, à vérifier auprès de vrais clients ».

## Accent

Exactement deux éléments : le point le plus bas avec son segment d'arrivée, et l'étiquette de friction.

## À éviter

- Plus de 6 étapes : fais deux parcours (avant achat, après achat).
- Deux personnes types sur la même carte : une carte par personne.
- Un parcours sans personne (un flux entre logiciels) : c'est une architecture.
