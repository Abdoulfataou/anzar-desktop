"""
Agent Orchestrateur - Chef d'orchestre du système multi-agent.
Reçoit la demande utilisateur et coordonne les autres agents.
"""

import logging
from typing import Dict, List, Any
from pydantic import BaseModel, Field

from .base import BaseAgent

logger = logging.getLogger(__name__)


class UserRequest(BaseModel):
    """Modèle pour les requêtes utilisateur."""

    description: str = Field(..., description="Description de l'application à créer")
    project_name: str = Field(default="my_project", description="Nom du projet")
    tech_stack: List[str] = Field(default_factory=list, description="Stack technologique")
    requirements: List[str] = Field(default_factory=list, description="Exigences spécifiques")


class OrchestratorAgent(BaseAgent):
    """Agent orchestrateur qui coordonne le pipeline."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="orchestrator",
            role="Architecte Logiciel",
            description="Analyse les demandes et coordonne le pipeline multi-agent",
            deepseek_client=deepseek_client
        )

        self.system_prompt = """Tu es un architecte logiciel expert avec 15 ans d'expérience.

Ton rôle: Analyser la demande utilisateur et créer un plan d'action détaillé.

Processus:
1. Analyse la demande pour comprendre le type d'application
2. Identifie les composants nécessaires
3. Décompose en tâches pour chaque agent
4. Estime la complexité et la durée
5. Propose une architecture technique

Réponds en JSON structuré:
{
    "project_name": "nom_du_projet",
    "description": "description détaillée",
    "tasks": [
        {"agent": "planner|coder|tester|executor", "task": "description", "priority": "high|medium|low"}
    ],
    "architecture": {
        "frontend": {"framework": "...", "language": "..."},
        "backend": {"framework": "...", "language": "..."},
        "database": {"type": "..."}
    },
    "dependencies": ["liste", "de", "dépendances"],
    "risks": ["risques", "identifiés"]
}"""

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyse la demande utilisateur et génère un plan de projet.

        Args:
            request: Dict contenant 'description' et optionnellement 'project_name', 'tech_stack', 'requirements'

        Returns:
            Plan de projet structuré
        """
        user_req = UserRequest(**request)

        logger.info(f"[{self.name}] Orchestration: {user_req.project_name}")

        # Construire le prompt
        user_message = f"""Créer un plan pour ce projet:

**Nom**: {user_req.project_name}
**Description**: {user_req.description}

Stack technique préférée: {', '.join(user_req.tech_stack) if user_req.tech_stack else "À déterminer"}
Exigences spéciales: {', '.join(user_req.requirements) if user_req.requirements else "Aucune"}

Génère un plan d'architecture détaillé et une liste de tâches pour la création du projet."""

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message}
        ]

        try:
            # Appel DeepSeek avec JSON mode forcé
            response = await self.call_deepseek(
                messages=messages,
                temperature=0.7,
                max_tokens=3000,
                response_format={"type": "json_object"},
            )

            # Parser le JSON
            plan = self.parse_json_response(response)

            return {
                "status": "success",
                "plan": plan,
                "project_name": user_req.project_name,
                "tokens_used": self.tokens_used
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur orchestration: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used
            }
