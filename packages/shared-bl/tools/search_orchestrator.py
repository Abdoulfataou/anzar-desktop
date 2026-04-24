"""
Orchestrateur de recherche pour ISSALAN
Combine Google Search et DuckDuckGo pour des résultats optimaux
"""

import os
import json
import logging
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timedelta
import asyncio
from enum import Enum

from .google_search import get_google_search_client
from .duckduckgo_search import get_duckduckgo_search_client

logger = logging.getLogger(__name__)

class SearchEngine(Enum):
    """Moteurs de recherche disponibles."""
    GOOGLE = "google"
    DUCKDUCKGO = "duckduckgo"
    BOTH = "both"

class SearchType(Enum):
    """Types de recherche disponibles."""
    GENERAL = "general"
    CODE_EXAMPLES = "code_examples"
    DOCUMENTATION = "documentation"
    ERROR_SOLUTION = "error_solution"
    INSTANT_ANSWER = "instant_answer"

class SearchOrchestrator:
    """Orchestrateur de recherche intelligent."""
    
    def __init__(self):
        """
        Initialise l'orchestrateur de recherche.
        """
        self.google_client = get_google_search_client()
        self.duckduckgo_client = get_duckduckgo_search_client()
        
        # Cache pour les résultats combinés
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl = timedelta(minutes=3)
        
        # Configuration par défaut
        self.default_config = {
            "preferred_engine": SearchEngine.BOTH,
            "fallback_order": [SearchEngine.GOOGLE, SearchEngine.DUCKDUCKGO],
            "max_results": 10,
            "timeout_seconds": 10,
            "deduplicate": True,
            "rank_by_relevance": True,
        }
    
    async def search(self, query: str, search_type: SearchType = SearchType.GENERAL,
                    config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Effectue une recherche intelligente.
        
        Args:
            query: Termes de recherche
            search_type: Type de recherche
            config: Configuration personnalisée
            
        Returns:
            Résultats de recherche structurés
        """
        # Fusionner la configuration
        merged_config = {**self.default_config, **(config or {})}
        
        # Convertir les enums en chaînes pour la sérialisation JSON
        serializable_config = self._make_config_serializable(merged_config)
        
        # Vérifier le cache
        cache_key = f"{query}_{search_type.value}_{json.dumps(serializable_config, sort_keys=True)}"
        if cache_key in self.cache:
            cached_data = self.cache[cache_key]
            if datetime.now() - cached_data["timestamp"] < self.cache_ttl:
                logger.info(f"Résultats de cache pour: {query}")
                return cached_data["results"]
        
        # Déterminer les moteurs à utiliser
        engines_to_use = self._determine_engines(merged_config["preferred_engine"])
        
        # Effectuer les recherches en parallèle
        tasks = []
        for engine in engines_to_use:
            task = self._perform_engine_search(engine, query, search_type, merged_config)
            tasks.append(task)
        
        try:
            # Exécuter avec timeout
            results_list = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=merged_config["timeout_seconds"]
            )
        except asyncio.TimeoutError:
            logger.warning(f"Timeout lors de la recherche: {query}")
            results_list = []
        
        # Combiner et traiter les résultats
        combined_results = self._combine_results(results_list, merged_config)
        
        # Ajouter des métadonnées
        response = {
            "query": query,
            "search_type": search_type.value,
            "total_results": len(combined_results),
            "results": combined_results,
            "timestamp": datetime.now().isoformat(),
            "config": merged_config,
        }
        
        # Mettre en cache
        self.cache[cache_key] = {
            "timestamp": datetime.now(),
            "results": response
        }
        
        logger.info(f"Recherche orchestrée réussie: {query} ({len(combined_results)} résultats)")
        return response
    
    def _determine_engines(self, preferred_engine: SearchEngine) -> List[SearchEngine]:
        """
        Détermine les moteurs de recherche à utiliser.
        
        Args:
            preferred_engine: Moteur préféré
            
        Returns:
            Liste des moteurs à utiliser
        """
        if preferred_engine == SearchEngine.BOTH:
            return [SearchEngine.GOOGLE, SearchEngine.DUCKDUCKGO]
        elif preferred_engine == SearchEngine.GOOGLE:
            return [SearchEngine.GOOGLE]
        elif preferred_engine == SearchEngine.DUCKDUCKGO:
            return [SearchEngine.DUCKDUCKGO]
        else:
            return [SearchEngine.GOOGLE, SearchEngine.DUCKDUCKGO]
    
    async def _perform_engine_search(self, engine: SearchEngine, query: str, 
                                    search_type: SearchType, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Effectue une recherche avec un moteur spécifique.
        
        Args:
            engine: Moteur de recherche
            query: Termes de recherche
            search_type: Type de recherche
            config: Configuration
            
        Returns:
            Résultats du moteur
        """
        try:
            if engine == SearchEngine.GOOGLE:
                return await self._google_search(query, search_type, config)
            elif engine == SearchEngine.DUCKDUCKGO:
                return await self._duckduckgo_search(query, search_type, config)
            else:
                return {"engine": engine.value, "results": [], "error": "Moteur inconnu"}
        except Exception as e:
            logger.error(f"Erreur avec {engine.value}: {e}")
            return {"engine": engine.value, "results": [], "error": str(e)}
    
    async def _google_search(self, query: str, search_type: SearchType, config: Dict[str, Any]) -> Dict[str, Any]:
        """Recherche Google."""
        results = []
        
        try:
            if search_type == SearchType.CODE_EXAMPLES:
                # Extraire le langage et le concept de la requête
                language, concept = self._extract_language_concept(query)
                results = await self.google_client.search_code_examples(language, concept)
                
            elif search_type == SearchType.DOCUMENTATION:
                # Extraire la technologie et le sujet
                technology, topic = self._extract_technology_topic(query)
                results = await self.google_client.search_documentation(technology, topic)
                
            elif search_type == SearchType.ERROR_SOLUTION:
                # Extraire le langage et l'erreur
                language, error = self._extract_language_error(query)
                results = await self.google_client.search_error_solution(error, language)
                
            else:  # GENERAL ou autres
                results = await self.google_client.search(
                    query, 
                    num_results=config["max_results"],
                    language="fr",
                    country="fr"
                )
                
        except Exception as e:
            logger.error(f"Erreur Google Search: {e}")
        
        return {
            "engine": "google",
            "results": results,
            "count": len(results),
            "timestamp": datetime.now().isoformat(),
        }
    
    async def _duckduckgo_search(self, query: str, search_type: SearchType, config: Dict[str, Any]) -> Dict[str, Any]:
        """Recherche DuckDuckGo."""
        results = []
        instant_answer = None
        
        try:
            # Toujours essayer la réponse instantanée
            if search_type in [SearchType.GENERAL, SearchType.INSTANT_ANSWER]:
                instant_answer = await self.duckduckgo_client.search_instant_answer(query)
            
            if search_type == SearchType.CODE_EXAMPLES:
                language, concept = self._extract_language_concept(query)
                results = await self.duckduckgo_client.search_code_examples(language, concept)
                
            elif search_type == SearchType.ERROR_SOLUTION:
                language, error = self._extract_language_error(query)
                results = await self.duckduckgo_client.search_error_solution(error, language)
                
            else:  # GENERAL, DOCUMENTATION, etc.
                results = await self.duckduckgo_client.search(
                    query,
                    num_results=config["max_results"],
                    region="fr-fr"
                )
                
        except Exception as e:
            logger.error(f"Erreur DuckDuckGo Search: {e}")
        
        return {
            "engine": "duckduckgo",
            "results": results,
            "instant_answer": instant_answer,
            "count": len(results),
            "timestamp": datetime.now().isoformat(),
        }
    
    def _combine_results(self, engine_results: List[Dict[str, Any]], config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Combine les résultats de plusieurs moteurs.
        
        Args:
            engine_results: Résultats de chaque moteur
            config: Configuration
            
        Returns:
            Résultats combinés et dédupliqués
        """
        all_results = []
        
        # Collecter tous les résultats
        for engine_result in engine_results:
            if isinstance(engine_result, Exception):
                continue
            
            engine = engine_result.get("engine", "unknown")
            results = engine_result.get("results", [])
            
            # Ajouter l'information du moteur à chaque résultat
            for result in results:
                result["search_engine"] = engine
                all_results.append(result)
        
        # Dédupliquer si configuré
        if config.get("deduplicate", True):
            all_results = self._deduplicate_results(all_results)
        
        # Trier par pertinence si configuré
        if config.get("rank_by_relevance", True):
            all_results = self._rank_by_relevance(all_results)
        
        # Limiter le nombre de résultats
        max_results = config.get("max_results", 10)
        return all_results[:max_results]
    
    def _deduplicate_results(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Déduplique les résultats par URL.
        
        Args:
            results: Liste des résultats
            
        Returns:
            Résultats dédupliqués
        """
        seen_urls = set()
        deduplicated = []
        
        for result in results:
            url = result.get("link", "").lower()
            if url and url not in seen_urls:
                seen_urls.add(url)
                deduplicated.append(result)
        
        return deduplicated
    
    def _rank_by_relevance(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Classe les résultats par pertinence.
        
        Args:
            results: Liste des résultats
            
        Returns:
            Résultats classés
        """
        for result in results:
            # Calculer un score de pertinence
            score = 0
            
            # Source du moteur
            if result.get("search_engine") == "google":
                score += 2  # Google est généralement plus pertinent
            
            # Type de résultat
            result_type = result.get("type", "")
            if result_type in ["stackoverflow", "github", "wikipedia"]:
                score += 3
            elif result_type == "official":
                score += 4
            
            # Score de pertinence existant
            if "relevance_score" in result:
                score += result["relevance_score"]
            if "solution_score" in result:
                score += result["solution_score"]
            
            # Longueur du snippet (indicateur de contenu)
            snippet = result.get("snippet", "")
            if len(snippet) > 100:
                score += 1
            
            result["combined_relevance_score"] = score
        
        # Trier par score décroissant
        return sorted(results, key=lambda x: x.get("combined_relevance_score", 0), reverse=True)
    
    def _extract_language_concept(self, query: str) -> Tuple[str, str]:
        """
        Extrait le langage et le concept d'une requête de code.
        
        Args:
            query: Requête de recherche
            
        Returns:
            Tuple (langage, concept)
        """
        # Langages de programmation courants
        languages = [
            "python", "javascript", "typescript", "java", "c++", "c#", "php",
            "ruby", "go", "rust", "swift", "kotlin", "dart", "r", "matlab",
            "html", "css", "sql", "bash", "powershell"
        ]
        
        query_lower = query.lower()
        language = "python"  # Par défaut
        
        for lang in languages:
            if lang in query_lower:
                language = lang
                break
        
        # Le concept est le reste de la requête
        concept = query_lower.replace(language, "").strip()
        if not concept:
            concept = "programming"
        
        return language, concept
    
    def _extract_technology_topic(self, query: str) -> Tuple[str, str]:
        """
        Extrait la technologie et le sujet d'une requête de documentation.
        
        Args:
            query: Requête de recherche
            
        Returns:
            Tuple (technologie, sujet)
        """
        # Technologies courantes
        technologies = [
            "react", "vue", "angular", "node.js", "express", "django", "flask",
            "spring", "laravel", "rails", "docker", "kubernetes", "aws", "azure",
            "gcp", "terraform", "ansible", "jenkins", "git", "mongodb", "mysql",
            "postgresql", "redis", "elasticsearch", "kafka", "rabbitmq"
        ]
        
        query_lower = query.lower()
        technology = "react"  # Par défaut
        
        for tech in technologies:
            if tech in query_lower:
                technology = tech
                break
        
        # Le sujet est le reste de la requête
        topic = query_lower.replace(technology, "").strip()
        if not topic:
            topic = "documentation"
        
        return technology, topic
    
    def _extract_language_error(self, query: str) -> Tuple[str, str]:
        """
        Extrait le langage et l'erreur d'une requête de solution d'erreur.
        
        Args:
            query: Requête de recherche
            
        Returns:
            Tuple (langage, erreur)
        """
        # Même liste de langages que précédemment
        languages = [
            "python", "javascript", "typescript", "java", "c++", "c#", "php",
            "ruby", "go", "rust", "swift", "kotlin", "dart", "r", "matlab"
        ]
        
        query_lower = query.lower()
        language = "python"  # Par défaut
        
        for lang in languages:
            if lang in query_lower:
                language = lang
                break
        
        # L'erreur est le reste de la requête
        error = query_lower.replace(language, "").strip()
        if not error:
            error = "error"
        
        return language, error
    
    def _make_config_serializable(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convertit une configuration avec des enums en une configuration sérialisable JSON.
        
        Args:
            config: Configuration avec des enums
            
        Returns:
            Configuration sérialisable
        """
        serializable = {}
        for key, value in config.items():
            if isinstance(value, Enum):
                serializable[key] = value.value
            elif isinstance(value, list):
                serializable[key] = [
                    item.value if isinstance(item, Enum) else item
                    for item in value
                ]
            elif isinstance(value, dict):
                serializable[key] = self._make_config_serializable(value)
            else:
                serializable[key] = value
        return serializable
    
    async def search_code_with_context(self, code: str, language: str, 
                                      error_message: Optional[str] = None) -> Dict[str, Any]:
        """
        Recherche intelligente basée sur le contexte du code.
        
        Args:
            code: Code source
            language: Langage de programmation
            error_message: Message d'erreur (optionnel)
            
        Returns:
            Résultats de recherche contextuels
        """
        # Analyser le code pour extraire des concepts
        concepts = self._extract_concepts_from_code(code, language)
        
        # Construire les requêtes
        queries = []
        
        # Requête pour les concepts généraux
        if concepts:
            concepts_query = f"{language} {' '.join(concepts[:3])} best practices"
            queries.append(concepts_query)
        
        # Requête pour les erreurs
        if error_message:
            error_query = f"{language} {error_message} solution"
            queries.append(error_query)
        
        # Requête pour la documentation
        doc_query = f"{language} official documentation"
        queries.append(doc_query)
        
        # Effectuer les recherches en parallèle
        tasks = []
        for query in queries:
            task = self.search(
                query,
                search_type=SearchType.GENERAL,
                config={"max_results": 5, "preferred_engine": SearchEngine.BOTH}
            )
            tasks.append(task)
        
        try:
            results_list = await asyncio.gather(*tasks, return_exceptions=True)
        except Exception as e:
            logger.error(f"Erreur lors de la recherche contextuelle: {e}")
            results_list = []
        
        # Combiner les résultats
        combined_results = []
        for i, result in enumerate(results_list):
            if isinstance(result, Exception):
                continue
            
            # Ajouter le contexte de la requête
            for res in result.get("results", []):
                res["context_query"] = queries[i]
                combined_results.append(res)
        
        # Dédupliquer et classer
        combined_results = self._deduplicate_results(combined_results)
        combined_results = self._rank_by_relevance(combined_results)
        
        return {
            "code_context": {
                "language": language,
                "concepts": concepts,
                "has_error": bool(error_message),
            },
            "search_queries": queries,
            "total_results": len(combined_results),
            "results": combined_results[:15],  # Limiter à 15 résultats
            "timestamp": datetime.now().isoformat(),
        }
    
    def _extract_concepts_from_code(self, code: str, language: str) -> List[str]:
        """
        Extrait des concepts clés du code.
        
        Args:
            code: Code source
            language: Langage de programmation
            
        Returns:
            Liste des concepts clés
        """
        concepts = []
        
        # Concepts basés sur le langage
        language_concepts = {
            "python": ["function", "class", "import", "def", "async", "await", "list", "dict", "tuple", "set"],
            "javascript": ["function", "class", "import", "export", "async", "await", "array", "object", "promise"],
            "typescript": ["interface", "type", "generic", "decorator", "module", "namespace"],
            "java": ["class", "interface", "method", "public", "private", "static", "void"],
            "c++": ["class", "template", "namespace", "pointer", "reference", "vector", "map"],
            "react": ["component", "hook", "state", "props", "effect", "context", "reducer"],
            "vue": ["component", "directive", "computed", "watch", "mixin", "plugin"],
            "angular": ["component", "service", "directive", "pipe", "module", "dependency injection"],
        }
        
        # Ajouter les concepts du langage
        if language.lower() in language_concepts:
            concepts.extend(language_concepts[language.lower()])
        
        # Analyser le code pour des motifs spécifiques
        code_lower = code.lower()
        
        # Vérifier les motifs communs
        patterns = {
            "async": ["async", "await", "promise", "future"],
            "oop": ["class", "interface", "inheritance", "polymorphism"],
            "functional": ["map", "filter", "reduce", "lambda", "closure"],
            "error": ["try", "catch", "except", "throw", "raise"],
            "database": ["select", "insert", "update", "delete", "query"],
            "api": ["fetch", "axios", "http", "rest", "graphql"],
            "testing": ["test", "assert", "mock", "stub", "spy"],
        }
        
        for category, keywords in patterns.items():
            for keyword in keywords:
                if keyword in code_lower:
                    concepts.append(category)
                    break
        
        # Dédupliquer
        concepts = list(set(concepts))
        
        # Limiter à 5 concepts maximum
        return concepts[:5]
    
    def clear_cache(self):
        """Vide le cache."""
        self.cache.clear()
        logger.info("Cache SearchOrchestrator vidé")
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques du cache."""
        return {
            "size": len(self.cache),
            "ttl_minutes": self.cache_ttl.total_seconds() / 60,
            "timestamp": datetime.now().isoformat(),
        }


# Instance globale
search_orchestrator = None

def get_search_orchestrator() -> SearchOrchestrator:
    """Factory pour obtenir l'orchestrateur de recherche."""
    global search_orchestrator
    if search_orchestrator is None:
        search_orchestrator = SearchOrchestrator()
    return search_orchestrator


# Test rapide
if __name__ == "__main__":
    import asyncio
    
    async def test():
        orchestrator = SearchOrchestrator()
        
        # Test recherche générale
        print("Test recherche générale...")
        result = await orchestrator.search(
            "Python async programming tutorial",
            search_type=SearchType.GENERAL,
            config={"max_results": 5}
        )
        print(f"Résultats: {result['total_results']}")
        for i, res in enumerate(result['results'][:3], 1):
            print(f"{i}. {res['title']}")
            print(f"   {res['link']}")
            print()
        
        # Test recherche d'exemples de code
        print("\nTest recherche exemples de code...")
        result = await orchestrator.search(
            "Python list comprehension examples",
            search_type=SearchType.CODE_EXAMPLES
        )
        print(f"Exemples de code: {result['total_results']}")
        
        # Test recherche solution erreur
        print("\nTest recherche solution erreur...")
        result = await orchestrator.search(
            "Python TypeError NoneType object is not iterable",
            search_type=SearchType.ERROR_SOLUTION
        )
        print(f"Solutions erreur: {result['total_results']}")
        
        # Test recherche avec contexte de code
        print("\nTest recherche avec contexte de code...")
        sample_code = """
        async def fetch_data(url):
            try:
                response = await aiohttp.get(url)
                return await response.json()
            except Exception as e:
                print(f"Error: {e}")
                return None
        """
        result = await orchestrator.search_code_with_context(
            sample_code,
            language="python",
            error_message="ConnectionError: Failed to connect"
        )
        print(f"Concepts extraits: {result['code_context']['concepts']}")
        print(f"Résultats contextuels: {result['total_results']}")
        
        # Test statistiques cache
        print("\nTest statistiques cache...")
        stats = orchestrator.get_cache_stats()
        print(f"Taille cache: {stats['size']}")
    
    asyncio.run(test())
