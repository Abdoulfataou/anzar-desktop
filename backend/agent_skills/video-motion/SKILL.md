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
4. **L'export est toujours la dernière étape.** Après toute modification de la page, même minime, réexporte avant de finir : la vidéo livrée doit correspondre à la dernière version. Ne demande jamais à l'utilisateur de dire « réexporte ».
5. La vidéo s'affiche d'elle-même dans la conversation, avec un lecteur et un bouton pour ouvrir le dossier. Termine en une ou deux phrases : le nom du fichier, la durée, et une proposition de retouche. Pas de longue liste de ce que tu as fait.

Pour tout traitement annexe (redimensionner le logo, lire une image), écris un script `.mjs` avec write_file puis lance-le ; jamais `node -e` ni `python -c`.

Le rendu utilise une horloge virtuelle : CSS, GSAP, canvas, three.js et le JavaScript maison (setTimeout, requestAnimationFrame) sont rendus image par image, au rythme exact. N'utilise pas d'horloge réelle extérieure (vidéo intégrée, GIF animé dans la page, chargement réseau pendant l'animation) : ces éléments-là ne suivent pas l'horloge virtuelle.

## 3 bis. Réglages de netteté et de déterminisme

- **Aléa seedé obligatoire** : jamais `Math.random()` nu. Utilise un PRNG seedé (même seed = même vidéo après retouche) :
  ```js
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  const rand = mulberry32(42);
  ```
- **Polices prêtes avant la première frame** : `display=block` sur le lien Google Fonts, puis `await document.fonts.ready` avant de lancer la timeline GSAP. Police non chargée = première frame floue, vidéo gâchée.
- **Tailles d'images explicites** (`width`/`height` ou `aspect-ratio`) : pas de reflow en pleine capture.
- **`will-change: transform`** sur les éléments animés (compositing GPU, frames régulières) ; animer `transform` et `opacity`, jamais `top/left/width`.
- **GSAP** : appelle `vendor_lib` (libs vendues dans ANZAR, hors ligne, version figée) plutôt qu'un CDN — un CDN lent ou coupé ruine la capture. Les recettes prêtes sont dans la skill `gsap-cookbook`, les règles de rythme dans `motion-system`.

## 4. Le son

- **Musique fournie par l'utilisateur** : s'il a joint un fichier audio (MP3, M4A ou WAV), passe son chemin dans `music` à `export_animation` (le chemin de la copie, indiqué dans la pièce jointe, par exemple `.anzar/fichiers/musique.mp3` ou `fichiers/musique.mp3`). La musique est coupée à la durée de la vidéo, rejouée en boucle si elle est trop courte, avec un léger fondu d'entrée et un fondu de sortie (`fade_out_ms`, 800 ms par défaut).
  - `music_start_ms` pour commencer au bon moment (sauter une introduction lente, démarrer sur le refrain).
  - `music_volume` (0 à 1) si la musique est trop forte.
  - Cale les moments forts de l'animation (apparition du prix, du logo) sur les temps forts de la musique quand l'utilisateur te les indique.
- **Sans fichier audio** : propose à l'utilisateur d'en joindre un, ou d'ajouter la musique ensuite dans CapCut, TikTok, Instagram ou WhatsApp, qui proposent des musiques libres de droits.
- **Droits** : n'utilise que de la musique que l'utilisateur a le droit d'utiliser (achetée, libre de droits, ou créée par lui). Rappelle-le en une phrase si la vidéo est destinée à une publicité.
- Un GIF ne contient jamais de son.
- Pour une voix off, Remotion (vidéos en React, rendu MP4 par `npx remotion render`) est l'outil adapté. Préviens alors l'utilisateur que sa licence est gratuite pour les particuliers et les très petites entreprises, mais payante au-delà.

## 5. Avant de livrer

- L'accroche se comprend-elle sans le son, en 1,5 seconde ?
- Chaque texte reste-t-il assez longtemps pour être lu ?
- Le prix, le numéro et le nom sont-ils exacts ?
- La fin reste-t-elle immobile assez longtemps pour noter le contact ?
