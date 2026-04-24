"""
Agent Exécuteur - Crée physiquement les dossiers et fichiers sur le disque.
Exécute les commandes shell et gère la création du projet.
"""

import os
import shutil
import subprocess
import sys
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from ag2 import Agent
from pydantic import BaseModel, Field
import logging
import json

logger = logging.getLogger(__name__)


class ExecutionResult(BaseModel):
    """Résultat d'une opération d'exécution."""
    success: bool = Field(..., description="L'opération a-t-elle réussi ?")
    operation: str = Field(..., description="Type d'opération")
    path: str = Field("", description="Chemin concerné")
    message: str = Field("", description="Message détaillé")
    output: str = Field("", description="Sortie de la commande")
    error: str = Field("", description="Erreur éventuelle")


class ProjectExecutionSummary(BaseModel):
    """Résumé de l'exécution d'un projet complet."""
    project_name: str = Field(..., description="Nom du projet")
    root_directory: str = Field(..., description="Répertoire racine")
    directories_created: int = Field(0, description="Nombre de dossiers créés")
    files_created: int = Field(0, description="Nombre de fichiers créés")
    commands_executed: int = Field(0, description="Nombre de commandes exécutées")
    results: List[ExecutionResult] = Field(default_factory=list)
    success: bool = Field(False, description="Le projet a-t-il été créé avec succès ?")
    start_url: str = Field("", description="URL de démarrage de l'application")


class ExecutorAgent:
    """Agent exécuteur pour créer physiquement les projets."""
    
    def __init__(self, deepseek_client):
        self.deepseek_client = deepseek_client
        self.system_prompt = """Tu es responsable de créer les fichiers sur le système.
Ton rôle : Exécuter les commandes pour créer l'arborescence et écrire le contenu.

Principes à suivre :
1. Toujours vérifier que les opérations sont sécurisées
2. Demander confirmation pour les opérations dangereuses
3. Fournir un feedback clair sur chaque opération
4. Gérer les erreurs proprement
5. Suivre la progression de la création

Tu disposes des outils suivants :
- create_directory(path): Crée un dossier
- write_file(path, content): Écrit un fichier
- read_file(path): Lit un fichier
- execute_command(command): Exécute une commande shell
- search_code(pattern): Recherche du code

Sois méthodique et sécurisé dans tes actions."""
        
        self.agent = Agent(
            name="executor",
            system_prompt=self.system_prompt,
            tools=[],
            llm_client=self.deepseek_client
        )
    
    async def create_project(self, project_structure: Dict[str, Any], require_confirmation: bool = True) -> ProjectExecutionSummary:
        """Crée un projet complet basé sur la structure."""
        
        project_name = project_structure.get('project_name', 'new_project')
        root_dir = project_structure.get('root_directory', f'./generated_projects/{project_name}')
        
        logger.info(f"Création du projet '{project_name}' dans '{root_dir}'")
        
        summary = ProjectExecutionSummary(
            project_name=project_name,
            root_directory=root_dir,
            success=False
        )
        
        try:
            # Créer le répertoire racine
            root_result = self.create_directory(root_dir)
            summary.results.append(root_result)
            
            if not root_result.success:
                logger.error(f"Impossible de créer le répertoire racine: {root_result.error}")
                return summary
            
            # Créer les sous-répertoires
            directories = project_structure.get('directories', [])
            for dir_info in directories:
                dir_path = os.path.join(root_dir, dir_info['path'])
                result = self.create_directory(dir_path)
                summary.results.append(result)
                if result.success:
                    summary.directories_created += 1
            
            # Créer les fichiers
            files = project_structure.get('files', [])
            for file_info in files:
                file_path = os.path.join(root_dir, file_info['path'])
                content = file_info.get('content', '')
                
                # Si le contenu n'est pas fourni, utiliser un template par défaut
                if not content and file_info.get('template'):
                    content = self._get_template_content(file_info['template'], project_structure)
                
                result = self.write_file(file_path, content)
                summary.results.append(result)
                if result.success:
                    summary.files_created += 1
            
            # Exécuter les commandes
            commands = project_structure.get('commands', [])
            for cmd_info in commands:
                command = cmd_info.get('command', '')
                if command:
                    # Changer dans le répertoire du projet pour les commandes
                    old_cwd = os.getcwd()
                    os.chdir(root_dir)
                    
                    result = self.execute_command(command)
                    
                    os.chdir(old_cwd)
                    
                    summary.results.append(result)
                    if result.success:
                        summary.commands_executed += 1
            
            # Générer l'URL de démarrage
            summary.start_url = self._generate_start_url(project_structure)
            
            # Marquer comme succès
            summary.success = True
            
            logger.info(f"Projet '{project_name}' créé avec succès: {summary.directories_created} dossiers, {summary.files_created} fichiers")
            
        except Exception as e:
            logger.error(f"Erreur lors de la création du projet: {e}")
            summary.results.append(ExecutionResult(
                success=False,
                operation="project_creation",
                path=root_dir,
                message="Erreur lors de la création du projet",
                error=str(e)
            ))
        
        return summary
    
    def create_directory(self, path: str) -> ExecutionResult:
        """Crée un dossier à l'emplacement spécifié."""
        try:
            # Vérifier si le chemin existe déjà
            if os.path.exists(path):
                if os.path.isdir(path):
                    return ExecutionResult(
                        success=True,
                        operation="create_directory",
                        path=path,
                        message="Le dossier existe déjà",
                        output=f"Dossier '{path}' existe déjà"
                    )
                else:
                    return ExecutionResult(
                        success=False,
                        operation="create_directory",
                        path=path,
                        message="Un fichier existe déjà à cet emplacement",
                        error=f"Le chemin '{path}' existe mais n'est pas un dossier"
                    )
            
            # Créer le dossier
            os.makedirs(path, exist_ok=True)
            
            return ExecutionResult(
                success=True,
                operation="create_directory",
                path=path,
                message="Dossier créé avec succès",
                output=f"Dossier '{path}' créé"
            )
            
        except Exception as e:
            return ExecutionResult(
                success=False,
                operation="create_directory",
                path=path,
                message="Erreur lors de la création du dossier",
                error=str(e)
            )
    
    def write_file(self, path: str, content: str) -> ExecutionResult:
        """Écrit du contenu dans un fichier."""
        try:
            # Vérifier si le répertoire parent existe
            dir_path = os.path.dirname(path)
            if dir_path and not os.path.exists(dir_path):
                os.makedirs(dir_path, exist_ok=True)
            
            # Écrire le fichier
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Vérifier que le fichier a été écrit
            file_size = os.path.getsize(path)
            
            return ExecutionResult(
                success=True,
                operation="write_file",
                path=path,
                message="Fichier écrit avec succès",
                output=f"Fichier '{path}' écrit ({file_size} octets)"
            )
            
        except Exception as e:
            return ExecutionResult(
                success=False,
                operation="write_file",
                path=path,
                message="Erreur lors de l'écriture du fichier",
                error=str(e)
            )
    
    def read_file(self, path: str) -> ExecutionResult:
        """Lit le contenu d'un fichier."""
        try:
            if not os.path.exists(path):
                return ExecutionResult(
                    success=False,
                    operation="read_file",
                    path=path,
                    message="Le fichier n'existe pas",
                    error=f"Fichier '{path}' non trouvé"
                )
            
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            return ExecutionResult(
                success=True,
                operation="read_file",
                path=path,
                message="Fichier lu avec succès",
                output=content[:1000]  # Limiter la sortie
            )
            
        except Exception as e:
            return ExecutionResult(
                success=False,
                operation="read_file",
                path=path,
                message="Erreur lors de la lecture du fichier",
                error=str(e)
            )
    
    def execute_command(self, command: str, cwd: Optional[str] = None) -> ExecutionResult:
        """Exécute une commande shell."""
        try:
            # Validation de sécurité basique
            dangerous_patterns = ['rm -rf', 'format', 'dd ', 'mkfs', ':(){:|:&};:']
            for pattern in dangerous_patterns:
                if pattern in command.lower():
                    return ExecutionResult(
                        success=False,
                        operation="execute_command",
                        path=cwd or os.getcwd(),
                        message="Commande dangereuse détectée",
                        error=f"La commande contient un pattern dangereux: {pattern}"
                    )
            
            # Exécuter la commande
            env = os.environ.copy()
            process = subprocess.Popen(
                command,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=cwd,
                env=env
            )
            
            stdout, stderr = process.communicate()
            
            if process.returncode == 0:
                return ExecutionResult(
                    success=True,
                    operation="execute_command",
                    path=cwd or os.getcwd(),
                    message="Commande exécutée avec succès",
                    output=stdout[:2000],  # Limiter la sortie
                    error=stderr[:1000] if stderr else ""
                )
            else:
                return ExecutionResult(
                    success=False,
                    operation="execute_command",
                    path=cwd or os.getcwd(),
                    message="Commande échouée",
                    output=stdout[:1000],
                    error=stderr[:1000] if stderr else f"Code de retour: {process.returncode}"
                )
            
        except Exception as e:
            return ExecutionResult(
                success=False,
                operation="execute_command",
                path=cwd or os.getcwd(),
                message="Erreur lors de l'exécution de la commande",
                error=str(e)
            )
    
    def search_code(self, pattern: str, directory: str = ".", recursive: bool = True) -> ExecutionResult:
        """Recherche du code dans le projet."""
        try:
            import re
            
            if not os.path.exists(directory):
                return ExecutionResult(
                    success=False,
                    operation="search_code",
                    path=directory,
                    message="Le répertoire n'existe pas",
                    error=f"Répertoire '{directory}' non trouvé"
                )
            
            results = []
            regex = re.compile(pattern, re.IGNORECASE)
            
            for root, dirs, files in os.walk(directory):
                if not recursive and root != directory:
                    continue
                
                for file in files:
                    if file.endswith(('.py', '.js', '.jsx', '.ts', '.tsx', '.md', '.txt', '.json', '.yml', '.yaml')):
                        file_path = os.path.join(root, file)
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read()
                                matches = regex.findall(content)
                                if matches:
                                    results.append({
                                        'file': file_path,
                                        'matches': len(matches),
                                        'sample': content[:200] if content else ""
                                    })
                        except:
                            continue
            
            output = json.dumps({
                'pattern': pattern,
                'directory': directory,
                'matches_found': len(results),
                'results': results[:10]  # Limiter les résultats
            }, indent=2)
            
            return ExecutionResult(
                success=True,
                operation="search_code",
                path=directory,
                message=f"Recherche terminée: {len(results)} correspondances",
                output=output
            )
            
        except Exception as e:
            return ExecutionResult(
                success=False,
                operation="search_code",
                path=directory,
                message="Erreur lors de la recherche",
                error=str(e)
            )
    
    def _get_template_content(self, template_name: str, project_context: Dict[str, Any]) -> str:
        """Retourne le contenu d'un template par défaut."""
        templates = {
            'react_package_json': self._template_react_package_json(project_context),
            'react_app': self._template_react_app(project_context),
            'react_index': self._template_react_index(project_context),
            'python_requirements': self._template_python_requirements(project_context),
            'fastapi_main': self._template_fastapi_main(project_context),
            'readme': self._template_readme(project_context),
            'gitignore': self._template_gitignore(project_context),
            'docker_compose': self._template_docker_compose(project_context),
        }
        
        return templates.get(template_name, f"# Template: {template_name}\n# Projet: {project_context.get('project_name', 'Inconnu')}")
    
    def _generate_start_url(self, project_structure: Dict[str, Any]) -> str:
        """Génère l'URL de démarrage de l'application."""
        project_name = project_structure.get('project_name', 'app')
        
        # Vérifier le type d'application
        architecture = project_structure.get('architecture', {})
        frontend = architecture.get('frontend', {})
        backend = architecture.get('backend', {})
        
        if frontend.get('framework') == 'React':
            return "http://localhost:3000"
        elif backend.get('framework') == 'FastAPI':
            return "http://localhost:8000/docs"
        else:
            return f"./{project_name}"
    
    # Templates par défaut
    def _template_react_package_json(self, context: Dict[str, Any]) -> str:
        return json.dumps({
            "name": context.get('project_name', 'app').lower().replace(' ', '-'),
            "version": "1.0.0",
            "private": True,
            "dependencies": {
                "react": "^18.2.0",
                "react-dom": "^18.2.0"
            },
            "scripts": {
                "start": "react-scripts start",
                "build": "react-scripts build",
                "test": "react-scripts test",
                "eject": "react-scripts eject"
            }
        }, indent=2)
    
    def _template_react_app(self, context: Dict[str, Any]) -> str:
        return '''import React from "react";
import "./App.css";

function App() {
  return (
    <div className="App">
      <h1>Application Générée</h1>
      <p>Créée par ISSALAN Multi-Agent System</p>
    </div>
  );
}

export default App;
'''
    
    def _template_react_index(self, context: Dict[str, Any]) -> str:
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
    
    def _template_python_requirements(self, context: Dict[str, Any]) -> str:
        return '''fastapi==0.104.1
uvicorn[standard]==0.24.0
'''
    
    def _template_fastapi_main(self, context: Dict[str, Any]) -> str:
        return '''from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello World"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
'''
    
    def _template_readme(self, context: Dict[str, Any]) -> str:
        return f'''# {context.get('project_name', 'Projet')}

Application générée automatiquement par ISSALAN Multi-Agent System.

## Installation

\`\`\`bash
npm install
\`\`\`

## Démarrage

\`\`\`bash
npm start
\`\`\`

## Documentation

Consultez la documentation pour plus d'informations.
'''
    
    def _template_gitignore(self, context: Dict[str, Any]) -> str:
        return '''node_modules/
.env
*.log
'''
    
    def _template_docker_compose(self, context: Dict[str, Any]) -> str:
        project_name = context.get('project_name', 'app').lower().replace(' ', '-')
        return f'''version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
'''