# Vitrine getanzar.com

Site statique bilingue (FR / EN), généré par `build.py` (Python standard, aucune dépendance).

```
i18n/fr.json, i18n/en.json   tous les textes, une source par langue (mêmes clés)
templates/                   gabarit commun (base.html) + une page par fichier
static/                      CSS, JS, polices, icônes, images de partage → /assets/
data/prix.json               grilles de prix de repli (si l'API ne répond pas)
Caddyfile, Dockerfile        service (redirections de langue, en-têtes de sécurité)
```

## Prévisualiser

```bash
cd apps/site
python3 build.py                       # → dist/
python3 -m http.server -d dist 8000    # http://localhost:8000/fr/
```

(Les redirections de `/` selon la langue sont faites par Caddy : en local, ouvre directement `/fr/` ou `/en/`.)

## Modifier un texte

Change-le dans `i18n/fr.json` **et** `i18n/en.json` (le script refuse de générer si les clés diffèrent).

## Ajouter une langue

1. Copier `i18n/en.json` en `i18n/xx.json` et traduire (y compris les `slug` des pages).
2. Ajouter `"xx"` à `LANGUES` dans `build.py`.
3. Dans le `Caddyfile`, ajouter la langue aux `map` (cookie, Accept-Language, page de téléchargement).

## Prix

- La page Tarifs lit `GET https://anzar-api.issalanhub.com/api/public/pricing` (sans compte),
  dans la monnaie du visiteur. Le serveur reste seul à calculer les prix.
- Si l'API ne répond pas, ou si la monnaie du visiteur n'est pas encore payable (aucun fournisseur actif),
  le site affiche la grille prévue pour cette monnaie dans `data/prix.json`.
  Après un changement de grille dans le backend : `python3 build.py --sync-prix ../../services/api`.

## Téléchargement

La page lit la dernière release **publiée** de `Abdoulfataou/anzar-desktop` (API GitHub).
Une release en brouillon n'est pas visible : il faut la publier sur GitHub.

Tant que le Mac n'est pas notarié (pas de certificat Apple « Developer ID Application »), la page
explique comment ouvrir l'app la première fois. Le jour où l'app est notariée : vider
`download.mac_first_open` (FR et EN) et retirer la première entrée de `download.help`.

## Images de partage

`static/og-fr.png` et `static/og-en.png` (1200 × 630). À régénérer si le titre change.

## Polices

Hanken Grotesk et Unbounded, licence SIL Open Font License (voir `static/fonts/OFL-*.txt`).
