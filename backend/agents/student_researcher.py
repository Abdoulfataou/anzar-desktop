"""
Agent Chercheur Étudiant - Pipeline de recherche documentaire avec synthèse et bibliographie.
Explore le web (si disponible), analyse sources, synthétise et formate bibliographie.
"""

import logging
from typing import Dict, Any, List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)


class StudentResearcherAgent(BaseAgent):
    """Agent spécialisé dans la recherche documentaire et la synthèse académique."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="student_researcher",
            role="Chercheur Documentaire",
            description="Effectue des recherches documentaires et génère des synthèses avec bibliographie formattée",
            deepseek_client=deepseek_client
        )
        self.web_search_available = False
        self._check_web_search_availability()

    def _check_web_search_availability(self):
        """Vérifie si le service web_search est disponible."""
        try:
            from services.web_search import web_search_tool
            self.web_search_available = True
            self.web_search_tool = web_search_tool
            logger.info(f"[{self.name}] Service web_search disponible")
        except ImportError:
            logger.warning(f"[{self.name}] Service web_search non disponible, utiliserai les connaissances LLM")
            self.web_search_available = False

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Exécute le pipeline de recherche documentaire.

        Args:
            request: {
                "query": str,               # Question de recherche
                "depth": str,               # "basic" | "detailed" | "exhaustive"
                "citation_style": str,      # "apa" | "mla" | "chicago" | "harvard"
                "language": str,            # "fr" | "en"
                "messages": list,           # Historique de conversation
            }

        Returns:
            {
                "status": "success",
                "synthesis": str,           # Synthèse markdown avec citations
                "sources": list,            # Sources trouvées
                "bibliography": str,        # Bibliographie formatée
                "key_findings": list,       # Points clés
                "tokens_used": int,
            }
        """
        query = request.get("query", "")
        depth = request.get("depth", "detailed")
        citation_style = request.get("citation_style", "apa")
        language = request.get("language", "fr")
        messages = request.get("messages", [])

        logger.info(f"[{self.name}] Démarrage recherche - Profondeur: {depth}")

        if not query or len(query.strip()) < 5:
            logger.warning(f"[{self.name}] Requête trop courte")
            return {
                "status": "error",
                "error": "Requête de recherche insuffisante",
                "tokens_used": self.tokens_used
            }

        try:
            # Step 1: Comprendre la question de recherche
            logger.debug(f"[{self.name}] Step 1: Analyse de la requête")
            research_brief = await self._understand_research_question(
                query, depth, language
            )

            # Step 2: Rechercher les sources
            logger.debug(f"[{self.name}] Step 2: Recherche des sources")
            sources = await self._search_sources(
                query, depth, language, research_brief
            )

            # Step 3: Analyser et recouper les sources
            logger.debug(f"[{self.name}] Step 3: Analyse et recoupement")
            analyzed_sources = await self._analyze_and_crossreference(
                sources, query, language
            )

            # Step 4: Synthétiser les résultats
            logger.debug(f"[{self.name}] Step 4: Synthèse des résultats")
            synthesis = await self._synthesize_findings(
                analyzed_sources, query, language, research_brief
            )

            # Step 5: Générer la bibliographie formatée
            logger.debug(f"[{self.name}] Step 5: Génération de la bibliographie")
            bibliography = await self._generate_bibliography(
                analyzed_sources, citation_style, language
            )

            # Extraire les points clés
            key_findings = await self._extract_key_findings(
                synthesis, language
            )

            return {
                "status": "success",
                "synthesis": synthesis,
                "sources": analyzed_sources,
                "bibliography": bibliography,
                "key_findings": key_findings,
                "research_brief": research_brief,
                "tokens_used": self.tokens_used,
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur dans le pipeline: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used
            }

    async def _understand_research_question(
        self,
        query: str,
        depth: str,
        language: str
    ) -> Dict[str, Any]:
        """Étape 1: Analyser et clarifier la requête de recherche."""

        depth_context = {
            "basic": "Recherche introductive avec sources principales",
            "detailed": "Recherche approfondie avec sources académiques et pratiques",
            "exhaustive": "Recherche exhaustive avec littérature grise et sources spécialisées"
        }

        system_prompt = f"""Tu es un expert en recherche académique. Analyse cette question de recherche.

Profondeur recherchée: {depth} ({depth_context.get(depth, '')})
Langue: {'Français' if language == 'fr' else 'Anglais'}

Détermine:
- Les concepts clés
- Les angles d'approche pertinents
- Les sources types à chercher (académiques, pratiques, officielles, etc.)
- Les mots-clés de recherche optimisés
- Les potentiels biais ou limites

Réponds en JSON:
{{
    "key_concepts": ["concept1", "concept2", ...],
    "angles": ["angle1", "angle2", ...],
    "source_types": ["type1", "type2", ...],
    "search_keywords": ["mot1", "mot2", ...],
    "constraints": "Limitations éventuelles ou biais à éviter"
}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Question de recherche: {query}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.5,
            max_tokens=1024
        )

        try:
            result = self.parse_json_response(response)
            logger.debug(f"[{self.name}] Requête analysée")
            return result
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur parsing requête: {e}")
            return {
                "key_concepts": query.split()[:3],
                "angles": [],
                "source_types": ["académique", "pratique"],
                "search_keywords": query.split(),
                "constraints": ""
            }

    async def _search_sources(
        self,
        query: str,
        depth: str,
        language: str,
        research_brief: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Étape 2: Chercher les sources via web_search ou LLM knowledge."""

        if self.web_search_available:
            logger.debug(f"[{self.name}] Recherche web activée")
            return await self._web_search_sources(query, depth, research_brief)
        else:
            logger.debug(f"[{self.name}] Utilisation des connaissances LLM")
            return await self._llm_knowledge_sources(query, depth, language, research_brief)

    async def _web_search_sources(
        self,
        query: str,
        depth: str,
        research_brief: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Chercher les sources via l'API web_search."""
        keywords = research_brief.get("search_keywords", [query])
        search_queries = keywords[:3] if depth == "basic" else keywords[:5]

        sources = []
        try:
            for search_term in search_queries:
                try:
                    results = await self.web_search_tool(search_term, num_results=5)
                    for result in results:
                        sources.append({
                            "title": result.get("title", ""),
                            "url": result.get("url", ""),
                            "snippet": result.get("snippet", ""),
                            "source_type": "web",
                            "relevance": 0.8
                        })
                except Exception as e:
                    logger.warning(f"[{self.name}] Erreur recherche '{search_term}': {e}")
                    continue

            logger.debug(f"[{self.name}] {len(sources)} sources trouvées")
            return sources
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur web_search, fallback LLM: {e}")
            return await self._llm_knowledge_sources(query, depth, "fr", research_brief)

    async def _llm_knowledge_sources(
        self,
        query: str,
        depth: str,
        language: str,
        research_brief: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Générer des sources basées sur les connaissances du modèle."""

        depth_guidance = {
            "basic": "3-4 sources principales",
            "detailed": "6-8 sources variées",
            "exhaustive": "10-12 sources variées et spécialisées"
        }

        system_prompt = f"""Tu es un expert en recherche qui connaît la littérature académique.
Fournis des sources RÉALISTES et PERTINENTES sur ce sujet.

Type de sources à mentionner:
- Livres et manuels académiques
- Articles de revues à comité de lecture
- Rapports officiels et études
- Ressources web réputées

Profondeur: {depth} ({depth_guidance.get(depth, '')})
Langue: {'Français' if language == 'fr' else 'Anglais'}

Réponds en JSON:
{{
    "sources": [
        {{
            "title": "Titre complet",
            "author": "Auteur(s)",
            "year": 2020,
            "type": "livre|article|rapport|site",
            "url": "URL estimée ou N/A",
            "snippet": "Résumé 1-2 lignes pertinent à la requête",
            "relevance": 0.9
        }},
        ...
    ]
}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Question: {query}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.6,
            max_tokens=2048
        )

        try:
            result = self.parse_json_response(response)
            sources = result.get("sources", [])
            logger.debug(f"[{self.name}] {len(sources)} sources LLM générées")
            return sources
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur parsing sources: {e}")
            return []

    async def _analyze_and_crossreference(
        self,
        sources: List[Dict[str, Any]],
        query: str,
        language: str
    ) -> List[Dict[str, Any]]:
        """Étape 3: Analyser et recouper les sources."""

        if not sources:
            logger.warning(f"[{self.name}] Aucune source à analyser")
            return []

        system_prompt = f"""Tu es un chercheur académique. Analyse ces sources et identifie:
- Les consensus entre sources
- Les divergences importantes
- Les auteurs clés
- Les éventuelles lacunes ou contradictions

Langue: {'Français' if language == 'fr' else 'Anglais'}

Pour chaque source, évalue:
- Crédibilité (académique, pratique, officielle, etc.)
- Année de publication (récence)
- Pertinence directe à la question
- Points clés à retenir

Enrichis les sources avec une analyse comparative. Réponds en JSON:
{{
    "analyzed_sources": [
        {{
            "title": "Titre",
            "author": "Auteur",
            "year": 2020,
            "type": "livre|article|rapport|site",
            "url": "URL",
            "key_points": ["point1", "point2"],
            "credibility": "haute|moyenne|basse",
            "relevance_score": 0.85,
            "notes": "Observations supplémentaires"
        }},
        ...
    ],
    "consensus": "Points d'accord entre sources",
    "divergences": "Divergences ou débats"
}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Sources à analyser:\n\n{str(sources[:10])}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.5,
            max_tokens=2048
        )

        try:
            result = self.parse_json_response(response)
            analyzed = result.get("analyzed_sources", sources)
            logger.debug(f"[{self.name}] Sources analysées et recoupées")
            return analyzed
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur analyse sources: {e}")
            return sources

    async def _synthesize_findings(
        self,
        sources: List[Dict[str, Any]],
        query: str,
        language: str,
        research_brief: Dict[str, Any]
    ) -> str:
        """Étape 4: Synthétiser les résultats en markdown structuré."""

        sources_text = "\n".join([
            f"- {s.get('title', '')} ({s.get('author', 'N/A')}, {s.get('year', 'N/A')}): {s.get('key_points', [])}"
            for s in sources[:8]
        ])

        system_prompt = f"""Tu es un excellent rédacteur académique. Synthétise les résultats de recherche de manière:
- Structurée avec sections claires
- Objective et équilibrée
- Avec citations inline [Auteur, année]
- Pédagogique et progressive

Format markdown:
- Titre principal
- Introduction
- Sections thématiques avec sous-titres
- Conclusion
- Notes sur les lacunes ou débats

Langue: {'Français' if language == 'fr' else 'Anglais'}

Synthèse (500-800 mots) avec citations [Author, year] tout au long:"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Question: {query}\n\nSources:\n{sources_text}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.6,
            max_tokens=3000
        )

        logger.debug(f"[{self.name}] Synthèse générée")
        return response

    async def _generate_bibliography(
        self,
        sources: List[Dict[str, Any]],
        citation_style: str,
        language: str
    ) -> str:
        """Étape 5: Générer la bibliographie formatée."""

        system_prompt = f"""Tu es un expert en formatage bibliographique. Formate ces sources en style {citation_style.upper()}.

Styles:
- APA: (Auteur, Année) - standard académique
- MLA: Auteur. "Titre". Publication, Année.
- Chicago: Auteur. Titre. Publisher, Année.
- Harvard: Auteur, A., Année. Titre. Publisher.

Langue: {'Français' if language == 'fr' else 'Anglais'}

Ordonne alphabétiquement et formate EXACTEMENT selon le style demandé. Réponds juste avec la bibliographie formatée:"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Sources à formater:\n\n{str(sources)}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.3,
            max_tokens=2048
        )

        logger.debug(f"[{self.name}] Bibliographie formatée ({citation_style})")
        return response

    async def _extract_key_findings(
        self,
        synthesis: str,
        language: str
    ) -> List[Dict[str, str]]:
        """Extraire les points clés de la synthèse."""

        system_prompt = f"""Tu es un expert en extraction de points clés. Identifie les 3-5 points clés de cette synthèse.

Points clés doivent être:
- Spécifiques et mémorables
- Pertinents à la question de recherche
- Basés sur le consensus des sources
- Formulés clairement

Langue: {'Français' if language == 'fr' else 'Anglais'}

Réponds en JSON:
{{
    "key_findings": [
        {{"finding": "Le point clé exactement", "importance": "haute|moyenne", "sources": ["Auteur, année", ...]}},
        ...
    ]
}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Synthèse:\n\n{synthesis[:2000]}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.4,
            max_tokens=1024
        )

        try:
            result = self.parse_json_response(response)
            findings = result.get("key_findings", [])
            logger.debug(f"[{self.name}] {len(findings)} points clés extraits")
            return findings
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur extraction points clés: {e}")
            return []
