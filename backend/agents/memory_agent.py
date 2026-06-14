"""
MemoryAgent — Hermes-inspired auto-learning agent.

Analyzes completed projects and iterations to extract developer preferences:
  - Preferred stack (frontend, backend, DB, etc.)
  - Naming conventions (camelCase, snake_case, etc.)
  - Recurring patterns (state management, routing, etc.)
  - Common errors and fixes
  - Code style preferences (comments language, structure, etc.)

Uses DeepSeek Flash (cheap/fast) for extraction.
"""

import json
import logging
from typing import Dict, Any, List

from .base import BaseAgent, MODEL_FLASH

logger = logging.getLogger(__name__)

MEMORY_EXTRACTION_PROMPT = """Tu es un assistant d'analyse de code qui extrait les préférences et habitudes d'un développeur à partir de ses projets.

Analyse le code fourni et extrais les informations suivantes sous forme de JSON:

{
  "stack": {
    "frontend": "framework et librairies utilisés (ex: React + TypeScript + Tailwind)",
    "backend": "framework backend (ex: FastAPI + Python)",
    "database": "base de données (ex: PostgreSQL)",
    "styling": "approche CSS (ex: Tailwind, CSS Modules, Styled Components)",
    "state": "gestion d'état (ex: Zustand, Redux, Context)",
    "build": "outils de build (ex: Vite, Webpack)"
  },
  "conventions": {
    "naming": "style de nommage (camelCase, snake_case, PascalCase)",
    "file_naming": "convention de nommage des fichiers (camelCase.ts, kebab-case.ts)",
    "comments_language": "langue des commentaires (français, anglais, mixte)",
    "indent": "style d'indentation (2 spaces, 4 spaces, tabs)",
    "quotes": "type de guillemets (single, double)"
  },
  "patterns": {
    "architecture": "pattern d'architecture (MVC, composants, microservices)",
    "error_handling": "approche gestion d'erreurs (try/catch global, error boundaries)",
    "api_style": "style d'API (REST, GraphQL, tRPC)",
    "imports": "style d'imports (relatifs, absolus, alias @/)"
  },
  "style": {
    "complexity": "complexité préférée (simple/minimal, intermédiaire, avancé)",
    "documentation": "niveau de documentation (minimal, modéré, détaillé)",
    "testing": "approche de test (aucun, unitaire, intégration, E2E)"
  }
}

RÈGLES:
- Retourne UNIQUEMENT le JSON, aucun texte avant/après
- N'invente rien — ne mets que ce qui est observable dans le code
- Si une information n'est pas déductible, omets la clé
- Sois précis et concret dans les valeurs
"""


class MemoryAgent(BaseAgent):
    """Agent d'apprentissage automatique des préférences développeur."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="memory",
            role="learning",
            description="Apprend les préférences développeur à partir des projets",
            deepseek_client=deepseek_client,
        )

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze code and extract developer preferences.

        Args:
            request: {
                "files": dict[path, content] — project files to analyze
                "project_name": str (optional)
            }

        Returns:
            {"entries": list[dict], "raw_profile": dict}
        """
        files = request.get("files", {})
        if not files:
            return {"entries": [], "raw_profile": {}}

        # Sample files — don't send everything, pick representative ones
        sampled = self._sample_files(files, max_files=15, max_chars=40000)
        files_content = "\n".join(
            f"── {path} ──\n{content}\n" for path, content in sampled.items()
        )

        model = self.resolve_model(MODEL_FLASH)
        logger.info(f"[MemoryAgent] Analyzing {len(sampled)} files with {model}")

        response = await self.call_deepseek(
            messages=[
                {"role": "system", "content": MEMORY_EXTRACTION_PROMPT},
                {"role": "user", "content": f"Analyse ces fichiers:\n\n{files_content}"},
            ],
            model=model,
            temperature=0.1,
            max_tokens=2048,
        )

        # Parse JSON response
        profile = self._parse_json_response(response)
        if not profile:
            logger.warning("[MemoryAgent] Failed to parse profile from AI response")
            return {"entries": [], "raw_profile": {}}

        # Convert to flat entries for DB storage
        entries = self._profile_to_entries(profile)
        logger.info(f"[MemoryAgent] Extracted {len(entries)} memory entries")

        return {
            "entries": entries,
            "raw_profile": profile,
            "tokens_used": self.tokens_used,
        }

    def _sample_files(
        self, files: Dict[str, str], max_files: int = 15, max_chars: int = 40000
    ) -> Dict[str, str]:
        """Sample representative files — configs first, then diverse code files."""
        priority_patterns = [
            "package.json", "tsconfig", "vite.config", "tailwind.config",
            "requirements.txt", "pyproject.toml", "Cargo.toml",
            ".eslintrc", ".prettierrc", "Dockerfile",
        ]

        sampled: Dict[str, str] = {}
        total_chars = 0

        # Priority files first
        for path, content in sorted(files.items()):
            if any(p in path.lower() for p in priority_patterns):
                truncated = content[:3000]
                sampled[path] = truncated
                total_chars += len(truncated)

        # Then diverse code files
        extensions_seen: set = set()
        for path, content in sorted(files.items()):
            if path in sampled or len(sampled) >= max_files:
                break
            if total_chars >= max_chars:
                break
            ext = path.rsplit(".", 1)[-1] if "." in path else ""
            if ext in ("map", "lock", "svg", "png", "ico"):
                continue
            # Prefer variety of file types
            truncated = content[:4000]
            sampled[path] = truncated
            total_chars += len(truncated)
            extensions_seen.add(ext)

        return sampled

    def _parse_json_response(self, response: str) -> dict:
        """Extract JSON from AI response, handling markdown code blocks."""
        text = response.strip()
        # Remove markdown code block wrapper
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:])
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to find JSON in the response
            import re
            match = re.search(r'\{[\s\S]*\}', text)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return {}

    def _profile_to_entries(self, profile: dict) -> List[dict]:
        """Convert nested profile dict to flat entries for DB storage."""
        entries = []
        for category, values in profile.items():
            if not isinstance(values, dict):
                continue
            if category not in ("stack", "conventions", "patterns", "errors", "preferences", "style"):
                continue
            for key, value in values.items():
                if value is None or value == "":
                    continue
                entries.append({
                    "category": category,
                    "key": key,
                    "value": value,
                    "confidence": 0.6,  # Auto-learned starts at 0.6
                })
        return entries
