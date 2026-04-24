# ISSALAN - Multi-Agent Application Generator

🚀 **ISSALAN** est un système multi-agent puissant qui génère des applications complètes à partir de descriptions textuelles. Il utilise 5 agents IA spécialisés qui collaborent pour planifier, coder, tester et exécuter des projets complets.

## 🌟 Fonctionnalités

### Agents Spécialisés
1. **Orchestrateur** - Analyse la demande utilisateur et crée un plan détaillé
2. **Planificateur** - Génère la structure complète du projet (dossiers, fichiers, dépendances)
3. **Codeur** - Écrit le code source propre, documenté et sécurisé
4. **Testeur** - Vérifie le code, trouve les bugs et propose des corrections
5. **Exécuteur** - Crée physiquement les fichiers et exécute les commandes

### "Vibecoding" Mode
- L'utilisateur donne une idée vague : "Crée un jeu Snake en Python avec Pygame"
- ISSALAN fait tout le reste : analyse, planification, codage, test, exécution
- Validation humaine uniquement pour le plan avant exécution

### Technologies
- **Backend** : Python 3.11+, AG2 (AutoGen), FastAPI, PostgreSQL, Redis
- **Desktop** : Tauri (Rust + React + TypeScript + Tailwind)
- **Mobile** : Expo (React Native + TypeScript)
- **IA** : DeepSeek Chat & Reasoner (via API)

## 🏗️ Architecture

```
mon-agent-app/
├── packages/
│   ├── shared-ui/          # Composants React partagés
│   ├── shared-bl/          # Logique métier partagée
│   │   ├── agents/         # 5 agents spécialisés
│   │   ├── tools/          # Tool calling
│   │   └── api/            # Appels DeepSeek + FastAPI
│   ├── desktop/            # Application Tauri
│   └── mobile/             # Application Expo
├── docker-compose.yml      # Configuration Docker complète
└── generated_projects/     # Projets générés automatiquement
```

## 🚀 Démarrage Rapide

### Prérequis
- Docker & Docker Compose
- Clé API DeepSeek (gratuite sur [deepseek.com](https://platform.deepseek.com/))

### Installation

1. **Cloner le projet**
```bash
git clone https://github.com/votre-username/issalan.git
cd issalan
```

2. **Configurer l'environnement**
```bash
cp .env.example .env
# Éditer .env et ajouter votre clé API DeepSeek
```

3. **Démarrer avec Docker**
```bash
docker-compose up --build
```

4. **Accéder aux services**
- API Backend : http://localhost:8000/docs
- Application Desktop : http://localhost:3000
- Application Mobile : Expo Go sur http://localhost:19002
- Monitoring : http://localhost:3001 (admin/admin)

### Développement Local

#### Backend
```bash
cd packages/shared-bl
python -m venv venv
source venv/bin/activate  # ou `venv\Scripts\activate` sur Windows
pip install -r ../../requirements.txt
python -m api.main
```

#### Desktop
```bash
cd desktop
npm install
npm run tauri:dev
```

#### Mobile
```bash
cd mobile
npm install
npx expo start
```

## 📖 Utilisation

### Créer votre première application

1. **Ouvrez l'interface ISSALAN** (desktop ou mobile)
2. **Décrivez votre application** :
   ```
   "Crée une application de gestion de tâches avec React, Node.js, et MongoDB"
   ```
3. **Validez le plan** généré automatiquement
4. **Observez les agents travailler** en temps réel
5. **Accédez à votre application** générée dans `./generated_projects/`

### Exemples de demandes

- "Crée un jeu Snake en Python avec Pygame"
- "Développe une app de gestion de tâches avec React, Node.js, et MongoDB"
- "Fais un site e-commerce complet avec panier et paiement Stripe"
- "Crée une API REST pour un réseau social avec authentification JWT"

## 🔧 Configuration

### Variables d'environnement

Créez un fichier `.env` basé sur `.env.example` :

```env
# DeepSeek API
DEEPSEEK_API_KEY=votre_clé_api_ici
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# Base de données
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/multiagent_db

# Redis
REDIS_URL=redis://localhost:6379/0

# Serveur
API_PORT=8000
DEBUG=true
```

### Modes DeepSeek

ISSALAN supporte deux modes d'IA :

1. **⚡ Mode Standard** (`deepseek-chat`)
   - Réponses rapides pour tâches simples
   - Débogage, questions courantes

2. **🧠 Mode Raisonnement** (`deepseek-reasoner`)
   - Réflexion approfondie pour problèmes complexes
   - Planification, analyse, architecture

## 🛡️ Sécurité

- Validation de toutes les entrées utilisateur avec Pydantic/Zod
- Confirmation requise pour les opérations dangereuses
- Isolation des processus avec Docker
- Pas d'injection d'ID utilisateur dans les prompts
- Stockage sécurisé des clés API

## 📊 Monitoring

Le système inclut un dashboard de monitoring avec :

- **Prometheus** : Métriques en temps réel
- **Grafana** : Visualisation des performances
- **Logs structurés** : Suivi des activités des agents

Accédez au monitoring : http://localhost:3001

## 🤖 Agents en Détail

### 1. Orchestrateur
- **Rôle** : Chef d'orchestre du système
- **Prompt** : "Tu es un architecte logiciel expert..."
- **Tâches** : Analyse des demandes, création de plans, délégation

### 2. Planificateur
- **Rôle** : Architecte de projets
- **Prompt** : "Tu es un expert en architecture de projets..."
- **Tâches** : Structure de projets, dépendances, arborescences

### 3. Codeur
- **Rôle** : Développeur senior
- **Prompt** : "Tu es un développeur senior expert..."
- **Tâches** : Génération de code propre, documenté, sécurisé

### 4. Testeur
- **Rôle** : Testeur QA rigoureux
- **Prompt** : "Tu es un testeur QA rigoureux..."
- **Tâches** : Revue de code, détection de bugs, suggestions

### 5. Exécuteur
- **Rôle** : Créateur de fichiers
- **Prompt** : "Tu es responsable de créer les fichiers sur le système..."
- **Tâches** : Création de dossiers/fichiers, exécution de commandes

## 🧪 Tests

```bash
# Backend tests
cd packages/shared-bl
python -m pytest tests/

# Frontend tests
cd desktop
npm test

# End-to-end tests
docker-compose -f docker-compose.test.yml up --build
```

## 📈 Roadmap

- [ ] Support de plus de langages (Go, Rust, Java)
- [ ] Intégration avec GitHub/GitLab
- [ ] Templates personnalisables
- [ ] Marketplace d'agents
- [ ] Mode collaboratif multi-utilisateurs
- [ ] Plugin system pour outils externes

## 🆘 Support & Contribution

### Signaler un bug
Utilisez les [Issues GitHub](https://github.com/votre-username/issalan/issues)

### Contribuer
1. Fork le projet
2. Créez une branche (`git checkout -b feature/amazing-feature`)
3. Commitez vos changements (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing-feature`)
5. Ouvrez une Pull Request

### Documentation
- [Guide des contributeurs](docs/CONTRIBUTING.md)
- [Architecture détaillée](docs/ARCHITECTURE.md)
- [Guide API](docs/API.md)

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🙏 Remerciements

- **DeepSeek** pour leur API IA puissante et gratuite
- **AG2 (AutoGen)** pour le framework multi-agent
- **Tauri** pour l'excellent framework desktop
- **Expo** pour la simplicité du développement mobile

---

**ISSALAN** - Transformez vos idées en applications, une ligne à la fois. 🚀

**Note** : Ce projet est un prototype. Testez-le et adaptez-le à vos besoins avant une utilisation en production.