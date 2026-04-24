"""
Agent Codeur - Génère le code source basé sur l'architecture.
"""

import logging
from typing import Dict, Any

from .base import BaseAgent

logger = logging.getLogger(__name__)


class CoderAgent(BaseAgent):
    """Agent qui génère le code source pour chaque fichier."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="coder",
            role="Développeur",
            description="Génère le code source clean et bien documenté",
            deepseek_client=deepseek_client
        )

        self.system_prompt = """Tu es un développeur expert avec 15 ans d'expérience.

Ton rôle: Écrire du code clean, bien documenté et testé.

Guidelines:
- Code modulaire et réutilisable
- Commentaires clairs (en français)
- Gestion d'erreurs robuste
- Tests unitaires
- Type hints (Python)
- SOLID principles

Réponds avec le code prêt à être écrit dans les fichiers."""

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Génère le code source pour les fichiers.

        Args:
            request: Dict contenant 'architecture' et 'plan'

        Returns:
            Dict avec les fichiers et leur code
        """
        architecture = request.get("architecture", {})
        plan = request.get("plan", {})
        project_name = request.get("project_name", "project")

        logger.info(f"[{self.name}] Génération code: {project_name}")

        # Récupérer les fichiers à générer
        files_to_generate = architecture.get("structure", {}).get("files", [])[:5]  # Limiter à 5 fichiers
        files_str = "\n".join([f"- {f.get('path')}: {f.get('description')}" for f in files_to_generate])

        user_message = f"""Génère le code source pour ces fichiers du projet '{project_name}':

{files_str}

Architecture: {str(architecture)[:1500]}

Format chaque fichier comme:
```language
// Chemin: filepath
// Code ici
```"""

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message}
        ]

        try:
            response = await self.call_deepseek(
                messages=messages,
                temperature=0.5,
                max_tokens=4000
            )

            # Parser les blocs de code
            files = self._extract_code_blocks(response)

            return {
                "status": "success",
                "files": files,
                "count": len(files),
                "tokens_used": self.tokens_used
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur génération: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used
            }

    def _extract_code_blocks(self, response: str) -> Dict[str, str]:
        """Extrait les blocs de code de la réponse."""
        import re

        files = {}
        pattern = r'```(\w+)\n//\s*Chemin:\s*([^\n]+)\n(.*?)```'
        matches = re.findall(pattern, response, re.DOTALL)

        for language, filepath, code in matches:
            files[filepath.strip()] = code.strip()

        if not files:
            # Fallback: stocker la réponse entière
            files["generated_code.txt"] = response

        return files
