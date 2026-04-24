"""
Endpoints API pour la recherche web intégrée
"""

import logging
from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import json
import asyncio

from ..tools.search_orchestrator import (
    get_search_orchestrator, 
    SearchOrchestrator, 
    SearchType, 
    SearchEngine
)

logger = logging.getLogger(__name__)

# Modèles Pydantic pour la validation
class WebSearchRequest(BaseModel):
    query: str
    search_type: str = "general"
    max_results: int = 10
    preferred_engine: str = "both"
    deduplicate: bool = True
    rank_by_relevance: bool = True

class CodeContextSearchRequest(BaseModel):
    code: str
    language: str
    error_message: Optional[str] = None
    max_results: int = 15

class BatchSearchRequest(BaseModel):
    queries: List[str]
    search_type: str = "general"
    max_results_per_query: int = 5

class SearchResult(BaseModel):
    title: str
    link: str
    snippet: str
    display_link: str
    search_engine: str
    type: Optional[str] = None
    relevance_score: Optional[float] = None
    meta: Optional[Dict[str, Any]] = None

class WebSearchResponse(BaseModel):
    query: str
    search_type: str
    total_results: int
    results: List[SearchResult]
    timestamp: str
    config: Dict[str, Any]

class CodeContextSearchResponse(BaseModel):
    code_context: Dict[str, Any]
    search_queries: List[str]
    total_results: int
    results: List[SearchResult]
    timestamp: str

class BatchSearchResponse(BaseModel):
    queries: List[str]
    results: Dict[str, WebSearchResponse]
    timestamp: str

# Routeur FastAPI
router = APIRouter(prefix="/api/web", tags=["Web Search"])

# Orchestrateur global
search_orchestrator = None

def init_web_endpoints(app):
    """Initialise les endpoints de recherche web."""
    global search_orchestrator
    search_orchestrator = get_search_orchestrator()
    
    # Inclure le routeur dans l'application
    app.include_router(router)
    
    logger.info("Endpoints de recherche web initialisés")

@router.post("/search", response_model=WebSearchResponse)
async def web_search(request: WebSearchRequest):
    """
    Recherche web intelligente.
    
    Args:
        request: Requête de recherche web
        
    Returns:
        Résultats de recherche
    """
    try:
        # Convertir le type de recherche
        search_type_map = {
            "general": SearchType.GENERAL,
            "code_examples": SearchType.CODE_EXAMPLES,
            "documentation": SearchType.DOCUMENTATION,
            "error_solution": SearchType.ERROR_SOLUTION,
            "instant_answer": SearchType.INSTANT_ANSWER,
        }
        
        search_type = search_type_map.get(request.search_type, SearchType.GENERAL)
        
        # Convertir le moteur préféré
        engine_map = {
            "google": SearchEngine.GOOGLE,
            "duckduckgo": SearchEngine.DUCKDUCKGO,
            "both": SearchEngine.BOTH,
        }
        
        preferred_engine = engine_map.get(request.preferred_engine, SearchEngine.BOTH)
        
        # Configuration
        config = {
            "preferred_engine": preferred_engine,
            "max_results": request.max_results,
            "deduplicate": request.deduplicate,
            "rank_by_relevance": request.rank_by_relevance,
        }
        
        # Effectuer la recherche
        result = await search_orchestrator.search(
            query=request.query,
            search_type=search_type,
            config=config
        )
        
        # Convertir les résultats au format Pydantic
        search_results = []
        for res in result.get("results", []):
            search_result = SearchResult(
                title=res.get("title", ""),
                link=res.get("link", ""),
                snippet=res.get("snippet", ""),
                display_link=res.get("display_link", res.get("link", "")),
                search_engine=res.get("search_engine", "unknown"),
                type=res.get("type"),
                relevance_score=res.get("combined_relevance_score"),
                meta=res.get("meta"),
            )
            search_results.append(search_result)
        
        return WebSearchResponse(
            query=result["query"],
            search_type=result["search_type"],
            total_results=result["total_results"],
            results=search_results,
            timestamp=result["timestamp"],
            config=result["config"],
        )
        
    except Exception as e:
        logger.error(f"Erreur dans /api/web/search: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/code-context", response_model=CodeContextSearchResponse)
async def search_code_context(request: CodeContextSearchRequest):
    """
    Recherche basée sur le contexte du code.
    
    Args:
        request: Requête de recherche contextuelle
        
    Returns:
        Résultats de recherche contextuels
    """
    try:
        # Effectuer la recherche contextuelle
        result = await search_orchestrator.search_code_with_context(
            code=request.code,
            language=request.language,
            error_message=request.error_message
        )
        
        # Convertir les résultats au format Pydantic
        search_results = []
        for res in result.get("results", []):
            search_result = SearchResult(
                title=res.get("title", ""),
                link=res.get("link", ""),
                snippet=res.get("snippet", ""),
                display_link=res.get("display_link", res.get("link", "")),
                search_engine=res.get("search_engine", "unknown"),
                type=res.get("type"),
                relevance_score=res.get("combined_relevance_score"),
                meta=res.get("meta"),
            )
            search_results.append(search_result)
        
        return CodeContextSearchResponse(
            code_context=result["code_context"],
            search_queries=result["search_queries"],
            total_results=result["total_results"],
            results=search_results,
            timestamp=result["timestamp"],
        )
        
    except Exception as e:
        logger.error(f"Erreur dans /api/web/search/code-context: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/batch", response_model=BatchSearchResponse)
async def batch_search(request: BatchSearchRequest):
    """
    Recherche par lots (multiple queries).
    
    Args:
        request: Requête de recherche par lots
        
    Returns:
        Résultats pour chaque requête
    """
    try:
        # Convertir le type de recherche
        search_type_map = {
            "general": SearchType.GENERAL,
            "code_examples": SearchType.CODE_EXAMPLES,
            "documentation": SearchType.DOCUMENTATION,
            "error_solution": SearchType.ERROR_SOLUTION,
        }
        
        search_type = search_type_map.get(request.search_type, SearchType.GENERAL)
        
        # Configuration
        config = {
            "max_results": request.max_results_per_query,
            "preferred_engine": SearchEngine.BOTH,
        }
        
        # Effectuer les recherches en parallèle
        tasks = []
        for query in request.queries:
            task = search_orchestrator.search(
                query=query,
                search_type=search_type,
                config=config
            )
            tasks.append(task)
        
        results_list = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Traiter les résultats
        results_dict = {}
        for i, query in enumerate(request.queries):
            if isinstance(results_list[i], Exception):
                logger.error(f"Erreur pour la requête '{query}': {results_list[i]}")
                results_dict[query] = WebSearchResponse(
                    query=query,
                    search_type=request.search_type,
                    total_results=0,
                    results=[],
                    timestamp="",
                    config=config,
                )
            else:
                result = results_list[i]
                
                # Convertir les résultats au format Pydantic
                search_results = []
                for res in result.get("results", []):
                    search_result = SearchResult(
                        title=res.get("title", ""),
                        link=res.get("link", ""),
                        snippet=res.get("snippet", ""),
                        display_link=res.get("display_link", res.get("link", "")),
                        search_engine=res.get("search_engine", "unknown"),
                        type=res.get("type"),
                        relevance_score=res.get("combined_relevance_score"),
                        meta=res.get("meta"),
                    )
                    search_results.append(search_result)
                
                results_dict[query] = WebSearchResponse(
                    query=result["query"],
                    search_type=result["search_type"],
                    total_results=result["total_results"],
                    results=search_results,
                    timestamp=result["timestamp"],
                    config=result["config"],
                )
        
        return BatchSearchResponse(
            queries=request.queries,
            results=results_dict,
            timestamp=datetime.now().isoformat(),
        )
        
    except Exception as e:
        logger.error(f"Erreur dans /api/web/search/batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/search/trends")
async def get_search_trends():
    """
    Récupère les tendances de recherche.
    
    Returns:
        Tendances de recherche populaires
    """
    try:
        # Tendances par défaut (à remplacer par une source réelle)
        trends = {
            "programming": [
                {"query": "Python async await", "volume": "high"},
                {"query": "React hooks tutorial", "volume": "high"},
                {"query": "Docker compose tutorial", "volume": "medium"},
                {"query": "Kubernetes deployment", "volume": "medium"},
                {"query": "TypeScript generics", "volume": "low"},
            ],
            "web_development": [
                {"query": "Next.js 14 features", "volume": "high"},
                {"query": "Tailwind CSS components", "volume": "high"},
                {"query": "GraphQL vs REST", "volume": "medium"},
                {"query": "WebSocket real-time", "volume": "medium"},
                {"query": "PWA implementation", "volume": "low"},
            ],
            "ai_ml": [
                {"query": "LLM fine-tuning", "volume": "high"},
                {"query": "Transformer architecture", "volume": "medium"},
                {"query": "PyTorch vs TensorFlow", "volume": "medium"},
                {"query": "Computer vision CNN", "volume": "low"},
                {"query": "Reinforcement learning", "volume": "low"},
            ],
        }
        
        return {
            "trends": trends,
            "timestamp": datetime.now().isoformat(),
            "source": "ISSALAN Search Trends",
        }
        
    except Exception as e:
        logger.error(f"Erreur dans /api/web/search/trends: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search/summarize")
async def summarize_search_results(request: WebSearchRequest):
    """
    Résume les résultats de recherche avec IA.
    
    Args:
        request: Requête de recherche à résumer
        
    Returns:
        Résumé des résultats
    """
    try:
        # D'abord effectuer la recherche
        search_response = await web_search(request)
        
        # Préparer le prompt pour le résumé
        results_text = ""
        for i, result in enumerate(search_response.results[:5], 1):
            results_text += f"{i}. {result.title}\n"
            results_text += f"   {result.snippet}\n"
            results_text += f"   Source: {result.search_engine}\n\n"
        
        # Utiliser DeepSeek pour résumer (à implémenter)
        # Pour l'instant, retourner un résumé simple
        summary = f"Recherche pour '{request.query}' a trouvé {search_response.total_results} résultats. "
        summary += "Les résultats les plus pertinents incluent des informations sur "
        summary += ", ".join([r.title[:30] + "..." for r in search_response.results[:3]])
        
        return {
            "query": request.query,
            "summary": summary,
            "total_results": search_response.total_results,
            "top_results": [
                {
                    "title": r.title,
                    "link": r.link,
                    "snippet": r.snippet[:100] + "..." if len(r.snippet) > 100 else r.snippet,
                }
                for r in search_response.results[:3]
            ],
            "timestamp": datetime.now().isoformat(),
        }
        
    except Exception as e:
        logger.error(f"Erreur dans /api/web/search/summarize: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/cache/stats")
async def get_cache_stats():
    """
    Récupère les statistiques du cache de recherche.
    
    Returns:
        Statistiques du cache
    """
    try:
        stats = search_orchestrator.get_cache_stats()
        
        # Ajouter les stats des moteurs individuels
        google_stats = search_orchestrator.google_client.get_cache_stats()
        duckduckgo_stats = search_orchestrator.duckduckgo_client.get_cache_stats()
        
        return {
            "orchestrator_cache": stats,
            "google_cache": google_stats,
            "duckduckgo_cache": duckduckgo_stats,
            "timestamp": datetime.now().isoformat(),
        }
        
    except Exception as e:
        logger.error(f"Erreur dans /api/web/cache/stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cache/clear")
async def clear_cache():
    """
    Vide le cache de recherche.
    
    Returns:
        Confirmation
    """
    try:
        search_orchestrator.clear_cache()
        search_orchestrator.google_client.clear_cache()
        search_orchestrator.duckduckgo_client.clear_cache()
        
        return {
            "message": "Cache vidé avec succès",
            "timestamp": datetime.now().isoformat(),
        }
        
    except Exception as e:
        logger.error(f"Erreur dans /api/web/cache/clear: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Import datetime à la fin pour éviter les problèmes circulaires
from datetime import datetime

# Exporter le routeur
__all__ = ["router", "init_web_endpoints"]