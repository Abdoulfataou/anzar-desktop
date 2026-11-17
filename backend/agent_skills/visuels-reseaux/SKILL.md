---
name: visuels-reseaux
description: Créer des visuels pour les réseaux sociaux et l'impression (publication Instagram ou Facebook, statut WhatsApp, miniature, bannière, affiche, flyer, carte de visite) en HTML ou SVG, puis les exporter en image. À charger pour toute demande de visuel graphique.
---

# Visuels pour les réseaux et l'impression

On conçoit le visuel comme une page HTML (ou un SVG) aux dimensions exactes du format, puis on l'exporte en image.

## 1. Formats

| Format | Taille en pixels |
|---|---|
| Publication carrée (Instagram, Facebook) | 1080 × 1080 |
| Publication portrait (Instagram) | 1080 × 1350 |
| Story, statut WhatsApp, Reels, TikTok | 1080 × 1920 |
| Miniature YouTube | 1280 × 720 |
| Couverture Facebook | 1640 × 624 (contenu important au centre) |
| Bannière LinkedIn | 1584 × 396 |
| Affiche A4 pour impression | 2480 × 3508 (300 dpi), marges de 5 mm |
| Flyer A5 | 1748 × 2480 |

Pour les stories, garde le texte important à l'écart des 250 px du haut et du bas, couverts par l'interface.

## 2. Construire

- Un fichier HTML par visuel, avec un conteneur aux dimensions exactes (`width` et `height` en px) et `overflow: hidden`.
- Polices web chargées dans la page ; attends leur chargement avant la capture.
- Images du client : compressées, recadrées avec `object-fit: cover`.
- Une hiérarchie en trois niveaux au plus : l'accroche (lisible en une seconde sur un téléphone), l'information (prix, date, lieu), l'action (numéro WhatsApp, adresse, lien).
- Texte assez grand : sur une story, rien sous 40 px ; sur une publication carrée, rien sous 28 px.
- Contraste fort : le visuel sera vu en plein soleil sur un écran peu lumineux.

## 3. Identité

- Reprends les couleurs, le logo et les polices du client s'il les donne. Sinon, propose une palette tirée de son métier.
- Pour une série (plusieurs publications), garde la même grille, les mêmes polices, la même place pour le logo : on doit reconnaître la marque au premier coup d'œil.
- Évite les clichés : dégradé violet-rose générique, texte en contour, dix polices différentes.

## 4. Exporter

- Lance un petit serveur : `start_dev_server` avec la commande `npx -y serve -l 4321 .`
- Vérifie avec `capture_page` (format ordinateur, page entière si besoin) et corrige.
- Pour produire le fichier final à la bonne taille, écris un script avec Playwright :
  `npx -y playwright screenshot --viewport-size=1080,1080 http://localhost:4321/visuel.html visuel.png`
  (adapte la taille au format ; ajoute `--full-page` pour une affiche). Si le navigateur manque : `npx -y playwright install chromium`.
- Range les images produites dans un dossier `export/` et donne leurs chemins à l'utilisateur.

## 5. Vérifier avant de livrer

- L'accroche se lit-elle en une seconde ?
- Le numéro, le prix, la date sont-ils exacts et bien visibles ?
- Rien n'est coupé ni trop près du bord ?
- Le visuel ressemble-t-il à la marque du client, et pas à un modèle ?
