# Guide de configuration rapide - ANZAR Backend

## Démarrage en 5 minutes

### 1. Prérequis
- Python 3.9+
- pip (gestionnaire de paquets)
- Compte DeepSeek API avec clé

### 2. Installation

```bash
cd /Users/agahmadou/Desktop/ANZAR/backend

# Créer l'environnement virtuel
python3 -m venv venv
source venv/bin/activate

# Installer les dépendances
pip install -r requirements.txt
```

### 3. Configuration

```bash
# Copier le fichier d'exemple
cp .env.example .env

# Éditer .env (macOS/Linux)
nano .env
# ou avec votre éditeur préféré
code .env
```

Remplissez le fichier `.env`:
```env
DEEPSEEK_API_KEY=votre_clé_api_ici
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_REASONER_MODEL=deepseek-reasoner
SERVER_HOST=127.0.0.1
SERVER_PORT=8000
DATABASE_PATH=./data/anzar.db
LOG_LEVEL=info
```

### 4. Lancer le serveur

```bash
python run.py
```

Vous devriez voir:
```
╔════════════════════════════════════════════════════════════════╗
║           ANZAR Backend - Multi-Agent Project Generator        ║
║                          Version 1.0.0                         ║
╚════════════════════════════════════════════════════════════════╝

Configuration:
  - Serveur: 127.0.0.1:8000
  - DeepSeek: https://api.deepseek.com/v1
  - Base de données: ./data/anzar.db

Démarrage...
INFO:     Started server process
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

### 5. Tester

Ouvrez dans votre navigateur:
```
http://127.0.0.1:8000/docs
```

Ou testez avec curl:
```bash
curl http://127.0.0.1:8000/health
```

## Troubleshooting

### Erreur: "No module named 'fastapi'"

Vérifiez que l'environnement virtuel est activé:
```bash
source venv/bin/activate  # macOS/Linux
# ou
venv\Scripts\activate     # Windows
```

Puis réinstallez les dépendances:
```bash
pip install -r requirements.txt
```

### Erreur: "Port 8000 already in use"

Le port 8000 est déjà utilisé. Options:
1. Terminez le processus qui utilise le port
2. Changez le port dans `.env`:
   ```env
   SERVER_PORT=8001
   ```

### Erreur: "DEEPSEEK_API_KEY is empty"

Vérifiez que:
1. Le fichier `.env` existe dans le répertoire backend
2. Il contient `DEEPSEEK_API_KEY=sk-...`
3. Vous avez sauvegardé le fichier

### DeepSeek API retourne une erreur

Testez votre clé API directement:
```bash
curl https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer sk-votre-clé" \
  -H "Content-Type: application/json" \
  -d '{"model": "deepseek-chat", "messages": [{"role": "user", "content": "hi"}]}'
```

## Développement

### Activation du mode reload

Le mode reload est activé par défaut dans `run.py`. Les changements de code redémarrent automatiquement le serveur.

### Désactiver le reload (production)

Éditez `run.py`:
```python
uvicorn.run(
    "main:app",
    host=settings.server_host,
    port=settings.server_port,
    reload=False,  # Changez ici
    log_level=settings.log_level.lower()
)
```

### Logs plus verbeux

Dans `.env`:
```env
LOG_LEVEL=debug
```

## Prochaines étapes

1. Consultez le [README principal](README.md) pour la documentation complète
2. Testez les endpoints avec les exemples fournis
3. Intégrez avec le frontend ANZAR
4. Configurez CORS si besoin (voir `main.py`)

## Architecture rapide

```
request → CORS middleware → Logging → FastAPI router
          ↓
    Endpoints:
    - /health (vérification)
    - /api/chat (streaming chat)
    - /api/projects/plan (génération plan)
    - /api/projects/{id}/execute (exécution complète)
    - /api/projects/{id}/status (statut)
          ↓
    Agents (pipeline):
    orchestrator → planner → coder → tester → executor
          ↓
    Response stream ← SSE ou JSON
```

## Fichiers importants

- `config.py` - Configuration centralisée
- `main.py` - Application FastAPI
- `services/deepseek_client.py` - Client API
- `agents/` - Agents spécialisés
- `.env` - Variables d'environnement (privé)
- `requirements.txt` - Dépendances Python

## Support

Pour des questions ou problèmes:
1. Vérifiez les logs: `LOG_LEVEL=debug`
2. Consultez la documentation dans `README.md`
3. Testez les endpoints avec `/docs`
