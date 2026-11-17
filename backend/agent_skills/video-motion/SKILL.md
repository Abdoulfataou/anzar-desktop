---
name: video-motion
description: Créer une courte vidéo de motion design (pub pour TikTok, Reels, statut WhatsApp, présentation d'un produit, logo animé, texte animé) et l'exporter en MP4. À charger quand l'utilisateur veut une vidéo, une pub animée ou un logo animé.
---

# Vidéo de motion design, du script au MP4

On construit la vidéo comme une page web animée aux dimensions exactes, puis `export_animation` l'enregistre image par image en MP4. Rien à installer chez l'utilisateur.

## 1. Le script d'abord

Écris le découpage en plans, avec les temps :
- **0 à 1,5 s : l'accroche.** Ce qui arrête le défilement : un prix, une question, un produit en gros plan, un mouvement fort. Sur TikTok, tout se joue ici.
- **Le cœur : 1 à 3 idées,** une par plan, 1,5 à 3 s chacune. Un texte court par plan (6 mots au plus), lisible à environ 3 mots par seconde.
- **La fin : l'action et la marque,** au moins 1,5 s immobile : logo, numéro WhatsApp, « Commande maintenant ».
- Durée totale : 6 à 15 s pour une pub de réseau social. Une boucle de 4 à 8 s pour un statut ou un logo animé. Jusqu'à 60 s pour une présentation de produit ou un statut long (`export_animation` accepte 60 s au plus en MP4, 20 s en GIF). Compte environ 2 minutes de production pour 60 s ; préviens l'utilisateur pour une vidéo longue.

## 2. Construire la page

- Un seul fichier HTML, un conteneur aux dimensions exactes du format (1080×1920 pour une story ou un Reel, 1080×1080 en carré), `overflow: hidden`, sans barres de défilement.
- **Tout démarre seul au chargement**, sans clic ni défilement. Un plan = un groupe d'éléments animés avec des `animation-delay` (CSS) ou une timeline GSAP.
- Pense « écran de téléphone » : texte énorme (90 px et plus en 1080×1920), contraste fort, rien d'important dans les 250 px du haut et du bas (interface de TikTok et Instagram).
- Images du client recadrées avec `object-fit: cover` ; polices chargées avant le début de l'animation (`document.fonts.ready` si tu animes en JavaScript).
- Charge la skill `motion-design` pour les durées, les courbes et la chorégraphie.

## 3. Vérifier puis exporter

Aucun serveur nécessaire : les outils ouvrent directement le fichier HTML (`file`).
1. Vérifie les moments clés avec `capture_page`, `file` et `frames` (un instant par plan, plus la fin).
2. Exporte : `export_animation` avec `file`, `size: "story"` (ou `carre`, `portrait`, `paysage`), `duration_ms` égale à la durée du script, `fps: 30`, `output: "export/nom-clair.mp4"`.
3. Regarde les images clés renvoyées : début, milieu, fin. Corrige et réexporte si besoin.
4. Donne à l'utilisateur le chemin de la vidéo : il la voit dans l'onglet Fichiers d'ANZAR (ou dans Documents/ANZAR sans projet ouvert).

Le rendu utilise une horloge virtuelle : CSS, GSAP, canvas, three.js et le JavaScript maison (setTimeout, requestAnimationFrame) sont rendus image par image, au rythme exact. N'utilise pas d'horloge réelle extérieure (vidéo intégrée, GIF animé dans la page, chargement réseau pendant l'animation) : ces éléments-là ne suivent pas l'horloge virtuelle.

## 4. Le son

`export_animation` produit une vidéo **sans son**. Dis-le à l'utilisateur et propose-lui d'ajouter la musique ou la voix dans CapCut ou directement dans TikTok, Instagram ou WhatsApp, qui proposent des musiques libres de droits.

Pour une vidéo longue avec voix off et musique intégrées, Remotion (vidéos en React, rendu MP4 par `npx remotion render`) est l'outil adapté. Préviens alors l'utilisateur que sa licence est gratuite pour les particuliers et les très petites entreprises, mais payante au-delà.

## 5. Avant de livrer

- L'accroche se comprend-elle sans le son, en 1,5 seconde ?
- Chaque texte reste-t-il assez longtemps pour être lu ?
- Le prix, le numéro et le nom sont-ils exacts ?
- La fin reste-t-elle immobile assez longtemps pour noter le contact ?
