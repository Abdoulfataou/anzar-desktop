"""
Agent Codeur - Écrit le code source de chaque fichier.
Génère du code propre, documenté, sécurisé et prêt pour la production.
"""

import json
import os
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from ag2 import Agent
from pydantic import BaseModel, Field
import logging

logger = logging.getLogger(__name__)


class CodeFile(BaseModel):
    """Fichier de code à générer."""
    path: str = Field(..., description="Chemin du fichier")
    content: str = Field("", description="Contenu du fichier")
    language: str = Field("", description="Langage de programmation")
    dependencies: List[str] = Field(default_factory=list, description="Dépendances nécessaires")
    purpose: str = Field("", description="But du fichier")


class CoderAgent:
    """Agent codeur pour générer le code source."""
    
    def __init__(self, deepseek_client):
        self.deepseek_client = deepseek_client
        self.system_prompt = """Tu es un développeur senior expert avec 12 ans d'expérience.
Ton rôle : Écrire du code propre, documenté, sécurisé et prêt pour la production.

Principes à suivre :
1. Écris du code lisible, bien structuré et maintenable
2. Utilise les meilleures pratiques du langage
3. Ajoute des commentaires et docstrings pertinents
4. Gère les erreurs de manière élégante
5. Sécurise le code (validation des entrées, protection contre les injections, etc.)
6. Optimise les performances quand c'est pertinent
7. Suis les conventions de nommage du langage

Format de réponse attendu :
Pour chaque fichier, fournis uniquement le code source complet.
Ne fournis pas d'explications supplémentaires sauf si demandé.
Le code doit être prêt à être copié-collé et exécuté.

Exemple de réponse pour un fichier Python :
```python
#!/usr/bin/env python3
"""
Module principal de l'application.
"""

import os
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def root():
    \"\"\"Endpoint racine.\"\"\"
    return {"message": "Hello World"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

Sois un développeur professionnel, rigoureux et créatif."""
        
        self.agent = Agent(
            name="coder",
            system_prompt=self.system_prompt,
            tools=[],
            llm_client=self.deepseek_client
        )
        
        # Templates de code par défaut
        self.code_templates = {
            "react_package_json": self._react_package_json_template,
            "react_app": self._react_app_template,
            "react_index": self._react_index_template,
            "python_requirements": self._python_requirements_template,
            "fastapi_main": self._fastapi_main_template,
            "readme": self._readme_template,
            "gitignore": self._gitignore_template,
            "docker_compose": self._docker_compose_template,
        }
    
    async def generate_code(self, file_info: Dict[str, Any], project_context: Dict[str, Any]) -> CodeFile:
        """Génère le code pour un fichier spécifique."""
        
        file_path = file_info['path']
        template = file_info.get('template')
        
        logger.info(f"Génération du code pour : {file_path} (template: {template})")
        
        # Si un template prédéfini existe, l'utiliser
        if template and template in self.code_templates:
            content = self.code_templates[template](project_context)
        else:
            # Générer du code avec l'IA
            content = await self._generate_with_ai(file_info, project_context)
        
        # Déterminer le langage basé sur l'extension
        language = self._detect_language(file_path)
        
        return CodeFile(
            path=file_path,
            content=content,
            language=language,
            dependencies=self._extract_dependencies(content, language),
            purpose=file_info.get('purpose', '')
        )
    
    async def _generate_with_ai(self, file_info: Dict[str, Any], project_context: Dict[str, Any]) -> str:
        """Génère du code avec l'IA DeepSeek."""
        
        user_message = f"""
        Génère le code complet pour le fichier suivant :
        
        Chemin du fichier : {file_info['path']}
        But du fichier : {file_info.get('purpose', 'Non spécifié')}
        
        Contexte du projet :
        - Nom : {project_context.get('project_name', 'Non spécifié')}
        - Description : {project_context.get('description', 'Non spécifié')}
        - Type d'application : {project_context.get('app_type', 'Non spécifié')}
        
        Stack technologique :
        - Frontend : {project_context.get('frontend_framework', 'React')}
        - Backend : {project_context.get('backend_framework', 'FastAPI')}
        - Base de données : {project_context.get('database', 'PostgreSQL')}
        
        Spécifications supplémentaires :
        {file_info.get('specifications', 'Aucune')}
        
        Fournis uniquement le code source complet, sans explications supplémentaires.
        Le code doit être prêt pour la production, sécurisé et bien documenté.
        """
        
        try:
            response = await self.agent.chat(user_message)
            return response if isinstance(response, str) else str(response)
        except Exception as e:
            logger.error(f"Erreur lors de la génération du code : {e}")
            return self._generate_fallback_code(file_info, project_context)
    
    def _generate_fallback_code(self, file_info: Dict[str, Any], project_context: Dict[str, Any]) -> str:
        """Génère un code de secours en cas d'erreur."""
        file_path = file_info['path']
        
        if file_path.endswith('.py'):
            return self._generate_fallback_python(file_path, project_context)
        elif file_path.endswith('.js') or file_path.endswith('.jsx') or file_path.endswith('.ts') or file_path.endswith('.tsx'):
            return self._generate_fallback_javascript(file_path, project_context)
        elif file_path.endswith('.json'):
            return self._generate_fallback_json(file_path, project_context)
        elif file_path.endswith('.md'):
            return f"# {project_context.get('project_name', 'Projet')}\n\n{project_context.get('description', '')}"
        else:
            return f"# File: {file_path}\n# Generated by ISSALAN Multi-Agent System\n\n# TODO: Implement this file"
    
    def _generate_fallback_python(self, file_path: str, project_context: Dict[str, Any]) -> str:
        """Génère un code Python de secours."""
        if 'main.py' in file_path or 'app.py' in file_path:
            return '''#!/usr/bin/env python3
"""
Application principale.
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Generated App", version="1.0.0")

# Configuration CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """Endpoint racine."""
    return {
        "message": "Welcome to the Generated App",
        "status": "running",
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
'''
        else:
            return f'''#!/usr/bin/env python3
"""
{file_path}
"""

def main():
    """Fonction principale."""
    print("Hello from {file_path}")

if __name__ == "__main__":
    main()
'''
    
    def _generate_fallback_javascript(self, file_path: str, project_context: Dict[str, Any]) -> str:
        """Génère un code JavaScript/React de secours."""
        if 'App.js' in file_path or 'App.jsx' in file_path or 'App.tsx' in file_path:
            return '''import React from "react";
import "./App.css";

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Generated Application</h1>
        <p>
          This application was automatically generated by ISSALAN Multi-Agent System.
        </p>
      </header>
    </div>
  );
}

export default App;
'''
        elif 'index.js' in file_path or 'index.tsx' in file_path:
            return '''import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
'''
        else:
            return f'''// {file_path}
// Generated by ISSALAN Multi-Agent System

export default function Component() {{
  return (
    <div>
      <h2>Generated Component</h2>
    </div>
  );
}}
'''
    
    def _generate_fallback_json(self, file_path: str, project_context: Dict[str, Any]) -> str:
        """Génère un JSON de secours."""
        if 'package.json' in file_path:
            return json.dumps({
                "name": project_context.get('project_name', 'generated-app').lower().replace(' ', '-'),
                "version": "1.0.0",
                "private": True,
                "dependencies": {
                    "react": "^18.2.0",
                    "react-dom": "^18.2.0",
                    "react-scripts": "5.0.1"
                },
                "scripts": {
                    "start": "react-scripts start",
                    "build": "react-scripts build",
                    "test": "react-scripts test",
                    "eject": "react-scripts eject"
                }
            }, indent=2)
        else:
            return json.dumps({"message": "Generated file"}, indent=2)
    
    def _detect_language(self, file_path: str) -> str:
        """Détecte le langage de programmation basé sur l'extension."""
        extensions = {
            '.py': 'python',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.json': 'json',
            '.md': 'markdown',
            '.html': 'html',
            '.css': 'css',
            '.scss': 'scss',
            '.yml': 'yaml',
            '.yaml': 'yaml',
            '.toml': 'toml',
            '.sh': 'bash',
            '.dockerfile': 'dockerfile',
            '.sql': 'sql'
        }
        
        for ext, lang in extensions.items():
            if file_path.endswith(ext):
                return lang
        
        return 'text'
    
    def _extract_dependencies(self, content: str, language: str) -> List[str]:
        """Extrait les dépendances du code."""
        dependencies = []
        
        if language == 'python':
            # Recherche d'imports
            import re
            imports = re.findall(r'^\s*(?:from\s+(\w+)|import\s+(\w+))', content, re.MULTILINE)
            for imp in imports:
                dep = imp[0] or imp[1]
                if dep and dep not in ['os', 'sys', 'json', 're', 'datetime', 'typing']:
                    dependencies.append(dep)
        
        elif language == 'javascript' or language == 'typescript':
            # Recherche d'imports
            import re
            imports = re.findall(r'import\s+.*from\s+[\'"]([^"\']+)[\'"]', content)
            dependencies.extend(imports)
        
        return list(set(dependencies))
    
    # Templates de code prédéfinis
    def _react_package_json_template(self, context: Dict[str, Any]) -> str:
        return json.dumps({
            "name": context.get('project_name', 'generated-app').lower().replace(' ', '-'),
            "version": "1.0.0",
            "private": True,
            "dependencies": {
                "react": "^18.2.0",
                "react-dom": "^18.2.0",
                "react-router-dom": "^6.20.0",
                "axios": "^1.6.2",
                "tailwindcss": "^3.3.0",
                "@types/react": "^18.2.37",
                "@types/react-dom": "^18.2.15"
            },
            "scripts": {
                "start": "react-scripts start",
                "build": "react-scripts build",
                "test": "react-scripts test",
                "eject": "react-scripts eject"
            },
            "devDependencies": {
                "react-scripts": "5.0.1",
                "@tailwindcss/forms": "^0.5.7",
                "autoprefixer": "^10.4.16",
                "postcss": "^8.4.32"
            }
        }, indent=2)
    
    def _react_app_template(self, context: Dict[str, Any]) -> str:
        return '''import React, { useState, useEffect } from "react";
import "./App.css";

function App() {
  const [message, setMessage] = useState("Loading...");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setMessage(data.status))
      .catch(() => setMessage("Backend not connected"));
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-16">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">
            Welcome to {context.get('project_name', 'Generated App')}
          </h1>
          <p className="text-gray-300 mb-8">
            This application was automatically generated by ISSALAN Multi-Agent System.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-3">🚀 Ready to Go</h2>
            <p className="text-gray-400">
              Your application is fully functional with frontend, backend, and database.
            </p>
          </div>

          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-3">⚡ Backend Status</h2>
            <p className="text-gray-400">
              Backend health: <span className="text-green-400 font-mono">{message}</span>
            </p>
          </div>

          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-3">🤖 AI-Powered</h2>
            <p className="text-gray-400">
              This entire project was created by AI agents working together.
            </p>
          </div>
        </div>

        <div className="mt-12 text-center text-gray-500">
          <p>
            Check the README.md file for setup instructions and documentation.
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
'''
    
    def _react_index_template(self, context: Dict[str, Any]) -> str:
        return '''import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
'''
    
    def _python_requirements_template(self, context: Dict[str, Any]) -> str:
        return '''fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
sqlalchemy==2.0.23
psycopg2-binary==2.9.9
asyncpg==0.29.0
redis==5.0.1
python-dotenv==1.0.0
httpx==0.25.2
'''
    
    def _fastapi_main_template(self, context: Dict[str, Any]) -> str:
        return '''#!/usr/bin/env python3
"""
API principale de l'application générée.
"""

import os
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import uvicorn
from dotenv import load_dotenv

load_dotenv()

# Modèles de données
class HealthResponse(BaseModel):
    """Réponse du health check."""
    status: str = Field(default="healthy")
    version: str = Field(default="1.0.0")
    service: str = Field(default="generated-api")

class ProjectInfo(BaseModel):
    """Informations sur le projet."""
    name: str
    description: str
    generated_by: str = Field(default="ISSALAN Multi-Agent System")
    technologies: List[str]

# Initialisation de l'application
app = FastAPI(
    title="Generated API",
    description="API générée automatiquement par ISSALAN",
    version="1.0.0"
)

# Configuration CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # À restreindre en production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sécurité
security = HTTPBearer()

# Données du projet
PROJECT_INFO = ProjectInfo(
    name="Generated Project",
    description="A project automatically generated by AI agents",
    technologies=["Python", "FastAPI", "PostgreSQL", "React", "Docker"]
)

@app.get("/", tags=["Root"])
async def root():
    """Endpoint racine."""
    return {
        "message": "Welcome to the Generated API",
        "documentation": "/docs",
        "health": "/health",
        "project": "/project"
    }

@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Health check endpoint."""
    return HealthResponse()

@app.get("/project", response_model=ProjectInfo, tags=["Project"])
async def get_project_info():
    """Informations sur le projet généré."""
    return PROJECT_INFO

@app.get("/api/users", tags=["Users"])
async def get_users():
    """Exemple d'endpoint pour les utilisateurs."""
    return {
        "users": [
            {"id": 1, "name": "Alice", "role": "admin"},
            {"id": 2, "name": "Bob", "role": "user"},
            {"id": 3, "name": "Charlie", "role": "user"}
        ]
    }

@app.post("/api/data", tags=["Data"])
async def create_data(payload: dict):
    """Exemple d'endpoint pour créer des données."""
    return {
        "message": "Data created successfully",
        "data": payload,
        "id": 123
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
'''
    
    def _readme_template(self, context: Dict[str, Any]) -> str:
        return f'''# {context.get('project_name', 'Generated Project')}

{context.get('description', 'An application automatically generated by ISSALAN Multi-Agent System.')}

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- Docker (optional)

### Installation

1. **Backend:**
```bash
cd backend
pip install -r requirements.txt
```

2. **Frontend:**
```bash
npm install
```

### Running the Application

**Development mode:**
```bash
# Terminal 1 - Backend
cd backend
uvicorn main:app --reload

# Terminal 2 - Frontend
npm start
```

**Using Docker:**
```bash
docker-compose up --build
```

## 📁 Project Structure

```
{context.get('project_name', 'project')}/
├── src/                    # Frontend source code
├── backend/               # Backend source code
├── public/                # Static files
├── config/                # Configuration files
├── tests/                 # Test files
├── docker-compose.yml     # Docker Compose configuration
├── README.md             # This file
└── .env.example          # Environment variables template
```

## 🔧 API Documentation

Once the backend is running, visit:
- API Documentation: http://localhost:8000/docs
- ReDoc Documentation: http://localhost:8000/redoc

## 🤖 About ISSALAN

This project was automatically generated by **ISSALAN Multi-Agent System**, an AI-powered platform that creates complete applications from natural language descriptions.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Since this is an auto-generated project, contributions should focus on:
1. Customizing the generated code
2. Adding specific features
3. Improving documentation
4. Fixing any issues

---

**Note**: This is an auto-generated prototype. Review and customize the code before deploying to production.
'''
    
    def _gitignore_template(self, context: Dict[str, Any]) -> str:
        return '''# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# Dependencies
/node_modules
/.pnp
.pnp.js

# Testing
/coverage

# Production build
/build
/dist

# Misc
.DS_Store
.env.local
.env.development.local
.env.test.local
.env.production.local
.env

npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Editor directories and files
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
.idea
*.swp
*.swo

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
pip-wheel-metadata/
share/python-wheels/
*.egg-info/
.installed.cfg
*.egg
MANIFEST

# Virtual Environments
venv/
env/
'''
    
    def _docker_compose_template(self, context: Dict[str, Any]) -> str:
        project_name = context.get('project_name', 'generated-project').lower().replace(' ', '-')
        return f'''version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: {project_name}
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
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/{project_name}
      REDIS_URL: redis://redis:6379/0
      DEBUG: "true"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./backend:/app
      - ./backend_data:/data

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "3000:3000"
    environment:
      REACT_APP_API_URL: http://localhost:8000
      REACT_APP_ENV: development
    depends_on:
      - backend
    volumes:
      - ./src:/app/src
      - ./public:/app/public
      - ./frontend_data:/data

volumes:
  postgres_data:
  redis_data:
  backend_data:
  frontend_data:
'''