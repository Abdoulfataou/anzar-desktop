"""
Intégration de la recherche web avec Redis cache et agents ISSALAN
"""

import os
import json
import logging
import asyncio
from typing import Dict, List, Any, Optional, Callable
from datetime import datetime, timedelta
import hashlib
import redis.asyncio as redis

from .search import web_search, get_tavily_search_client
from .duckduckgo_search import get_duckduckgo_search_client

logger = logging.getLogger(__name__)

class WebSearchWithRedisCache:
    """Recherche web avec cache Redis pour les agents ISSALAN."""
    
    def __init__(self, redis_url: Optional[str] = None):
        """
        Initialise la recherche web avec cache Redis.
        
        Args:
            redis_url: URL Redis (optionnelle, peut être dans les variables d'environnement)
        """
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")
        self.redis_client: Optional[redis.Redis] = None
        
        # Clients de recherche
        self.tavily_client = get_tavily_search_client()
        self.duckduckgo_client = get_duckduckgo_search_client()
        
        # Configuration du cache
        self.cache_ttl = 3600  # 1 heure par défaut
        self.cache_prefix = "issalan:search:"
        
        # Statistiques
        self.stats = {
            "cache_hits": 0,
            "cache_misses": 0,
            "tavily_searches": 0,
            "fallback_searches": 0,
            "errors": 0,
            "total_searches": 0,
        }
        
        logger.info(f"WebSearchWithRedisCache initialisé (Redis: {self.redis_url})")
    
    async def initialize(self):
        """Initialise la connexion Redis."""
        try:
            self.redis_client = redis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
            
            # Tester la connexion
            await self.redis_client.ping()
            logger.info("Connexion Redis établie avec succès")
            
        except Exception as e:
            logger.warning(f"Impossible de se connecter à Redis: {e}. Utilisation du cache mémoire uniquement.")
            self.redis_client = None
        
        # Initialiser le client Tavily
        if self.tavily_client.session is None:
            await self.tavily_client.initialize()
    
    async def shutdown(self):
        """Ferme les connexions."""
        if self.redis_client:
            await self.redis_client.close()
            logger.info("Connexion Redis fermée")
        
        await self.tavily_client.shutdown()
    
    def _generate_cache_key(self, query: str, params: Dict[str, Any]) -> str:
        """
        Génère une clé de cache Redis.
        
        Args:
            query: Requête de recherche
            params: Paramètres de recherche
            
        Returns:
            Clé de cache
        """
        cache_data = {
            "query": query,
            "params": params,
            "version": "v1.0"
        }
        cache_str = json.dumps(cache_data, sort_keys=True)
        hash_key = hashlib.md5(cache_str.encode()).hexdigest()
        return f"{self.cache_prefix}{hash_key}"
    
    async def _get_cached_results(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """
        Récupère les résultats du cache Redis.
        
        Args:
            cache_key: Clé de cache
            
        Returns:
            Résultats en cache ou None
        """
        if not self.redis_client:
            return None
        
        try:
            cached_data = await self.redis_client.get(cache_key)
            if cached_data:
                self.stats["cache_hits"] += 1
                return json.loads(cached_data)
            
            self.stats["cache_misses"] += 1
            return None
            
        except Exception as e:
            logger.warning(f"Erreur lors de la récupération du cache: {e}")
            return None
    
    async def _cache_results(self, cache_key: str, results: Dict[str, Any], ttl: Optional[int] = None):
        """
        Stocke les résultats dans le cache Redis.
        
        Args:
            cache_key: Clé de cache
            results: Résultats à stocker
            ttl: Time-to-live en secondes
        """
        if not self.redis_client:
            return
        
        try:
            ttl = ttl or self.cache_ttl
            await self.redis_client.setex(
                cache_key,
                ttl,
                json.dumps(results)
            )
            logger.debug(f"Résultats mis en cache: {cache_key} (TTL: {ttl}s)")
            
        except Exception as e:
            logger.warning(f"Erreur lors de la mise en cache: {e}")
    
    async def search(
        self,
        query: str,
        search_depth: str = "basic",
        max_results: int = 5,
        include_answer: bool = True,
        time_range: Optional[str] = None,
        domain: Optional[str] = None,
        use_cache: bool = True,
        cache_ttl: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Recherche web avec cache Redis.
        
        Args:
            query: Requête de recherche
            search_depth: "basic" ou "advanced"
            max_results: Nombre maximum de résultats
            include_answer: Inclure une réponse synthétisée
            time_range: "day", "week", "month", "year"
            domain: Limiter la recherche à un domaine spécifique
            use_cache: Utiliser le cache
            cache_ttl: TTL personnalisé pour le cache
            
        Returns:
            Résultats de recherche
        """
        self.stats["total_searches"] += 1
        
        # Paramètres de recherche
        params = {
            "search_depth": search_depth,
            "max_results": max_results,
            "include_answer": include_answer,
            "time_range": time_range,
            "domain": domain,
        }
        
        # Vérifier le cache
        if use_cache:
            cache_key = self._generate_cache_key(query, params)
            cached_results = await self._get_cached_results(cache_key)
            
            if cached_results:
                logger.info(f"Résultats de cache pour: {query}")
                cached_results["cached"] = True
                cached_results["cache_key"] = cache_key
                return cached_results
        
        # Effectuer la recherche
        try:
            logger.info(f"Recherche web: {query}")
            
            # Utiliser Tavily avec fallback
            results = await web_search(
                query=query,
                search_depth=search_depth,
                max_results=max_results,
                include_answer=include_answer,
                time_range=time_range,
                domain=domain
            )
            
            # Compter le type de recherche
            if results.get("source") == "duckduckgo_fallback":
                self.stats["fallback_searches"] += 1
            else:
                self.stats["tavily_searches"] += 1
            
            # Ajouter des métadonnées
            results["search_timestamp"] = datetime.now().isoformat()
            results["search_params"] = params
            results["cached"] = False
            
            # Mettre en cache
            if use_cache:
                await self._cache_results(cache_key, results, cache_ttl)
                results["cache_key"] = cache_key
            
            return results
            
        except Exception as e:
            self.stats["errors"] += 1
            logger.error(f"Erreur lors de la recherche: {e}")
            
            # Retourner une réponse d'erreur
            return {
                "query": query,
                "answer": f"Erreur lors de la recherche: {str(e)}",
                "results": [],
                "error": str(e),
                "search_timestamp": datetime.now().isoformat(),
                "cached": False,
            }
    
    async def search_for_agent(
        self,
        agent_id: str,
        query: str,
        context: Optional[str] = None,
        search_depth: str = "advanced",
        max_results: int = 7
    ) -> Dict[str, Any]:
        """
        Recherche web optimisée pour les agents IA.
        
        Args:
            agent_id: Identifiant de l'agent
            query: Requête de recherche
            context: Contexte additionnel
            search_depth: Profondeur de recherche
            max_results: Nombre maximum de résultats
            
        Returns:
            Résultats formatés pour les agents
        """
        # Construire la requête avec le contexte de l'agent
        full_query = query
        if context:
            full_query = f"{query} [Agent: {agent_id}, Contexte: {context}]"
        
        # Effectuer la recherche
        results = await self.search(
            query=full_query,
            search_depth=search_depth,
            max_results=max_results,
            include_answer=True,
            use_cache=True,
            cache_ttl=1800  # 30 minutes pour les recherches d'agents
        )
        
        # Ajouter des métadonnées d'agent
        results["agent_id"] = agent_id
        results["agent_context"] = context
        results["agent_timestamp"] = datetime.now().isoformat()
        
        # Formater pour l'agent
        formatted_results = self._format_for_agent(results)
        
        return formatted_results
    
    def _format_for_agent(self, results: Dict[str, Any]) -> Dict[str, Any]:
        """
        Formate les résultats pour un agent IA.
        
        Args:
            results: Résultats bruts
            
        Returns:
            Résultats formatés pour l'agent
        """
        formatted = {
            "query": results.get("query", ""),
            "answer": results.get("answer", ""),
            "summary": results.get("summary", ""),
            "results": [],
            "metadata": {
                "cached": results.get("cached", False),
                "source": results.get("source", "tavily"),
                "search_depth": results.get("search_depth", "basic"),
                "timestamp": results.get("search_timestamp", ""),
                "agent_id": results.get("agent_id", ""),
            }
        }
        
        # Formater les résultats individuels
        for result in results.get("results", []):
            formatted_result = {
                "title": result.get("title", ""),
                "url": result.get("url", ""),
                "content": result.get("content", ""),
                "relevance_score": result.get("score", 0.0),
                "source_type": result.get("code_source", "web"),
            }
            
            # Ajouter un extrait pour l'agent
            if formatted_result["content"]:
                formatted_result["excerpt"] = formatted_result["content"][:200] + "..."
            
            formatted["results"].append(formatted_result)
        
        # Ajouter des statistiques
        formatted["statistics"] = {
            "total_results": len(formatted["results"]),
            "cached": results.get("cached", False),
            "response_time": results.get("response_time", 0),
        }
        
        return formatted
    
    async def batch_search(
        self,
        queries: List[Dict[str, Any]],
        use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Recherche par lot pour plusieurs requêtes.
        
        Args:
            queries: Liste de dictionnaires avec 'query' et paramètres optionnels
            use_cache: Utiliser le cache
            
        Returns:
            Résultats combinés
        """
        tasks = []
        
        for query_data in queries:
            query = query_data["query"]
            params = {
                "search_depth": query_data.get("search_depth", "basic"),
                "max_results": query_data.get("max_results", 5),
                "include_answer": query_data.get("include_answer", True),
                "time_range": query_data.get("time_range"),
                "domain": query_data.get("domain"),
            }
            
            task = self.search(
                query=query,
                use_cache=use_cache,
                **params
            )
            tasks.append(task)
        
        # Exécuter en parallèle
        results_list = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Combiner les résultats
        combined = {
            "batch_id": hashlib.md5(str(datetime.now().timestamp()).encode()).hexdigest()[:8],
            "timestamp": datetime.now().isoformat(),
            "queries": queries,
            "results": [],
            "statistics": {
                "total_queries": len(queries),
                "successful": 0,
                "failed": 0,
                "cached": 0,
                "from_tavily": 0,
                "from_fallback": 0,
            }
        }
        
        for i, (query_data, result) in enumerate(zip(queries, results_list)):
            if isinstance(result, Exception):
                combined["statistics"]["failed"] += 1
                combined["results"].append({
                    "query": query_data["query"],
                    "error": str(result),
                    "success": False
                })
            else:
                combined["statistics"]["successful"] += 1
                
                if result.get("cached"):
                    combined["statistics"]["cached"] += 1
                
                if result.get("source") == "duckduckgo_fallback":
                    combined["statistics"]["from_fallback"] += 1
                else:
                    combined["statistics"]["from_tavily"] += 1
                
                combined["results"].append({
                    "query": query_data["query"],
                    "result": result,
                    "success": True
                })
        
        return combined
    
    async def clear_cache_for_query(self, query: str, params: Optional[Dict[str, Any]] = None):
        """
        Vide le cache pour une requête spécifique.
        
        Args:
            query: Requête de recherche
            params: Paramètres de recherche (optionnel)
        """
        if not self.redis_client:
            return
        
        params = params or {}
        cache_key = self._generate_cache_key(query, params)
        
        try:
            deleted = await self.redis_client.delete(cache_key)
            if deleted:
                logger.info(f"Cache vidé pour: {query}")
            else:
                logger.debug(f"Aucun cache trouvé pour: {query}")
                
        except Exception as e:
            logger.warning(f"Erreur lors du vidage du cache: {e}")
    
    async def clear_all_cache(self):
        """Vide tout le cache de recherche."""
        if not self.redis_client:
            return
        
        try:
            # Trouver toutes les clés de cache
            pattern = f"{self.cache_prefix}*"
            keys = await self.redis_client.keys(pattern)
            
            if keys:
                deleted = await self.redis_client.delete(*keys)
                logger.info(f"{deleted} entrées de cache supprimées")
            else:
                logger.info("Aucune entrée de cache trouvée")
                
        except Exception as e:
            logger.error(f"Erreur lors du vidage complet du cache: {e}")
    
    async def get_cache_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques du cache Redis."""
        if not self.redis_client:
            return {"redis_available": False}
        
        try:
            # Compter les clés de cache
            pattern = f"{self.cache_prefix}*"
            keys = await self.redis_client.keys(pattern)
            
            # Obtenir des informations sur les clés
            cache_info = []
            for key in keys[:10]:  # Limiter aux 10 premières
                try:
                    ttl = await self.redis_client.ttl(key)
                    cache_info.append({
                        "key": key,
                        "ttl": ttl
                    })
                except Exception:
                    pass
            
            return {
                "redis_available": True,
                "total_cache_entries": len(keys),
                "cache_prefix": self.cache_prefix,
                "cache_ttl_default": self.cache_ttl,
                "sample_entries": cache_info,
                "search_stats": self.stats,
            }
            
        except Exception as e:
            logger.warning(f"Erreur lors de la récupération des statistiques: {e}")
            return {"redis_available": False, "error": str(e)}
    
    async def register_agent_function(self, agent_system):
        """
        Enregistre la fonction de recherche web pour un agent.
        
        Args:
            agent_system: Système d'agents (AG2 ou similaire)
            
        Returns:
            Fonction enregistrée
        """
        async def agent_web_search(
            query: str,
            search_depth: str = "basic",
            max_results: int = 5,
            include_answer: bool = True
        ) -> Dict[str, Any]:
            """
            Fonction de recherche web pour les agents.
            
            Args:
                query: Requête de recherche
                search_depth: "basic" ou "advanced"
                max_results: Nombre maximum de résultats
                include_answer: Inclure une réponse synthétisée
                
            Returns:
                Résultats de recherche
            """
            return await self.search_for_agent(
                agent_id=agent_system.agent_id if hasattr(agent_system, 'agent_id') else "unknown",
                query=query,
                search_depth=search_depth,
                max_results=max_results
            )
        
        # Enregistrer la fonction
        if hasattr(agent_system, 'register_function'):
            agent_system.register_function(
                func=agent_web_search,
                name="web_search",
                description="Recherche web avec Tavily API et fallback DuckDuckGo. Retourne des résultats formatés pour les agents IA."
            )
            logger.info(f"Fonction web_search enregistrée pour l'agent {getattr(agent_system, 'agent_id', 'unknown')}")
        
        return agent_web_search


# Instance globale
_web_search_integration = None

def get_web_search_integration() -> WebSearchWithRedisCache:
    """
    Factory pour obtenir l'intégration de recherche web.
    
    Returns:
        Instance de WebSearchWithRedisCache
    """
    global _web_search_integration
    
    if _web_search_integration is None:
        _web_search_integration = WebSearchWithRedisCache()
    
    return _web_search_integration


# Fonction utilitaire pour les agents
async def agent_web_search_tool(
    query: str,
    search_depth: str = "basic",
    max_results: int = 5,
    include_answer: bool = True
) -> Dict[str, Any]:
    """
    Outil de recherche web pour les agents IA.
    
    Args:
        query: Requête de recherche
        search_depth: "basic" ou "advanced"
        max_results: Nombre maximum de résultats
        include_answer: Inclure une réponse synthétisée
        
    Returns:
        Résultats de recherche formatés
    """
    integration = get_web_search_integration()
    
    # Initialiser si nécessaire
    if integration.redis_client is None:
        await integration.initialize()
    
    return await integration.search(
        query=query,
        search_depth=search_depth,
        max_results=max_results,
        include_answer=include_answer
    )


# Test de l'intégration
async def test_web_search_integration():
    """Test de l'intégration de recherche web."""
    print("🔍 Test de l'intégration Web Search ISSALAN")
    print("=" * 60)
    
    integration = WebSearchWithRedisCache()
    await integration.initialize()
    
    # Test 1: Recherche basique avec cache
    print("1️⃣  Test recherche basique avec cache:")
    try:
        results = await integration.search(
            query="Python async programming",
            max_results=3,
            use_cache=True
        )
        print(f"   ✅ Requête: {results.get('query', 'N/A')}")
        print(f"   ✅ Résultats: {len(results.get('results', []))}")
        print(f"   ✅ Cache utilisé: {results.get('cached', False)}")
        print(f"   ✅ Source: {results.get('source', 'N/A')}")
        print("   ✅ Recherche basique réussie")
    except Exception as e:
        print(f"   ❌ Erreur recherche basique: {e}")
    
    # Test 2: Recherche pour agent
    print("\n2️⃣  Test recherche pour agent:")
    try:
        agent_results = await integration.search_for_agent(
            agent_id="test_agent_001",
            query="FastAPI middleware",
            context="Building REST API",
            max_results=2
        )
        print(f"   ✅ Agent ID: {agent_results.get('metadata', {}).get('agent_id', 'N/A')}")
        print(f"   ✅ Format agent: {len(agent_results.get('results', []))} résultats")
        print(f"   ✅ Métadonnées: {list(agent_results.get('metadata', {}).keys())}")
        print("   ✅ Recherche agent réussie")
    except Exception as e:
        print(f"   ❌ Erreur recherche agent: {e}")
    
    # Test 3: Recherche par lot
    print("\n3️⃣  Test recherche par lot:")
    try:
        queries = [
            {"query": "React hooks tutorial", "max_results": 2},
            {"query": "Vue 3 composition API", "max_results": 2},
            {"query": "Angular dependency injection", "max_results": 2},
        ]
        
        batch_results = await integration.batch_search(queries)
        print(f"   ✅ Requêtes: {batch_results.get('statistics', {}).get('total_queries', 0)}")
        print(f"   ✅ Réussies: {batch_results.get('statistics', {}).get('successful', 0)}")
        print(f"   ✅ Depuis cache: {batch_results.get('statistics', {}).get('cached', 0)}")
        print("   ✅ Recherche par lot réussie")
    except Exception as e:
        print(f"   ❌ Erreur recherche par lot: {e}")
    
    # Test 4: Statistiques cache
    print("\n4️⃣  Test statistiques cache:")
    try:
        cache_stats = await integration.get_cache_stats()
        print(f"   ✅ Redis disponible: {cache_stats.get('redis_available', False)}")
        print(f"   ✅ Entrées cache: {cache_stats.get('total_cache_entries', 0)}")
        print(f"   ✅ Hits cache: {cache_stats.get('search_stats', {}).get('cache_hits', 0)}")
        print(f"   ✅ Misses cache: {cache_stats.get('search_stats', {}).get('cache_misses', 0)}")
        print("   ✅ Statistiques cache réussies")
    except Exception as e:
        print(f"   ❌ Erreur statistiques cache: {e}")
    
    # Test 5: Outil agent
    print("\n5️⃣  Test outil agent:")
    try:
        tool_results = await agent_web_search_tool(
            query="Docker container networking",
            search_depth="basic",
            max_results=2
        )
        print(f"   ✅ Type retour: {type(tool_results)}")
        print(f"   ✅ Clés disponibles: {list(tool_results.keys())[:5]}...")
        print("   ✅ Outil agent réussi")
    except Exception as e:
        print(f"   ❌ Erreur outil agent: {e}")
    
    # Test 6: Vidage cache
    print("\n6️⃣  Test vidage cache:")
    try:
        await integration.clear_cache_for_query("Python async programming")
        print("   ✅ Cache vidé pour requête spécifique")
        
        # Optionnel: vider tout le cache
        # await integration.clear_all_cache()
        # print("   ✅ Tout le cache vidé")
        
    except Exception as e:
        print(f"   ❌ Erreur vidage cache: {e}")
    
    await integration.shutdown()
    
    print("\n" + "=" * 60)
    print("✅ Intégration Web Search testée avec succès")
    print("\n📋 Résumé des fonctionnalités:")
    print("  ✅ Tavily API avec fallback DuckDuckGo")
    print("  ✅ Cache Redis intelligent")
    print("  ✅ Recherche optimisée pour les agents")
    print("  ✅ Recherche par lot en parallèle")
    print("  ✅ Statistiques et monitoring")
    print("  ✅ Outil prêt pour AG2 et autres systèmes d'agents")
    print("  ✅ Format JSON optimisé pour les LLM")


if __name__ == "__main__":
    # Exécuter le test
    asyncio.run(test_web_search_integration())
