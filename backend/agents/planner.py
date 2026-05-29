"""
Agent Planificateur — Architecture et découpe de projet.

Transforme une description vague en spécification technique complète:
  - Enrichit la description (pages, features, design, contenu)
  - Planifie les tâches et phases
  - Définit l'architecture (structure fichiers, dépendances, design system)

Single-call: tout en 1 appel API pour minimiser les coûts.
"""

import logging
import json
from typing import Dict, Any, List, Optional

from .base import BaseAgent, MODEL_PRO

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT
# ────────────────────────────────────────────────────────────────────────────

PLANNER_SYSTEM_PROMPT = """Tu es un architecte logiciel senior avec 15 ans d'expérience en conception de systèmes.
Tu transformes des idées vagues en spécifications techniques complètes et actionnables.

En UNE SEULE réponse, tu dois:
1. ENRICHIR la description vague en spécification détaillée (pages, features, design, contenu réaliste)
2. PLANIFIER le projet (tâches ordonnées par priorité et dépendance)
3. DÉFINIR l'architecture complète (structure fichiers, dépendances, design system)

RÈGLES ABSOLUES:
- Préserve l'intention originale de l'utilisateur — enrichis sans dénaturer
- Sois CONCRET: pas "une belle page" mais "hero section avec image plein écran, titre gradient, CTA animé, stats en chiffres"
- Adapte au contexte géographique/culturel mentionné (langue, devise FCFA/EUR, design local)
- Pour un projet web: 15-30 fichiers (pages HTML + CSS + JS + assets + config)
- Pour un script/outil: 5-10 fichiers
- Pour une API: 10-20 fichiers (routes + models + middleware + config + tests)
- Pour un fullstack: 25-40 fichiers
- Le code sera généré DIRECTEMENT à partir de ta spec — chaque fichier doit avoir un "description" suffisamment détaillée pour qu'un développeur puisse l'écrire sans poser de questions
- Inclus TOUJOURS: fichiers principaux + config + styles + scripts + README.md

DESIGN SYSTEM:
- Définis des couleurs harmonieuses (primaire, secondaire, accent) avec des hex codes
- Spécifie la typographie (Google Fonts recommandé)
- Indique le style global (minimaliste, corporate, playful, dark, glassmorphism, etc.)

Réponds en JSON strict:
{
    "project_name": "nom_du_projet",
    "description": "Description enrichie et détaillée du projet (3-5 phrases)",
    "tasks": [
        {"task": "Description concrète de la tâche", "priority": "high|medium|low"}
    ],
    "architecture": {
        "frontend": {"framework": "vanilla|react|vue|svelte", "pages": ["page1", "page2"]},
        "backend": {"framework": "none|express|fastapi|flask", "endpoints": []},
        "design": {
            "style": "Description du style visuel",
            "colors": {"primary": "#hex", "secondary": "#hex", "accent": "#hex", "background": "#hex", "text": "#hex"},
            "fonts": "Font1, Font2, sans-serif"
        }
    },
    "structure": {
        "directories": ["src/", "styles/", "scripts/", "assets/"],
        "files": [
            {"path": "index.html", "description": "Description DÉTAILLÉE du contenu et de la structure", "type": "html"}
        ]
    },
    "dependencies": {"core": [], "dev": []},
    "setup_steps": ["Étape 1: ...", "Étape 2: ..."]
}"""

# Indices par type de projet
PROJECT_TYPE_HINTS = {
    "web_app": "Site web: pages principales, composants, responsive, SEO, favicon, meta tags",
    "api_backend": "API REST: endpoints CRUD, schéma DB, auth JWT, middleware erreur/logging, validation",
    "mobile": "Mobile: écrans principaux, navigation stack/tabs, stockage local, notifications push",
    "fullstack": "Full-stack: frontend (pages + composants) + backend (API + DB) + deploy config",
    "ecommerce": "E-commerce: catalogue produits, panier, checkout, paiement (Stripe/PayPal), comptes utilisateurs, admin",
    "script": "Script/CLI: arguments, flow d'exécution, I/O fichiers, logging, error handling",
    "data": "Data/IA: pipeline ETL, visualisation (charts), modèles ML, notebooks, config",
    "game": "Jeu: gameplay loop, écrans (menu, jeu, score), assets, contrôles clavier/tactile, audio",
    "landing": "Landing page: hero section, features, témoignages, pricing, CTA, footer, SEO",
    "dashboard": "Dashboard: sidebar nav, widgets/cartes KPI, graphiques, tableau de données, filtres",
    "portfolio": "Portfolio: hero, projets grid, about, contact form, responsive, animations",
    "blog": "Blog: liste articles, article detail, catégories, recherche, pagination, RSS",
}


class PlannerAgent(BaseAgent):
    """Agent architecte — transforme une idée en plan technique complet."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="planner",
            role="Architecte Logiciel",
            description="Transforme une description de projet en architecture technique complète",
            deepseek_client=deepseek_client,
        )

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Planifie un projet complet en un seul appel API.

        Args:
            request: {
                "project_name": str,
                "description": str,
                "project_type": str,      # "web_app" | "api_backend" | "fullstack" | etc.
                "tech_stack": list[str],   # ["React", "Node.js", "PostgreSQL"]
                "requirements": list[str], # Exigences spécifiques
            }

        Returns:
            {
                "status": "success",
                "title": str,
                "overview": str,
                "files": list,
                "phases": list,
                "architecture": dict,
                "tokens_used": int,
            }
        """
        project_name = request.get("project_name", "mon_projet")
        description = request.get("description", "")
        project_type = request.get("project_type", "other")
        tech_stack = request.get("tech_stack", [])
        requirements = request.get("requirements", [])

        logger.info(f"[{self.name}] Planification: {project_name} ({project_type})")

        if not description:
            return {
                "status": "error",
                "error": "Description du projet requise",
                "tokens_used": self.tokens_used,
            }

        # Construire le message utilisateur enrichi
        type_hint = PROJECT_TYPE_HINTS.get(project_type, "")
        tech_str = ", ".join(tech_stack) if tech_stack else "À déterminer selon le projet"
        req_str = ", ".join(requirements) if requirements else "Aucune exigence spécifique"

        user_message = (
            f"Projet: {project_name}\n"
            f"Type: {project_type}{f' ({type_hint})' if type_hint else ''}\n"
            f"Description: {description}\n"
            f"Technologies: {tech_str}\n"
            f"Exigences: {req_str}\n\n"
            "Génère le plan complet avec architecture et structure de fichiers."
        )

        messages = [
            {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ]

        try:
            raw_text = await self.call_deepseek(
                messages=messages,
                model=self.resolve_model(MODEL_PRO),
                temperature=0.7,
                max_tokens=16000,  # V4: plans détaillés pour projets complexes
                response_format={"type": "json_object"},
            )

            # Parser la réponse JSON
            combined = self.parse_json_response(raw_text)

            # Extraire les fichiers
            files_list = combined.get("structure", {}).get("files", [])
            if not files_list:
                files_list = combined.get("files", [])

            # Construire le résultat normalisé
            result = {
                "status": "success",
                "title": combined.get("project_name", project_name),
                "overview": combined.get("description", description),
                "files": [
                    {
                        "path": f.get("path", ""),
                        "description": f.get("description", ""),
                        "type": f.get("type", ""),
                    }
                    for f in files_list
                ],
                "phases": [
                    {
                        "name": t.get("task", ""),
                        "description": t.get("task", ""),
                        "duration": "",
                        "tasks": [t.get("task", "")],
                    }
                    for t in combined.get("tasks", [])
                ],
                "complexity": self._estimate_complexity(files_list, combined),
                "notes": "",
                "architecture": {
                    "structure": combined.get("structure", {"files": files_list}),
                    "architecture": combined.get("architecture", {}),
                    "dependencies": combined.get("dependencies", {}),
                },
                "setup_steps": combined.get("setup_steps", []),
                "tokens_used": self.tokens_used,
            }

            logger.info(
                f"[{self.name}] Plan terminé: {len(result['files'])} fichiers, "
                f"complexité {result['complexity']}"
            )

            return result

        except Exception as e:
            logger.error(f"[{self.name}] Erreur planification: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used,
            }

    @staticmethod
    def _estimate_complexity(
        files: List[Dict], combined: Dict[str, Any]
    ) -> str:
        """Estime la complexité du projet selon le nombre de fichiers et la structure."""
        n = len(files)
        has_backend = bool(combined.get("architecture", {}).get("backend", {}).get("framework"))
        has_db = any(
            "database" in str(f).lower() or "model" in str(f).lower()
            for f in files
        )

        if n <= 5:
            return "simple"
        if n <= 15 and not has_backend:
            return "medium"
        if n > 25 or (has_backend and has_db):
            return "complex"
        return "medium"
