"""
Agent Recherche Web — Recherche internet + synthèse intelligente.

Pipeline:
  1. Analyse la question → génère des requêtes de recherche optimisées
  2. Exécute les recherches via Serper (Google)
  3. Synthétise les résultats avec DeepSeek
  4. Retourne une réponse structurée avec sources

Coût: 1 appel Serper (gratuit ou $0.0003) + 1 appel DeepSeek pour la synthèse.
"""

import logging
import json
from typing import Dict, Any, List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)

SYNTHESIZER_PROMPT = """Tu es un assistant de recherche expert. Tu synthétises des résultats de recherche web en réponses claires et complètes.

RÈGLES:
1. STRUCTURÉ: Réponds de manière organisée avec des sections claires
2. SOURCÉ: Cite tes sources entre crochets [Source: titre] quand tu utilises une information
3. OBJECTIF: Présente les faits sans biais, mentionne les différentes perspectives si pertinent
4. COMPLET: Couvre tous les aspects pertinents de la question
5. CONCIS: Reste informatif sans être verbeux (300-500 mots max)
6. HONNÊTE: Si les résultats ne répondent pas bien à la question, dis-le clairement
7. ACTUEL: Privilégie les informations les plus récentes

FORMAT:
- Réponse principale en paragraphes clairs
- Sources numérotées à la fin
- Si pertinent: tableau comparatif, liste de points clés, ou timeline"""


class WebSearchAgent(BaseAgent):
    """Agent qui recherche sur le web et synthétise les résultats."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="web_search",
            role="Chercheur Web",
            description="Recherche sur internet et synthétise les résultats",
            deepseek_client=deepseek_client,
        )
        self._search_fn = None
        self._format_fn = None
        self._init_search()

    def _init_search(self):
        """Charge le service de recherche web."""
        try:
            from services.web_search import search_web, format_search_results
            self._search_fn = search_web
            self._format_fn = format_search_results
            logger.info(f"[{self.name}] Service Serper connecté")
        except ImportError:
            logger.warning(f"[{self.name}] Service web_search non disponible")

    @property
    def is_available(self) -> bool:
        """True si le service de recherche est disponible."""
        return self._search_fn is not None

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Recherche et synthétise.

        Args:
            request: {
                "query": str,          # Question de l'utilisateur
                "num_results": int,    # Nombre de résultats (défaut: 5)
                "language": str,       # "fr" | "en" (défaut: "fr")
                "mode": str,           # "search_only" | "synthesize" (défaut: "synthesize")
            }

        Returns:
            {
                "status": "success",
                "synthesis": str,       # Synthèse en markdown
                "results": list,        # Résultats bruts
                "query": str,
                "tokens_used": int,
            }
        """
        query = request.get("query", "")
        num_results = request.get("num_results", 5)
        language = request.get("language", "fr")
        mode = request.get("mode", "synthesize")

        logger.info(f"[{self.name}] Recherche: '{query[:80]}...'")

        if not query or len(query.strip()) < 3:
            return {
                "status": "error",
                "error": "Requête trop courte",
                "tokens_used": self.tokens_used,
            }

        if not self.is_available:
            return {
                "status": "error",
                "error": "Service de recherche web non configuré (SERPER_API_KEY manquante)",
                "tokens_used": self.tokens_used,
            }

        try:
            # Step 1: Rechercher
            search_data = await self._search_fn(
                query=query,
                num_results=min(num_results, 10),
                language=language,
            )

            results = search_data.get("results", [])
            search_summary = search_data.get("summary", "")
            search_error = search_data.get("error")

            if search_error:
                return {
                    "status": "error",
                    "error": f"Erreur de recherche: {search_error}",
                    "tokens_used": self.tokens_used,
                }

            if not results:
                return {
                    "status": "success",
                    "synthesis": f"Aucun résultat trouvé pour: {query}",
                    "results": [],
                    "query": query,
                    "tokens_used": self.tokens_used,
                }

            # Step 2: Mode search_only → retourner les résultats bruts
            if mode == "search_only":
                formatted = self._format_fn(search_data) if self._format_fn else str(results)
                return {
                    "status": "success",
                    "synthesis": formatted,
                    "results": results,
                    "summary": search_summary,
                    "query": query,
                    "tokens_used": self.tokens_used,
                }

            # Step 3: Synthétiser avec DeepSeek
            synthesis = await self._synthesize(query, results, search_summary, language)

            return {
                "status": "success",
                "synthesis": synthesis,
                "results": results,
                "summary": search_summary,
                "query": query,
                "tokens_used": self.tokens_used,
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used,
            }

    async def _synthesize(
        self,
        query: str,
        results: List[Dict[str, str]],
        summary: str,
        language: str,
    ) -> str:
        """Synthétise les résultats de recherche en une réponse cohérente."""
        # Formater les résultats pour le LLM
        results_text = "\n\n".join(
            f"[{i+1}] {r.get('title', 'Sans titre')}\n"
            f"    URL: {r.get('url', '')}\n"
            f"    Extrait: {r.get('snippet', '')}"
            for i, r in enumerate(results)
        )

        summary_line = f"\nRéponse rapide Google: {summary}" if summary else ""

        lang_instruction = "Réponds en français." if language == "fr" else "Answer in English."

        user_message = (
            f"Question de l'utilisateur: {query}\n\n"
            f"Résultats de recherche Google:{summary_line}\n\n"
            f"{results_text}\n\n"
            f"Synthétise ces résultats pour répondre à la question. {lang_instruction}"
        )

        messages = [
            {"role": "system", "content": SYNTHESIZER_PROMPT},
            {"role": "user", "content": user_message},
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.4,
            max_tokens=2048,
        )

        logger.info(f"[{self.name}] Synthèse générée ({len(response)} chars)")
        return response
