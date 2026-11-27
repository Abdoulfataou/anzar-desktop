# Comparaison : matrice 2×2, avant / après, offres côte à côte

Si la comparaison tient dans un tableau de 3 colonnes, fais un tableau. Dessine seulement quand la **position** ou le **contraste visuel** apporte quelque chose.

## Matrice 2×2 (classer des options)

**Pour :** prioriser (impact × effort), positionner des concurrents (prix × qualité), choisir des produits à mettre en avant (marge × ventes).

- Deux axes en croix au centre (`stroke:var(--encre); stroke-width:1`), avec une pointe à chaque bout positif. Raccourcis les axes de 60 à 80 px avant le bord pour laisser la place aux mots.
- **Un seul mot au bout de chaque axe** (`.surtitre`), au-delà de la pointe et jamais sur la ligne : `IMPACT`, `EFFORT`. Ni flèche dans le texte, ni « fort / faible ».
- Chaque option est un point (`r=4`, encre) avec son nom (`.sous` ou `.nom`) à 8 ou 10 px. Un nom ne traverse jamais un axe.
- Accent sur l'option « à faire d'abord » (souvent en haut à droite).
- Facultatif : le nom de chaque case en `.surtitre` dans son coin (`À FAIRE D'ABORD`, `À PLANIFIER`, `PETITS GAINS`, `À ÉVITER`).
- Budget : 12 points environ. Pas de cases remplies de quatre couleurs différentes.

**Variante « scénarios »** : chaque case contient un scénario nommé (`.nom` 16 px et 1 à 3 lignes en `.sous`) au lieu de points. Les cases ont la même taille (280 × 180), en `.b-stock`. La case retenue est en `.b-focal`. Les axes ont une pointe aux deux bouts.

## Avant / après

**Pour :** montrer un changement d'organisation ou de méthode (cahier → application, livraison au hasard → tournées).

- Deux panneaux côte à côte de même taille : `AVANT` à gauche en `.surtitre` gris, `APRÈS` à droite. Un filet vertical les sépare.
- **Les mêmes éléments aux mêmes places** dans les deux panneaux, pour que l'œil voie ce qui change. Ce qui disparaît passe en `.b-option` dans « après » ou n'y figure plus. Ce qui est nouveau est en accent (2 au plus).
- En bas, un bandeau de 2 ou 3 lignes « Ce qui change » (`.sous`), chaque ligne préfixée d'un petit carré de couleur.
- Si seuls des chiffres changent (prix, délais), ce n'est pas un diagramme : fais un tableau.

## Offres côte à côte (2 ou 3)

**Pour :** présenter des formules (simple, standard, premium), des forfaits ou des options d'un devis.

- Des colonnes de **largeurs légèrement différentes** (par exemple 1,1 / 1 / 0,9), pas trois cartes identiques. Fond blanc, filet de 1 px, `rx=6`, **sans ombre**.
- L'offre recommandée en `.b-focal`, avec un surtitre accent `RECOMMANDÉ`.
- En haut de chaque colonne : le nom (`.nom` 16 px) et le prix (serif 28 px, en `.tech` si c'est un code). Dessous : 3 à 5 lignes courtes alignées entre les colonnes, pour que la même ligne se compare d'une offre à l'autre.
- Une case vide ou un tiret (`—`) quand une option n'est pas incluse, jamais une croix rouge.
