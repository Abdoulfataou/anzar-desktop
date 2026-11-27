# Style : couleurs, boîtes, flèches, légende

Les classes CSS citées ici sont définies dans le modèle de SKILL.md §5. Utilise-les plutôt que des couleurs écrites à la main : le diagramme reste cohérent, et un changement de couleur se fait en une ligne.

## Couleurs (rôles)

| Rôle | Variable | Clair | Usage |
|---|---|---|---|
| papier | `--papier` | `#f5f5f5` | Fond, masques |
| encre | `--encre` | `#2d3142` | Texte principal, contour des boîtes principales |
| gris | `--gris` | `#4f5d75` | Texte secondaire, flèches par défaut |
| doux | `--doux` | `#5a6580` | Étiquettes de flèches, noms de zones |
| filet | `--filet` | `rgba(45,49,66,.12)` | Lignes fines, séparateurs |
| accent | `--accent` | `#bf4520` | 1 ou 2 éléments au plus |
| accent-teinte | `--accent-teinte` | `rgba(191,69,32,.08)` | Fond d'une boîte accentuée |
| lien | `--lien` | `#2e5aa8` | Appels à un service extérieur (API, Mobile Money, SMS) |

Contrastes sur le papier : encre 11,8:1, gris 6,1:1, doux 5,3:1, accent 4,7:1, lien 6,1:1. Tout texte doit atteindre 4,5:1 sur le fond **où il se trouve réellement** : dans une boîte teintée, le contraste baisse.

**Version sombre** (sur demande, ou pour une présentation sur fond noir) : remplace le bloc `:root` par
```css
--papier: #2d3142; --encre: #f5f5f5; --gris: #bfc0c0; --doux: #949eb2;
--filet: rgba(245,245,245,.12); --accent: #f08a59; --accent-teinte: rgba(240,138,89,.10); --lien: #739fdf;
```
Dans les classes, change aussi `rgba(45,49,66,…)` en `rgba(245,245,245,…)` (mêmes opacités), le `#fff` de `.b-base` en `#393e53`, et la couleur des trois marqueurs (`#bfc0c0`, `#f08a59`, `#739fdf`).

## Polices (système, hors ligne)

| Classe | Famille | Taille | Usage |
|---|---|---|---|
| `.titre` | serif système (Iowan, Palatino, Georgia) | 28 px | Titre, une seule fois |
| `.surtitre` | mono | 10 px, espacé, MAJUSCULES écrites telles quelles | Type du diagramme, noms de zones, en-têtes |
| `.nom` | sans système (San Francisco, Segoe UI, Roboto) | 14 px, gras 600 | Nom d'une boîte |
| `.sous` | sans | 11 px | Précision courte sous le nom (rôle, mission) |
| `.tech` | mono | 10 px | Seulement le technique : URL, port, code, numéro, montant |
| `.etiq` | sans | 10 px, 500 | Étiquettes de flèches, en minuscules |
| `.note` | serif italique | 14 px | Une remarque éditoriale, 2 au plus |

Les majuscules gardent leurs accents : « ÉTAPE », « RÉSEAU », « À FAIRE ». N'utilise pas `text-transform` : écris le texte directement en majuscules.

Pour une langue locale (haoussa, zarma, bambara, wolof, peul), les polices système couvrent les lettres spéciales (ɓ, ɗ, ƙ, ŋ, ɛ, ɔ). Vérifie-les sur la capture.

## Traitements des boîtes

| Classe | Pour | Rendu |
|---|---|---|
| `.b-focal` | Le point à retenir (1 ou 2) | fond teinté, contour accent |
| `.b-base` | Étape, service, équipe | fond blanc, contour encre |
| `.b-stock` | Base de données, stock, caisse, fichier | fond gris léger, contour gris |
| `.b-externe` | Service extérieur (opérateur, banque, fournisseur) | fond très léger, contour estompé |
| `.b-personne` | Client, utilisateur, visiteur | fond gris bleuté, contour doux |
| `.b-option` | Facultatif, prévu, pas encore en place | contour en tirets |

Rayon des coins : 6 pour les boîtes, 8 pour les zones, 2 pour les petites étiquettes. **Jamais d'ombre.**

Une petite étiquette de catégorie dans le coin d'une boîte (facultative) :
```svg
<rect x="X+8" y="Y+6" width="36" height="14" rx="2" fill="none" stroke="#4f5d75" stroke-opacity=".4" stroke-width=".8"/>
<text class="surtitre" x="X+26" y="Y+16" text-anchor="middle" style="font-size:8px">API</text>
```
Si tu en mets une, décale le nom de la boîte vers le bas pour qu'ils ne se touchent pas.

## Flèches

| Classes | Quand |
|---|---|
| `f` | Par défaut |
| `f f-accent` | Le chemin principal, celui qu'on veut montrer (1 au plus) |
| `f f-lien` | Appel vers un service extérieur |
| `f f-tirets` | Facultatif, retour, réponse, asynchrone |
| `f f-nue` | Trait sans pointe (rattachement d'organigramme, bus) |

Tracés à angle droit avec coins arrondis (rayon 8) :
```svg
<!-- droite puis bas puis droite : de (x1,y1) à (x2,y2), m = milieu en x -->
<path class="f" d="M x1,y1 H m-8 Q m,y1 m,y1+8 V y2-8 Q m,y2 m+8,y2 H x2"/>
<!-- un seul coude : sortir par le côté, entrer par le haut de la cible -->
<path class="f" d="M x1,y1 H x2-8 Q x2,y1 x2,y1+8 V y2"/>
<!-- pont au-dessus d'un trait vertical situé en x = c -->
<path class="f f-tirets" d="M x1,y H c-8 a 8,8 0 0,1 16,0 H x2"/>
```
Pour un trajet vers le haut, inverse les signes verticaux (`y1-8`, `y2+8`). Une flèche sort et entre **perpendiculairement** au bord de la boîte, sur la partie droite du bord, à 8 px au moins d'un coin. Si la cible est nettement plus haut ou plus bas, entre par son bord haut ou bas, pas par le côté.

La pointe touche le bord : termine le tracé exactement sur le bord de la boîte (la pointe est dessinée au bout du trait).

## Étiquette de flèche

```svg
<!-- trait horizontal en y = Y : masque 14 px de haut, posé 8 px au-dessus du trait -->
<rect class="masque" x="MX-L/2" y="Y-22" width="L" height="14" rx="2"/>
<text class="etiq" x="MX" y="Y-12" text-anchor="middle">paie 2 000 F</text>
```
L = caractères × 10 × 0,6 + 8. Sur un segment vertical, place l'étiquette à côté du trait, à 8 px, avec `text-anchor="start"`. Le masque doit être dans un espace vide : il ne déborde jamais sur une boîte ni sur le bord d'une zone.

**À l'intérieur d'une zone, pas de masque** : sur le fond teinté de la zone, il ferait une tache claire. L'étiquette est déjà à l'écart de tout trait (règle 2), elle n'en a pas besoin.

## Zones (regrouper)

Une zone regroupe 2 boîtes ou plus qui vont ensemble (même équipe, même serveur, même lieu). Elle est dessinée en premier, 3 au plus côte à côte.
```svg
<rect class="zone" x="X" y="Y" width="W" height="H" rx="8"/>
<rect class="masque" x="X+12" y="Y-7" width="LARGEUR" height="14" rx="2"/>
<text class="surtitre" x="X+18" y="Y+4" style="fill:var(--doux)">SERVEUR</text>
```
Laisse 24 px entre le haut de la zone et la première boîte.

## Légende : un bandeau en bas

Seulement si le diagramme utilise plusieurs traitements qui ne se comprennent pas seuls. Ajoute environ 60 px à la hauteur du viewBox.
```svg
<line class="filet" x1="48" y1="LY" x2="W-48" y2="LY"/>
<text class="surtitre" x="48" y="LY+28">LÉGENDE</text>
<!-- puis des entrées à l'horizontale, espacées de 160 à 180 px : un petit échantillon (rect 16 × 10 ou trait de 24 px) + un .sous -->
```
La légende décrit chaque traitement utilisé, et rien d'autre.

## Remarque éditoriale (facultative, 2 au plus)

Un texte `.note` en italique, placé dans un espace vide, relié si besoin à son élément par un fin trait `.filet` à angle droit. Il sert à dire le « pourquoi » : « Le goulot : la validation manuelle prend 2 jours ».

## Accessibilité

- `<title>` est le premier enfant du `<svg>`, avant `<defs>` ; `<desc>` suit.
- Le `svg` porte `role="img"` et `aria-labelledby="SLUG-titre SLUG-desc"`. Les identifiants reprennent le nom du fichier : jamais `title` ni `desc` tout court.
- `<desc>` décrit le contenu (« Organigramme d'une boutique : la gérante, la caisse, les achats et la livraison »), pas la forme (« une boîte en haut et trois en bas »).

## Grille et mesures

- Coordonnées, largeurs, hauteurs et écarts sont des multiples de 4.
- Boîte d'une ligne : 40 px de haut. Boîte de deux lignes (nom et précision) : 56 px.
- Écart entre boîtes sœurs : 32 à 48 px, identique dans toute la rangée.
- Marges extérieures : 48 px au moins. Le titre est en y = 86. Le contenu commence vers y = 130.
