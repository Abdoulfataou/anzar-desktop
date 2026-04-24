"""
Agent Planificateur - Génère la structure complète du projet.
Crée l'arborescence, les fichiers, et planifie les dépendances.
"""

import json
import os
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from ag2 import Agent
from pydantic import BaseModel, Field
import logging
import yaml

logger = logging.getLogger(__name__)


class ProjectStructure(BaseModel):
    """Structure complète du projet à générer."""
    project_name: str = Field(..., description="Nom du projet")
    root_directory: str = Field(..., description="Répertoire racine")
    directories: List[Dict[str, Any]] = Field(default_factory=list, description="Liste des répertoires")
    files: List[Dict[str, Any]] = Field(default_factory=list, description="Liste des fichiers")
    dependencies: Dict[str, List[str]] = Field(default_factory=dict, description="Dépendances par langage")
    commands: List[Dict[str, str]] = Field(default_factory=list, description="Commandes à exécuter")
    readme_content: str = Field("", description="Contenu du README.md")


class PlannerAgent:
    """Agent planificateur pour générer la structure des projets."""
    
    def __init__(self, deepseek_client):
        self.deepseek_client = deepseek_client
        self.system_prompt = """Tu es un expert en architecture de projets avec 10 ans d'expérience.
Ton rôle : Pour chaque application demandée, génère une arborescence complète, la stack technologique à utiliser, et les dépendances nécessaires.

Processus à suivre :
1. Analyse l'architecture proposée par l'orchestrateur
2. Génère une arborescence de dossiers logique et professionnelle
3. Liste tous les fichiers nécessaires avec leur chemin complet
4. Spécifie les dépendances (package.json, requirements.txt, etc.)
5. Propose les commandes d'installation et de démarrage
6. Génère un README.md complet

Format de réponse attendu (JSON) :
{
    "project_name": "nom_du_projet",
    "root_directory": "./generated_projects/nom_du_projet",
    "directories": [
        {"path": "src", "purpose": "Code source principal"},
        {"path": "src/components", "purpose": "Composants React"},
        {"path": "public", "purpose": "Fichiers statiques"}
    ],
    "files": [
        {
            "path": "package.json",
            "content": "contenu JSON ou null",
            "template": "package_template"
        },
        {
            "path": "src/index.js",
            "content": "// Code JavaScript",
            "template": "react_app"
        }
    ],
    "dependencies": {
        "node": ["react", "react-dom", "tailwindcss"],
        "python": ["fastapi", "uvicorn"],
        "system": ["docker", "git"]
    },
    "commands": [
        {"command": "npm install", "description": "Installer les dépendances Node.js"},
        {"command": "pip install -r requirements.txt", "description": "Installer les dépendances Python"}
    ],
    "readme_content": "# Nom du Projet\\n\\nDescription..."
}

Sois exhaustif, organisé, et pense à tous les aspects du projet."""
        
        self.agent = Agent(
            name="planner",
            system_prompt=self.system_prompt,
            tools=[],
            llm_client=self.deepseek_client
        )
    
    async def generate_structure(self, project_plan: Dict[str, Any]) -> ProjectStructure:
        """Génère la structure complète du projet basée sur le plan."""
        
        user_message = f"""
        Plan du projet à générer :
        
        Nom du projet : {project_plan.get('project_name', 'new_project')}
        Description : {project_plan.get('description', 'Non spécifié')}
        
        Architecture proposée :
        {json.dumps(project_plan.get('architecture', {}), indent=2)}
        
        Stack technologique :
        - Frontend : {project_plan.get('architecture', {}).get('frontend', {}).get('framework', 'React')}
        - Backend : {project_plan.get('architecture', {}).get('backend', {}).get('framework', 'FastAPI')}
        - Base de données : {project_plan.get('architecture', {}).get('database', {}).get('type', 'PostgreSQL')}
        
        Génère une structure complète de projet professionnelle.
        """
        
        logger.info(f"Génération de la structure pour : {project_plan.get('project_name', 'new_project')}")
        
        try:
            # Appel à l'API DeepSeek
            response = await self.agent.chat(user_message)
            
            # Parser la réponse JSON
            if isinstance(response, str):
                import re
                json_match = re.search(r'\{.*\}', response, re.DOTALL)
                if json_match:
                    response_data = json.loads(json_match.group())
                else:
                    response_data = self._create_default_structure(project_plan)
            else:
                response_data = response
            
            # Convertir en ProjectStructure
            structure = ProjectStructure(
                project_name=response_data.get('project_name', project_plan.get('project_name', 'new_project')),
                root_directory=response_data.get('root_directory', f"./generated_projects/{project_plan.get('project_name', 'new_project')}"),
                directories=response_data.get('directories', []),
                files=response_data.get('files', []),
                dependencies=response_data.get('dependencies', {}),
                commands=response_data.get('commands', []),
                readme_content=response_data.get('readme_content', self._generate_default_readme(project_plan))
            )
            
            # Ajouter des fichiers manquants essentiels
            structure = self._augment_structure(structure, project_plan)
            
            logger.info(f"Structure générée avec {len(structure.directories)} dossiers et {len(structure.files)} fichiers")
            return structure
            
        except Exception as e:
            logger.error(f"Erreur lors de la génération de la structure : {e}")
            return self._create_default_structure(project_plan)
    
    def _create_default_structure(self, project_plan: Dict[str, Any]) -> ProjectStructure:
        """Crée une structure par défaut en cas d'erreur."""
        project_name = project_plan.get('project_name', 'new_project')
        
        return ProjectStructure(
            project_name=project_name,
            root_directory=f"./generated_projects/{project_name}",
            directories=[
                {"path": "src", "purpose": "Code source principal"},
                {"path": "src/components", "purpose": "Composants React"},
                {"path": "src/pages", "purpose": "Pages de l'application"},
                {"path": "src/styles", "purpose": "Fichiers de style"},
                {"path": "public", "purpose": "Fichiers statiques"},
                {"path": "backend", "purpose": "Code backend"},
                {"path": "backend/api", "purpose": "Endpoints API"},
                {"path": "backend/models", "purpose": "Modèles de données"},
                {"path": "config", "purpose": "Fichiers de configuration"},
                {"path": "tests", "purpose": "Tests unitaires et d'intégration"}
            ],
            files=[
                {
                    "path": "package.json",
                    "content": None,
                    "template": "react_package_json"
                },
                {
                    "path": "src/App.jsx",
                    "content": None,
                    "template": "react_app"
                },
                {
                    "path": "src/index.js",
                    "content": None,
                    "template": "react_index"
                },
                {
                    "path": "backend/requirements.txt",
                    "content": None,
                    "template": "python_requirements"
                },
                {
                    "path": "backend/main.py",
                    "content": None,
                    "template": "fastapi_main"
                },
                {
                    "path": "README.md",
                    "content": None,
                    "template": "readme"
                },
                {
                    "path": ".gitignore",
                    "content": None,
                    "template": "gitignore"
                },
                {
                    "path": "docker-compose.yml",
                    "content": None,
                    "template": "docker_compose"
                }
            ],
            dependencies={
                "node": ["react", "react-dom", "react-router-dom", "tailwindcss", "axios"],
                "python": ["fastapi", "uvicorn", "pydantic", "sqlalchemy", "psycopg2-binary"],
                "system": ["docker", "git", "node", "python"]
            },
            commands=[
                {"command": "npm install", "description": "Installer les dépendances Node.js"},
                {"command": "pip install -r backend/requirements.txt", "description": "Installer les dépendances Python"},
                {"command": "npm start", "description": "Démarrer le frontend"},
                {"command": "uvicorn backend.main:app --reload", "description": "Démarrer le backend"}
            ],
            readme_content=self._generate_default_readme(project_plan)
        )
    
    def _augment_structure(self, structure: ProjectStructure, project_plan: Dict[str, Any]) -> ProjectStructure:
        """Améliore la structure générée avec des fichiers essentiels manquants."""
        
        # Assurer la présence des fichiers essentiels
        essential_files = {
            "README.md": structure.readme_content,
            ".gitignore": self._get_gitignore_template(),
            ".env.example": self._get_env_template(),
            "docker-compose.yml": self._get_docker_compose_template(structure.project_name)
        }
        
        for file_path, content in essential_files.items():
            if not any(f["path"] == file_path for f in structure.files):
                structure.files.append({
                    "path": file_path,
                    "content": content,
                    "template": "custom"
                })
        
        return structure
    
    def _generate_default_readme(self, project_plan: Dict[str, Any]) -> str:
        """Génère un README par défaut."""
        project_name = project_plan.get('project_name', 'new_project')
        description = project_plan.get('description', 'Application générée automatiquement')
        
        return f"""# {project_name}

{description}

## 🚀 Fonctionnalités

- Application générée automatiquement par le système multi-agent
- Architecture modulaire et extensible
- Prête pour le développement et le déploiement

## 📁 Structure du projet

```
{project_name}/
├── src/                    # Code source frontend
├── backend/               # Code source backend  
├── public/                # Fichiers statiques
├── config/                # Configuration
└── tests/                 # Tests
```

## ⚙️ Installation

### Prérequis
- Node.js 18+
- Python 3.11+
- Docker (optionnel)

### Installation des dépendances

```bash
# Frontend
npm install

# Backend
cd backend
pip install -r requirements.txt
```

## 🏃‍♂️ Démarrage

```bash
# Développement frontend
npm start

# Développement backend
cd backend
uvicorn main:app --reload
```

## 🐳 Docker

```bash
# Construire et démarrer avec Docker
docker-compose up --build
```

## 📚 Documentation

- [Documentation frontend](docs/frontend.md)
- [Documentation backend](docs/backend.md)
- [Guide de déploiement](docs/deployment.md)

## 🤖 Génération

Cette application a été générée automatiquement par le système multi-agent ISSALAN.

---

**Note** : Ce projet est un prototype généré automatiquement. Pensez à le personnaliser selon vos besoins.
"""
    
    def _get_gitignore_template(self) -> str:
        """Retourne un template .gitignore standard."""
        return """# Dependencies
node_modules/
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# Next.js build output
.next
out

# Nuxt.js build / generate output
.nuxt
dist

# Gatsby files
.cache/
# Comment in the public line in if your project uses Gatsby and not Next.js
# https://nextjs.org/blog/next-9-1#public-directory-support
# public

# Vue.js dist output
dist

# Stores VSCode versions
.versions/

# Temporary folders
tmp/
temp/

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
share/python-wheels/
*.egg-info/
.installed.cfg
*.egg
MANIFEST

# Virtual Environments
venv/
env/
"""
    
    def _get_env_template(self) -> str:
        """Retourne un template .env.example."""
        return """# Configuration de l'application
APP_NAME=GeneratedApp
APP_ENV=development
APP_DEBUG=true
APP_URL=http://localhost:3000

# Base de données
DB_CONNECTION=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=app_db
DB_USERNAME=postgres
DB_PASSWORD=postgres

# Cache
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Clés API
DEEPSEEK_API_KEY=your_deepseek_api_key_here
"""
    
    def _get_docker_compose_template(self, project_name: str) -> str:
        """Retourne un template docker-compose.yml."""
        return f"""version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: {project_name}_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/{project_name}_db
      REDIS_URL: redis://redis:6379/0
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./backend:/app

  frontend:
    build:
      context: .
      dockerfile: ./Dockerfile.frontend
    ports:
      - "3000:3000"
    environment:
      REACT_APP_API_URL: http://backend:8000
    depends_on:
      - backend
    volumes:
      - ./src:/app/src
      - ./public:/app/public

volumes:
  postgres_data:
  redis_data:
"""