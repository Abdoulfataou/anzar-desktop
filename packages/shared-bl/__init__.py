"""
Package shared-bl pour ISSALAN
Ce package contient la logique métier partagée entre les différentes applications.
"""

__version__ = "2.0.0"
__author__ = "ISSALAN Team"
__description__ = "Business Logic partagée pour ISSALAN"

# Import des modules principaux
from .tools.search_orchestrator import SearchOrchestrator, SearchType, SearchEngine
from .tools.google_search import GoogleSearch
from .tools.duckduckgo_search import DuckDuckGoSearch
from .tools.search import TavilySearch, get_tavily_search_client, web_search
from .tools.web_search_integration import WebSearchWithRedisCache, get_web_search_integration, agent_web_search_tool
from .api.web_endpoints import router as web_endpoints_router

# Exporter les éléments principaux
__all__ = [
    "SearchOrchestrator",
    "SearchType", 
    "SearchEngine",
    "GoogleSearch",
    "DuckDuckGoSearch",
    "TavilySearch",
    "get_tavily_search_client",
    "web_search",
    "WebSearchWithRedisCache",
    "get_web_search_integration",
    "agent_web_search_tool",
    "web_endpoints_router",
]
