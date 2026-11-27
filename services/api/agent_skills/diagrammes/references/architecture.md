# Architecture d'application

**Pour :** les briques d'un logiciel et leurs échanges en un coup d'œil. Application mobile, serveur, base de données, services extérieurs (Mobile Money, SMS, cartes, IA). Pour un dossier technique, un appel d'offres, un mémoire ou un investisseur.

## Disposition

- Regroupe par niveau ou par lieu : **chez l'utilisateur** (téléphone, ordinateur) → **chez nous** (serveur, base) → **à l'extérieur** (opérateurs, fournisseurs). Une zone (`.zone`) par groupe, 3 au plus côte à côte.
- Le flux principal va de gauche à droite (ou de haut en bas en format `telephone`). Choisis un sens et garde-le.
- 1 ou 2 boîtes en accent : le cœur du système (souvent le serveur ou la brique que l'on présente).
- Traitements : l'utilisateur en `.b-personne`, les applications et services en `.b-base`, les bases de données et fichiers en `.b-stock`, les services tiers en `.b-externe`, un module prévu en `.b-option`.
- Dans une boîte : le nom lisible (`.nom`, « Serveur ANZAR ») et, dessous, la technologie (`.tech`, « FastAPI · Python »). Les noms d'abord, la technique ensuite.
- Flèches : `f` pour les échanges internes, `f f-lien` pour les appels vers l'extérieur, `f f-tirets` pour les réponses, les notifications et les tâches de fond. Étiquette courte qui dit ce qui circule : « commande », « reçu », « code SMS ».

## Mesures (format `document`)

- Boîtes de 160 à 200 px de large sur 56 px de haut ; 64 à 96 px entre colonnes, pour laisser la place aux étiquettes de flèches.
- Une zone commence 24 px au-dessus de sa première boîte et finit 16 px sous la dernière. 16 px de marge latérale.
- Les échanges qui vont et reviennent entre deux boîtes : deux flèches parallèles écartées de 12 px au moins (aller en trait plein au-dessus, retour en tirets en dessous). Ou, plus simple, une seule flèche avec une étiquette « commande / reçu ».

## Budget

9 boîtes · 12 flèches · 3 zones · 2 accents. Au-delà : une vue d'ensemble, puis un diagramme de détail par zone.

## À éviter

- Fond sombre et couleurs néon pour « faire technique ».
- Toutes les briques avec la même forme et la même couleur.
- Des flèches dans les deux sens sur le même tracé.
- Des logos de marques dessinés de mémoire : écris le nom du service (« Orange Money », « Wave ») dans une boîte `.b-externe`.
