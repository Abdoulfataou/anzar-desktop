"""
Module de Recherches Web - Inspiré de Trae Solo.
Recherches intelligentes sur internet avec RAG et mise à jour des connaissances.
"""

import os
import json
import asyncio
import logging
from typing import Dict, List, Any, Optional, AsyncGenerator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import aiohttp
from bs4 import BeautifulSoup
import re
from urllib.parse import urlparse, quote_plus
import hashlib
import redis.asyncio as redis
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


@dataclass
class SearchQuery:
    """Requête de recherche."""
    query: str
    max_results: int = 10
    language: str = "fr"
    time_range: Optional[str] = None  # "day", "week", "month", "year"
    domain: Optional[str] = None


@dataclass
class SearchResult:
    """Résultat de recherche."""
    title: str
    url: str
    snippet: str
    content: Optional[str] = None
    relevance_score: float = 0.0
    freshness: Optional[datetime] = None
    source_type: str = "web"  # "web", "documentation", "api_docs", "github"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ResearchContext:
    """Contexte de recherche."""
    query: str
    results: List[SearchResult]
    summary: Optional[str] = None
    insights: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    generated_at: datetime = field(default_factory=datetime.now)


class WebResearchEngine:
    """
    Moteur de recherches web intelligent.
    Inspiré de Trae Solo : recherche, RAG, mise à jour des connaissances.
    """
    
    def __init__(self, deepseek_client, redis_client=None):
        self.deepseek_client = deepseek_client
        self.redis_client = redis_client
        
        # Configuration des moteurs de recherche
        self.search_engines = {
            'google': self._search_google,
            'duckduckgo': self._search_duckduckgo,
            'github': self._search_github,
            'stackoverflow': self._search_stackoverflow,
            'documentation': self._search_documentation,
        }
        
        # Cache configuration
        self.cache_ttl = 3600  # 1 heure
        
        # Session HTTP
        self.session = None
        
        # Sources de documentation populaires
        self.documentation_sources = {
            'python': 'https://docs.python.org/3/',
            'typescript': 'https://www.typescriptlang.org/docs/',
            'react': 'https://react.dev/',
            'nextjs': 'https://nextjs.org/docs',
            'fastapi': 'https://fastapi.tiangolo.com/',
            'docker': 'https://docs.docker.com/',
            'kubernetes': 'https://kubernetes.io/docs/',
            'postgresql': 'https://www.postgresql.org/docs/',
            'redis': 'https://redis.io/docs/',
        }
    
    async def initialize(self):
        """Initialise le moteur de recherche."""
        self.session = aiohttp.ClientSession(
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        )
        logger.info("Moteur de recherches web initialisé")
    
    async def search(self, query: SearchQuery) -> ResearchContext:
        """
        Effectue une recherche intelligente sur internet.
        
        Args:
            query: Requête de recherche
            
        Returns:
            Contexte de recherche complet
        """
        logger.info(f"Recherche: {query.query}")
        
        # Vérifier le cache
        cache_key = self._generate_cache_key(query)
        cached = await self._get_cached_results(cache_key)
        if cached:
            logger.info("Résultats trouvés dans le cache")
            return cached
        
        # Rechercher sur différents moteurs
        all_results = []
        
        # Recherche web générale
        web_results = await self._search_web(query)
        all_results.extend(web_results)
        
        # Recherche documentation technique
        if self._is_technical_query(query.query):
            doc_results = await self._search_technical_documentation(query)
            all_results.extend(doc_results)
        
        # Recherche GitHub
        if self._is_code_related(query.query):
            github_results = await self._search_github_repositories(query)
            all_results.extend(github_results)
        
        # Trier par pertinence
        sorted_results = await self._rank_results(query.query, all_results)
        
        # Extraire le contenu des meilleurs résultats
        enriched_results = await self._enrich_results(sorted_results[:query.max_results])
        
        # Générer un résumé avec IA
        summary = await self._generate_summary(query.query, enriched_results)
        
        # Extraire des insights
        insights = await self._extract_insights(query.query, enriched_results)
        
        # Générer des recommandations
        recommendations = await self._generate_recommendations(query.query, enriched_results)
        
        # Créer le contexte de recherche
        context = ResearchContext(
            query=query.query,
            results=enriched_results,
            summary=summary,
            insights=insights,
            recommendations=recommendations
        )
        
        # Mettre en cache
        await self._cache_results(cache_key, context)
        
        return context
    
    async def research_for_development(self, task_description: str, tech_stack: List[str] = None) -> Dict[str, Any]:
        """
        Recherche pour le développement logiciel.
        
        Args:
            task_description: Description de la tâche de développement
            tech_stack: Stack technologique (optionnel)
            
        Returns:
            Recherche structurée pour le développement
        """
        logger.info(f"Recherche pour développement: {task_description[:100]}...")
        
        # Analyser la tâche
        task_analysis = await self._analyze_development_task(task_description, tech_stack)
        
        # Recherches spécifiques
        research_queries = await self._generate_research_queries(task_analysis)
        
        # Exécuter les recherches
        research_results = {}
        for category, queries in research_queries.items():
            category_results = []
            for query_text in queries:
                query = SearchQuery(query=query_text, max_results=5)
                try:
                    result = await self.search(query)
                    category_results.append(result)
                except Exception as e:
                    logger.warning(f"Erreur recherche {category}: {e}")
            
            research_results[category] = category_results
        
        # Synthétiser les résultats
        synthesis = await self._synthesize_research(task_description, research_results)
        
        return {
            'task_analysis': task_analysis,
            'research_queries': research_queries,
            'research_results': research_results,
            'synthesis': synthesis,
            'recommended_approach': await self._recommend_development_approach(task_analysis, research_results)
        }
    
    async def real_time_web_search(self, query: str, context: Optional[Dict[str, Any]] = None) -> AsyncGenerator[str, None]:
        """
        Recherche web en temps réel avec streaming.
        
        Args:
            query: Requête de recherche
            context: Contexte additionnel
            
        Yields:
            Résultats en temps réel
        """
        logger.info(f"Recherche temps réel: {query}")
        
        # Recherche initiale
        search_query = SearchQuery(query=query, max_results=3)
        results = await self._search_web(search_query)
        
        # Stream des résultats
        for i, result in enumerate(results):
            yield f"**Résultat {i+1}:** {result.title}\n"
            yield f"URL: {result.url}\n"
            yield f"Extrait: {result.snippet}\n\n"
            
            # Extraire plus de détails si demandé
            if context and context.get('detailed', False):
                try:
                    content = await self._fetch_page_content(result.url)
                    if content:
                        summary = await self._summarize_content(content[:2000])
                        yield f"Résumé: {summary}\n\n"
                except Exception as e:
                    logger.warning(f"Erreur extraction contenu: {e}")
    
    async def rag_context_retrieval(self, query: str, documents: List[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Récupération de contexte avec RAG.
        
        Args:
            query: Requête
            documents: Documents à indexer (optionnel)
            
        Returns:
            Contexte enrichi avec RAG
        """
        logger.info(f"RAG pour: {query}")
        
        # Si pas de documents fournis, rechercher sur le web
        if not documents:
            search_results = await self.search(SearchQuery(query=query, max_results=5))
            documents = [
                {
                    'content': result.content or result.snippet,
                    'metadata': {
                        'source': result.url,
                        'title': result.title,
                        'relevance': result.relevance_score
                    }
                }
                for result in search_results.results
                if result.content or result.snippet
            ]
        
        # Indexer les documents
        indexed_docs = await self._index_documents(documents)
        
        # Rechercher les documents pertinents
        relevant_docs = await self._retrieve_relevant_documents(query, indexed_docs)
        
        # Générer un contexte enrichi
        enriched_context = await self._enrich_with_rag(query, relevant_docs)
        
        return {
            'query': query,
            'relevant_documents': relevant_docs,
            'enriched_context': enriched_context,
            'confidence_score': self._calculate_confidence(relevant_docs)
        }
    
    # Méthodes auxiliaires
    async def _search_web(self, query: SearchQuery) -> List[SearchResult]:
        """Recherche sur le web."""
        # Implémentation simplifiée (à remplacer par une vraie API)
        # En production, utiliser Google Custom Search API, DuckDuckGo API, etc.
        
        mock_results = [
            SearchResult(
                title="Documentation DeepSeek API",
                url="https://platform.deepseek.com/api-docs/",
                snippet="Documentation complète de l'API DeepSeek avec exemples de code.",
                relevance_score=0.95,
                source_type="documentation"
            ),
            SearchResult(
                title="GitHub - multi-agent development",
                url="https://github.com/search?q=multi-agent+development",
                snippet="Projets open source sur le développement multi-agent.",
                relevance_score=0.88,
                source_type="github"
            ),
            SearchResult(
                title="Stack Overflow - AI development tools",
                url="https://stackoverflow.com/questions/tagged/ai-development",
                snippet="Questions et réponses sur les outils de développement IA.",
                relevance_score=0.82,
                source_type="stackoverflow"
            ),
        ]
        
        return mock_results
    
    async def _search_technical_documentation(self, query: SearchQuery) -> List[SearchResult]:
        """Recherche dans la documentation technique."""
        results = []
        
        # Détecter les technologies mentionnées
        technologies = self._detect_technologies(query.query)
        
        for tech in technologies:
            if tech in self.documentation_sources:
                results.append(SearchResult(
                    title=f"Documentation {tech}",
                    url=self.documentation_sources[tech],
                    snippet=f"Documentation officielle de {tech}",
                    relevance_score=0.90,
                    source_type="documentation"
                ))
        
        return results
    
    async def _search_github_repositories(self, query: SearchQuery) -> List[SearchResult]:
        """Recherche sur GitHub."""
        # Implémentation simplifiée
        return [
            SearchResult(
                title="GitHub - React examples",
                url="https://github.com/search?q=react+examples",
                snippet="Exemples de projets React sur GitHub.",
                relevance_score=0.85,
                source_type="github"
            )
        ]
    
    async def _search_stackoverflow(self, query: SearchQuery) -> List[SearchResult]:
        """Recherche sur Stack Overflow."""
        # Implémentation simplifiée
        return [
            SearchResult(
                title="Stack Overflow - Python async",
                url="https://stackoverflow.com/questions/tagged/python+async",
                snippet="Questions sur la programmation asynchrone en Python.",
                relevance_score=0.80,
                source_type="stackoverflow"
            )
        ]
    
    async def _enrich_results(self, results: List[SearchResult]) -> List[SearchResult]:
        """Enrichit les résultats avec plus de contenu."""
        enriched = []
        
        for result in results:
            try:
                # Extraire le contenu de la page
                content = await self._fetch_page_content(result.url)
                if content:
                    result.content = content[:5000]  # Limiter la taille
            except Exception as e:
                logger.warning(f"Erreur enrichissement {result.url}: {e}")
            
            enriched.append(result)
        
        return enriched
    
    async def _generate_summary(self, query: str, results: List[SearchResult]) -> str:
        """Génère un résumé des résultats avec IA."""
        if not results:
            return "Aucun résultat trouvé."
        
        # Préparer le contenu pour l'IA
        content = "\n\n".join([
            f"Source: {r.title}\nURL: {r.url}\nContenu: {r.content or r.snippet}"
            for r in results[:3]
        ])
        
        prompt = f"""
        Requête de recherche: {query}
        
        Résultats trouvés:
        {content}
        
        Génère un résumé concis (3-5 phrases) de ces résultats.
        Inclus les points clés et les insights principaux.
        """
        
        try:
            response = await self.deepseek_client.chat_completion(
                messages=[
                    {'role': 'system', 'content': 'Tu es un expert en synthèse de recherches.'},
                    {'role': 'user', 'content': prompt}
                ],
                max_tokens=300
            )
            
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Erreur génération résumé: {e}")
            return "Impossible de générer un résumé."
    
    async def _extract_insights(self, query: str, results: List[SearchResult]) -> List[str]:
        """Extrait des insights des résultats."""
        insights = []
        
        # Insights basiques
        if results:
            insights.append(f"{len(results)} résultats pertinents trouvés")
            
            # Catégoriser par source
            sources = {}
            for r in results:
                sources[r.source_type] = sources.get(r.source_type, 0) + 1
            
            for source_type, count in sources.items():
                insights.append(f"{count} résultats de {source_type}")
        
        # Insights avec IA
        try:
            content = "\n".join([r.content or r.snippet for r in results[:3]])
            
            prompt = f"""
            Requête: {query}
            
            Résultats:
            {content}
            
            Extrais 3-5 insights clés de ces résultats.
            Format: liste à puces.
            """
            
            response = await self.deepseek_client.chat_completion(
                messages=[
                    {'role': 'system', 'content': 'Tu es un analyste expert.'},
                    {'role': 'user', 'content': prompt}
                ],
                max_tokens=400
            )
            
            ai_insights = response.choices[0].message.content.split('\n')
            insights.extend([i.strip() for i in ai_insights if i.strip()])
            
        except Exception as e:
            logger.warning(f"Erreur extraction insights IA: {e}")
        
        return insights
    
    async def _generate_recommendations(self, query: str, results: List[SearchResult]) -> List[str]:
        """Génère des recommandations basées sur les résultats."""
        recommendations = []
        
        # Recommandations basiques
        if any(r.source_type == 'documentation' for r in results):
            recommendations.append("Consulter la documentation officielle pour les détails techniques")
        
        if any(r.source_type == 'github' for r in results):
            recommendations.append("Examiner les projets open source similaires sur GitHub")
        
        if any(r.source_type == 'stackoverflow' for r in results):
            recommendations.append("Vérifier les solutions courantes sur Stack Overflow")
        
        # Recommandations avec IA
        try:
            prompt = f"""
            Requête: {query}
            
            Basé sur cette requête, génère 3-5 recommandations pratiques pour le développeur.
            Focus sur les actions concrètes à prendre.
            Format: liste à puces.
            """
            
            response = await self.deepseek_client.chat_completion(
                messages=[
                    {'role': 'system', 'content': 'Tu es un mentor en développement.'},
                    {'role': 'user', 'content': prompt}
                ],
                max_tokens=300
            )
            
            ai_recommendations = response.choices[0].message.content.split('\n')
            recommendations.extend([r.strip() for r in ai_recommendations if r.strip()])
            
        except Exception as e:
            logger.warning(f"Erreur génération recommandations IA: {e}")
        
        return recommendations
    
    async def _analyze_development_task(self, task_description: str, tech_stack: List[str] = None) -> Dict[str, Any]:
        """Analyse une tâche de développement."""
        prompt = f"""
        Tâche de développement: {task_description}
        {"Stack technique: " + ", ".join(tech_stack) if tech_stack else ""}
        
        Analyse cette tâche et identifie:
        1. Les composants techniques nécessaires
        2. Les défis potentiels
        3. Les technologies recommandées
        4. Les étapes de développement
        5. Les recherches nécessaires
        """
        
        try:
            response = await self.deepseek_client.chat_completion(
                messages=[
                    {'role': 'system', 'content': 'Tu es un architecte logiciel expert.'},
                    {'role': 'user', 'content': prompt}
                ],
                max_tokens=500
            )
            
            analysis_text = response.choices[0].message.content
            
            # Parser l'analyse
            return {
                'task_description': task_description,
                'tech_stack': tech_stack or [],
                'analysis': analysis_text,
                'components': self._extract_components(analysis_text),
                'challenges': self._extract_challenges(analysis_text),
                'technologies': self._extract_technologies(analysis_text),
                'steps': self._extract_steps(analysis_text),
                'research_needs': self._extract_research_needs(analysis_text)
            }
            
        except Exception as e:
            logger.error(f"Erreur analyse tâche: {e}")
            return {
                'task_description': task_description,
                'tech_stack': tech_stack or [],
                'analysis': 'Analyse non disponible',
                'components': [],
                'challenges': [],
                'technologies': [],
                'steps': [],
                'research_needs': []
            }
    
    async def _generate_research_queries(self, task_analysis: Dict[str, Any]) -> Dict[str, List[str]]:
        """Génère des requêtes de recherche basées sur l'analyse."""
        queries = {
            'technologies': [],
            'best_practices': [],
            'examples': [],
            'tutorials': [],
            'documentation': []
        }
        
        # Requêtes pour les technologies
        for tech in task_analysis.get('technologies', []):
            queries['technologies'].append(f"{tech} latest features 2024")
            queries['best_practices'].append(f"{tech} best practices")
            queries['examples'].append(f"{tech} example project")
        
        # Requêtes pour les défis
        for challenge in task_analysis.get('challenges', []):
            queries['tutorials'].append(f"how to solve {challenge}")
        
        # Requêtes générales
        queries['documentation'].append(f"{task_analysis['task_description']} documentation")
        
        return queries
    
    async def _synthesize_research(self, task_description: str, research_results: Dict[str, Any]) -> Dict[str, Any]:
        """Synthétise les résultats de recherche."""
        # Préparer le contenu pour la synthèse
        content_parts = []
        
        for category, results in research_results.items():
            if results:
                content_parts.append(f"## {category.upper()}")
                for result in results:
                    if hasattr(result, 'summary') and result.summary:
                        content_parts.append(f"- {result.summary}")
        
        content = "\n".join(content_parts)
        
        prompt = f"""
        Tâche: {task_description}
        
        Recherches effectuées:
        {content}
        
        Synthétise ces recherches en:
        1. Points clés à retenir
        2. Approche recommandée
        3. Pièges à éviter
        4. Ressources essentielles
        """
        
        try:
            response = await self.deepseek_client.chat_completion(
                messages=[
                    {'role': 'system', 'content': 'Tu es un expert en synthèse de recherches techniques.'},
                    {'role': 'user', 'content': prompt}
                ],
                max_tokens=600
            )
            
            return {
                'synthesis': response.choices[0].message.content,
                'key_points': self._extract_key_points(response.choices[0].message.content),
                'recommended_approach': self._extract_recommended_approach(response.choices[0].message.content),
                'pitfalls': self._extract_pitfalls(response.choices[0].message.content),
                'essential_resources': self._extract_resources(response.choices[0].message.content)
            }
            
        except Exception as e:
            logger.error(f"Erreur synthèse: {e}")
            return {'synthesis': 'Synthèse non disponible'}
    
    async def _recommend_development_approach(self, task_analysis: Dict[str, Any], research_results: Dict[str, Any]) -> str:
        """Recommande une approche de développement."""
        prompt = f"""
        Tâche: {task_analysis['task_description']}
        
        Analyse: {task_analysis.get('analysis', '')}
        
        Recommande une approche de développement détaillée incluant:
        1. Architecture recommandée
        2. Étapes de mise en œuvre
        3. Technologies spécifiques
        4. Timeline estimée
        5. Métriques de succès
        """
        
        try:
            response = await self.deepseek_client.chat_completion(
                messages=[
                    {'role': 'system', 'content': 'Tu es un architecte logiciel senior.'},
                    {'role': 'user', 'content': prompt}
                ],
                max_tokens=800
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            logger.error(f"Erreur recommandation approche: {e}")
            return "Approche non disponible"
    
    # Méthodes utilitaires
    def _generate_cache_key(self, query: SearchQuery) -> str:
        """Génère une clé de cache."""
        data = {
            'query': query.query,
            'max_results': query.max_results,
            'language': query.language,
            'time_range': query.time_range,
            'domain': query.domain
        }
        return f"search:{hashlib.md5(json.dumps(data, sort_keys=True).encode()).hexdigest()}"
    
    async def _get_cached_results(self, cache_key: str) -> Optional[ResearchContext]:
        """Récupère les résultats du cache."""
        if not self.redis_client:
            return None
        
        try:
            cached = await self.redis_client.get(cache_key)
            if cached:
                data = json.loads(cached)
                # Convertir les dates
                if 'generated_at' in data:
                    data['generated_at'] = datetime.fromisoformat(data['generated_at'])
                if 'results' in data:
                    for result in data['results']:
                        if 'freshness' in result and result['freshness']:
                            result['freshness'] = datetime.fromisoformat(result['freshness'])
                return ResearchContext(**data)
        except Exception as e:
            logger.warning(f"Erreur cache: {e}")
        
        return None
    
    async def _cache_results(self, cache_key: str, context: ResearchContext):
        """Stocke les résultats dans le cache."""
        if not self.redis_client:
            return
        
        try:
            # Convertir en JSON sérialisable
            data = {
                'query': context.query,
                'results': [
                    {
                        'title': r.title,
                        'url': r.url,
                        'snippet': r.snippet,
                        'content': r.content,
                        'relevance_score': r.relevance_score,
                        'freshness': r.freshness.isoformat() if r.freshness else None,
                        'source_type': r.source_type,
                        'metadata': r.metadata
                    }
                    for r in context.results
                ],
                'summary': context.summary,
                'insights': context.insights,
                'recommendations': context.recommendations,
                'generated_at': context.generated_at.isoformat()
            }
            
            await self.redis_client.setex(
                cache_key,
                self.cache_ttl,
                json.dumps(data)
            )
            
        except Exception as e:
            logger.warning(f"Erreur mise en cache: {e}")
    
    def _is_technical_query(self, query: str) -> bool:
        """Détecte si une requête est technique."""
        technical_keywords = [
            'python', 'javascript', 'typescript', 'react', 'vue', 'angular',
            'docker', 'kubernetes', 'aws', 'azure', 'gcp',
            'api', 'database', 'backend', 'frontend', 'devops',
            'algorithm', 'data structure', 'machine learning', 'ai'
        ]
        
        query_lower = query.lower()
        return any(keyword in query_lower for keyword in technical_keywords)
    
    def _is_code_related(self, query: str) -> bool:
        """Détecte si une requête est liée au code."""
        code_keywords = [
            'code', 'programming', 'development', 'software',
            'github', 'git', 'repository', 'open source',
            'library', 'framework', 'sdk', 'api'
        ]
        
        query_lower = query.lower()
        return any(keyword in query_lower for keyword in code_keywords)
    
    def _detect_technologies(self, query: str) -> List[str]:
        """Détecte les technologies mentionnées dans une requête."""
        technologies = []
        query_lower = query.lower()
        
        for tech in self.documentation_sources.keys():
            if tech in query_lower:
                technologies.append(tech)
        
        return technologies
    
    async def _fetch_page_content(self, url: str) -> Optional[str]:
        """Extrait le contenu d'une page web."""
        try:
            async with self.session.get(url, timeout=10) as response:
                if response.status == 200:
                    html = await response.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Supprimer les scripts et styles
                    for script in soup(["script", "style", "nav", "footer", "header"]):
                        script.decompose()
                    
                    # Extraire le texte
                    text = soup.get_text()
                    
                    # Nettoyer
                    lines = (line.strip() for line in text.splitlines())
                    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
                    text = ' '.join(chunk for chunk in chunks if chunk)
                    
                    return text[:10000]  # Limiter la taille
                
        except Exception as e:
            logger.warning(f"Erreur extraction contenu {url}: {e}")
        
        return None
    
    async def _summarize_content(self, content: str) -> str:
        """Résume le contenu avec IA."""
        prompt = f"""
        Contenu à résumer:
        {content[:3000]}
        
        Génère un résumé concis (2-3 phrases).
        """
        
        try:
            response = await self.deepseek_client.chat_completion(
                messages=[
                    {'role': 'system', 'content': 'Tu es un expert en résumé.'},
                    {'role': 'user', 'content': prompt}
                ],
                max_tokens=200
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            logger.warning(f"Erreur résumé: {e}")
            return content[:200] + "..."
    
    async def _rank_results(self, query: str, results: List[SearchResult]) -> List[SearchResult]:
        """Classe les résultats par pertinence."""
        if not results:
            return []
        
        # Calculer les scores de pertinence
        for result in results:
            result.relevance_score = self._calculate_relevance(query, result)
        
        # Trier par score
        return sorted(results, key=lambda x: x.relevance_score, reverse=True)
    
    def _calculate_relevance(self, query: str, result: SearchResult) -> float:
        """Calcule la pertinence d'un résultat."""
        score = 0.0
        
        # Vérifier les mots clés dans le titre
        query_words = set(query.lower().split())
        title_words = set(result.title.lower().split())
        
        title_match = len(query_words.intersection(title_words)) / max(len(query_words), 1)
        score += title_match * 0.4
        
        # Vérifier les mots clés dans le snippet
        if result.snippet:
            snippet_words = set(result.snippet.lower().split())
            snippet_match = len(query_words.intersection(snippet_words)) / max(len(query_words), 1)
            score += snippet_match * 0.3
        
        # Bonus pour la fraîcheur
        if result.freshness:
            days_old = (datetime.now() - result.freshness).days
            if days_old < 7:
                score += 0.2
            elif days_old < 30:
                score += 0.1
        
        # Bonus pour la source
        if result.source_type == 'documentation':
            score += 0.1
        
        return min(score, 1.0)
    
    async def _index_documents(self, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Indexe les documents pour la recherche RAG."""
        indexed = []
        
        for doc in documents:
            # Extraire les embeddings (simplifié)
            content = doc.get('content', '')
            words = content.lower().split()
            
            indexed.append({
                'content': content,
                'metadata': doc.get('metadata', {}),
                'tokens': words,
                'length': len(words)
            })
        
        return indexed
    
    async def _retrieve_relevant_documents(self, query: str, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Récupère les documents pertinents pour une requête."""
        if not documents:
            return []
        
        query_words = set(query.lower().split())
        
        scored_docs = []
        for doc in documents:
            doc_words = set(doc['tokens'])
            overlap = len(query_words.intersection(doc_words))
            score = overlap / max(len(query_words), 1)
            
            scored_docs.append({
                'document': doc,
                'score': score
            })
        
        # Trier par score
        scored_docs.sort(key=lambda x: x['score'], reverse=True)
        
        return [sd['document'] for sd in scored_docs[:5]]
    
    async def _enrich_with_rag(self, query: str, documents: List[Dict[str, Any]]) -> str:
        """Enrichit une requête avec le contexte RAG."""
        if not documents:
            return query
        
        # Préparer le contexte
        context = "\n\n".join([
            f"Source: {doc['metadata'].get('source', 'Unknown')}\n"
            f"Content: {doc['content'][:1000]}"
            for doc in documents[:3]
        ])
        
        prompt = f"""
        Requête: {query}
        
        Contexte RAG:
        {context}
        
        Génère une version enrichie de la requête qui incorpore le contexte.
        """
        
        try:
            response = await self.deepseek_client.chat_completion(
                messages=[
                    {'role': 'system', 'content': 'Tu es un expert en enrichissement de contexte.'},
                    {'role': 'user', 'content': prompt}
                ],
                max_tokens=300
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            logger.warning(f"Erreur enrichissement RAG: {e}")
            return query
    
    def _calculate_confidence(self, documents: List[Dict[str, Any]]) -> float:
        """Calcule le score de confiance basé sur les documents."""
        if not documents:
            return 0.0
        
        # Score basé sur le nombre et la qualité des documents
        num_docs = len(documents)
        avg_length = sum(len(doc.get('tokens', [])) for doc in documents) / max(num_docs, 1)
        
        score = min(num_docs / 5, 1.0) * 0.6  # Max 5 documents
        score += min(avg_length / 100, 1.0) * 0.4  # Longueur moyenne
        
        return score
    
    def _extract_components(self, text: str) -> List[str]:
        """Extrait les composants d'une analyse."""
        components = []
        lines = text.split('\n')
        
        for line in lines:
            line = line.strip()
            if line.startswith(('1.', '2.', '3.', '4.', '5.', '-', '•', '*')) and len(line) > 3:
                component = line.lstrip('12345.-•* ').strip()
                if component and len(component) > 10:
                    components.append(component)
        
        return components[:10] if components else ["Composants non détectés"]
    
    def _extract_challenges(self, text: str) -> List[str]:
        """Extrait les défis d'une analyse."""
        challenges = []
        lines = text.split('\n')
        
        challenge_keywords = ['défi', 'challenge', 'difficulté', 'problème', 'risque', 'limitation']
        
        for line in lines:
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in challenge_keywords):
                challenges.append(line.strip())
        
        return challenges[:5] if challenges else ["Aucun défi majeur identifié"]
    
    def _extract_technologies(self, text: str) -> List[str]:
        """Extrait les technologies mentionnées."""
        technologies = []
        lines = text.split('\n')
        
        tech_keywords = ['python', 'javascript', 'typescript', 'react', 'vue', 'angular',
                        'node', 'express', 'fastapi', 'django', 'flask',
                        'postgresql', 'mongodb', 'redis', 'mysql',
                        'docker', 'kubernetes', 'aws', 'azure', 'gcp',
                        'tailwind', 'bootstrap', 'material-ui']
        
        for line in lines:
            for tech in tech_keywords:
                if tech in line.lower():
                    technologies.append(tech)
        
        return list(set(technologies))[:10]
    
    def _extract_steps(self, text: str) -> List[str]:
        """Extrait les étapes de développement."""
        steps = []
        lines = text.split('\n')
        
        step_keywords = ['étape', 'step', 'phase', 'processus', 'procédure']
        
        for line in lines:
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in step_keywords):
                steps.append(line.strip())
        
        return steps[:10] if steps else ["Étapes non spécifiées"]
    
    def _extract_research_needs(self, text: str) -> List[str]:
        """Extrait les besoins de recherche."""
        needs = []
        lines = text.split('\n')
        
        research_keywords = ['recherche', 'research', 'documentation', 'apprendre', 'étudier']
        
        for line in lines:
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in research_keywords):
                needs.append(line.strip())
        
        return needs[:5] if needs else ["Aucun besoin de recherche spécifique"]
    
    def _extract_key_points(self, text: str) -> List[str]:
        """Extrait les points clés d'une synthèse."""
        key_points = []
        lines = text.split('\n')
        
        for line in lines:
            line = line.strip()
            if line.startswith(('1.', '2.', '3.', '4.', '5.', '-', '•', '*')) and len(line) > 3:
                point = line.lstrip('12345.-•* ').strip()
                if point and len(point) > 10:
                    key_points.append(point)
        
        return key_points[:5] if key_points else ["Points clés non spécifiés"]
    
    def _extract_recommended_approach(self, text: str) -> str:
        """Extrait l'approche recommandée."""
        lines = text.split('\n')
        
        approach_keywords = ['approche', 'approach', 'méthode', 'stratégie', 'recommandation']
        
        for line in lines:
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in approach_keywords):
                return line.strip()
        
        return "Approche non spécifiée"
    
    def _extract_pitfalls(self, text: str) -> List[str]:
        """Extrait les pièges à éviter."""
        pitfalls = []
        lines = text.split('\n')
        
        pitfall_keywords = ['piège', 'pitfall', 'erreur', 'mistake', 'éviter', 'attention']
        
        for line in lines:
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in pitfall_keywords):
                pitfalls.append(line.strip())
        
        return pitfalls[:5] if pitfalls else ["Aucun piège spécifique identifié"]
    
    def _extract_resources(self, text: str) -> List[str]:
        """Extrait les ressources essentielles."""
        resources = []
        lines = text.split('\n')
        
        resource_keywords = ['ressource', 'resource', 'documentation', 'lien', 'link', 'site']
        
        for line in lines:
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in resource_keywords):
                resources.append(line.strip())
        
        return resources[:5] if resources else ["Ressources non spécifiées"]
    
    async def close(self):
        """Ferme les ressources du moteur de recherche."""
        if self.session:
            await self.session.close()
            logger.info("Moteur de recherches web fermé")


# Singleton pour faciliter l'utilisation
_web_research_engine = None

async def get_web_research_engine(deepseek_client, redis_client=None):
    """Retourne une instance singleton du moteur de recherche."""
    global _web_research_engine
    
    if _web_research_engine is None:
        _web_research_engine = WebResearchEngine(deepseek_client, redis_client)
        await _web_research_engine.initialize()
    
    return _web_research_engine