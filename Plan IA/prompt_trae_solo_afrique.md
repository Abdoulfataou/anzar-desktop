# Prompt pour modèle IA : Développement d'une application "Trae Solo pour l'Afrique"

## Contexte
Vous êtes un modèle IA capable de générer du code, de concevoir des interfaces et d'architecturer des applications. L'objectif est de créer une application web/mobile inspirée de l'interface de **Trae Solo** (voir screenshot fourni) mais adaptée pour le marché africain, avec des réorganisations pour ne pas être une copie conforme.

## Description de l'interface source (Trae Solo)
À partir du screenshot, on observe les éléments suivants :

### Structure générale
- Barre latérale gauche avec onglets principaux (probablement : Tasks, Projects, Tools, Settings)
- Zone centrale avec des cartes de projets/tâches
- En-tête avec recherche, notifications, profil utilisateur

### Éléments identifiés
1. **Onglet "New task rea"** (probablement "New task request") – permet de créer une nouvelle tâche.
2. **Onglet "Project list"** – liste des projets avec cartes.
3. **Cartes de projets** : chaque carte contient :
   - Titre (ex. "Développer une application IA puissa...")
   - Badge de statut (ex. "TenereGuard", "Abdoulfataou Pro")
   - Catégorie (ex. "Application Development")
   - Description courte (ex. "Implement a multi-language learning platform.")
4. **Section "Code with SOLO"** – slogan "Let SOLO handle all your development tasks".
5. **Section "Project Understanding Game Creativity"** – sous‑section avec cartes comme "Analyze project repository Create a pixel art mecha battle game".
6. **Section "Automation Tools"** – sous‑section avec carte "Write an automation tool to collect data".
7. **Footer** – "Help you write code, debugs, optimize performance and other development work, deliver production-ready code."
8. **Badge "SOLO Auto Model v"** – version.

### Logique sous‑jacente
- Interface orientée **gestion de projets et tâches** pour le développement logiciel assisté par IA.
- **Navigation hiérarchique** : onglets principaux → sous‑onglets → cartes détaillées.
- **Cartes interactives** menant à des vues détaillées (détail du projet, outils d'automatisation, etc.).
- **Design moderne** : coins arrondis, ombres légères, palette de couleurs sobre (blanc, gris, touches de couleur pour les badges).

## Exigences pour la nouvelle application "Trae Solo pour l'Afrique"

### 1. Adaptation thématique pour l'Afrique
- **Nom** : proposer un nom évocateur pour le marché africain (ex. "JengaDev", "UbuntuBuild", "AfriSolo").
- **Langues** : support du français, anglais, swahili, arabe (selon la région cible). Interface localisable.
- **Références culturelles** : utiliser des couleurs, motifs ou symboles inspirés de l'art africain (discrètement, pour un design professionnel).
- **Cas d'usage prioritaires** : mettre en avant des projets typiques du continent (applications mobile banking, agrictech, edtech, santé, énergie solaire, etc.).

### 2. Structure des onglets et sous‑onglets (reprise mais réorganisée)
**Barre latérale principale** (verticale) :
- **Tableau de bord** (Dashboard) – vue d'ensemble des projets, statistiques.
- **Projets** (Projects) – liste des projets, filtres par statut, région, secteur.
- **Tâches** (Tasks) – gestion des tâches personnelles et d'équipe.
- **Outils IA** (AI Tools) – outils d'automatisation, génération de code, analyse de données, etc.
- **Ressources** (Resources) – documentation, templates, tutoriels adaptés aux développeurs africains.
- **Communauté** (Community) – espace d'échange, forums, partage de projets.
- **Paramètres** (Settings) – profil, équipe, facturation.

**Sous‑onglets** (dans la zone centrale selon la sélection) :
- Sous **Projets** : "Tous", "En cours", "Terminés", "Archivés".
- Sous **Outils IA** : "Générateur de code", "Analyse de données", "Automatisation", "Tests".
- Sous **Ressources** : "Guides", "API locales", "Modèles de contrat", "Financement".

### 3. Graphisme et charte visuelle
- **Palette de couleurs** : inspirée des paysages africains (terres ocres, verts savane, bleus ciel). Éviter les stéréotypes, rester professionnel.
- **Typographie** : polices modernes, lisibles (ex. Inter, Open Sans). Possibilité d'intégrer une police africaine stylisée pour les titres.
- **Cartes de projet** : design repris mais avec des indicateurs visuels de région (petit drapeau ou icône géographique).
- **Badges** : catégories sectorielles (Fintech, AgriTech, Santé, Éducation) avec codes couleur.
- **Animations** : discrètes, pour améliorer l'expérience utilisateur.

### 4. Logique fonctionnelle
- **Création de projet** : formulaire avec champs spécifiques (région, secteur, langues cibles, budget estimé).
- **Gestion des tâches** : intégration avec des outils de collaboration (commentaires, pièces jointes, délais).
- **Outils IA** : interface unifiée pour lancer des générations de code, des analyses de données, des scripts d'automatisation, avec pré‑remplissage de contextes africains (ex. données démographiques, réglementations locales).
- **Tableau de bord** : métriques clés (nombre de projets par secteur, progression, équipes actives).
- **Communauté** : système de likes, partage, mentorat.

### 5. Réorganisations pour éviter la copie conforme
- **Inverser la disposition** : placer la barre latérale à droite, ou utiliser une barre horizontale en haut pour les onglets principaux sur mobile.
- **Regroupement différent** : fusionner "Tasks" et "Projects" en un seul onglet "Activités", avec onglets secondaires.
- **Section "Code with SOLO"** remplacée par une bannière personnalisable mettant en avant un outil ou un projet phare.
- **Ajouter un onglet "Marché"** (Marketplace) pour des services tiers (hébergement local, paiements mobiles, SMS API).
- **Intégrer une carte interactive** de l'Afrique montrant la répartition géographique des projets.
- **Système de récompenses** (badges, niveaux) pour encourager l'engagement communautaire.

### 6. Exigences techniques
- **Stack technique recommandée** : React/Next.js pour le frontend, Node.js/Express ou Python/FastAPI pour le backend, base de données PostgreSQL ou MongoDB.
- **Responsive design** : mobile-first, support tablette et desktop.
- **Accessibilité** : respect des normes WCAG, contrastes adaptés.
- **Performance** : optimisée pour les connexions internet variables (faible bande passante).
- **Sécurité** : authentification robuste, chiffrement des données, conformité RGPD et lois locales.

## Livrable attendu
Fournissez :
1. **Maquettes Figma** (ou description détaillée des écrans) incluant :
   - Page de connexion / inscription
   - Tableau de bord
   - Liste des projets
   - Détail d'un projet
   - Interface d'un outil IA (ex. générateur de code)
   - Page de profil utilisateur
2. **Architecture technique** : schéma des composants, choix des technologies, structure de la base de données.
3. **Code frontend** (au moins un composant clé, ex. la carte de projet) avec style CSS/ Tailwind.
4. **Spécifications des API** (endpoints principaux pour projets, tâches, outils IA).
5. **Guide de localisation** : comment ajouter une nouvelle langue, adapter les contenus.

## Instructions supplémentaires
- Soyez créatif tout en conservant la logique d'origine de gestion de projets assistée par IA.
- Proposez des micro‑interactions qui améliorent l'engagement.
- Pensez à l'évolutivité : comment ajouter de nouveaux outils IA, intégrer des APIs locales (paiement mobile, géolocalisation).
- Prévoyez une modularité pour que l'application puisse être utilisée aussi bien par des startups que des grandes entreprises.

## Ton de communication
- Professionnel, motivant, aligné avec les valeurs d'innovation et de collaboration panafricaine.
- Éviter le jargon technique excessif ; expliquer les choix lorsque nécessaire.

---
**Note** : Ce prompt est conçu pour être fourni à un modèle IA (GPT‑4, Claude, etc.) ou à une équipe de développement. Adaptez‑le selon le niveau de détail souhaité.