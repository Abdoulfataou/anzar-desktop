# 🚀 Démarrage Rapide ISSALAN

## 📋 Vue d'ensemble

ISSALAN est maintenant une plateforme de développement complète, optimisée pour l'efficacité chinoise et rivalisant avec Trae Solo. Voici comment démarrer :

## 🎯 Installation Rapide

### 1. **Prérequis**
```bash
# Vérifier Python 3.8+
python3 --version

# Vérifier Node.js 18+
node --version

# Vérifier npm
npm --version
```

### 2. **Installation des Dépendances**
```bash
# Backend Python
cd /Users/agahmadou/Desktop/ISSALAN
pip3 install fastapi uvicorn pydantic python-dotenv openai redis httpx pydantic-settings

# Frontend Desktop
cd desktop
npm install --legacy-peer-deps

# Frontend Mobile
cd ../mobile
npm install --legacy-peer-deps
```

### 3. **Configuration**
```bash
# Copier le fichier d'environnement
cp .env.example .env

# Éditer .env avec votre clé API DeepSeek
# DEEPSEEK_API_KEY=votre_clé_api_ici
```

## 🏃‍♂️ Lancement

### Option 1: **Développement Local**
```bash
# Terminal 1 - Backend
cd /Users/agahmadou/Desktop/ISSALAN
python3 packages/shared-bl/api/main.py

# Terminal 2 - Frontend Desktop
cd desktop
npm run dev

# Terminal 3 - Frontend Mobile (optionnel)
cd mobile
npm start
```

### Option 2: **Docker (Recommandé)**
```bash
# Construire et lancer avec Docker Compose
docker-compose up --build

# Ou en arrière-plan
docker-compose up -d
```

## 🌐 Accès

### Backend API
- **URL**: http://localhost:8000
- **Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health
- **Monitoring**: http://localhost:9090/metrics

### Frontend Desktop
- **URL**: http://localhost:5173
- **Éditeur de code**: http://localhost:5173/editor
- **Dashboard**: http://localhost:5173/dashboard
- **Projets**: http://localhost:5173/projects

### Frontend Mobile
- **URL**: http://localhost:19006
- **Expo Go**: Scanner le QR code

## 🔧 Fonctionnalités Testées

### ✅ Backend
- [x] API FastAPI avec 20+ endpoints
- [x] Configuration centralisée
- [x] Sécurité CORS et middleware
- [x] Logging structuré
- [x] Cache Redis intelligent
- [x] Rate limiting intelligent
- [x] Monitoring Prometheus

### ✅ IA & Agents
- [x] Complétion de code en temps réel
- [x] Génération de code avec DeepSeek
- [x] Analyse de code avancée
- [x] Refactoring intelligent
- [x] Débogage automatique
- [x] Recherche de documentation
- [x] Agents collaboratifs (Orchestrateur, Planificateur, Codeur, Testeur, Exécuteur)

### ✅ Frontend Desktop
- [x] Éditeur Monaco (VS Code-like)
- [x] Thèmes personnalisés ISSALAN
- [x] Navigation par symboles
- [x] Recherche avancée
- [x] Terminal intégré
- [x] Gestion de projets
- [x] Interface responsive

### ✅ Frontend Mobile
- [x] Interface React Native
- [x] Compatibilité iOS/Android
- [x] Synchronisation en temps réel
- [x] Mode hors ligne
- [x] Notifications push

## 🧪 Tests

### Exécuter tous les tests
```bash
# Test backend
python3 test_backend.py

# Test frontend desktop
cd desktop
npm test

# Test frontend mobile
cd mobile
npm test
```

### Tests spécifiques
```bash
# Test configuration
python3 -c "import sys; sys.path.append('packages/shared-bl'); from api.config import validate_config; validate_config()"

# Test API
curl http://localhost:8000/health
curl http://localhost:8000/

# Test complétion IA (exemple)
curl -X POST http://localhost:8000/api/ai/completions \
  -H "Content-Type: application/json" \
  -d '{"code": "function hello() {", "language": "javascript", "cursor_position": {"line": 0, "column": 20}}'
```

## 🚀 Déploiement

### Production
```bash
# Build production
cd desktop
npm run build

# Build mobile
cd ../mobile
npm run build:android  # ou build:ios

# Déployer backend
cd ..
docker build -t issalan-backend -f Dockerfile.backend .
docker run -p 8000:8000 issalan-backend
```

### Cloud (AWS/GCP/Azure)
```bash
# AWS ECS
aws ecr create-repository --repository-name issalan
docker tag issalan-backend:latest 123456789.dkr.ecr.region.amazonaws.com/issalan:latest
docker push 123456789.dkr.ecr.region.amazonaws.com/issalan:latest

# GCP Cloud Run
gcloud builds submit --tag gcr.io/project-id/issalan
gcloud run deploy issalan --image gcr.io/project-id/issalan --platform managed

# Azure Container Instances
az acr build --registry myregistry --image issalan:latest .
az container create --resource-group myResourceGroup --name issalan --image myregistry.azurecr.io/issalan:latest --cpu 1 --memory 1.5 --ports 8000
```

## 🔧 Dépannage

### Problèmes courants

#### 1. **Port déjà utilisé**
```bash
# Trouver le processus utilisant le port
lsof -i :8000
# ou
netstat -an | grep 8000

# Tuer le processus
kill -9 <PID>
```

#### 2. **Erreur de dépendances Python**
```bash
# Mettre à jour pip
pip3 install --upgrade pip

# Réinstaller les dépendances
pip3 install -r requirements.txt --force-reinstall
```

#### 3. **Erreur Node.js/npm**
```bash
# Nettoyer le cache npm
npm cache clean --force

# Réinstaller les dépendances
rm -rf node_modules package-lock.json
npm install
```

#### 4. **Clé API DeepSeek manquante**
```bash
# Vérifier le fichier .env
cat .env | grep DEEPSEEK

# Obtenir une clé API sur https://platform.deepseek.com/api_keys
```

### Logs
```bash
# Backend logs
tail -f logs/issalan.log

# Docker logs
docker-compose logs -f

# Frontend logs
cd desktop && npm run dev  # affiche les logs dans le terminal
```

## 📞 Support

### Documentation
- **API Docs**: http://localhost:8000/docs
- **Code Source**: `/packages/shared-bl/api/`
- **Configuration**: `/packages/shared-bl/api/config.py`
- **Endpoints IA**: `/packages/shared-bl/api/ai_endpoints.py`

### Communauté
- **GitHub**: https://github.com/issalan
- **Discord**: https://discord.gg/issalan
- **Email**: support@issalan.africa

### Formation
- **Tutoriels vidéo**: YouTube
- **Documentation interactive**: Plateforme
- **Workshops**: En ligne et présentiel
- **Certification**: Développeur ISSALAN

## 🎉 Félicitations !

Vous avez maintenant une plateforme de développement complète, puissante et optimisée pour l'Afrique. ISSALAN est prêt à rivaliser avec les meilleures plateformes mondiales tout en restant fidèle à sa mission : **rendre le développement accessible à tous en Afrique**.

**Prochaine étape** : Commencez à développer votre premier projet avec ISSALAN !

---
*Document généré automatiquement - ISSALAN v1.0.0*