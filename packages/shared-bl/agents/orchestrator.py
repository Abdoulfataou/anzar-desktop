"""
Agent Orchestrateur - Chef d'orchestre du système multi-agent.
Reçoit la demande utilisateur, la décompose en tâches, et délègue aux agents spécialisés.
"""

import json
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from ag2 import Agent, Task, TaskResult
from pydantic import BaseModel, Field
import logging

logger = logging.getLogger(__name__)


class UserRequest(BaseModel):
    """Modèle pour les requêtes utilisateur."""
    description: str = Field(..., description="Description textuelle de l'application à créer")
    project_name: Optional[str] = Field(None, description="Nom du projet (optionnel)")
    tech_stack: Optional[List[str]] = Field(default_factory=list, description="Stack technologique préférée")
    requirements: Optional[List[str]] = Field(default_factory=list, description="Exigences spécifiques")


@dataclass
class ProjectPlan:
    """Plan de projet généré par l'orchestrateur."""
    project_name: str
    description: str
    tasks: List[Dict[str, Any]]
    architecture: Dict[str, Any]
    estimated_duration: str
    dependencies: List[str]
    risks: List[str]


class OrchestratorAgent:
    """Agent orchestrateur principal."""
    
    def __init__(self, deepseek_client):
        self.deepseek_client = deepseek_client
        self.system_prompt = """Tu es un architecte logiciel expert avec 15 ans d'expérience.
Ton rôle : Analyser la demande utilisateur et créer un plan d'action détaillé avec des tâches spécifiques pour chaque agent spécialisé.

Processus à suivre :
1. Analyse la demande utilisateur pour comprendre le type d'application demandée
2. Identifie les composants nécessaires (frontend, backend, base de données, API, etc.)
3. Décompose en tâches réalisables par les autres agents
4. Estime la complexité et la durée
5. Propose une architecture technique adaptée

Format de réponse attendu (JSON) :
{
    "project_name": "nom_du_projet",
    "description": "description détaillée",
    "tasks": [
        {
            "agent": "planner|coder|tester|executor",
            "task": "description de la tâche",
            "priority": "high|medium|low",
            "estimated_time": "X minutes"
        }
    ],
    "architecture": {
        "frontend": {"framework": "...", "language": "...", "dependencies": [...]},
        "backend": {"framework": "...", "language": "...", "dependencies": [...]},
        "database": {"type": "...", "schema": "..."},
        "deployment": {"platform": "...", "requirements": [...]}
    },
    "dependencies": ["liste", "de", "dépendances"],
    "risks": ["risques", "identifiés"]
}

Sois méthodique, précis, et toujours orienté vers l'action."""
        
        self.agent = Agent(
            name="orchestrator",
            system_prompt=self.system_prompt,
            tools=[],
            llm_client=self.deepseek_client
        )
    
    async def analyze_request(self, user_request: UserRequest) -> ProjectPlan:
        """Analyse la demande utilisateur et génère un plan de projet."""
        
        user_message = f"""
        Demande utilisateur : {user_request.description}
        
        Informations supplémentaires :
        - Nom du projet : {user_request.project_name or 'Non spécifié'}
        - Stack technologique préférée : {', '.join(user_request.tech_stack) if user_request.tech_stack else 'Non spécifié'}
        - Exigences spécifiques : {', '.join(user_request.requirements) if user_request.requirements else 'Aucune'}
        
        Génère un plan complet pour cette application.
        """
        
        logger.info(f"Analyse de la demande utilisateur : {user_request.description[:100]}...")
        
        try:
            # Appel à l'API DeepSeek
            response = await self.agent.chat(user_message)
            
            # Parser la réponse JSON
            if isinstance(response, str):
                # Essayer d'extraire le JSON de la réponse
                import re
                json_match = re.search(r'\{.*\}', response, re.DOTALL)
                if json_match:
                    response_data = json.loads(json_match.group())
                else:
                    # Si pas de JSON, créer un plan par défaut
                    response_data = self._create_default_plan(user_request)
            else:
                response_data = response
            
            # Convertir en ProjectPlan
            plan = ProjectPlan(
                project_name=response_data.get('project_name', user_request.project_name or 'new_project'),
                description=response_data.get('description', user_request.description),
                tasks=response_data.get('tasks', []),
                architecture=response_data.get('architecture', {}),
                estimated_duration=response_data.get('estimated_duration', '1 heure'),
                dependencies=response_data.get('dependencies', []),
                risks=response_data.get('risks', [])
            )
            
            logger.info(f"Plan généré pour le projet : {plan.project_name}")
            return plan
            
        except Exception as e:
            logger.error(f"Erreur lors de l'analyse de la demande : {e}")
            # Plan de secours
            return self._create_default_plan(user_request)
    
    def _create_default_plan(self, user_request: UserRequest) -> ProjectPlan:
        """Crée un plan par défaut en cas d'erreur."""
        return ProjectPlan(
            project_name=user_request.project_name or "new_project",
            description=user_request.description,
            tasks=[
                {
                    "agent": "planner",
                    "task": "Générer l'arborescence du projet",
                    "priority": "high",
                    "estimated_time": "10 minutes"
                },
                {
                    "agent": "coder",
                    "task": "Écrire le code principal",
                    "priority": "high",
                    "estimated_time": "30 minutes"
                },
                {
                    "agent": "tester",
                    "task": "Vérifier et corriger le code",
                    "priority": "medium",
                    "estimated_time": "15 minutes"
                },
                {
                    "agent": "executor",
                    "task": "Créer les fichiers et dossiers",
                    "priority": "high",
                    "estimated_time": "5 minutes"
                }
            ],
            architecture={
                "frontend": {"framework": "React", "language": "TypeScript"},
                "backend": {"framework": "FastAPI", "language": "Python"},
                "database": {"type": "PostgreSQL"},
                "deployment": {"platform": "Docker"}
            },
            estimated_duration="1 heure",
            dependencies=["python", "nodejs", "docker"],
            risks=["Complexité non estimée", "Dépendances manquantes"]
        )
    
    async def delegate_tasks(self, plan: ProjectPlan, agents: Dict[str, Any]) -> List[TaskResult]:
        """Délègue les tâches aux agents spécialisés."""
        results = []
        
        for task in plan.tasks:
            agent_name = task['agent']
            if agent_name in agents:
                logger.info(f"Délégation de la tâche à l'agent {agent_name}: {task['task']}")
                # Ici, on créerait une tâche AG2 formelle
                # Pour l'instant, on simule
                result = TaskResult(
                    task_id=agent_name,
                    status="delegated",
                    result=f"Tâche déléguée à {agent_name}: {task['task']}"
                )
                results.append(result)
            else:
                logger.warning(f"Agent {agent_name} non trouvé pour la tâche: {task['task']}")
        
        return results