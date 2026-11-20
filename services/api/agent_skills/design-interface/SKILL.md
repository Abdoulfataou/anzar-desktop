---
name: design-interface
description: Concevoir une interface, une page web ou un site qui a une vraie identité visuelle (pas un modèle générique). À charger avant de créer ou de refaire le design d'une page, d'un écran d'application, d'une vitrine ou d'un tableau de bord.
---

# Concevoir une interface qui a du caractère

Ton but : un design qu'on ne confond pas avec mille autres, et qui sert le sujet. Un site de pâtisserie à Niamey, un tableau de bord de pharmacie et une vitrine d'avocat ne doivent pas se ressembler.

## 1. Partir du sujet, pas d'un modèle

Avant d'écrire du code, réponds en trois lignes (dans ta tête ou dans ta réponse) :
- **Le sujet** : de quoi parle la page, pour quel métier ?
- **Le public** : qui la regarde, sur quel appareil ? En Afrique de l'Ouest, souvent un téléphone Android d'entrée de gamme et une connexion lente.
- **Sa mission** : l'action principale attendue (commander, appeler, s'inscrire, lire un prix).

Puis cherche les matières, couleurs et mots propres à ce métier (le wax d'une boutique de pagnes, la craie d'une école, l'emballage d'un produit local). C'est de là que viennent les choix originaux.

## 2. Un petit système de jetons, décidé avant de coder

Écris-le en variables CSS en tête de fichier :
- **Couleurs** : 4 à 6 couleurs nommées d'après le sujet (« --terre », « --indigo », pas « --primary-500 »). Un fond, un texte, une couleur d'accent, une couleur secondaire, une couleur de bordure. Contraste du texte : 4,5:1 minimum.
- **Typographie** : une ou deux familles, choisies pour ce sujet, pas par réflexe. Une échelle claire (par exemple 14, 16, 20, 28, 40, 56 px), des graisses voulues, des lignes de moins de 80 caractères.
- **Espacements** : une échelle (4, 8, 12, 16, 24, 32, 48, 64, 96 px), rien en dehors.
- **Rayons et ombres** : différents selon la hiérarchie (un bouton, une carte et une fenêtre n'ont pas le même rayon), ou pas d'ombre du tout.

## 3. Mettre l'audace à un seul endroit

Choisis UN élément mémorable : un titre très typographique, une photo qui occupe tout l'écran, un objet propre au métier (un ticket de caisse, une étiquette de prix, un menu à la craie), une démonstration vivante. Tout le reste est calme et discipliné. Avant de finir, retire un ornement.

## 4. Les clichés à éviter (sauf demande explicite)

- Le fond crème avec un titre à empattements et un accent terre cuite.
- Le fond presque noir avec un seul accent vert acide ou orange vif.
- Tout découper en cartes identiques, même arrondi, même ombre grise, dégradés décoratifs.
- Une petite étiquette en MAJUSCULES espacées au-dessus de chaque titre.
- Mettre un seul mot du titre en couleur ou en italique.
- Numéroter 01 / 02 / 03 un contenu qui n'est pas une suite d'étapes.
- Des flèches « → » ajoutées à tous les boutons et liens.
- Une animation d'apparition sur chaque bloc.

## 5. Le texte fait partie du design

- Écris du point de vue de l'utilisateur, en mots simples. Pas de jargon technique.
- Un bouton dit ce qui va se passer : « Commander sur WhatsApp », pas « Envoyer ».
- Une erreur explique quoi faire. Un écran vide invite à agir.
- Pas de texte de remplissage (lorem ipsum, « Bienvenue sur notre site ») : invente un contenu crédible pour le sujet.

## 6. Qualité de base, toujours

- Pensé d'abord pour le téléphone (390 px de large), puis élargi.
- Focus clavier visible, cibles tactiles de 44 px minimum, `prefers-reduced-motion` respecté.
- Léger : polices limitées à 2 familles et 3 graisses, images compressées et dimensionnées, pas de bibliothèque lourde pour un effet.
- Attention aux sélecteurs CSS qui s'annulent entre eux (marges entre sections notamment).

## 7. Regarder, critiquer, corriger

Après avoir construit, appelle `capture_page` (ordinateur et téléphone). Examine chaque capture :
- Qu'est-ce qui attire l'œil en premier ? Est-ce le bon élément ?
- Un texte déborde, se chevauche ou est coupé sur téléphone ?
- Les alignements et les espacements suivent-ils l'échelle ?
- Le contraste est-il suffisant partout ?
- Est-ce que ça ressemble à un modèle générique ? Si oui, renforce l'élément mémorable.

Corrige, recapture. Deux rounds au plus, puis présente le résultat en une ou deux phrases.
