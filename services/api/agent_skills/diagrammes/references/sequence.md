# Séquence (messages échangés dans l'ordre)

**Pour :** l'ordre exact des échanges entre plusieurs acteurs ou systèmes. Un paiement Mobile Money, une connexion par code SMS, une commande passée par WhatsApp puis confirmée. Pour les développeurs et les dossiers techniques.

## Disposition

- **Acteurs** en haut, sur une rangée : une boîte par acteur (`.b-personne` pour une personne, `.b-base` pour notre système, `.b-externe` pour un tiers comme l'opérateur). 5 acteurs au plus, régulièrement espacés.
- **Lignes de vie** : un trait vertical en tirets (`stroke:var(--filet); stroke-dasharray:4 4`, ou gris clair) qui descend du centre de chaque acteur.
- **Messages** : des flèches horizontales droites d'une ligne de vie à l'autre, de haut en bas dans l'ordre du temps, espacées de 40 à 48 px. L'étiquette (`.etiq`) est au-dessus de la flèche, sur un masque, à 6 à 10 px du trait. Les réponses sont en tirets (`f f-tirets`).
- **Numérotation** facultative : `1.`, `2.`… au début de chaque étiquette, pour pouvoir en parler.
- **Activation** facultative : un rectangle étroit (8 px de large, `rgba(45,49,66,.08)`) sur la ligne de vie, pendant qu'un acteur traite une demande.
- **Message vers soi-même** : un petit crochet à angle droit qui sort à droite de la ligne de vie et revient 24 px plus bas.
- Accent : le message décisif (la confirmation du paiement, par exemple), et lui seul.
- Les appels vers un tiers peuvent être en `f f-lien`.

## Mesures (format `document`)

- Acteurs à y = 120 (boîtes de 140 × 48). Lignes de vie jusqu'en bas du dessin.
- Premier message à y = 208, puis un pas de 44 px.
- Budget : 5 acteurs · 10 messages. Au-delà, découpe le scénario (cas normal, puis cas d'erreur).

## À éviter

- Des flèches obliques : un message est toujours horizontal.
- Des étiquettes longues : « demande le paiement de 5 000 F » devient « 3. paiement 5 000 F ».
