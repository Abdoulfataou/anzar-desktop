"""
Agent Testeur - Vérifie et améliore le code généré.
"""

import logging
from typing import Dict, Any

from .base import BaseAgent

logger = logging.getLogger(__name__)


class TesterAgent(BaseAgent):
    """Agent qui teste le code générés et identifie les problèmes."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="tester",
            role="QA Engineer",
            description="Teste le code et identifie les bugs et problèmes de sécurité",
            deepseek_client=deepseek_client
        )

        self.system_prompt = """Tu es un testeur logiciel expert en QA et sécurité.

Ton rôle: Analyser le code généré et identifier:
- Bugs et problèmes logiques
- Manques de gestion d'erreur
- Failles de sécurité
- Problèmes de performance
- Non-respect des bonnes pratiques

Réponds en JSON avec:
{
    "code_quality": "score 1-10",
    "issues": [
        {"severity": "critical|high|medium|low", "description": "...", "fix": "..."}
    ],
    "security_review": {
        "vulnerabilities": [...],
        "recommendations": [...]
    },
    "improvements": ["suggestion 1", "suggestion 2"]
}"""

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Teste et valide le code généré.

        Args:
            request: Dict contenant 'files' et 'plan'

        Returns:
            Rapport de test avec problèmes identifiés et suggestions
        """
        files = request.get("files", {})
        plan = request.get("plan", {})

        logger.info(f"[{self.name}] Test de {len(files)} fichiers")

        # Limiter les fichiers à tester
        files_to_test = list(files.items())[:3]
        files_summary = "\n".join([f"- {path}: {len(code)} chars" for path, code in files_to_test])

        user_message = f"""Teste ce code généré:

{files_summary}

Code complet:
{str(files_to_test)[:2000]}

Plan du projet: {str(plan)[:1000]}

Identifie tous les problèmes, failles de sécurité et suggestions d'amélioration."""

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message}
        ]

        try:
            response = await self.call_deepseek(
                messages=messages,
                temperature=0.6,
                max_tokens=2000
            )

            report = self.parse_json_response(response)

            return {
                "status": "success",
                "report": report,
                "files_tested": len(files),
                "tokens_used": self.tokens_used
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur test: {e}")
            return {
                "status": "error",
                "error": str(e),
                "files_tested": len(files),
                "tokens_used": self.tokens_used
            }
