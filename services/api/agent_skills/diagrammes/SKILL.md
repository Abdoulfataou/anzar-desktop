---
name: diagrammes
description: Dessiner un diagramme clair et soigné, de qualité éditoriale, livré en page HTML et en image PNG à partager - organigramme, parcours client, architecture d'application, processus ou logigramme, étapes d'une méthode, chronologie ou frise, planning, comparaison ou matrice 2x2, entonnoir de vente, pyramide, cycle, cause-effet (Ishikawa), séquence d'échanges. À charger dès qu'on demande un schéma, un diagramme, un organigramme, une frise ou un plan visuel (pour une affiche ou une publication, voir plutôt visuels-reseaux).
license: MIT (adapté de diagram-design de Cathryn Lavery, voir LICENSE)
---

# Diagrammes de qualité éditoriale

Un bon diagramme fait comprendre en dix secondes ce qu'un paragraphe explique mal. Il est sobre et précis, et chaque trait a un sens.

Livrable : **un fichier HTML autonome** (SVG intégré, sans dépendance réseau) **et une image PNG** exportée de ce HTML. Les deux portent le même nom :
- dans un projet : `diagrammes/<nom-clair>.html` et `diagrammes/<nom-clair>.png` ;
- dans l'Espace ANZAR (sans projet) : `fichiers/diagrammes/<nom-clair>.html` et `.png`. N'écrase jamais un fichier existant : ajoute `-2`, `-3`.

## 1. La règle d'or : enlever

- Un nœud = une idée. Deux boîtes qui vont toujours ensemble n'en font qu'une.
- Une flèche porte une information. Si la disposition dit déjà la relation, supprime la flèche.
- **Densité visée : 4 sur 10.** Au-delà de 9 boîtes, fais deux diagrammes : une vue d'ensemble, puis un détail.
- **L'accent (orange brûlé) va sur 1 ou 2 éléments au plus** : le point que le lecteur doit retenir. Tout le reste est encre, gris ou gris doux.
- Avant de dessiner, demande-toi : un tableau ou trois puces feraient-ils le même travail ? Si oui, ne dessine pas.

## 2. Choisir le type, puis charger sa fiche

| On veut montrer… | Type | Fiche (load_skill, file=) |
|---|---|---|
| Qui dirige qui, qui est responsable de quoi | Organigramme | `references/organigramme.md` |
| Ce que vit le client, étape par étape, et ce qu'il ressent | Parcours client | `references/parcours-client.md` |
| Les briques d'une application et leurs échanges | Architecture | `references/architecture.md` |
| Une procédure avec des décisions (oui / non) | Logigramme | `references/processus.md` |
| Un processus entre plusieurs acteurs (qui fait quoi) | Couloirs | `references/processus.md` |
| Une méthode en 3 à 7 étapes ordonnées | Étapes | `references/processus.md` |
| Des événements datés, l'histoire d'une entreprise | Chronologie / frise | `references/chronologie.md` |
| Des tâches avec début et fin (planning) | Planning (Gantt) | `references/chronologie.md` |
| Classer des options sur deux critères | Matrice 2×2 | `references/comparaison.md` |
| Avant / après, ou 2 à 3 offres côte à côte | Comparaison | `references/comparaison.md` |
| Des visiteurs qui deviennent clients (pertes à chaque étape) | Entonnoir | `references/entonnoir-pyramide.md` |
| Une hiérarchie de priorités ou de besoins | Pyramide | `references/entonnoir-pyramide.md` |
| Un cercle vertueux où la dernière étape nourrit la première | Cycle | `references/cycle.md` |
| Les causes d'un problème, par familles | Cause-effet | `references/cause-effet.md` |
| Les messages échangés dans l'ordre (ex. paiement Mobile Money) | Séquence | `references/sequence.md` |

Charge **toujours** `references/style.md` (couleurs, boîtes, flèches, règles de tracé) et **la fiche du type choisi**, rien d'autre. Si le chargement d'une fiche échoue, applique ce document seul : il suffit pour un diagramme correct.

## 3. Annoncer le plan avant de dessiner

En une ou deux phrases, dis le type retenu, le format (§4) et ce que le budget t'oblige à laisser de côté. Si l'utilisateur est là et que la demande est floue, laisse-lui une chance de corriger. Si la demande fixe déjà tout, annonce-le en une ligne et dessine.

## 4. Formats

Tout le diagramme, **titre compris**, est dans le SVG. La page HTML l'affiche en plein écran et l'export PNG agrandit le dessin sans le flouter.

| Format | viewBox | Export PNG (width × height) | Usage |
|---|---|---|---|
| `document` (défaut) | `0 0 960 600` | 1920 × 1200 | Rapport, dossier, présentation, mémoire |
| `large` | `0 0 1280 720` | 2560 × 1440 | Diapositive 16:9, schéma riche, impression paysage |
| `telephone` | `0 0 540 675` | 2160 × 2700 | Statut WhatsApp, publication Facebook ou Instagram (4:5), lecture sur téléphone |
| `carre` | `0 0 600 600` | 1800 × 1800 | Publication carrée |

Pour un partage sur téléphone (le cas le plus courant chez nos clients), préfère `telephone` : flux de haut en bas, 6 boîtes au plus, mêmes tailles de texte. La taille de texte reste fixe d'un format à l'autre : un petit format revient donc à un texte plus gros à l'écran. Ne réduis jamais les tailles de texte pour faire entrer du contenu. Coupe plutôt du contenu.

## 5. Le modèle de départ

Pars toujours de ce modèle. Remplace `SLUG` (le nom du fichier), le titre, la description et le contenu. Les couleurs et les polices sont déjà réglées : **polices système uniquement**, aucun lien vers Google Fonts ni vers un autre site. Le diagramme marche hors ligne, sur Mac, Windows et Android.

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TITRE</title>
<style>
  :root {
    --papier: #f5f5f5; --encre: #2d3142; --gris: #4f5d75; --doux: #5a6580;
    --filet: rgba(45,49,66,.12); --accent: #bf4520; --accent-teinte: rgba(191,69,32,.08); --lien: #2e5aa8;
    --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
    --sans: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    --mono: ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  }
  html, body { margin: 0; height: 100%; background: var(--papier); }
  svg { display: block; width: 100vw; height: 100vh; }
  .titre { font: 400 28px var(--serif); fill: var(--encre); }
  .surtitre { font: 500 10px var(--mono); fill: var(--gris); letter-spacing: .14em; }
  .nom { font: 600 14px var(--sans); fill: var(--encre); }
  .sous { font: 400 11px var(--sans); fill: var(--gris); }
  .tech { font: 400 10px var(--mono); fill: var(--gris); }
  .etiq { font: 500 10px var(--sans); fill: var(--doux); }
  .note { font: italic 400 14px var(--serif); fill: var(--gris); }
  .txt-accent { fill: var(--accent); }
  .masque { fill: var(--papier); }
  .b-base { fill: #fff; stroke: var(--encre); stroke-width: 1; }
  .b-focal { fill: var(--accent-teinte); stroke: var(--accent); stroke-width: 1.2; }
  .b-stock { fill: rgba(45,49,66,.05); stroke: var(--gris); stroke-width: 1; }
  .b-externe { fill: rgba(45,49,66,.03); stroke: rgba(45,49,66,.30); stroke-width: 1; }
  .b-personne { fill: rgba(79,93,117,.10); stroke: var(--doux); stroke-width: 1; }
  .b-option { fill: rgba(45,49,66,.02); stroke: rgba(45,49,66,.25); stroke-width: 1; stroke-dasharray: 4 3; }
  .zone { fill: rgba(45,49,66,.02); stroke: rgba(45,49,66,.10); stroke-width: .8; }
  .f { fill: none; stroke: var(--gris); stroke-width: 1.2; marker-end: url(#fleche); }
  .f-accent { stroke: var(--accent); marker-end: url(#fleche-accent); }
  .f-lien { stroke: var(--lien); marker-end: url(#fleche-lien); }
  .f-tirets { stroke-dasharray: 5 4; stroke-width: 1; }
  .f-nue { marker-end: none; }
  .filet { fill: none; stroke: var(--filet); stroke-width: .8; }
</style>
</head>
<body>
<svg viewBox="0 0 960 600" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="SLUG-titre SLUG-desc">
  <title id="SLUG-titre">Titre court, 60 caractères au plus</title>
  <desc id="SLUG-desc">Une phrase qui dit ce que montre le diagramme, pas sa forme.</desc>
  <defs>
    <marker id="fleche" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" fill="#4f5d75"/></marker>
    <marker id="fleche-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" fill="#bf4520"/></marker>
    <marker id="fleche-lien" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" fill="#2e5aa8"/></marker>
  </defs>
  <rect width="100%" height="100%" class="masque"/>
  <text class="surtitre" x="48" y="52">ORGANIGRAMME · BOUTIQUE</text>
  <text class="titre" x="48" y="86">Titre du diagramme</text>
  <!-- Ordre de dessin : zones, puis flèches, puis étiquettes, puis boîtes, puis légende -->
</svg>
</body>
</html>
```

Une boîte : un masque opaque, puis la boîte, puis les textes centrés.
```svg
<rect class="masque" x="400" y="160" width="160" height="56" rx="6"/>
<rect class="b-base" x="400" y="160" width="160" height="56" rx="6"/>
<text class="nom" x="480" y="185" text-anchor="middle">Gérante</text>
<text class="sous" x="480" y="203" text-anchor="middle">Achats et caisse</text>
```

**Largeur d'une boîte** : nombre de caractères × taille de police × 0,6, plus 24 px de marge en tout, arrondi au multiple de 4 supérieur. Fais le calcul pour la ligne la plus longue. Le français est 15 à 20 % plus long que l'anglais : prévois large ou raccourcis le texte.

## 6. Règles de tracé (non négociables)

1. **Flèches à angle droit**, coins arrondis (`Q`, rayon 8). Une ligne droite seulement si les deux bouts ont le même x ou le même y. Jamais de diagonale.
2. **Étiquette de flèche** (16 caractères au plus, en minuscules, `.etiq`) posée sur un masque opaque, **à 6 à 10 px du trait**, jamais dessus. Sur un segment vertical, mets-la à côté.
3. **Aucun chevauchement** : deux flèches ne partagent jamais un tronçon. Écarte les tracés parallèles de 12 px au moins ; à un croisement, fais un petit pont (arc) sur la flèche la moins importante.
4. **Un point d'attache par flèche** : N flèches sur un même bord partent de points répartis à L × k / (N + 1), à 12 px au moins l'un de l'autre et à 8 px au moins d'un coin.
5. **Une flèche ne passe jamais derrière une boîte** qui n'est ni son départ ni son arrivée. Contourne-la.
6. **Dessine les flèches avant les boîtes**, et vérifie qu'aucun masque d'étiquette ne déborde sur une boîte.

Coordonnées, tailles et écarts sur une **grille de 4 px**. Marges extérieures de 48 px au moins.

## 7. Ce qui fait « fait à la va-vite »

Ombres portées, dégradés, néon, fond sombre avec lueur cyan ; coins très arrondis (plus de 10 px) ; toutes les boîtes identiques ; l'accent partout ; légende flottant au milieu du dessin (elle va en bandeau en bas, sous un filet) ; texte vertical ; émojis à la place d'icônes ; police à chasse fixe pour des noms (le `.tech` est réservé aux URL, numéros, codes, montants) ; trois cartes identiques en rangée ; information visible seulement au survol (le PNG ne la montrera pas).

## 8. Fabriquer, se relire, exporter

1. **Écrire** le fichier avec `write_file` (`diagrammes/<nom>.html`).
2. **Se relire** avec `capture_page`, `file` et `viewports: ["desktop"]`. Cherche et nomme au moins un défaut parmi les suivants :
   - un texte coupé ou qui déborde de sa boîte ;
   - une étiquette loin de sa flèche, ou posée sur le trait ;
   - une flèche qui traverse une boîte, ou qui finit dans le vide ;
   - des flèches superposées ou qui convergent au même point ;
   - des écarts inégaux entre boîtes sœurs ;
   - un amas d'un côté et un grand vide de l'autre ;
   - un contenu coupé au bord, ou un texte trop petit.
   Si tu ne trouves rien, dis pour chaque point pourquoi il ne s'applique pas. Corrige en restructurant d'abord (sens du flux, regroupement, textes plus courts), et en déplaçant des coordonnées ensuite. Deux tours de correction au plus.
3. **Passer la liste de vérification** (§9).
4. **Exporter** avec `export_animation` : `file` (le HTML), `format: "png"`, `width` et `height` du tableau §4, et `output` (`diagrammes/<nom>.png`). Tu reçois l'image : regarde-la à taille réelle, elle est le vrai livrable.
5. **Règle absolue : après toute modification du HTML, même d'un seul mot, réexporte le PNG.** L'export est toujours ta dernière action. Le PNG livré doit correspondre à la dernière version du HTML. Ne demande jamais à l'utilisateur de dire « réexporte ».
6. **Livrer** : le PNG s'affiche dans la conversation. Donne les deux noms de fichiers et, en une phrase, ce que tu as dû laisser de côté pour rester lisible.

Pour une **demande de changement** (couleur de l'entreprise, nom, une boîte en plus), modifie le HTML avec `edit_file`, relis-le avec `capture_page`, puis réexporte.

## 9. Liste de vérification avant export

- [ ] Le bon type ? Un tableau ne ferait-il pas mieux ?
- [ ] Peut-on enlever une boîte, fusionner deux boîtes, retirer une flèche ou une étiquette ?
- [ ] Accent sur 2 éléments au plus ; légende complète, en bas, sans entrée inutile ?
- [ ] Budget du type respecté (9 boîtes et 12 flèches au plus en général) ?
- [ ] Les 6 règles de tracé du §6 respectées ? Grille de 4 px ?
- [ ] Le texte tient dans chaque boîte, avec 12 px de marge de chaque côté ?
- [ ] `<title>` en premier enfant du SVG, `<desc>` en une phrase, identifiants `SLUG-titre` et `SLUG-desc` ?
- [ ] Aucun lien réseau (police, image, script) ? Tout est dans un seul fichier ?
- [ ] Orthographe et accents français relus (É, À, Ç en majuscules aussi) ?

## 10. Couleurs du client

Si l'utilisateur donne la couleur de sa marque, mets-la dans `--accent` (et la même couleur à 8 % d'opacité dans `--accent-teinte`, ainsi que dans le marqueur `fleche-accent`). Vérifie qu'elle reste lisible sur le papier (contraste d'au moins 4,5:1). Sinon, fonce-la tout en gardant sa teinte. Garde une seule couleur d'accent. Une version sombre est décrite dans `references/style.md`.

---
Adapté du projet open source diagram-design de Cathryn Lavery (licence MIT) : https://github.com/cathrynlavery/diagram-design. Texte de la licence dans `LICENSE`.
