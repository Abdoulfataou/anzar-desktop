# Chronologie, frise et planning

## Chronologie ou frise

**Pour :** l'histoire d'une entreprise, les étapes d'un projet, une feuille de route, les dates clés d'un dossier, une frise historique pour un cours.

- Une ligne de base horizontale (`stroke:var(--encre); stroke-width:1`) au milieu du dessin.
- Des graduations aux bornes de temps (années, mois, trimestres). Leur date est écrite dessous en `.tech`.
- Chaque événement est un petit cercle plein (`r=4`, encre) sur la ligne. Son libellé (date en `.surtitre` et texte en `.nom` ou `.sous`) **alterne au-dessus et au-dessous**, relié au cercle par un fin trait vertical (`.filet`, plus foncé si besoin).
- Le ou les jalons majeurs (1 ou 2) : cercle accent `r=6` et libellé `.nom` couleur accent.
- **L'échelle de temps est honnête.** Des événements inégalement espacés dans le temps sont inégalement espacés sur la frise. Une période trop dense s'écrit avec une coupure visible (deux petits traits obliques sur la ligne) et un nouveau départ, jamais avec un faux espacement régulier.
- Mesures (`large`) : ligne en y = 380, de x = 96 à x = 1184. Libellés à 56 à 120 px de la ligne, en alternance. Largeur d'un libellé : 160 px au plus, 2 lignes au plus.
- En format `telephone`, la frise devient verticale : la ligne en x = 96, les dates à gauche, les textes à droite, de haut en bas.
- Budget : 10 événements · 2 jalons accent.

## Planning (Gantt)

**Pour :** des tâches avec un début et une fin, regroupées en phases (lancement d'une boutique, chantier, campagne, préparation d'un examen).

- **Colonne des tâches** à gauche (x = 48 à 248) : nom de la tâche en `.nom` à 12 px (`style="font-size:12px"`). Le nom de la phase est en `.surtitre` au-dessus de son groupe.
- **Zone de temps** à droite (x = 248 à W − 48). Semaines ou mois en `.tech` en haut, avec un filet sous l'axe.
- **Une ligne par tâche** : 40 px de haut. Barre de 24 px de haut, `rx=4`, centrée dans la ligne : fond `rgba(79,93,117,.15)` et contour `var(--gris)`.
- **La tâche clé** (livrable principal, ou tâche qui retarde tout le reste) : fond `var(--accent-teinte)`, contour accent, nom en accent. Une seule.
- Une zone légère (`.zone`) derrière chaque phase.
- Facultatif : une ligne verticale en tirets pour « aujourd'hui ».
- Largeur d'une barre = (fin − début) × pas, avec pas = largeur de la zone de temps / nombre de semaines.
- Budget : 12 tâches · 5 tâches en parallèle dans une phase · pas de flèches de dépendance (sauf si c'est indispensable).
- Ne mets pas les dates dans les barres : elles se lisent sur l'axe.
