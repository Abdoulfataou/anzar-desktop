# Entonnoir et pyramide

Deux orientations. Choisis-en une, ne les mélange jamais :
- **Entonnoir** (pointe en bas) : le haut est large (le public touché), le bas est étroit (ceux qui achètent). Pour une campagne, des ventes ou un recrutement.
- **Pyramide** (pointe en haut) : la base est le fondement, le sommet est le plus rare ou le plus précieux. Pour des priorités, des besoins ou une gamme de produits.

## Disposition

- 4 à 6 niveaux. Chacun est un trapèze tracé avec un `<polygon>` de 4 points, de 56 à 72 px de haut, séparé du suivant par 4 px de vide (ou par un filet).
- Les largeurs diminuent régulièrement. **Pour des chiffres réels, elles sont honnêtes** : proportionnelles aux nombres (1 000 personnes atteintes, 300 messages, 60 commandes = 100 %, 30 %, 6 % de la largeur), avec une largeur minimale de 120 px pour garder le texte lisible. Signale-le alors dans une `.note`.
- Dans chaque niveau : le nom au centre (`.nom`) et le chiffre ou la précision dessous (`.sous`, ou `.tech` pour un nombre).
- À droite, facultatif : la perte entre deux niveaux (`.etiq`, « −70 % »), alignée sur la limite entre eux.
- Remplissage : tous les niveaux en `rgba(45,49,66,.05)` avec un contour `var(--gris)` à 1 px. **Un seul niveau en accent** : la conversion (bas de l'entonnoir), le sommet de la pyramide, ou le goulot d'étranglement, c'est-à-dire la plus grosse perte.
- Facultatif : un axe à gauche avec un surtitre en mots, sans flèche dans le texte : `CONVERSION`, `DE PLUS EN PLUS RARE`.

Trapèze centré en `cx` : `points="cx−L1/2,y  cx+L1/2,y  cx+L2/2,y+h  cx−L2/2,y+h"`, où L1 est la largeur du haut et L2 celle du bas.

## À éviter

- 7 niveaux ou plus.
- Une pyramide pour des données sans hiérarchie (fais une barre ou un tableau).
- Des largeurs truquées : des niveaux régulièrement espacés alors que les pertes ne le sont pas.
- L'accent sur la base de la pyramide.
