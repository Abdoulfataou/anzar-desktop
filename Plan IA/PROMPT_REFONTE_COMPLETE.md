# PROMPT POUR REFONTE COMPLÈTE ISSALAN DESKTOP

## 🌍 CONTEXTE
Application ISSALAN Desktop existante (React + TypeScript + Vite) avec design africain complet, 5 agents IA, et système d'authentification simulé. L'application est fonctionnelle mais nécessite une refonte moderne complète pour améliorer le design, les performances et l'expérience utilisateur.

## 🎯 OBJECTIF
Créer une nouvelle version ultra-moderne de ISSALAN Desktop avec :
- Identité africaine renforcée et design épuré
- Performances optimisées (temps de chargement, réactivité)
- Expérience mobile/tablette améliorée
- Fonctionnalités étendues et micro-interactions
- Code propre, maintenable et scalable

## 🏗 STACK TECHNIQUE (À CONSERVER)
- **Frontend** : React 18+ avec TypeScript strict
- **Build** : Vite avec optimisation avancée
- **Styling** : Tailwind CSS avec design system africain
- **État global** : Zustand avec persistance
- **Routing** : React Router DOM v6
- **Éditeur de code** : Monaco Editor (comme VS Code)
- **Validation** : React Hook Form + Zod
- **Icônes** : Lucide React

## 🎨 PALETTE DE COULEURS AFRICAINES (À CONSERVER)
```javascript
// Palette africaine existante - À GARDER
african-earth: '#D2691E',      // Terre africaine
african-savanna: '#8FBC8F',    // Savane
african-sky: '#87CEEB',        // Ciel africain  
african-sunset: '#FF8C00',     // Coucher de soleil
african-gold: '#FFD700',       // Or africain
african-clay: '#B5651D',       // Argile
african-forest: '#228B22',     // Forêt tropicale
african-ocean: '#1E90FF',      // Océan Atlantique/Indien
```

## 📱 PAGES À RECRÉER (9 PAGES)
1. **Login.tsx** - Authentification africaine avec motifs géométriques
2. **Register.tsx** - Inscription avec validation de mot de passe
3. **Dashboard.tsx** - Tableau de bord avec carte interactive Afrique
4. **Projects.tsx** - Liste des projets avec filtres régionaux
5. **NewProject.tsx** - Création avec sélection région africaine
6. **ProjectDetail.tsx** - Détail avec visualisation des 5 agents
7. **Agents.tsx** - 5 agents IA avec statistiques et onglets
8. **Settings.tsx** - Paramètres avec préférences africaines
9. **SectionPage.tsx** - Composant générique pour sous-onglets

## 🤖 5 AGENTS IA (CŒUR MÉTIER - À CONSERVER)
1. **Orchestrateur** - Coordonne l'exécution des autres agents
2. **Planificateur** - Décompose les tâches et organise le workflow
3. **Codeur** - Génère et optimise le code
4. **Testeur** - Vérifie la qualité et exécute les tests
5. **Exécuteur** - Lance les commandes et déploie les solutions

## 🚀 FONCTIONNALITÉS OBLIGATOIRES
- ✅ **Authentification simulée** : 2 utilisateurs (admin/user) avec JWT simulé
- ✅ **5 agents IA** : Interface dédiée avec cartes et statistiques
- ✅ **Éditeur de code intelligent** : Monaco Editor avec complétions IA
- ✅ **Carte interactive Afrique** : Heatmap avec répartition régionale
- ✅ **Sous-onglets complets** : 7 sections avec sous-pages
- ✅ **Design responsive** : Mobile-first, tablette, desktop optimisés
- ✅ **Dark/Light mode** : Thème africain cohérent
- ✅ **Animations** : Transitions douces et micro-interactions

## 🌍 IDENTITÉ AFRICAINE (À RENFORCER)
- **Design inspiré** des textiles et motifs africains
- **Régions supportées** : Afrique de l'Ouest, Est, Centre, Nord, Australe
- **Cas d'usage spécifiques** : Agriculture, santé, éducation, commerce local
- **Éléments culturels** : Drapeaux, noms de projets, références locales
- **Focus** sur défis et opportunités africains

## ⚡ AMÉLIORATIONS DEMANDÉES
1. **Design plus moderne et épuré** - Interface plus légère et aérée
2. **Meilleure expérience mobile** - Navigation tactile optimisée
3. **Performances optimisées** - Lazy loading, code splitting, images optimisées
4. **Micro-interactions** - Feedback utilisateur subtil et plaisant
5. **Système de notifications** - Toast modernes et notifications système
6. **Recherche globale** - Moteur de recherche plus puissant
7. **Analytics intégrés** - Tableaux de bord plus complets
8. **Accessibilité** - Support ARIA, contrastes, navigation clavier

## 🔐 DONNÉES DE TEST (À CONSERVER)
- **Admin** : `admin@issalan.africa` / `password123` (rôle: admin, région: Afrique de l'Ouest)
- **User** : `user@example.com` / `password123` (rôle: user, région: Afrique de l'Est)
- **Projets de démo** : 26 projets répartis par région africaine
- **Statistiques** : 85% taux de réussite, 42 membres actifs

## 📁 STRUCTURE DE DOSSIERS (À CONSERVER)
```
desktop/
├── src/
│   ├── api/              # API simulée (auth, projects, etc.)
│   ├── components/       # Composants réutilisables
│   ├── pages/           # 9 pages principales
│   ├── services/        # Services métier
│   ├── stores/          # Zustand stores (auth, projects)
│   ├── types/           # Types TypeScript
│   ├── App.tsx          # Configuration des routes
│   ├── index.css        # Styles globaux
│   └── index.tsx        # Point d'entrée
```

## 🎨 DESIGN SYSTEM AFRICAIN
- **Typography** : Inter (principal), JetBrains Mono (code)
- **Spacing** : Échelle cohérente (4px base)
- **Breakpoints** : Mobile (640px), Tablet (768px), Desktop (1024px+)
- **Shadows** : Subtiles et modernes
- **Borders** : Rayons cohérents (8px, 12px, 16px)
- **Transitions** : Durées standardisées (150ms, 300ms)

## 🔗 SOUS-ONGLETS (7 SECTIONS COMPLÈTES)
- **Dashboard** : Analytiques, Carte interactive
- **Projets** : En cours, Terminés, Archivés
- **Tâches** : Tâches d'équipe, Backlog
- **Outils IA** : Générateur de code, Analyse de données, Automatisation, Tests IA
- **Ressources** : Guides, API locales, Modèles, Financement
- **Communauté** : Forum, Projets partagés, Mentorat
- **Paramètres** : Profil, Équipe, Facturation, Intégrations

## 📱 RESPONSIVE BREAKPOINTS
- **Mobile** : < 640px - Navigation simplifiée, contenu vertical
- **Tablette** : 640px - 1024px - Sidebar réduite, grilles adaptatives
- **Desktop** : > 1024px - Interface complète, multi-colonnes

## 🎯 CRITÈRES DE RÉUSSITE
1. **Performance** : Score Lighthouse > 90 (Performance, Accessibility, Best Practices)
2. **Code qualité** : TypeScript strict, pas d'erreurs de compilation
3. **Design cohérent** : Palette africaine respectée, identité forte
4. **Expérience utilisateur** : Navigation intuitive, feedback immédiat
5. **Responsive** : Parfait sur mobile, tablette, desktop
6. **Fonctionnalités** : Toutes les fonctionnalités existantes présentes et améliorées

## 📋 LIVRABLES ATTENDUS
1. **Code source complet** - Documentation en ligne, bonnes pratiques
2. **Application fonctionnelle** - Accessible sur localhost avec Vite
3. **Design system** - Palette, composants, guidelines
4. **Documentation technique** - Architecture, installation, déploiement
5. **Identifiants de test** - 2 comptes fonctionnels avec données de démo
6. **Tests de performance** - Résultats Lighthouse inclus

## 🚨 CONTRAINTES TECHNIQUES
- **Compatibilité navigateurs** : Chrome, Safari, Firefox (dernières 2 versions)
- **Performance mobile** : Temps de chargement < 3s sur 4G
- **Accessibilité** : WCAG 2.1 AA minimum
- **SEO** : Meta tags, sémantique HTML, performance Core Web Vitals
- **Sécurité** : Protection basique (XSS, injection)

## 📊 ÉTAT ACTUEL DE RÉFÉRENCE
- **URL de test** : http://192.168.64.77:1420/
- **Statut** : Fonctionnel mais design à moderniser
- **Forces** : Architecture solide, identité africaine claire, fonctionnalités complètes
- **Faiblesses** : Design daté, expérience mobile à améliorer, performances à optimiser

---

## ✅ RÉSUMÉ EXÉCUTIF
**Refondre complètement ISSALAN Desktop en conservant :**
- L'identité africaine (palette couleurs, régions, cas d'usage)
- Les 5 agents IA spécialisés (cœur métier)
- L'architecture technique (React, TypeScript, Zustand, Vite)
- Les fonctionnalités principales (auth, projets, éditeur, dashboard)

**Améliorer significativement :**
- Le design (plus moderne, épuré, cohérent)
- L'expérience mobile/tablette
- Les performances (chargement, réactivité)
- Les micro-interactions et feedback utilisateur

**Livrer une application web React africaine moderne, performante et scalable.**

---

**DOCUMENTATION COMPLÈTE DISPONIBLE :** [DOCUMENTATION_REFONTE_ISSALAN_COMPLETE.md](computer:///sessions/69e41ebdf77f060a21c27083/workspace/DOCUMENTATION_REFONTE_ISSALAN_COMPLETE.md)

**APPLICATION DE TEST :** http://192.168.64.77:1420/

**IDENTIFIANTS :** 
- Admin: admin@issalan.africa / password123
- User: user@example.com / password123