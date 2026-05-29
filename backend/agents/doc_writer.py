"""
Agent Documentation — Génération automatique de docs techniques.

Capacités:
  - README.md complet (badges, installation, usage, API, contribution)
  - Documentation API (endpoints, paramètres, exemples)
  - Guides d'installation et de déploiement
  - Changelogs et release notes
  - Commentaires de code et docstrings

Un seul appel DeepSeek par document.
"""

import logging
from typing import Dict, Any, List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPTS
# ────────────────────────────────────────────────────────────────────────────

PROMPT_README = """Tu es un expert en documentation open-source. Tu rédiges des README.md de qualité professionnelle.

STRUCTURE OBLIGATOIRE:
1. **Titre** avec emoji pertinent + badge(s) (version, licence, statut)
2. **Description** — 2-3 phrases claires sur ce que fait le projet
3. **Fonctionnalités** — liste des features clés
4. **Prérequis** — versions exactes (Node 18+, Python 3.11+, etc.)
5. **Installation** — commandes copier-coller qui marchent du premier coup
6. **Usage** — exemples de code concrets et fonctionnels
7. **Configuration** — variables d'environnement, fichiers de config
8. **Structure du projet** — arborescence des fichiers importants
9. **API Reference** (si applicable) — endpoints avec méthodes, paramètres, réponses
10. **Contribution** — workflow PR, conventions de commit
11. **Licence** — type de licence

RÈGLES:
- Toutes les commandes doivent être dans des blocs ```bash
- Les exemples de code doivent être FONCTIONNELS
- Pas de liens morts ou de placeholders — si tu ne connais pas l'URL, ne mets pas de lien
- Adapte le ton au type de projet (sérieux pour une lib, friendly pour un outil CLI)
- Tables pour les comparaisons, endpoints, variables d'env"""

PROMPT_API_DOC = """Tu es un expert en documentation d'API REST. Tu rédiges une doc claire et complète.

POUR CHAQUE ENDPOINT:
- Méthode HTTP + URL
- Description courte
- Paramètres (path, query, body) avec types et descriptions
- Headers requis (auth, content-type)
- Réponse success (status code + body JSON exemple)
- Réponses d'erreur (status codes + messages)
- Exemple curl ou fetch

FORMAT:
```
### GET /api/users/:id
Récupère un utilisateur par ID.

**Paramètres**
| Param | Type   | In   | Description        |
|-------|--------|------|--------------------|
| id    | string | path | ID de l'utilisateur |

**Headers**
| Header        | Valeur           |
|---------------|------------------|
| Authorization | Bearer {token}   |

**Réponse 200**
```json
{"id": "usr_123", "name": "Alice", "email": "alice@example.com"}
```

**Erreurs**
| Status | Description            |
|--------|------------------------|
| 404    | Utilisateur non trouvé |
| 401    | Token invalide         |
```"""

PROMPT_CHANGELOG = """Tu es un rédacteur technique. Tu rédiges des changelogs clairs selon le format Keep a Changelog.

FORMAT:
## [version] - YYYY-MM-DD
### Added
- Nouvelles fonctionnalités

### Changed
- Modifications de fonctionnalités existantes

### Fixed
- Corrections de bugs

### Removed
- Fonctionnalités supprimées

### Security
- Corrections de sécurité

RÈGLES:
- Chaque entrée commence par un verbe à l'infinitif
- Sois spécifique: pas "Améliorations diverses" mais "Réduction du temps de chargement de la page d'accueil de 3.2s à 0.8s"
- Classe par importance (breaking changes en premier)
- Mentionne les issues/PR liées si disponibles"""

PROMPT_GUIDE = """Tu es un rédacteur technique expert. Tu rédiges des guides d'installation et de déploiement.

STRUCTURE:
1. **Prérequis** — tout ce qu'il faut installer/configurer avant de commencer
2. **Étapes** — numérotées, avec commandes copier-coller
3. **Configuration** — chaque variable d'environnement expliquée
4. **Vérification** — comment vérifier que tout fonctionne
5. **Dépannage** — problèmes courants et solutions

RÈGLES:
- Chaque commande dans un bloc ```bash
- Indiquer l'OS si les commandes diffèrent (Linux/macOS/Windows)
- Screenshots ou sorties attendues après les étapes critiques
- Liens vers la doc officielle pour les dépendances"""


class DocWriterAgent(BaseAgent):
    """Agent documentation — génère des docs techniques automatiquement."""

    MODES = {
        "readme": PROMPT_README,
        "api": PROMPT_API_DOC,
        "changelog": PROMPT_CHANGELOG,
        "guide": PROMPT_GUIDE,
    }

    MODE_MAX_TOKENS = {
        "readme": 4000,
        "api": 5000,
        "changelog": 2000,
        "guide": 3500,
    }

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="doc_writer",
            role="Rédacteur Technique",
            description="Génère de la documentation technique de qualité professionnelle",
            deepseek_client=deepseek_client,
        )

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Génère un document technique.

        Args:
            request: {
                "mode": "readme" | "api" | "changelog" | "guide",
                "project_name": str,
                "description": str,
                "code": str,           # Code source à documenter (optionnel)
                "files": list,         # Liste des fichiers du projet (optionnel)
                "context": str,        # Contexte additionnel (optionnel)
                "language": str,       # "fr" | "en" (défaut: "fr")
            }

        Returns:
            {
                "status": "success",
                "document": str,        # Document markdown
                "mode": str,
                "tokens_used": int,
            }
        """
        mode = request.get("mode", "readme")
        project_name = request.get("project_name", "")
        description = request.get("description", "")
        code = request.get("code", "")
        files = request.get("files", [])
        context = request.get("context", "")
        language = request.get("language", "fr")

        if mode not in self.MODES:
            return {
                "status": "error",
                "error": f"Mode inconnu: {mode}. Disponibles: {list(self.MODES.keys())}",
                "tokens_used": self.tokens_used,
            }

        logger.info(f"[{self.name}] Génération {mode}: {project_name or '(sans nom)'}")

        # Construire le message utilisateur
        parts = []
        if project_name:
            parts.append(f"Projet: {project_name}")
        if description:
            parts.append(f"Description: {description}")
        if files:
            files_str = "\n".join(
                f"- {f.get('path', f) if isinstance(f, dict) else f}"
                for f in files[:30]
            )
            parts.append(f"Fichiers du projet:\n{files_str}")
        if code:
            parts.append(f"Code source:\n```\n{code[:4000]}\n```")
        if context:
            parts.append(f"Contexte: {context}")

        lang_note = "Rédige en français." if language == "fr" else "Write in English."
        parts.append(lang_note)

        user_message = "\n\n".join(parts)

        messages = [
            {"role": "system", "content": self.MODES[mode]},
            {"role": "user", "content": user_message},
        ]

        try:
            response = await self.call_deepseek(
                messages=messages,
                temperature=0.5,
                max_tokens=self.MODE_MAX_TOKENS.get(mode, 4000),
            )

            return {
                "status": "success",
                "document": response,
                "mode": mode,
                "tokens_used": self.tokens_used,
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur {mode}: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used,
            }
