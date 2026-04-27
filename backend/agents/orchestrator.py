"""
Agent Orchestrateur - Chef d'orchestre du systeme multi-agent.
Recoit la demande utilisateur et coordonne les autres agents.
"""

import logging
from typing import Dict, List, Any
from pydantic import BaseModel, Field

from .base import BaseAgent

logger = logging.getLogger(__name__)


class UserRequest(BaseModel):
    """Modele pour les requetes utilisateur."""

    description: str = Field(..., description="Description de l'application a creer")
    project_name: str = Field(default="my_project", description="Nom du projet")
    tech_stack: List[str] = Field(default_factory=list, description="Stack technologique")
    requirements: List[str] = Field(default_factory=list, description="Exigences specifiques")


class OrchestratorAgent(BaseAgent):
    """Agent orchestrateur qui coordonne le pipeline."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="orchestrator",
            role="Architecte Logiciel",
            description="Analyse les demandes et coordonne le pipeline multi-agent",
            deepseek_client=deepseek_client
        )

        self.system_prompt = """Tu es un architecte logiciel expert avec 15 ans d'experience.

Ton role: Analyser la demande utilisateur (deja enrichie par le Product Manager) et creer un plan d'action complet.

Regles:
1. RESPECTE la description enrichie — elle contient deja les pages, features, design, contenu
2. Cree un plan COMPLET avec TOUS les fichiers necessaires (15-25 fichiers pour un projet web/e-commerce)
3. Chaque fichier doit avoir un role clair et specifique
4. Inclus TOUJOURS: index.html, styles.css, app.js/main.js, et tous les composants
5. Pour un site web: cree des pages separees ou sections (accueil, produits, panier, contact, etc.)
6. Pense UX: navigation, responsive design, animations, micro-interactions
7. Pense SEO: meta tags, titres, structure semantique HTML5
8. Le code doit etre COMPLET et FONCTIONNEL, pas de placeholders vides

Reponds en JSON:
{
    "project_name": "nom_du_projet",
    "description": "description detaillee du projet",
    "tasks": [
        {"agent": "planner|coder|tester|executor", "task": "description detaillee", "priority": "high|medium|low"}
    ],
    "architecture": {
        "frontend": {"framework": "...", "language": "...", "pages": ["liste des pages"]},
        "backend": {"framework": "...", "language": "..."},
        "database": {"type": "..."},
        "design": {"style": "...", "colors": {"primary": "#hex", "secondary": "#hex"}, "fonts": "..."}
    },
    "dependencies": ["liste", "de", "dependances"],
    "risks": ["risques", "identifies"]
}"""

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyse la demande utilisateur et genere un plan de projet.

        Args:
            request: Dict contenant 'description' et optionnellement 'project_name', 'tech_stack', 'requirements'

        Returns:
            Plan de projet structure
        """
        user_req = UserRequest(**request)

        logger.info(f"[{self.name}] Orchestration: {user_req.project_name}")

        # Construire le prompt
        user_message = f"""Creer un plan complet pour ce projet:

**Nom**: {user_req.project_name}
**Description**: {user_req.description}

Stack technique: {', '.join(user_req.tech_stack) if user_req.tech_stack else "A determiner"}
Exigences: {', '.join(user_req.requirements) if user_req.requirements else "Aucune"}

Genere un plan d'architecture detaille avec TOUS les fichiers a creer.
Le projet doit etre complet et fonctionnel des la premiere generation."""

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message}
        ]

        try:
            response = await self.call_deepseek(
                messages=messages,
                temperature=0.7,
                max_tokens=4000,
                response_format={"type": "json_object"},
            )

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
