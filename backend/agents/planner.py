"""
Agent Planificateur - Génère l'architecture et la structure des fichiers.
"""

import logging
from typing import Dict, Any

from .base import BaseAgent

logger = logging.getLogger(__name__)


class PlannerAgent(BaseAgent):
    """Agent qui produit l'architecture détaillée et la structure des fichiers."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="planner",
            role="Architecte",
            description="Génère l'architecture détaillée et la structure des fichiers",
            deepseek_client=deepseek_client
        )

        self.system_prompt = """Tu es un expert en architecture logicielle et design de projets.

Ton rôle: Prendre un plan de haut niveau et générer une structure de fichiers détaillée avec architecture.

Réponds en JSON avec:
{
    "structure": {
        "directories": ["src/", "src/components/", "src/services/", ...],
        "files": [
            {"path": "src/main.py", "description": "Point d'entrée", "type": "python"}
        ]
    },
    "architecture": {
        "layers": {
            "presentation": "...",
            "business_logic": "...",
            "data_access": "..."
        },
        "patterns": ["pattern1", "pattern2"]
    },
    "dependencies": {
        "core": ["package1>=1.0", "package2"],
        "dev": ["pytest", "black"]
    },
    "setup_steps": ["Step 1", "Step 2"]
}"""

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Génère l'architecture et la structure des fichiers.

        Args:
            request: Dict contenant 'plan' et 'project_name'

        Returns:
            Architecture détaillée avec structure de fichiers
        """
        plan = request.get("plan", {})
        project_name = request.get("project_name", "project")

        logger.info(f"[{self.name}] Planification: {project_name}")

        user_message = f"""Basé sur ce plan d'architecture:

{str(plan)[:2000]}

Génère une structure de fichiers détaillée avec:
1. Hiérarchie des répertoires
2. Fichiers à créer avec descriptions
3. Dépendances (core et dev)
4. Patterns à utiliser
5. Étapes de configuration

Pour le projet: {project_name}"""

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message}
        ]

        try:
            response = await self.call_deepseek(
                messages=messages,
                temperature=0.6,
                max_tokens=2500
            )

            architecture = self.parse_json_response(response)

            return {
                "status": "success",
                "architecture": architecture,
                "tokens_used": self.tokens_used
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur planification: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used
            }
