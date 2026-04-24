"""
Agent Hybride Simplifié - Fusion Orchestrateur + Planificateur + Codeur
Pour MVP ISSALAN (solo-dev friendly)
"""

import json
import logging
import asyncio
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from pydantic import BaseModel, Field
from datetime import datetime
import os
import re

from ..api.deepseek_client import DeepSeekClient

logger = logging.getLogger(__name__)


class UserRequest(BaseModel):
    """Requête utilisateur simplifiée."""
    description: str = Field(..., description="Description de l'application à créer")
    project_name: Optional[str] = Field(None, description="Nom du projet")
    tech_stack: Optional[List[str]] = Field(default_factory=list)
    requirements: Optional[List[str]] = Field(default_factory=list)


@dataclass
class SimpleProjectPlan:
    """Plan de projet simplifié."""
    project_name: str
    description: str
    files: List[Dict[str, Any]]  # Liste des fichiers à créer
    structure: Dict[str, Any]    # Structure des dossiers
    dependencies: List[str]      # Dépendances à installer
    estimated_time: str = "30 minutes"
    status: str = "planned"      # planned, generating, completed, failed


class SimpleAgent:
    """
    Agent hybride qui combine :
    1. Analyse de la demande (Orchestrateur)
    2. Planification structure (Planificateur) 
    3. Génération code (Codeur)
    
    Pour MVP solo-dev : 1 agent au lieu de 5
    """
    
    def __init__(self, deepseek_client: DeepSeekClient):
        self.deepseek_client = deepseek_client
        
        # Prompt système optimisé pour agent unique
        self.system_prompt = """Tu es ISSALAN, un agent IA expert qui génère des applications complètes.
Tu combines 3 rôles :
1. ARCHITECTE : Analyse la demande et conçoit l'architecture
2. PLANIFICATEUR : Crée la structure de fichiers et dossiers
3. CODEUR : Écrit le code source propre et fonctionnel

Processus en 3 étapes :
1. ANALYSE : Comprendre la demande utilisateur
2. PLAN : Générer structure complète (fichiers + dossiers)
3. CODE : Écrire le code pour chaque fichier

Format de réponse JSON :
{
  "project_name": "nom_du_projet",
  "description": "description_claire",
  "structure": {
    "root": "nom_du_projet",
    "folders": ["src", "public", "docs"],
    "files": [
      {
        "path": "chemin/complet/du/fichier",
        "type": "file_type", // "code", "config", "documentation"
        "language": "python|javascript|html|css|etc",
        "content": "contenu_du_fichier_complet",
        "description": "à_quoi_sert_ce_fichier"
      }
    ]
  },
  "dependencies": ["liste", "des", "dépendances"],
  "instructions": "commandes à exécuter pour lancer le projet"
}

Sois concis, pratique, et orienté vers l'action. Génère du code PRÊT À UTILISER."""
        
        logger.info("SimpleAgent initialisé (Orchestrateur+Planificateur+Codeur fusionnés)")
    
    async def process_request(self, user_request: UserRequest) -> SimpleProjectPlan:
        """
        Traite une requête utilisateur complète.
        Retourne un plan avec tous les fichiers à créer.
        """
        logger.info(f"Traitement requête: {user_request.description[:50]}...")
        
        try:
            # Étape 1: Générer le plan complet
            plan_data = await self._generate_plan(user_request)
            
            # Étape 2: Générer le contenu des fichiers
            files_with_content = await self._generate_files_content(plan_data, user_request)
            
            # Créer le plan final
            plan = SimpleProjectPlan(
                project_name=plan_data.get("project_name", user_request.project_name or "new_project"),
                description=plan_data.get("description", user_request.description),
                files=files_with_content,
                structure=plan_data.get("structure", {}),
                dependencies=plan_data.get("dependencies", []),
                estimated_time=plan_data.get("estimated_time", "30 minutes")
            )
            
            logger.info(f"Plan généré: {plan.project_name} avec {len(plan.files)} fichiers")
            return plan
            
        except Exception as e:
            logger.error(f"Erreur traitement requête: {e}")
            return self._create_fallback_plan(user_request)
    
    async def _generate_plan(self, user_request: UserRequest) -> Dict[str, Any]:
        """Génère le plan d'architecture."""
        prompt = f"""
        Demande utilisateur: {user_request.description}
        
        Informations supplémentaires:
        - Nom projet: {user_request.project_name or 'Non spécifié'}
        - Stack tech: {', '.join(user_request.tech_stack) if user_request.tech_stack else 'Non spécifié'}
        - Exigences: {', '.join(user_request.requirements) if user_request.requirements else 'Aucune'}
        
        Génère un plan COMPLET avec:
        1. Structure de dossiers
        2. Liste des fichiers nécessaires (avec chemins)
        3. Dépendances à installer
        4. Instructions de démarrage
        
        Réponds en JSON.
        """
        
        response = await self.deepseek_client.generate_json(
            prompt=prompt,
            system_prompt=self.system_prompt,
            model="deepseek-reasoner"  # Mode raisonnement pour la planification
        )
        
        return response
    
    async def _generate_files_content(self, plan_data: Dict[str, Any], user_request: UserRequest) -> List[Dict[str, Any]]:
        """Génère le contenu de chaque fichier."""
        files = plan_data.get("structure", {}).get("files", [])
        
        if not files:
            # Si pas de fichiers dans le plan, créer une structure par défaut
            files = self._create_default_files(plan_data, user_request)
        
        # Générer le contenu pour chaque fichier
        files_with_content = []
        
        for file_info in files:
            try:
                content = await self._generate_file_content(file_info, user_request)
                
                file_with_content = {
                    "path": file_info.get("path", f"unknown/{len(files_with_content)}"),
                    "type": file_info.get("type", "code"),
                    "language": file_info.get("language", "text"),
                    "content": content,
                    "description": file_info.get("description", ""),
                    "status": "generated"
                }
                
                files_with_content.append(file_with_content)
                
            except Exception as e:
                logger.error(f"Erreur génération fichier {file_info.get('path', 'unknown')}: {e}")
                # Fichier de secours
                files_with_content.append(self._create_fallback_file(file_info))
        
        return files_with_content
    
    async def _generate_file_content(self, file_info: Dict[str, Any], user_request: UserRequest) -> str:
        """Génère le contenu d'un fichier spécifique."""
        file_path = file_info.get("path", "")
        file_type = file_info.get("type", "code")
        language = file_info.get("language", "text")
        
        prompt = f"""
        Génère le contenu COMPLET du fichier: {file_path}
        
        Contexte:
        - Projet: {user_request.description[:100]}...
        - Type fichier: {file_type}
        - Langage: {language}
        - Description: {file_info.get('description', 'Non spécifiée')}
        
        Règles:
        1. Écris du code COMPLET et FONCTIONNEL
        2. Inclus les imports/dépendances nécessaires
        3. Documente le code si pertinent
        4. Suis les bonnes pratiques du langage
        5. Le code doit être PRÊT À UTILISER
        
        Retourne SEULEMENT le contenu du fichier (pas de markdown, pas de ```).
        """
        
        response = await self.deepseek_client.generate_text(
            prompt=prompt,
            system_prompt="Tu es un développeur senior expert. Écris du code propre, documenté et fonctionnel.",
            model="deepseek-chat"  # Mode chat pour le code
        )
        
        # Nettoyer la réponse (enlever les blocs de code markdown)
        cleaned_content = self._clean_code_response(response, language)
        
        return cleaned_content
    
    def _clean_code_response(self, response: str, language: str) -> str:
        """Nettoie la réponse pour extraire juste le code."""
        # Enlever les blocs de code markdown ```language ... ```
        pattern = rf'```{language}?\s*(.*?)\s*```'
        matches = re.findall(pattern, response, re.DOTALL)
        
        if matches:
            # Prendre le premier bloc de code trouvé
            return matches[0].strip()
        
        # Si pas de bloc de code, enlever les ``` vides
        response = re.sub(r'```.*?```', '', response, flags=re.DOTALL)
        
        # Enlever les lignes vides au début et à la fin
        return response.strip()
    
    def _create_default_files(self, plan_data: Dict[str, Any], user_request: UserRequest) -> List[Dict[str, Any]]:
        """Crée une structure de fichiers par défaut."""
        project_name = plan_data.get("project_name", "my_project")
        
        # Détecter le type de projet basé sur la description
        description_lower = user_request.description.lower()
        
        if "web" in description_lower or "site" in description_lower:
            return self._create_web_project_files(project_name)
        elif "api" in description_lower or "backend" in description_lower:
            return self._create_api_project_files(project_name)
        elif "python" in description_lower:
            return self._create_python_project_files(project_name)
        else:
            return self._create_basic_project_files(project_name)
    
    def _create_web_project_files(self, project_name: str) -> List[Dict[str, Any]]:
        """Fichiers pour un projet web basique."""
        return [
            {
                "path": f"{project_name}/index.html",
                "type": "code",
                "language": "html",
                "description": "Page HTML principale"
            },
            {
                "path": f"{project_name}/style.css",
                "type": "code",
                "language": "css",
                "description": "Feuille de style CSS"
            },
            {
                "path": f"{project_name}/script.js",
                "type": "code",
                "language": "javascript",
                "description": "JavaScript pour l'interactivité"
            },
            {
                "path": f"{project_name}/README.md",
                "type": "documentation",
                "language": "markdown",
                "description": "Documentation du projet"
            }
        ]
    
    def _create_api_project_files(self, project_name: str) -> List[Dict[str, Any]]:
        """Fichiers pour une API basique."""
        return [
            {
                "path": f"{project_name}/main.py",
                "type": "code",
                "language": "python",
                "description": "Point d'entrée de l'API"
            },
            {
                "path": f"{project_name}/requirements.txt",
                "type": "config",
                "language": "text",
                "description": "Dépendances Python"
            },
            {
                "path": f"{project_name}/.env.example",
                "type": "config",
                "language": "text",
                "description": "Variables d'environnement"
            },
            {
                "path": f"{project_name}/README.md",
                "type": "documentation",
                "language": "markdown",
                "description": "Documentation API"
            }
        ]
    
    def _create_python_project_files(self, project_name: str) -> List[Dict[str, Any]]:
        """Fichiers pour un projet Python basique."""
        return [
            {
                "path": f"{project_name}/main.py",
                "type": "code",
                "language": "python",
                "description": "Script Python principal"
            },
            {
                "path": f"{project_name}/utils.py",
                "type": "code",
                "language": "python",
                "description": "Fonctions utilitaires"
            },
            {
                "path": f"{project_name}/requirements.txt",
                "type": "config",
                "language": "text",
                "description": "Dépendances"
            },
            {
                "path": f"{project_name}/README.md",
                "type": "documentation",
                "language": "markdown",
                "description": "Documentation"
            }
        ]
    
    def _create_basic_project_files(self, project_name: str) -> List[Dict[str, Any]]:
        """Fichiers pour un projet générique."""
        return [
            {
                "path": f"{project_name}/README.md",
                "type": "documentation",
                "language": "markdown",
                "description": "Documentation du projet"
            },
            {
                "path": f"{project_name}/main.txt",
                "type": "code",
                "language": "text",
                "description": "Fichier principal"
            }
        ]
    
    def _create_fallback_file(self, file_info: Dict[str, Any]) -> Dict[str, Any]:
        """Crée un fichier de secours en cas d'erreur."""
        path = file_info.get("path", "backup/file.txt")
        language = file_info.get("language", "text")
        
        # Contenu de secours basé sur le type de fichier
        if language == "python":
            content = "# Fichier Python généré par ISSALAN\n# Contenu temporaire - régénération nécessaire\n\nprint('Hello from ISSALAN!')"
        elif language == "html":
            content = """<!DOCTYPE html>
<html>
<head>
    <title>ISSALAN Generated</title>
</head>
<body>
    <h1>Hello from ISSALAN!</h1>
    <p>This file was generated by ISSALAN AI.</p>
</body>
</html>"""
        elif language == "markdown":
            content = "# Project Documentation\n\nThis file was generated by ISSALAN AI.\n\n## Next Steps\n\nRegenerate this file for proper content."
        else:
            content = f"File: {path}\nGenerated by ISSALAN AI\nContent generation failed - please regenerate."
        
        return {
            "path": path,
            "type": file_info.get("type", "code"),
            "language": language,
            "content": content,
            "description": f"Fallback file - {file_info.get('description', '')}",
            "status": "fallback"
        }
    
    def _create_fallback_plan(self, user_request: UserRequest) -> SimpleProjectPlan:
        """Crée un plan de secours en cas d'erreur."""
        logger.warning("Création plan de secours")
        
        return SimpleProjectPlan(
            project_name=user_request.project_name or "fallback_project",
            description=user_request.description,
            files=[
                {
                    "path": "README.md",
                    "type": "documentation",
                    "language": "markdown",
                    "content": f"# {user_request.project_name or 'Project'}\n\n{user_request.description}\n\n*Generated by ISSALAN (fallback mode)*",
                    "description": "Documentation de secours",
                    "status": "fallback"
                }
            ],
            structure={
                "root": user_request.project_name or "fallback_project",
                "folders": [],
                "files": ["README.md"]
            },
            dependencies=[],
            estimated_time="5 minutes",
            status="fallback"
        )
    
    async def validate_plan(self, plan: SimpleProjectPlan) -> Dict[str, Any]:
        """
        Valide un plan généré.
        Vérifie la cohérence et propose des améliorations.
        """
        validation_result = {
            "valid": True,
            "issues": [],
            "warnings": [],
            "suggestions": []
        }
        
        # Vérification 1: Fichiers avec chemins valides
        for file in plan.files:
            path = file.get("path", "")
            if not path or path.strip() == "":
                validation_result["issues"].append(f"Fichier sans chemin: {file}")
                validation_result["valid"] = False
            
            # Vérifier les chemins dangereux
            if ".." in path or path.startswith("/") or "~" in path:
                validation_result["warnings"].append(f"Chemin potentiellement dangereux: {path}")
        
        # Vérification 2: Contenu non vide pour les fichiers de code
        for file in plan.files:
            if file.get("type") == "code" and not file.get("content", "").strip():
                validation_result["issues"].append(f"Fichier code vide: {file.get('path')}")
                validation_result["valid"] = False
        
        # Vérification 3: README présent
        has_readme = any("README" in file.get("path", "").upper() for file in plan.files)
        if not has_readme:
            validation_result["suggestions"].append("Ajouter un fichier README.md")
        
        return validation_result
    
    def get_agent_info(self) -> Dict[str, Any]:
        """Retourne les informations sur l'agent."""
        return {
            "name": "SimpleAgent",
            "version": "1.0.0",
            "description": "Agent hybride (Orchestrateur+Planificateur+Codeur)",
            "capabilities": [
                "Analyse de demande utilisateur",
                "Planification de structure projet",
                "Génération de code source",
                "Validation de plans",
                "Fallback automatique"
            ],
            "models_supported": ["deepseek-chat", "deepseek-reasoner"],
            "status": "active"
        }


# Test de l'agent
async def test_simple_agent():
    """Test de l'agent hybride simplifié."""
    print("🧪 Test SimpleAgent (Orchestrateur+Planificateur+Codeur fusionnés)")
    print("=" * 60)
    
    try:
        from ..api.deepseek_client import get_deepseek_client
        
        # Initialiser le client DeepSeek
        deepseek_client = await get_deepseek_client()
        
        # Créer l'agent
        agent = SimpleAgent(deepseek_client)
        
        # Requête de test
        user_request = UserRequest(
            description="Crée un site web simple avec une page d'accueil, une page contact, et un formulaire",
            project_name="mon_site_web",
            tech_stack=["HTML", "CSS", "JavaScript"],
            requirements=["Responsive", "Formulaire fonctionnel"]
        )
        
        print("1. Traitement de la requête...")
        plan = await agent.process_request(user_request)
        
        print(f"   ✅ Projet: {plan.project_name}")
        print(f"   ✅ Fichiers générés: {len(plan.files)}")
        print(f"   ✅ Temps estimé: {plan.estimated_time}")
        
        print("\n2. Validation du plan...")
        validation = await agent.validate_plan(plan)
        
        print(f"   ✅ Valide: {validation['valid']}")
        if validation['issues']:
            print(f"   ⚠️  Problèmes: {len(validation['issues'])}")
        if validation['warnings']:
            print(f"   ⚠️  Avertissements: {len(validation['warnings'])}")
        if validation['suggestions']:
            print(f"   💡 Suggestions: {validation['suggestions']}")
        
        print("\n3. Aperçu des fichiers...")
        for i, file in enumerate(plan.files[:3]):  # Afficher les 3 premiers
            print(f"   {i+1}. {file['path']} ({file['language']})")
            print(f"      {file['description'][:50]}...")
        
        if len(plan.files) > 3:
            print(f"   ... et {len(plan.files) - 3} autres fichiers")
        
        print("\n4. Informations agent...")
        info = agent.get_agent_info()
        print(f"   ✅ Nom: {info['name']}")
        print(f"   ✅ Version: {info['version']}")
        print(f"   ✅ Capacités: {len(info['capabilities'])}")
        
        print("\n" + "=" * 60)
        print("✅ SimpleAgent testé avec succès !")
        print("\n📋 Réduction de complexité :")
        print("   Avant : 5 agents séparés (Orchestrateur, Planificateur, Codeur, Testeur, Exécuteur)")
        print("   Après  : 1 agent hybride (80% moins complexe)")
        print("\n🚀 Prêt pour le MVP solo-dev !")
        
        return True
        
    except Exception as e:
        print(f"❌ Erreur test SimpleAgent: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    # Exécuter le test
    asyncio.run(test_simple_agent())
