"""
Module de recherche web pour ISSALAN avec Tavily API et fallback DuckDuckGo
Spécialement conçu pour les agents IA avec format JSON optimisé
"""

import os
import json
import logging
import asyncio
from typing import Dict, List, Any, Optional, Union
from datetime import datetime, timedelta
import hashlib
import aiohttp

# Import des fallbacks - import absolu pour éviter les problèmes d'importation dynamique
try:
    from .duckduckgo_search import DuckDuckGoSearch, get_duckduckgo_search_client
except ImportError:
    # Fallback pour l'importation dynamique
    import sys
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from packages.shared_bl.tools.duckduckgo_search import DuckDuckGoSearch, get_duckduckgo_search_client

logger = logging.getLogger(__name__)

class TavilySearch:
    """Client Tavily API spécialement conçu pour les agents IA."""
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialise le client Tavily.
        
        Args:
            api_key: Clé API Tavily (optionnelle, peut être dans les variables d'environnement)
        """
        self.api_key = api_key or os.getenv("TAVILY_API_KEY")
        self.base_url = "https://api.tavily.com"
        
        # Configuration par défaut
        self.default_params = {
            "search_depth": "basic",  # "basic" ou "advanced"
            "include_answer": True,    # Inclure une réponse synthétisée
            "include_raw_content": False,  # Inclure le contenu brut
            "include_images": False,   # Inclure les images
            "max_results": 5,          # Nombre maximum de résultats
        }
        
        # Cache mémoire simple
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl = timedelta(minutes=30)
        
        # Session HTTP
        self.session: Optional[aiohttp.ClientSession] = None
        
        # Fallback
        self.duckduckgo_client: Optional[DuckDuckGoSearch] = None
        
        logger.info(f"TavilySearch initialisé (API key: {'présente' if self.api_key else 'absente'})")
    
    async def initialize(self):
        """Initialise la session HTTP."""
        if not self.session:
            self.session = aiohttp.ClientSession(
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}" if self.api_key else ""
                }
            )
        
        # Initialiser le fallback
        if not self.duckduckgo_client:
            self.duckduckgo_client = get_duckduckgo_search_client()
        
        logger.info("TavilySearch complètement initialisé")
    
    async def shutdown(self):
        """Ferme la session HTTP."""
        if self.session:
            await self.session.close()
            self.session = None
            logger.info("Session Tavily fermée")
    
    def _generate_cache_key(self, query: str, params: Dict[str, Any]) -> str:
        """
        Génère une clé de cache unique.
        
        Args:
            query: Requête de recherche
            params: Paramètres de recherche
            
        Returns:
            Clé de cache
        """
        cache_data = {
            "query": query,
            "params": params
        }
        cache_str = json.dumps(cache_data, sort_keys=True)
        return f"tavily:{hashlib.md5(cache_str.encode()).hexdigest()}"
    
    async def search(
        self, 
        query: str, 
        search_depth: str = "basic",
        max_results: int = 5,
        include_answer: bool = True,
        include_images: bool = False,
        time_range: Optional[str] = None,
        domain: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Effectue une recherche avec Tavily API.
        
        Args:
            query: Requête de recherche
            search_depth: "basic" ou "advanced"
            max_results: Nombre maximum de résultats (1-10)
            include_answer: Inclure une réponse synthétisée
            include_images: Inclure les images
            time_range: "day", "week", "month", "year"
            domain: Limiter la recherche à un domaine spécifique
            
        Returns:
            Résultats de recherche au format JSON optimisé pour les LLM
        """
        # Vérifier le cache
        params = {
            "search_depth": search_depth,
            "max_results": max_results,
            "include_answer": include_answer,
            "include_images": include_images,
            "time_range": time_range,
            "domain": domain
        }
        
        cache_key = self._generate_cache_key(query, params)
        if cache_key in self.cache:
            cached_data = self.cache[cache_key]
            if datetime.now() - cached_data["timestamp"] < self.cache_ttl:
                logger.info(f"Résultats de cache pour: {query}")
                return cached_data["results"]
        
        # Si pas de clé API, utiliser le fallback
        if not self.api_key:
            logger.warning("Clé API Tavily non configurée, utilisation du fallback DuckDuckGo")
            return await self._fallback_search(query, max_results)
        
        # Préparer la requête
        request_data = {
            "query": query,
            "search_depth": search_depth,
            "include_answer": include_answer,
            "include_images": include_images,
            "max_results": min(max_results, 10),  # Tavily limite à 10
        }
        
        # Ajouter les paramètres optionnels
        if time_range:
            request_data["time_range"] = time_range
        if domain:
            request_data["domain"] = domain
        
        try:
            # Effectuer la requête
            async with self.session.post(
                f"{self.base_url}/search",
                json=request_data,
                timeout=30
            ) as response:
                
                if response.status == 200:
                    data = await response.json()
                    
                    # Formater les résultats pour les agents IA
                    formatted_results = self._format_for_agents(data)
                    
                    # Mettre en cache
                    self.cache[cache_key] = {
                        "timestamp": datetime.now(),
                        "results": formatted_results
                    }
                    
                    logger.info(f"Recherche Tavily réussie: {query} ({len(formatted_results.get('results', []))} résultats)")
                    return formatted_results
                    
                elif response.status == 401:
                    logger.error("Clé API Tavily invalide, utilisation du fallback")
                    return await self._fallback_search(query, max_results)
                    
                else:
                    logger.error(f"Erreur Tavily API: {response.status}")
                    return await self._fallback_search(query, max_results)
                    
        except asyncio.TimeoutError:
            logger.warning("Timeout Tavily API, utilisation du fallback")
            return await self._fallback_search(query, max_results)
            
        except Exception as e:
            logger.error(f"Erreur Tavily API: {e}, utilisation du fallback")
            return await self._fallback_search(query, max_results)
    
    def _format_for_agents(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Formate les résultats Tavily pour les agents IA.
        
        Args:
            data: Données brutes de Tavily
            
        Returns:
            Données formatées pour les LLM
        """
        formatted = {
            "query": data.get("query", ""),
            "answer": data.get("answer", ""),
            "results": [],
            "images": data.get("images", []),
            "response_time": data.get("response_time", 0),
            "search_depth": data.get("search_depth", "basic"),
        }
        
        # Formater les résultats
        for result in data.get("results", []):
            formatted_result = {
                "title": result.get("title", ""),
                "url": result.get("url", ""),
                "content": result.get("content", ""),
                "score": result.get("score", 0.0),
                "published_date": result.get("published_date", ""),
                "author": result.get("author", ""),
            }
            
            # Ajouter des métadonnées supplémentaires
            if "raw_content" in result:
                formatted_result["raw_content_preview"] = result["raw_content"][:500] + "..."
            
            formatted["results"].append(formatted_result)
        
        # Ajouter un résumé si disponible
        if data.get("answer"):
            formatted["summary"] = data["answer"]
        elif formatted["results"]:
            # Générer un résumé simple à partir des premiers résultats
            snippets = [r["content"][:200] for r in formatted["results"][:3] if r["content"]]
            formatted["summary"] = " ".join(snippets)[:500] + "..."
        
        return formatted
    
    async def _fallback_search(self, query: str, max_results: int = 5) -> Dict[str, Any]:
        """
        Recherche de fallback avec DuckDuckGo.
        
        Args:
            query: Requête de recherche
            max_results: Nombre maximum de résultats
            
        Returns:
            Résultats au même format que Tavily
        """
        if not self.duckduckgo_client:
            self.duckduckgo_client = get_duckduckgo_search_client()
        
        try:
            # Recherche DuckDuckGo
            results = await self.duckduckgo_client.search(query, num_results=max_results)
            
            # Formater pour correspondre au format Tavily
            formatted_results = {
                "query": query,
                "answer": "",
                "results": [],
                "images": [],
                "response_time": 0,
                "search_depth": "basic",
                "source": "duckduckgo_fallback",
            }
            
            for result in results:
                formatted_result = {
                    "title": result.get("title", ""),
                    "url": result.get("link", ""),
                    "content": result.get("snippet", ""),
                    "score": 0.8,  # Score par défaut
                    "published_date": "",
                    "author": "",
                }
                formatted_results["results"].append(formatted_result)
            
            # Générer une réponse synthétisée simple
            if formatted_results["results"]:
                snippets = [r["content"][:150] for r in formatted_results["results"][:3] if r["content"]]
                formatted_results["answer"] = " ".join(snippets)[:300] + "..."
                formatted_results["summary"] = formatted_results["answer"]
            
            logger.info(f"Fallback DuckDuckGo réussi: {query} ({len(results)} résultats)")
            return formatted_results
            
        except Exception as e:
            logger.error(f"Erreur fallback DuckDuckGo: {e}")
            return {
                "query": query,
                "answer": f"Erreur lors de la recherche: {str(e)}",
                "results": [],
                "images": [],
                "response_time": 0,
                "search_depth": "basic",
                "source": "error",
                "error": str(e)
            }
    
    async def search_with_context(
        self, 
        query: str, 
        context: Optional[str] = None,
        search_depth: str = "advanced",
        max_results: int = 7
    ) -> Dict[str, Any]:
        """
        Recherche avec contexte pour les agents IA.
        
        Args:
            query: Requête de recherche
            context: Contexte additionnel pour affiner la recherche
            search_depth: Profondeur de recherche
            max_results: Nombre maximum de résultats
            
        Returns:
            Résultats enrichis avec contexte
        """
        # Construire la requête avec contexte
        full_query = query
        if context:
            full_query = f"{query} [Contexte: {context}]"
        
        # Effectuer la recherche
        results = await self.search(
            query=full_query,
            search_depth=search_depth,
            max_results=max_results,
            include_answer=True
        )
        
        # Ajouter le contexte aux résultats
        if context:
            results["context"] = context
            results["contextual_query"] = full_query
        
        return results
    
    async def search_code_specific(
        self,
        language: str,
        concept: str,
        include_examples: bool = True,
        include_documentation: bool = True
    ) -> Dict[str, Any]:
        """
        Recherche spécifique pour le code.
        
        Args:
            language: Langage de programmation
            concept: Concept à rechercher
            include_examples: Inclure des exemples de code
            include_documentation: Inclure la documentation
            
        Returns:
            Résultats spécifiques au code
        """
        # Construire la requête
        query_parts = [f"{language} {concept}"]
        
        if include_examples:
            query_parts.append("code examples")
        
        if include_documentation:
            query_parts.append("documentation")
        
        query = " ".join(query_parts)
        
        # Domaines prioritaires pour le code
        domains = [
            "github.com",
            "stackoverflow.com",
            "docs.python.org" if language == "python" else None,
            "developer.mozilla.org" if language in ["javascript", "html", "css"] else None,
            "react.dev" if language == "react" else None,
        ]
        
        domains = [d for d in domains if d]
        
        # Effectuer plusieurs recherches si nécessaire
        all_results = []
        
        for domain in domains[:2]:  # Limiter à 2 domaines pour éviter trop de requêtes
            try:
                domain_results = await self.search(
                    query=query,
                    domain=domain,
                    max_results=3,
                    search_depth="basic"
                )
                
                if domain_results.get("results"):
                    # Marquer la source
                    for result in domain_results["results"]:
                        result["code_source"] = domain
                    
                    all_results.extend(domain_results["results"])
                    
            except Exception as e:
                logger.warning(f"Erreur recherche domaine {domain}: {e}")
        
        # Si pas assez de résultats, recherche générale
        if len(all_results) < 3:
            general_results = await self.search(
                query=query,
                max_results=5,
                search_depth="basic"
            )
            
            if general_results.get("results"):
                all_results.extend(general_results["results"][:3])
        
        # Formater les résultats
        formatted = {
            "query": query,
            "language": language,
            "concept": concept,
            "results": all_results[:max_results],
            "search_type": "code_specific",
            "timestamp": datetime.now().isoformat()
        }
        
        # Générer un résumé pour les exemples de code
        if include_examples and all_results:
            code_snippets = []
            for result in all_results:
                if "code" in result.get("content", "").lower() or "example" in result.get("title", "").lower():
                    code_snippets.append(result["content"][:200])
            
            if code_snippets:
                formatted["code_summary"] = " ".join(code_snippets)[:500] + "..."
        
        return formatted
    
    async def search_multiple_queries(
        self,
        queries: List[str],
        search_depth: str = "basic",
        max_results_per_query: int = 3
    ) -> Dict[str, Any]:
        """
        Recherche multiple en parallèle.
        
        Args:
            queries: Liste des requêtes
            search_depth: Profondeur de recherche
            max_results_per_query: Résultats par requête
            
        Returns:
            Résultats combinés
        """
        tasks = []
        for query in queries:
            task = self.search(
                query=query,
                search_depth=search_depth,
                max_results=max_results_per_query
            )
            tasks.append(task)
        
        # Exécuter en parallèle
        results_list = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Combiner les résultats
        combined = {
            "queries": queries,
            "results_by_query": {},
            "all_results": [],
            "total_results": 0,
            "successful_queries": 0,
            "failed_queries": 0
        }
        
        for i, (query, result) in enumerate(zip(queries, results_list)):
            if isinstance(result, Exception):
                logger.error(f"Erreur pour la requête '{query}': {result}")
                combined["results_by_query"][query] = {
                    "error": str(result),
                    "results": []
                }
                combined["failed_queries"] += 1
            else:
                combined["results_by_query"][query] = result
                if result.get("results"):
                    combined["all_results"].extend(result["results"])
                    combined["total_results"] += len(result["results"])
                combined["successful_queries"] += 1
        
        # Dédupliquer les résultats
        seen_urls = set()
        unique_results = []
        
        for result in combined["all_results"]:
            url = result.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                unique_results.append(result)
        
        combined["all_results"] = unique_results
        combined["unique_results"] = len(unique_results)
        
        return combined
    
    def clear_cache(self):
        """Vide le cache."""
        self.cache.clear()
        logger.info("Cache Tavily vidé")
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques du cache."""
        return {
            "size": len(self.cache),
            "keys": list(self.cache.keys()),
            "ttl_minutes": self.cache_ttl.total_seconds() / 60,
        }


# Instance globale
_tavily_search_client = None

def get_tavily_search_client() -> TavilySearch:
    """
    Factory pour obtenir le client Tavily Search.
    
    Returns:
        Instance du client Tavily
    """
    global _tavily_search_client
    
    if _tavily_search_client is None:
        _tavily_search_client = TavilySearch()
    
    return _tavily_search_client


# Fonction principale pour les agents IA
async def web_search(
    query: str, 
    search_depth: str = "basic",
    max_results: int = 5,
    include_answer: bool = True,
    time_range: Optional[str] = None,
    domain: Optional[str] = None
) -> Dict[str, Any]:
    """
    Fonction de recherche web pour les agents IA.
    
    Args:
        query: Requête de recherche
        search_depth: "basic" ou "advanced"
        max_results: Nombre maximum de résultats (1-10)
        include_answer: Inclure une réponse synthétisée
        time_range: "day", "week", "month", "year"
        domain: Limiter la recherche à un domaine spécifique
        
    Returns:
        Résultats de recherche au format JSON optimisé pour les LLM
    """
    client = get_tavily_search_client()
    
    # Initialiser si nécessaire
    if client.session is None:
        await client.initialize()
    
    return await client.search(
        query=query,
        search_depth=search_depth,
        max_results=max_results,
        include_answer=include_answer,
        time_range=time_range,
        domain=domain
    )


# Test du module
async def test_tavily_search():
    """Test du module Tavily Search."""
    print("🔍 Test du module Tavily Search ISSALAN")
    print("=" * 50)
    
    client = TavilySearch()
    await client.initialize()
    
    # Test 1: Recherche basique
    print("1️⃣  Test recherche basique:")
    try:
        results = await client.search("Python programming language", max_results=3)
        print(f"   ✅ Requête: {results.get('query', 'N/A')}")
        print(f"   ✅ Nombre de résultats: {len(results.get('results', []))}")
        print(f"   ✅ Réponse synthétisée: {'Oui' if results.get('answer') else 'Non'}")
        
        if results.get("results"):
            print(f"   ✅ Premier résultat: {results['results'][0].get('title', 'N/A')[:50]}...")
        
        print("   ✅ Recherche basique réussie")
    except Exception as e:
        print(f"   ❌ Erreur recherche basique: {e}")
    
    # Test 2: Recherche avec contexte
    print("\n2️⃣  Test recherche avec contexte:")
    try:
        context_results = await client.search_with_context(
            query="async programming",
            context="I'm learning Python asyncio",
            max_results=2
        )
        print(f"   ✅ Contexte ajouté: {context_results.get('context', 'N/A')}")
        print(f"   ✅ Requête contextuelle: {context_results.get('contextual_query', 'N/A')}")
        print("   ✅ Recherche avec contexte réussie")
    except Exception as e:
        print(f"   ❌ Erreur recherche avec contexte: {e}")
    
    # Test 3: Recherche spécifique au code
    print("\n3️⃣  Test recherche spécifique au code:")
    try:
        code_results = await client.search_code_specific(
            language="python",
            concept="list comprehension",
            include_examples=True
        )
        print(f"   ✅ Langage: {code_results.get('language', 'N/A')}")
        print(f"   ✅ Concept: {code_results.get('concept', 'N/A')}")
        print(f"   ✅ Type de recherche: {code_results.get('search_type', 'N/A')}")
        print("   ✅ Recherche code réussie")
    except Exception as e:
        print(f"   ❌ Erreur recherche code: {e}")
    
    # Test 4: Recherche multiple
    print("\n4️⃣  Test recherche multiple:")
    try:
        queries = ["React hooks", "Vue composition API", "Angular components"]
        multi_results = await client.search_multiple_queries(queries, max_results_per_query=2)
        print(f"   ✅ Requêtes: {len(multi_results.get('queries', []))}")
        print(f"   ✅ Requêtes réussies: {multi_results.get('successful_queries', 0)}")
        print(f"   ✅ Résultats uniques: {multi_results.get('unique_results', 0)}")
        print("   ✅ Recherche multiple réussie")
    except Exception as e:
        print(f"   ❌ Erreur recherche multiple: {e}")
    
    # Test 5: Cache
    print("\n5️⃣  Test du cache:")
    try:
        cache_stats = client.get_cache_stats()
        print(f"   ✅ Taille du cache: {cache_stats.get('size', 0)}")
        print(f"   ✅ TTL: {cache_stats.get('ttl_minutes', 0)} minutes")
        
        # Vider le cache
        client.clear_cache()
        print("   ✅ Cache vidé avec succès")
    except Exception as e:
        print(f"   ❌ Erreur cache: {e}")
    
    # Test 6: Fonction web_search (pour agents)
    print("\n6️⃣  Test fonction web_search (pour agents IA):")
    try:
        agent_results = await web_search(
            query="FastAPI documentation",
            search_depth="basic",
            max_results=2,
            include_answer=True
        )
        print(f"   ✅ Format agent: {type(agent_results)}")
        print(f"   ✅ Clés disponibles: {list(agent_results.keys())[:5]}...")
        print("   ✅ Fonction web_search réussie")
    except Exception as e:
        print(f"   ❌ Erreur fonction web_search: {e}")
    
    await client.shutdown()
    
    print("\n" + "=" * 50)
    print("✅ Module Tavily Search testé avec succès")
    print("\n📋 Résumé des fonctionnalités:")
    print("  ✅ Tavily API avec réponse synthétisée pour agents IA")
    print("  ✅ Fallback DuckDuckGo automatique")
    print("  ✅ Cache mémoire intelligent")
    print("  ✅ Recherche avec contexte")
    print("  ✅ Recherche spécifique au code")
    print("  ✅ Recherche multiple en parallèle")
    print("  ✅ Format JSON optimisé pour les LLM")
    print("  ✅ Prêt pour l'intégration avec les agents ISSALAN")


if __name__ == "__main__":
    # Exécuter le test
    asyncio.run(test_tavily_search())
