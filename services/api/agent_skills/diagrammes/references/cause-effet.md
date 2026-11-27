# Cause-effet (diagramme d'Ishikawa, en arêtes de poisson)

**Pour :** analyser les causes d'un problème observé, regroupées par familles. Par exemple : « Les livraisons arrivent en retard », « Les ventes baissent », « Les élèves échouent en mathématiques ». Il montre **ce qui a été examiné**, pas seulement la conclusion.

## Disposition

- **L'arête centrale** : une ligne horizontale (`stroke:var(--encre); stroke-width:1.2`) de gauche à droite au milieu (y = CY), terminée par une pointe dans **la boîte de l'effet** à droite : le problème, en `.b-focal`.
- **Les arêtes** (familles de causes) : des traits droits à 60° qui rejoignent l'arête centrale, alternativement au-dessus et au-dessous, régulièrement espacés. Au bout libre de chacune, une étiquette de famille (`rx=4`, `.b-base`, texte `.nom` 12 à 14 px). Familles courantes : **Main-d'œuvre, Méthodes, Matériel, Matières, Milieu, Mesure** (les « 6 M »), à adapter au métier (Clients, Fournisseurs, Argent…).
- **Les causes** : de courts traits horizontaux de 32 px (`stroke:var(--doux)`) qui partent de chaque arête, avec le libellé de la cause en `.sous` au bout. 2 à 4 causes par arête, 4 mots au plus chacune.
- Les arêtes à 60° sont la grammaire de ce type : la règle des angles droits ne s'applique qu'aux autres liaisons, s'il y en a.
- **Accent** : la famille où se trouve la cause confirmée (son arête et son étiquette en accent). Avec la boîte de l'effet, cela fait le budget de 2 accents.
- Ordre de dessin : arête centrale, arêtes, traits de causes, étiquettes de familles, boîte de l'effet, légende.

## Calcul (format `large`, 1280 × 720)

L'arête centrale est en CY = 380. La boîte de l'effet commence en HEAD = 1040 (largeur 192, hauteur 72). L'arête k (k = 1 à 6) touche l'arête centrale en :
```
x_attache(k) = HEAD − 120 − k × 150
bout libre   : x = x_attache − 96 ;  y = CY − 168 (k impair, au-dessus) ou CY + 168 (k pair, au-dessous)
```
Les causes partent de l'arête à 1/3 et 2/3 de sa longueur (point (x_attache − 32, CY ∓ 56) puis (x_attache − 64, CY ∓ 112)) et vont vers la gauche.

## Budget

6 familles · 4 causes par famille · 2 accents.
