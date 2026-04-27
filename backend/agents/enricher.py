"""
Agent Enrichisseur — Transforme une description vague en specification detaillee.

Quand un utilisateur ecrit "je veux vendre des cosmetiques, USA -> Niger",
cet agent genere une spec complete: pages, fonctionnalites, design, contenu, etc.
Le resultat est ensuite passe a l'Orchestrator pour planification.
"""

import logging
from typing import Dict, Any, List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)

# ── Instructions specifiques par type de projet ──
TYPE_INSTRUCTIONS: Dict[str, str] = {
    "web_app": """Pour une application web, detaille:
- Les pages principales (accueil, dashboard, profil, parametres...)
- Les fonctionnalites interactives (formulaires, filtres, recherche, notifications)
- Le design system (couleurs, typographie, layout responsive)
- L'authentification si necessaire
- Les composants reutilisables a creer""",

    "api_backend": """Pour une API/Backend, detaille:
- Les endpoints REST avec methodes HTTP et payloads
- Le schema de base de donnees (tables, relations)
- L'authentification et autorisation (JWT, OAuth...)
- La validation des donnees et gestion d'erreurs
- Les middleware necessaires (CORS, rate limiting, logging)""",

    "mobile": """Pour une app mobile, detaille:
- Les ecrans principaux et le flow de navigation
- Les composants natifs a utiliser
- Le stockage local vs API
- Les notifications push si pertinent
- Le design adapte mobile (bottom tabs, gestures, pull-to-refresh)""",

    "fullstack": """Pour un projet full-stack, detaille:
- Le frontend: pages, composants, routing
- Le backend: API endpoints, base de donnees, auth
- La communication frontend-backend
- Le deploiement (Docker, CI/CD)
- Les variables d'environnement""",

    "ecommerce": """Pour un site e-commerce, detaille:
- Le catalogue produits (categories, filtres, recherche, tri)
- Les fiches produit (images, description, prix, variantes, avis)
- Le panier et le checkout (etapes, recapitulatif, codes promo)
- Le paiement (Stripe, PayPal, ou mobile money selon la region)
- Les comptes utilisateurs (profil, commandes, adresses, favoris)
- Le tableau de bord vendeur si applicable
- Les emails transactionnels (confirmation, expedition, facture)
- Le design: hero banner, grille produits, call-to-action, footer
- La gestion des devises et livraison internationale si mentionne
- Le SEO et les meta tags pour chaque page""",

    "script": """Pour un script/outil, detaille:
- Les arguments CLI et options
- Le flow d'execution etape par etape
- La gestion des erreurs et le logging
- Les fichiers d'entree/sortie
- La configuration (fichier config ou env vars)""",

    "data": """Pour un projet Data/IA, detaille:
- Les sources de donnees et leur format
- Le pipeline de traitement (ETL)
- Les visualisations et dashboards
- Les modeles ML si applicable
- Le stockage et l'export des resultats""",

    "game": """Pour un jeu, detaille:
- Les mecaniques de gameplay
- Les ecrans (menu, jeu, pause, game over, scores)
- Les assets necessaires (sprites, sons, backgrounds)
- Le systeme de score et progression
- Les controles (clavier, tactile)""",
}


class EnricherAgent(BaseAgent):
    """Agent qui enrichit une description vague en specification detaillee."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="enricher",
            role="Product Manager",
            description="Transforme une idee vague en specification detaillee et actionnable",
            deepseek_client=deepseek_client,
        )

        self.system_prompt = """Tu es un Product Manager expert qui transforme des idees vagues en specifications detaillees pour des developpeurs.

Ton role: Prendre la description breve d'un utilisateur et la transformer en une specification complete, professionnelle et actionnable.

Regles:
1. GARDE l'intention originale de l'utilisateur — ne change pas son idee
2. ENRICHIS avec des details concrets: pages, fonctionnalites, design, contenu
3. ADAPTE au contexte mentionne (pays, langue, devise, public cible)
4. PROPOSE un design moderne et professionnel (couleurs, layout, typographie)
5. INCLUS des placeholder textes realistes (pas de "Lorem ipsum")
6. PENSE UX: navigation intuitive, responsive, accessibilite
7. SOIS CONCRET: au lieu de "une belle page", dis "hero section avec image plein ecran, titre en gras, sous-titre, et bouton CTA gradient bleu-violet"

Reponds en JSON:
{
    "enriched_description": "description complete et detaillee du projet",
    "pages": [
        {"name": "Accueil", "sections": ["hero", "produits populaires", "temoignages", "newsletter"], "description": "..."}
    ],
    "features": ["feature 1 detaillee", "feature 2 detaillee"],
    "design": {
        "style": "moderne, minimaliste, premium...",
        "colors": {"primary": "#hex", "secondary": "#hex", "accent": "#hex", "background": "#hex"},
        "typography": "Inter pour le texte, Playfair Display pour les titres",
        "layout": "description du layout general"
    },
    "content_suggestions": {
        "brand_name": "nom suggere si pas fourni",
        "tagline": "slogan suggere",
        "sample_products": ["si e-commerce, 3-5 exemples de produits avec prix"]
    },
    "tech_recommendations": ["techno 1", "techno 2"],
    "additional_requirements": ["requirement specifique au contexte"]
}"""

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enrichit la description utilisateur en spec detaillee.

        Args:
            request: Dict avec 'description', 'project_name', 'project_type', 'tech_stack'

        Returns:
            Specification enrichie
        """
        description = request.get("description", "")
        project_name = request.get("project_name", "mon_projet")
        project_type = request.get("project_type", "other")
        tech_stack = request.get("tech_stack", [])

        logger.info(f"[{self.name}] Enrichissement: {project_name} (type={project_type})")

        # Instructions specifiques au type
        type_guide = TYPE_INSTRUCTIONS.get(project_type, "")

        user_message = f"""Voici la demande d'un utilisateur pour creer un projet:

**Nom du projet**: {project_name}
**Type**: {project_type}
**Description de l'utilisateur**: {description}
**Technologies demandees**: {', '.join(tech_stack) if tech_stack else 'A determiner selon le type'}

{f"Instructions specifiques pour ce type de projet:{chr(10)}{type_guide}" if type_guide else ""}

Transforme cette description en une specification complete et detaillee.
Sois concret et specifique — le code sera genere directement a partir de ta spec.
Si l'utilisateur mentionne un contexte geographique ou culturel, adapte le contenu (langue, devise, design)."""

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message},
        ]

        try:
            response = await self.call_deepseek(
                messages=messages,
                temperature=0.7,
                max_tokens=3000,
                response_format={"type": "json_object"},
            )

            spec = self.parse_json_response(response)

            # Construire la description enrichie finale
            enriched = spec.get("enriched_description", description)

            # Ajouter les details de pages et features au texte
            pages = spec.get("pages", [])
            features = spec.get("features", [])
            design = spec.get("design", {})
            content = spec.get("content_suggestions", {})

            # Construire un prompt enrichi complet pour l'Orchestrator
            full_spec = f"""{enriched}

Pages principales:
{chr(10).join(f'- {p["name"]}: {p.get("description", "")}' for p in pages) if pages else '- A definir selon le type'}

Fonctionnalites:
{chr(10).join(f'- {f}' for f in features) if features else '- A definir'}

Design:
- Style: {design.get('style', 'moderne et professionnel')}
- Couleurs: primaire {design.get('colors', {}).get('primary', '#3B82F6')}, secondaire {design.get('colors', {}).get('secondary', '#8B5CF6')}
- Typographie: {design.get('typography', 'Inter')}
- Layout: {design.get('layout', 'responsive, mobile-first')}

{f'Contenu suggere: tagline "{content.get("tagline", "")}"' if content.get('tagline') else ''}
{f'Exemples produits: {", ".join(content.get("sample_products", []))}' if content.get('sample_products') else ''}"""

            return {
                "status": "success",
                "enriched_description": full_spec.strip(),
                "spec": spec,
                "tokens_used": self.tokens_used,
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur enrichissement: {e}")
            # Fallback: retourner la description originale
            return {
                "status": "fallback",
                "enriched_description": description,
                "spec": {},
                "tokens_used": self.tokens_used,
            }
