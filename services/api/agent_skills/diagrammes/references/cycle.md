# Cycle (cercle vertueux)

**Pour :** une boucle qui se renforce, où la dernière étape nourrit la première. Par exemple : client satisfait → recommandation → nouveau client → commande → livraison soignée → client satisfait. Ou : vendre → encaisser → réapprovisionner → mieux vendre.

Si le chemin se termine ou se ramifie, fais un **logigramme**. Si rien ne revient vraiment au départ, fais des **étapes**.

## Disposition

- 4 à 7 stations réparties sur un cercle de rayon R (180 à 220 px en format `document`, centre (480, 340)). La première est en haut, puis dans le sens des aiguilles d'une montre.
- Centre de la station k sur N : angle θ = −90° + k × 360° / N, puis x = cx + R × cos θ et y = cy + R × sin θ. Arrondis à 4 et dessine la boîte (150 × 56, `.b-base`) centrée sur ce point.
- Les liaisons entre stations voisines suivent l'anneau : un **arc de cercle** du bord d'une boîte au bord de la suivante (`<path class="f" d="M x1,y1 A R,R 0 0,1 x2,y2"/>`, avec des points pris sur le cercle, juste hors des boîtes). Ces arcs sont la seule exception à la règle des angles droits.
- Facultatif, **un centre** : ce qui s'accumule à chaque tour (« Réputation », « Fichier clients », « Trésorerie »), en `.b-stock` de 180 × 80, relié à 1 ou 2 stations par des traits droits en tirets (`f f-tirets`) avec une courte étiquette. Un seul centre au plus.
- Accent : **une station au plus**, celle qui fait tourner ou bloquer la boucle (« Livraison à l'heure »).

## Mesures

- Vérifie qu'aucune boîte ne touche sa voisine : la distance entre deux centres voisins (2 × R × sin(180° / N)) doit dépasser la largeur de la boîte plus 32 px. Sinon, agrandis R ou réduis N.
- Les étiquettes d'arcs, si besoin, vont à l'extérieur du cercle, sur un masque.

## Budget

7 stations · 1 centre · 1 accent.
