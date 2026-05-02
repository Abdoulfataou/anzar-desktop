"""
Agent Correcteur Étudiant - Pipeline intelligent de correction avec analyse détaillée.
Analyse, catégorise, corrige le texte et génère suggestions d'amélioration.
"""

import logging
import re
from typing import Dict, Any, List

from .base import BaseAgent

logger = logging.getLogger(__name__)


class StudentCorrectorAgent(BaseAgent):
    """Agent spécialisé dans la correction intelligente avec feedback détaillé."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="student_corrector",
            role="Correcteur Académique",
            description="Corrige les textes avec analyse détaillée et suggestions pédagogiques",
            deepseek_client=deepseek_client
        )

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Exécute le pipeline de correction intelligente.

        Args:
            request: {
                "text": str,                # Texte à corriger
                "correction_type": str,     # "langue" | "reformulation" | "academique" | "tout"
                "level": str,               # Niveau académique (optionnel)
                "messages": list,           # Historique de conversation
            }

        Returns:
            {
                "status": "success",
                "corrected_text": str,      # Texte corrigé avec annotations
                "analysis": {
                    "error_count": int,
                    "error_categories": dict,
                    "score": float,         # /20
                    "level_detected": str,
                },
                "suggestions": list,        # Conseils d'amélioration
                "tokens_used": int,
            }
        """
        text = request.get("text", "")
        correction_type = request.get("correction_type", "tout")
        level = request.get("level", "Licence")
        messages = request.get("messages", [])

        logger.info(f"[{self.name}] Démarrage correction - Type: {correction_type}")

        if not text or len(text.strip()) < 10:
            logger.warning(f"[{self.name}] Texte trop court")
            return {
                "status": "error",
                "error": "Texte trop court pour correction",
                "tokens_used": self.tokens_used
            }

        try:
            # Step 1: Analyser la qualité du texte
            logger.debug(f"[{self.name}] Step 1: Analyse de qualité")
            analysis = await self._analyze_text_quality(text, level, correction_type)

            # Step 2: Catégoriser les erreurs
            logger.debug(f"[{self.name}] Step 2: Catégorisation des erreurs")
            error_categories = await self._categorize_errors(text, correction_type, level)

            # Step 3: Appliquer les corrections avec explications
            logger.debug(f"[{self.name}] Step 3: Application des corrections")
            corrected_text = await self._apply_corrections(text, correction_type, level)

            # Step 4: Générer score de qualité /20
            logger.debug(f"[{self.name}] Step 4: Calcul du score")
            score = await self._calculate_score(analysis, error_categories)

            # Step 5: Générer suggestions d'amélioration
            logger.debug(f"[{self.name}] Step 5: Génération des suggestions")
            suggestions = await self._generate_suggestions(text, analysis, error_categories, level)

            return {
                "status": "success",
                "corrected_text": corrected_text,
                "analysis": {
                    "error_count": error_categories.get("total_errors", 0),
                    "error_categories": error_categories.get("categories", {}),
                    "score": score,
                    "level_detected": analysis.get("level_detected", level),
                    "quality_metrics": analysis.get("metrics", {}),
                },
                "suggestions": suggestions,
                "tokens_used": self.tokens_used,
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur dans le pipeline: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used
            }

    async def _analyze_text_quality(
        self,
        text: str,
        level: str,
        correction_type: str
    ) -> Dict[str, Any]:
        """Étape 1: Analyser les aspects de qualité."""

        type_focus = {
            "langue": "orthographe, grammaire, conjugaison, ponctuation",
            "reformulation": "clarté, concision, style, fluidité, redondances",
            "academique": "structure, rigueur logique, citations, vocabulaire académique, argument",
            "tout": "tous les aspects"
        }

        system_prompt = f"""Tu es un expert en analyse textuelle académique. Analyse ce texte sur:
{type_focus.get(correction_type, 'tous les aspects')}

Niveau supposé: {level}

Identifie:
- La clarté globale (0-100)
- La structure logique (0-100)
- Le niveau académique du langage (0-100)
- La fluidité/lisibilité (0-100)
- Les redondances ou digressions
- Le ton et le registre

Réponds en JSON:
{{
    "metrics": {{
        "clarity": 0,
        "structure": 0,
        "academic_level": 0,
        "fluidity": 0,
        "redundancy": "absent|faible|modéré|élevé"
    }},
    "level_detected": "Lycée|Licence|Master",
    "observations": "Observations générales sur la qualité"
}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Texte à analyser:\n\n{text[:2000]}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.3,
            max_tokens=1024
        )

        try:
            result = self.parse_json_response(response)
            logger.debug(f"[{self.name}] Analyse complétée")
            return result
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur parsing analyse: {e}")
            return {
                "metrics": {"clarity": 60, "structure": 60, "academic_level": 60, "fluidity": 60},
                "level_detected": level,
                "observations": "Analyse échouée"
            }

    async def _categorize_errors(
        self,
        text: str,
        correction_type: str,
        level: str
    ) -> Dict[str, Any]:
        """Étape 2: Catégoriser les erreurs détectées."""

        system_prompt = f"""Tu es un correcteur académique expert. Catégorise TOUS les erreurs dans ce texte.

Type de correction: {correction_type}

Catégories selon le type:
- Si "langue": orthographe, grammaire, conjugaison, ponctuation, syntaxe
- Si "reformulation": redondance, clarté, concision, style
- Si "academique": rigueur, logique, citations manquantes, vocabulaire
- Si "tout": combiner toutes les catégories

Pour chaque erreur, fournis:
- position approximative (début, milieu, fin, "ligne X")
- type exact
- sévérité (légère, modérée, grave)

Réponds en JSON:
{{
    "categories": {{
        "orthographe": {{"count": 0, "examples": ["erreur 1", ...]}},
        "grammaire": {{"count": 0, "examples": [...]}},
        ...
    }},
    "total_errors": 0,
    "severity_breakdown": {{
        "legere": 0,
        "moderee": 0,
        "grave": 0
    }}
}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Texte à analyser:\n\n{text[:2000]}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.3,
            max_tokens=2048
        )

        try:
            result = self.parse_json_response(response)
            logger.debug(f"[{self.name}] Erreurs catégorisées: {result.get('total_errors', 0)}")
            return result
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur parsing catégorisation: {e}")
            return {
                "categories": {},
                "total_errors": 0,
                "severity_breakdown": {"legere": 0, "moderee": 0, "grave": 0}
            }

    async def _apply_corrections(
        self,
        text: str,
        correction_type: str,
        level: str
    ) -> str:
        """Étape 3: Appliquer les corrections avec format annotations."""

        type_guidance = {
            "langue": "Corrige orthographe, grammaire, conjugaison, ponctuation",
            "reformulation": "Reformule pour plus de clarté, concision et fluidité",
            "academique": "Renforce le langage académique et la structure logique",
            "tout": "Corrige tous les aspects — langue, clarté, rigueur académique"
        }

        system_prompt = f"""Tu es un correcteur pédagogique. Fournis le texte COMPLÈTEMENT CORRIGÉ avec annotations.

Correction type: {type_guidance.get(correction_type, 'tout')}
Niveau: {level}

Format des corrections:
- ~~texte original~~ → **texte corrigé** [EXPLICATION COURTE]

Exemple:
"C'est ~~une problématique importante~~ → **un enjeu majeur** [Langage plus académique]"

Important:
- Préserve le sens et l'intention de l'auteur
- Sois pédagogue dans tes explications
- Corrige COMPLÈTEMENT le texte
- Utilise le format ~~ancien~~ → **nouveau** pour chaque correction
- Ajoute des explications brèves entre crochets

Fournis le texte corrigé complet:"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Texte à corriger:\n\n{text}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.3,
            max_tokens=4096
        )

        logger.debug(f"[{self.name}] Corrections appliquées")
        return response

    async def _calculate_score(
        self,
        analysis: Dict[str, Any],
        error_categories: Dict[str, Any]
    ) -> float:
        """Étape 4: Calculer un score de qualité /20."""

        metrics = analysis.get("metrics", {})
        total_errors = error_categories.get("total_errors", 0)
        severity = error_categories.get("severity_breakdown", {})

        # Base: moyenne des métriques
        clarity = metrics.get("clarity", 50) / 100
        structure = metrics.get("structure", 50) / 100
        academic = metrics.get("academic_level", 50) / 100
        fluidity = metrics.get("fluidity", 50) / 100

        base_score = (clarity + structure + academic + fluidity) / 4 * 20

        # Pénalité erreurs
        grave_penalty = severity.get("grave", 0) * 2
        moderee_penalty = severity.get("moderee", 0) * 1
        legere_penalty = severity.get("legere", 0) * 0.3

        total_penalty = grave_penalty + moderee_penalty + legere_penalty
        final_score = max(0, base_score - total_penalty)

        logger.debug(f"[{self.name}] Score calculé: {final_score:.1f}/20")
        return round(final_score, 1)

    async def _generate_suggestions(
        self,
        text: str,
        analysis: Dict[str, Any],
        error_categories: Dict[str, Any],
        level: str
    ) -> List[Dict[str, str]]:
        """Étape 5: Générer des suggestions d'amélioration pédagogiques."""

        metrics = analysis.get("metrics", {})
        categories = error_categories.get("categories", {})

        system_prompt = f"""Tu es un tuteur académique. Génère 3-5 suggestions SPÉCIFIQUES et PÉDAGOGIQUES pour améliorer ce texte.

Niveau: {level}
Métriques actuelles:
- Clarté: {metrics.get('clarity', 60)}/100
- Structure: {metrics.get('structure', 60)}/100
- Langue académique: {metrics.get('academic_level', 60)}/100
- Fluidité: {metrics.get('fluidity', 60)}/100

Erreurs principales: {str(categories)[:500]}

Crée des suggestions qui:
1. Ciblent les faiblesses principales
2. Sont SPÉCIFIQUES (pas génériques)
3. Sont CONSTRUCTIVES et encourageantes
4. Expliquent le "pourquoi"
5. Donnent un exemple concret si pertinent

Réponds en JSON:
{{
    "suggestions": [
        {{"priority": "haute|moyenne|basse", "category": "categorie", "suggestion": "texte", "example": "exemple concret"}},
        ...
    ]
}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Texte analysé:\n\n{text[:1500]}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.5,
            max_tokens=1500
        )

        try:
            result = self.parse_json_response(response)
            suggestions = result.get("suggestions", [])
            logger.debug(f"[{self.name}] Suggestions générées: {len(suggestions)}")
            return suggestions
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur parsing suggestions: {e}")
            return []
