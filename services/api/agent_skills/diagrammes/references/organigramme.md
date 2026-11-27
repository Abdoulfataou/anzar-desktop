# Organigramme

**Pour :** qui dirige qui, qui est responsable de quoi, à qui s'adresser. Une boutique, une PME, une association, une école, une équipe projet, un bureau de l'administration.

Si les boîtes ne sont pas des personnes ou des équipes, mais une classification (familles de produits, plan d'un mémoire), c'est une **arborescence** : mêmes règles, sans les rôles.

## Disposition

- La direction est en haut, au centre. Les niveaux sont alignés à l'horizontale : tous les responsables sur la même ligne, puis toutes les personnes de terrain.
- Liaisons à angle droit, sans pointe (`f f-nue`) : un trait vertical part du bas du parent jusqu'à un « bus » horizontal, puis un trait vertical descend vers le haut de chaque enfant. Le bus est à mi-hauteur entre les deux rangées.
- Chaque boîte répond, si la place le permet, à deux questions :
  1. **Qui** : le nom de la fonction ou de la personne (`.nom`), par exemple « Gérante » ou « Aïcha · Gérante ».
  2. **De quoi elle s'occupe** : 2 à 4 mots (`.sous`), par exemple « Caisse et stock ». Un numéro de téléphone ou un identifiant va en `.tech`.
- Un poste vacant, à recruter ou confié à l'extérieur (comptable externe, livreur à la tâche) : `.b-option` en tirets. Ne le cache pas : un trou dans l'organisation est une information.
- Une règle (« Achats de plus de 100 000 F : accord de la gérante ») va dans une `.note` en marge ou en bas, pas dans une boîte de plus.

## Traitements

- La direction ou le point d'entrée (la personne à qui l'on s'adresse en premier) : `.b-focal`. **Un seul accent.**
- Équipes et services : `.b-base`.
- Personnes de terrain : `.b-base` ou `.b-stock`, avec une seule règle pour tout le diagramme.
- Partenaires extérieurs (fournisseur, comptable, transitaire) : `.b-externe`, à côté du niveau concerné, relié en tirets.

## Mesures (format `document`, 960 × 600)

- Boîtes de 56 px de haut. Largeur unique par niveau (2 largeurs au plus dans tout le diagramme), calculée sur le nom le plus long.
- Rangées à y = 140, 268, 396 (128 px de pas, bus à mi-chemin).
- Centre la rangée : premier x = (960 − (n × largeur + (n − 1) × écart)) / 2, arrondi à 4.
- En format `telephone` (540 × 675), empile plutôt les niveaux en liste indentée : le parent à gauche, les enfants décalés de 32 px, reliés par un trait vertical puis horizontal (forme de L).

## Budget

12 boîtes visibles au plus · 4 niveaux au plus · 5 subordonnés directs au plus par parent (au-delà, crée des groupes) · 1 accent · 2 remarques.

## À éviter

- Des boîtes toutes identiques : l'entrée, les équipes et les postes vacants doivent se distinguer.
- Des descriptions de poste complètes dans les boîtes.
- Des diagonales du parent vers les enfants.
- Un enfant relié au grand-parent en sautant un niveau.
