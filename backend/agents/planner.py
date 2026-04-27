"""
Agent Planificateur - Genere l'architecture et la structure des fichiers.
Produit une liste COMPLETE de fichiers avec descriptions detaillees.
"""

import logging
from typing import Dict, Any

from .base import BaseAgent

logger = logging.getLogger(__name__)


class PlannerAgent(BaseAgent):
    """Agent qui produit l'architecture detaillee et la structure des fichiers."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="planner",
            role="Architecte",
            description="Genere l'architecture detaillee et la structure des fichiers",
            deepseek_client=deepseek_client
        )

        self.system_prompt = """Tu es un expert en architecture logicielle et design de projets.

Ton role: Prendre un plan et generer une structure de fichiers COMPLETE et detaillee.

REGLES:
1. Genere TOUS les fichiers necessaires (15-25 pour un projet web, 5-10 pour un script)
2. Chaque fichier a un chemin precis, une description claire et un type
3. Inclus les fichiers de config (package.json, .gitignore, etc.)
4. Pour un site web, TOUJOURS inclure:
   - index.html (page principale)
   - styles/main.css (styles globaux)
   - styles/responsive.css (media queries)
   - js/app.js (logique principale)
   - js/components/*.js (composants reutilisables)
   - assets/ (images, icones)
   - Pages additionnelles selon le projet
5. Pour un projet avec backend:
   - server.js ou app.py
   - routes/
   - models/
   - middleware/
   - config/

Reponds en JSON:
{
    "structure": {
        "directories": ["src/", "src/styles/", "src/js/", "src/assets/", ...],
        "files": [
            {"path": "index.html", "description": "Page d'accueil avec hero, produits, temoignages", "type": "html"},
            {"path": "styles/main.css", "description": "Variables CSS, reset, typographie, layout global", "type": "css"},
            {"path": "js/app.js", "description": "Navigation, panier, filtres produits", "type": "javascript"}
        ]
    },
    "architecture": {
        "layers": {
            "presentation": "HTML5 semantique + CSS moderne + JS vanilla",
            "business_logic": "...",
            "data_access": "..."
        },
        "patterns": ["pattern1", "pattern2"]
    },
    "dependencies": {
        "core": ["package1", "package2"],
        "dev": ["eslint", "prettier"]
    },
    "setup_steps": ["Step 1", "Step 2"]
}"""

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Genere l'architecture et la structure des fichiers.
        """
        plan = request.get("plan", {})
        project_name = request.get("project_name", "project")

        logger.info(f"[{self.name}] Planification: {project_name}")

        user_message = f"""Base sur ce plan d'architecture:

{str(plan)[:3000]}

Genere une structure de fichiers COMPLETE avec:
1. TOUS les repertoires necessaires
2. TOUS les fichiers avec descriptions detaillees de leur contenu
3. Dependencies (core et dev)
4. Patterns architecturaux
5. Etapes de configuration

Pour le projet: {project_name}

IMPORTANT: Genere suffisamment de fichiers pour un projet COMPLET et FONCTIONNEL.
Minimum 10 fichiers pour un site web, 15+ pour un e-commerce."""

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message}
        ]

        try:
            response = await self.call_deepseek(
                messages=messages,
                temperature=0.6,
                max_tokens=4000,
                response_format={"type": "json_object"},
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
