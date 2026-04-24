"""
Recherche Google intégrée pour ISSALAN
Utilise l'API Google Custom Search
"""

import os
import json
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import asyncio
import aiohttp
from urllib.parse import quote_plus

logger = logging.getLogger(__name__)

class GoogleSearch:
    """Client pour l'API Google Custom Search."""
    
    def __init__(self, api_key: Optional[str] = None, search_engine_id: Optional[str] = None):
        """
        Initialise le client Google Search.
        
        Args:
            api_key: Clé API Google Cloud
            search_engine_id: ID du moteur de recherche personnalisé
        """
        self.api_key = api_key or os.getenv("GOOGLE_API_KEY", "")
        self.search_engine_id = search_engine_id or os.getenv("GOOGLE_SEARCH_ENGINE_ID", "")
        self.base_url = "https://www.googleapis.com/customsearch/v1"
        
        # Cache pour éviter les requêtes répétitives
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl = timedelta(minutes=5)
        
        # Configuration par défaut
        self.default_params = {
            "num": 10,  # Nombre de résultats
            "lr": "lang_fr",  # Langue française
            "cr": "countryFR",  # Pays France
            "safe": "active",  # Filtrage de contenu
            "gl": "fr",  # Géolocalisation France
        }
    
    async def search(self, query: str, num_results: int = 10, language: str = "fr", 
                    country: str = "fr", safe_search: bool = True) -> List[Dict[str, Any]]:
        """
        Effectue une recherche Google.
        
        Args:
            query: Termes de recherche
            num_results: Nombre de résultats (1-10)
            language: Langue des résultats
            country: Pays pour la recherche
            safe_search: Activer le filtrage de contenu
            
        Returns:
            Liste des résultats de recherche
        """
        # Vérifier la configuration
        if not self.api_key or not self.search_engine_id:
            logger.warning("Google Search API non configurée")
            return []
        
        # Vérifier le cache
        cache_key = f"{query}_{num_results}_{language}_{country}"
        if cache_key in self.cache:
            cached_data = self.cache[cache_key]
            if datetime.now() - cached_data["timestamp"] < self.cache_ttl:
                logger.info(f"Résultats de cache pour: {query}")
                return cached_data["results"]
        
        # Préparer les paramètres
        params = {
            "key": self.api_key,
            "cx": self.search_engine_id,
            "q": query,
            "num": min(num_results, 10),  # Google limite à 10 résultats par requête
            "lr": f"lang_{language}",
            "cr": f"country{country.upper()}",
            "safe": "active" if safe_search else "off",
            "gl": country.lower(),
        }
        
        try:
            # Effectuer la requête
            async with aiohttp.ClientSession() as session:
                async with session.get(self.base_url, params=params) as response:
                    if response.status != 200:
                        logger.error(f"Erreur Google Search: {response.status}")
                        return []
                    
                    data = await response.json()
                    
                    # Parser les résultats
                    results = self._parse_results(data)
                    
                    # Mettre en cache
                    self.cache[cache_key] = {
                        "timestamp": datetime.now(),
                        "results": results
                    }
                    
                    logger.info(f"Recherche Google réussie: {query} ({len(results)} résultats)")
                    return results
                    
        except Exception as e:
            logger.error(f"Erreur lors de la recherche Google: {e}")
            return []
    
    def _parse_results(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Parse les résultats de l'API Google.
        
        Args:
            data: Données JSON de l'API
            
        Returns:
            Liste structurée des résultats
        """
        results = []
        
        if "items" not in data:
            return results
        
        for item in data["items"]:
            result = {
                "title": item.get("title", ""),
                "link": item.get("link", ""),
                "snippet": item.get("snippet", ""),
                "display_link": item.get("displayLink", ""),
                "formatted_url": item.get("formattedUrl", ""),
                "cache_id": item.get("cacheId", ""),
                "kind": item.get("kind", ""),
                "html_title": item.get("htmlTitle", ""),
                "html_snippet": item.get("htmlSnippet", ""),
                "mime": item.get("mime", ""),
                "file_format": item.get("fileFormat", ""),
            }
            
            # Extraire les métadonnées pagemap si disponibles
            if "pagemap" in item:
                pagemap = item["pagemap"]
                
                # Informations métas
                if "metatags" in pagemap and pagemap["metatags"]:
                    metatags = pagemap["metatags"][0]
                    result["meta"] = {
                        "description": metatags.get("og:description", metatags.get("description", "")),
                        "type": metatags.get("og:type", ""),
                        "site_name": metatags.get("og:site_name", ""),
                        "image": metatags.get("og:image", ""),
                    }
                
                # Informations techniques
                if "cse_thumbnail" in pagemap and pagemap["cse_thumbnail"]:
                    thumbnail = pagemap["cse_thumbnail"][0]
                    result["thumbnail"] = {
                        "src": thumbnail.get("src", ""),
                        "width": thumbnail.get("width", ""),
                        "height": thumbnail.get("height", ""),
                    }
            
            results.append(result)
        
        return results
    
    async def search_code_examples(self, language: str, concept: str, 
                                  framework: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Recherche des exemples de code spécifiques.
        
        Args:
            language: Langage de programmation
            concept: Concept à rechercher
            framework: Framework spécifique (optionnel)
            
        Returns:
            Exemples de code pertinents
        """
        query_parts = [f"{language} code example", concept]
        if framework:
            query_parts.append(framework)
        
        query = " ".join(query_parts)
        
        # Ajouter des sites spécifiques pour la qualité
        sites = [
            "site:github.com",
            "site:stackoverflow.com", 
            "site:developer.mozilla.org",
            "site:w3schools.com",
            "site:python.org",
            "site:npmjs.com",
            "site:docs.microsoft.com",
        ]
        
        query = f"{query} {' OR '.join(sites)}"
        
        results = await self.search(query, num_results=15, language="en")
        
        # Filtrer pour les résultats les plus pertinents
        code_results = []
        for result in results:
            # Vérifier si c'est un résultat de code
            if any(keyword in result["title"].lower() or keyword in result["snippet"].lower() 
                  for keyword in ["example", "code", "tutorial", "how to", "guide"]):
                
                # Classer par pertinence
                score = 0
                if language.lower() in result["title"].lower():
                    score += 3
                if concept.lower() in result["title"].lower():
                    score += 2
                if framework and framework.lower() in result["title"].lower():
                    score += 2
                
                result["relevance_score"] = score
                code_results.append(result)
        
        # Trier par score de pertinence
        code_results.sort(key=lambda x: x.get("relevance_score", 0), reverse=True)
        
        return code_results[:10]  # Retourner les 10 meilleurs
    
    async def search_documentation(self, technology: str, topic: str) -> List[Dict[str, Any]]:
        """
        Recherche de documentation technique.
        
        Args:
            technology: Technologie (ex: React, Python, Docker)
            topic: Sujet spécifique
            
        Returns:
            Documentation pertinente
        """
        query = f"{technology} {topic} documentation official"
        
        # Sites de documentation officiels
        official_sites = {
            "python": "site:python.org OR site:pypi.org",
            "javascript": "site:developer.mozilla.org OR site:w3schools.com",
            "typescript": "site:typescriptlang.org",
            "react": "site:reactjs.org OR site:react.dev",
            "vue": "site:vuejs.org",
            "angular": "site:angular.io",
            "docker": "site:docker.com",
            "kubernetes": "site:kubernetes.io",
            "aws": "site:aws.amazon.com",
            "azure": "site:azure.microsoft.com",
            "gcp": "site:cloud.google.com",
        }
        
        # Ajouter le site officiel si connu
        if technology.lower() in official_sites:
            query = f"{query} {official_sites[technology.lower()]}"
        
        results = await self.search(query, num_results=10, language="en")
        
        # Marquer les résultats officiels
        for result in results:
            result["is_official"] = any(
                official in result["link"].lower() 
                for official in ["python.org", "reactjs.org", "react.dev", "developer.mozilla.org", 
                               "docker.com", "kubernetes.io", "aws.amazon.com", "microsoft.com"]
            )
        
        return results
    
    async def search_error_solution(self, error_message: str, language: str = "python") -> List[Dict[str, Any]]:
        """
        Recherche des solutions pour une erreur spécifique.
        
        Args:
            error_message: Message d'erreur
            language: Langage de programmation
            
        Returns:
            Solutions potentielles
        """
        # Nettoyer le message d'erreur
        clean_error = error_message.split("\n")[0].strip()
        query = f"{language} {clean_error} solution fix"
        
        # Sites de support technique
        support_sites = [
            "site:stackoverflow.com",
            "site:github.com",
            "site:stackexchange.com",
            "site:reddit.com/r/programming",
            "site:medium.com",
            "site:dev.to",
        ]
        
        query = f"{query} {' OR '.join(support_sites)}"
        
        results = await self.search(query, num_results=15, language="en")
        
        # Analyser les résultats pour les solutions
        solutions = []
        for result in results:
            # Vérifier si c'est une solution Stack Overflow
            if "stackoverflow.com" in result["link"]:
                # Extraire le score si disponible
                if "score" in result.get("meta", {}):
                    result["stackoverflow_score"] = int(result["meta"]["score"])
                else:
                    result["stackoverflow_score"] = 0
                
                solutions.append(result)
        
        # Trier par score Stack Overflow
        solutions.sort(key=lambda x: x.get("stackoverflow_score", 0), reverse=True)
        
        return solutions[:5]  # Retourner les 5 meilleures solutions
    
    def clear_cache(self):
        """Vide le cache."""
        self.cache.clear()
        logger.info("Cache Google Search vidé")
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques du cache."""
        return {
            "size": len(self.cache),
            "keys": list(self.cache.keys()),
            "ttl_minutes": self.cache_ttl.total_seconds() / 60,
        }


# Instance globale
google_search_client = None

def get_google_search_client() -> GoogleSearch:
    """Factory pour obtenir le client Google Search."""
    global google_search_client
    if google_search_client is None:
        google_search_client = GoogleSearch()
    return google_search_client


# Test rapide
if __name__ == "__main__":
    import asyncio
    
    async def test():
        client = GoogleSearch()
        
        # Test de recherche basique
        print("Test recherche basique...")
        results = await client.search("Python async await tutorial", num_results=5)
        print(f"Résultats: {len(results)}")
        for i, result in enumerate(results[:3], 1):
            print(f"{i}. {result['title']}")
            print(f"   {result['link']}")
            print()
        
        # Test recherche d'exemples de code
        print("\nTest recherche exemples de code...")
        code_results = await client.search_code_examples("python", "async function", "asyncio")
        print(f"Exemples de code: {len(code_results)}")
        
        # Test recherche documentation
        print("\nTest recherche documentation...")
        doc_results = await client.search_documentation("React", "useState hook")
        print(f"Documentation: {len(doc_results)}")
        
        # Test recherche solution erreur
        print("\nTest recherche solution erreur...")
        error_results = await client.search_error_solution("TypeError: 'NoneType' object is not iterable", "python")
        print(f"Solutions erreur: {len(error_results)}")
    
    asyncio.run(test())