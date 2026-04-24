# ANZAR Backend - Multi-Agent Project Generator

Backend Python simplifié pour la génération automatique de projets avec agents IA spécialisés.

## Caractéristiques

- ✅ **Léger et rapide** - Démarrage instantané (< 1s)
- ✅ **Zéro dépendances lourdes** - Pas de PostgreSQL, Redis, ou autres services
- ✅ **Multi-agent** - Pipeline orchestré: Planning → Code → Test → Exécution
- ✅ **Streaming SSE** - Chat avec réponses en temps réel optimisées pour connexions lentes
- ✅ **Cache intégré** - Cache basé fichiers, pas besoin de Redis
- ✅ **Type-safe** - Pydantic pour validation, type hints partout
- ✅ **Async throughout** - Entièrement asynchrone avec FastAPI

## Architecture

```
backend/
├── config.py              # Configuration centralisée
├── main.py                # Application FastAPI + endpoints
├── run.py                 # Script de lancement
├── services/
│   ├── deepseek_client.py # Client API DeepSeek avec streaming
│   └── cache.py           # Cache basé fichiers
└── agents/
    ├── base.py            # Classe de base pour les agents
    ├── orchestrator.py    # Chef d'orchestre
    ├── planner.py         # Génération d'architecture
    ├── coder.py           # Génération de code
    ├── tester.py          # Vérification et tests
    └── executor.py        # Création fichiers sur disque
```

## Installation

### 1. Cloner le backend

```bash
cd /Users/agahmadou/Desktop/ANZAR/backend
```

### 2. Créer un environnement virtuel

```bash
python3.9 -m venv venv
source venv/bin/activate  # Sur Windows: venv\Scripts\activate
```

### 3. Installer les dépendances

```bash
pip install -r requirements.txt
```

### 4. Configurer les variables d'environnement

```bash
cp .env.example .env
# Éditer .env avec votre clé DeepSeek API
nano .env
```

## Lancement

### Mode développement

```bash
python run.py
```

Le serveur démarre sur `http://127.0.0.1:8000`

### Mode production

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

## API Endpoints

### 1. Health Check

```bash
GET /health
```

Retourne l'état de tous les services.

### 2. Chat avec streaming

```bash
POST /api/chat
```

**Body:**
```json
{
  "messages": [{"role": "user", "content": "Hello"}],
  "temperature": 0.7,
  "max_tokens": 2048
}
```

**Réponse:** Stream SSE avec chunks texte

### 3. Générer un plan de projet

```bash
POST /api/projects/plan
```

**Body:**
```json
{
  "description": "Une application web de gestion de tâches",
  "project_name": "task_manager",
  "tech_stack": ["Python", "FastAPI", "React"],
  "requirements": ["authentification", "API REST"]
}
```

**Réponse:**
```json
{
  "status": "success",
  "project_id": "task_manager",
  "plan": {...},
  "architecture": {...}
}
```

### 4. Exécuter la génération complète

```bash
POST /api/projects/{project_id}/execute
```

Génère:
1. Code source complet
2. Tests et vérification
3. Structure de fichiers
4. Fichiers écrits sur disque

**Réponse:**
```json
{
  "status": "success",
  "project_id": "task_manager",
  "code_generation": {...},
  "testing": {...},
  "execution": {
    "status": "success",
    "project_path": "./projects/task_manager",
    "files_created": [...],
    "file_count": 12
  }
}
```

### 5. Récupérer le statut d'un projet

```bash
GET /api/projects/{project_id}/status
```

### 6. Lister tous les projets

```bash
GET /api/projects
```

## Configuration

### Variables d'environnement (.env)

```env
# DeepSeek API
DEEPSEEK_API_KEY=sk-xxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_REASONER_MODEL=deepseek-reasoner

# Serveur
SERVER_HOST=127.0.0.1
SERVER_PORT=8000

# Base de données SQLite
DATABASE_PATH=./data/anzar.db

# Logging
LOG_LEVEL=info
```

## Structure des agents

### BaseAgent (Classe de base)

```python
class BaseAgent(ABC):
    async def execute(request: Dict) -> Dict
    async def call_deepseek(messages, model, ...) -> str
    def parse_json_response(response: str) -> Dict
```

### Pipeline d'exécution

1. **OrchestratorAgent**: Analyse la demande utilisateur
   - Décompose en tâches
   - Crée un plan maître
   - Décide de l'architecture

2. **PlannerAgent**: Génère l'architecture détaillée
   - Structure de fichiers
   - Dépendances
   - Patterns et configurations

3. **CoderAgent**: Génère le code source
   - Code clean et commenté
   - Support multi-langages
   - Respecte les bonnes pratiques

4. **TesterAgent**: Vérifie le code généré
   - Identifie les bugs
   - Analyse la sécurité
   - Suggère des améliorations

5. **ExecutorAgent**: Crée le projet sur disque
   - Structure réelle de répertoires
   - Fichiers sources
   - README et configuration

## Optimisations pour connexions lentes

1. **Streaming SSE** - Réponses progressives, pas d'attente
2. **Chunking** - Envoi de petits fragments rapidement
3. **Cache basé fichiers** - Pas de round-trip réseau
4. **Timeouts adaptés** - 30s pour chat, 60s pour streaming
5. **Compression headers** - Gzip automatique

## Exemples d'utilisation

### Exemple 1: Chat simple

```bash
curl -X POST http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Comment créer une API REST?"}],
    "max_tokens": 1000
  }'
```

### Exemple 2: Générer un projet complet

```bash
# 1. Créer le plan
curl -X POST http://127.0.0.1:8000/api/projects/plan \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Une app web de streaming vidéo",
    "project_name": "video_streaming",
    "tech_stack": ["Python", "FastAPI", "React"],
    "requirements": ["upload", "streaming", "authentification"]
  }'

# 2. Exécuter la génération
curl -X POST http://127.0.0.1:8000/api/projects/video_streaming/execute

# 3. Vérifier le statut
curl http://127.0.0.1:8000/api/projects/video_streaming/status
```

## Intégration avec le frontend

### Configuration CORS

Le backend accepte les connexions depuis:
- `http://localhost:5173` (Vite dev)
- `http://127.0.0.1:8080` (build production)
- `tauri://localhost` (Tauri)

Voir `main.py` pour modifier les origines autorisées.

### Headers important

```
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

## Logging

Les logs sont affichés dans la console avec le format:
```
2024-04-22 14:30:45 - root - INFO - → POST /api/projects/plan
2024-04-22 14:30:47 - agents.orchestrator - INFO - [orchestrator] Orchestration: my_project
2024-04-22 14:30:50 - root - INFO - ← POST /api/projects/plan - 200 (4.23s)
```

Ajustez le niveau avec `LOG_LEVEL` (.env):
- `DEBUG` - Messages de debug détaillés
- `INFO` - Informations générales
- `WARNING` - Avertissements seulement
- `ERROR` - Erreurs seulement

## Dépannage

### Erreur: "DEEPSEEK_API_KEY not set"

Vérifiez que le fichier `.env` existe et contient la clé:
```bash
cat .env | grep DEEPSEEK_API_KEY
```

### Erreur: "Connection refused" sur DeepSeek API

- Vérifiez votre connexion internet
- Vérifiez que la clé API est valide
- Testez avec: `curl https://api.deepseek.com/v1/health`

### Le serveur démarre mais pas accessible

Vérifiez le port:
```bash
# Changez le port dans .env
SERVER_PORT=8001
python run.py
```

### Trop de tokens utilisés

Réduisez `max_tokens` dans les requêtes chat:
```json
{"max_tokens": 512}
```

## Performance

Métriques typiques (avec DeepSeek API):
- Health check: ~50ms
- Chat simple: 1-3s
- Génération plan: 3-5s
- Génération code: 5-10s
- Test code: 2-3s
- Création fichiers: <1s

**Total pour un petit projet:** ~15-20s

## Améliorations futures

- [ ] Persistance base de données (SQLite)
- [ ] Webhooks pour notifications de progression
- [ ] Support multi-utilisateurs
- [ ] Système de plugins
- [ ] Limite de tokens par utilisateur
- [ ] Compression des réponses streaming
- [ ] Caching amélioré avec invalidation

## Licence

Partie du projet ANZAR - Tous droits réservés
