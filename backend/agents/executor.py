"""
Agent Exécuteur - Crée la structure du projet et écrit les fichiers sur disque.
"""

import logging
import asyncio
import os
from pathlib import Path
from typing import Dict, Any

from .base import BaseAgent

logger = logging.getLogger(__name__)


class ExecutorAgent(BaseAgent):
    """Agent qui exécute la création du projet sur disque."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="executor",
            role="DevOps Engineer",
            description="Crée la structure du projet et écrit les fichiers",
            deepseek_client=deepseek_client
        )

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Crée le projet sur disque avec structure et fichiers.

        Args:
            request: Dict contenant 'files', 'architecture', 'project_name'

        Returns:
            Résultat de l'exécution
        """
        files = request.get("files", {})
        architecture = request.get("architecture", {})
        project_name = request.get("project_name", "my_project")
        base_dir = request.get("base_dir", f"./projects/{project_name}")

        logger.info(f"[{self.name}] Exécution projet: {project_name} -> {base_dir}")

        created_files = []
        errors = []

        try:
            # Créer la structure de répertoires
            base_path = Path(base_dir).resolve()
            base_path.mkdir(parents=True, exist_ok=True)
            directories = architecture.get("structure", {}).get("directories", [])

            # Créer les répertoires (with path traversal check)
            for directory in directories:
                dir_path = (base_path / directory).resolve()
                # SECURITY: prevent path traversal (../)
                if not str(dir_path).startswith(str(base_path)):
                    logger.warning(f"Path traversal blocked: {directory}")
                    errors.append(f"Chemin invalide: {directory}")
                    continue
                try:
                    dir_path.mkdir(parents=True, exist_ok=True)
                    logger.debug(f"Répertoire créé: {dir_path}")
                except Exception as e:
                    logger.warning(f"Erreur création répertoire {directory}: {e}")

            # Écrire les fichiers (with path traversal check)
            for filepath, content in files.items():
                try:
                    file_path = (base_path / filepath).resolve()

                    # SECURITY: prevent path traversal
                    if not str(file_path).startswith(str(base_path)):
                        logger.warning(f"Path traversal blocked: {filepath}")
                        errors.append(f"Chemin invalide: {filepath}")
                        continue

                    # SECURITY: limit file size (10MB max)
                    if len(content) > 10_000_000:
                        errors.append(f"Fichier trop volumineux: {filepath}")
                        continue

                    # S'assurer que le répertoire parent existe
                    file_path.parent.mkdir(parents=True, exist_ok=True)

                    # Écrire le fichier
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(content)

                    created_files.append(filepath)
                    logger.info(f"Fichier écrit: {filepath}")

                except Exception as e:
                    error_msg = f"Erreur écriture {filepath}: {e}"
                    logger.error(error_msg)
                    errors.append(error_msg)

            # Générer un README
            try:
                await self._create_readme(base_path, project_name, architecture)
            except Exception as e:
                logger.warning(f"Erreur création README: {e}")

            # Générer un requirements.txt (si Python)
            try:
                await self._create_requirements(base_path, architecture)
            except Exception as e:
                logger.warning(f"Erreur création requirements.txt: {e}")

            logger.info(f"[{self.name}] Projet créé: {len(created_files)} fichiers")

            return {
                "status": "success" if not errors else "partial",
                "project_path": str(base_path),
                "files_created": created_files,
                "file_count": len(created_files),
                "errors": errors,
                "tokens_used": self.tokens_used
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur exécution: {e}")
            return {
                "status": "error",
                "error": str(e),
                "files_created": created_files,
                "errors": errors,
                "tokens_used": self.tokens_used
            }

    async def _create_readme(self, base_path: Path, project_name: str, architecture: Dict[str, Any]) -> None:
        """Crée un fichier README.md pour le projet."""
        readme_content = f"""# {project_name}

Projet généré automatiquement par ANZAR.

## Architecture

```
{str(architecture.get('architecture', {}))}
```

## Installation

1. Cloner le projet
2. Installer les dépendances
3. Configurer l'environnement

## Utilisation

[À compléter]

## Structure du projet

- `src/` - Code source
- `tests/` - Tests unitaires
- `docs/` - Documentation

Généré par ANZAR Backend
"""
        readme_path = base_path / "README.md"
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(readme_content)
        logger.info("README.md créé")

    async def _create_requirements(self, base_path: Path, architecture: Dict[str, Any]) -> None:
        """Crée un fichier requirements.txt pour Python."""
        dependencies = architecture.get("dependencies", {}).get("core", [])

        if not dependencies:
            return

        requirements_path = base_path / "requirements.txt"
        with open(requirements_path, "w", encoding="utf-8") as f:
            for dep in dependencies:
                f.write(f"{dep}\n")

        logger.info("requirements.txt créé")
