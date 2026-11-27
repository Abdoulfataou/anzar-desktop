# Processus : logigramme, couloirs, étapes

Trois formes. Choisis selon ce qui compte :
- des **décisions** (oui ou non) → **logigramme** ;
- **qui fait quoi** entre plusieurs acteurs → **couloirs** ;
- une **suite simple** de 3 à 7 étapes, sans embranchement → **étapes**.

## Logigramme

- La forme dit le type, pas la couleur :
  - **ovale** (`rx` = la moitié de la hauteur) : début et fin ;
  - **rectangle** (`rx=6`) : une action ;
  - **losange** : une question, avec 3 sorties au plus ;
  - **petit point plein** (`r=4`, couleur encre) : là où des branches se rejoignent.
- Le flux va de haut en bas. Depuis un losange, « oui » part à droite et « non » en bas. **Étiquette chaque sortie** (« oui », « non », « pas de stock »).
- Losange : `<path d="M cx,y1 L x2,cy L cx,y2 L x1,cy Z"/>` avec une classe de boîte. Le texte va au centre, sur 2 lignes courtes au plus. Le losange fait 1,6 fois la largeur de son texte.
- Accent sur le chemin heureux **ou** sur la décision la plus lourde de conséquences, pas les deux.
- Budget : 9 formes, 12 flèches, 3 losanges.

## Couloirs (qui fait quoi)

- Une bande horizontale par acteur (client, vendeur, livreur, caisse). Le nom de l'acteur est en `.surtitre` dans une marge gauche de 120 px. Les bandes sont séparées par des filets.
- Chaque étape est un rectangle placé dans la bande de celui qui la fait. Une étape n'est jamais à cheval sur deux bandes : choisis un responsable.
- Le temps va de gauche à droite. Ordonne les étapes pour que les flèches aillent surtout vers la droite, sans zigzags.
- **Les passages de relais** (flèches qui changent de bande) sont les liaisons importantes : mets en accent celui qui crée le plus d'attente ou de risque.
- Budget : 5 bandes · 10 étapes · 1 accent.

## Étapes (une méthode ordonnée)

- Une rangée horizontale de 3 à 7 étapes, de même largeur, ou une colonne verticale en format `telephone`.
- Chaque étape porte un **numéro à deux chiffres** (`01`, `02`… en `.surtitre` ou en serif 28 px), un **titre** court (`.nom`) et une **explication** d'une ou deux lignes de 28 caractères au plus (`.sous`).
- Un rail continu sous les numéros : un rectangle de 8 px de haut par étape, en alternant `rgba(45,49,66,.06)` et `rgba(45,49,66,.12)`. L'ordre se lit sur le rail : **pas de flèches entre étapes voisines**.
- **Une seule étape en accent** : la décision, la transformation ou le risque que la figure veut montrer (segment de rail et numéro en accent).
- Mesures (`large`) : étapes de 224 px pour 3 à 5 étapes, 184 px pour 6, 160 px pour 7, centrées. Numéros à y = 200, rail à y = 236, titres à y = 290, explications à y = 314 et 332.
- Si le texte ne tient pas, raccourcis-le. Ne réduis pas les polices.

## À éviter

- Des couleurs différentes pour distinguer les types de formes (c'est la forme qui les distingue).
- Un losange à 4 sorties ou plus : découpe-le en deux questions.
- Des sorties de décision sans étiquette.
- Des flèches qui reviennent en arrière sur toute la largeur : réordonne les étapes.
