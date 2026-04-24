"""
Recherche DuckDuckGo intégrée pour ISSALAN
Alternative gratuite à Google Search
"""

import os
import json
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import asyncio
import aiohttp
from urllib.parse import quote_plus, urlencode
import re

logger = logging.getLogger(__name__)

class DuckDuckGoSearch:
    """Client pour la recherche DuckDuckGo."""
    
    def __init__(self):
        """
        Initialise le client DuckDuckGo Search.
        """
        self.base_url = "https://html.duckduckgo.com/html/"
        self.api_url = "https://api.duckduckgo.com/"
        
        # Cache pour éviter les requêtes répétitives
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl = timedelta(minutes=10)  # TTL plus long car gratuit
        
        # Headers pour simuler un navigateur
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }
    
    async def search(self, query: str, num_results: int = 10, region: str = "fr-fr", 
                    safe_search: bool = True) -> List[Dict[str, Any]]:
        """
        Effectue une recherche DuckDuckGo.
        
        Args:
            query: Termes de recherche
            num_results: Nombre de résultats (1-30)
            region: Région pour la recherche
            safe_search: Activer le filtrage de contenu
            
        Returns:
            Liste des résultats de recherche
        """
        # Vérifier le cache
        cache_key = f"{query}_{num_results}_{region}"
        if cache_key in self.cache:
            cached_data = self.cache[cache_key]
            if datetime.now() - cached_data["timestamp"] < self.cache_ttl:
                logger.info(f"Résultats de cache pour: {query}")
                return cached_data["results"]
        
        # Préparer les paramètres
        params = {
            "q": query,
            "kl": region,  # Région linguistique
            "kp": "1" if safe_search else "-1",  # Safe search
            "df": "d",  # Date range (any time)
        }
        
        try:
            # Effectuer la requête HTML
            async with aiohttp.ClientSession(headers=self.headers) as session:
                async with session.post(self.base_url, data=params) as response:
                    if response.status != 200:
                        logger.error(f"Erreur DuckDuckGo: {response.status}")
                        return []
                    
                    html = await response.text()
                    
                    # Parser les résultats HTML
                    results = self._parse_html_results(html)
                    
                    # Limiter le nombre de résultats
                    results = results[:num_results]
                    
                    # Mettre en cache
                    self.cache[cache_key] = {
                        "timestamp": datetime.now(),
                        "results": results
                    }
                    
                    logger.info(f"Recherche DuckDuckGo réussie: {query} ({len(results)} résultats)")
                    return results
                    
        except Exception as e:
            logger.error(f"Erreur lors de la recherche DuckDuckGo: {e}")
            return []
    
    def _parse_html_results(self, html: str) -> List[Dict[str, Any]]:
        """
        Parse les résultats HTML de DuckDuckGo.
        
        Args:
            html: Contenu HTML de la page de résultats
            
        Returns:
            Liste structurée des résultats
        """
        results = []
        
        # Patterns pour extraire les résultats
        result_pattern = r'<a\s+class="result__url"\s+href="([^"]+)"[^>]*>([^<]+)</a>.*?<h2\s+class="result__title">.*?<a\s+class="result__a"[^>]*>([^<]+)</a>.*?<a\s+class="result__snippet"[^>]*>([^<]+)</a>'
        
        # Version améliorée du pattern
        improved_pattern = r'<div\s+class="result[^"]*">.*?<a\s+class="result__url"[^>]*href="([^"]+)"[^>]*>([^<]+)</a>.*?<h2[^>]*>.*?<a[^>]*>([^<]+)</a>.*?<a[^>]*class="result__snippet"[^>]*>(.*?)</a>'
        
        # Essayer avec le pattern amélioré
        matches = re.findall(improved_pattern, html, re.DOTALL)
        
        for match in matches:
            if len(match) >= 4:
                url = match[0].strip()
                display_url = match[1].strip()
                title = match[2].strip()
                snippet = match[3].strip()
                
                # Nettoyer le snippet HTML
                snippet = re.sub(r'<[^>]+>', '', snippet)
                snippet = re.sub(r'\s+', ' ', snippet).strip()
                
                result = {
                    "title": title,
                    "link": url,
                    "snippet": snippet,
                    "display_link": display_url,
                    "source": "duckduckgo",
                }
                
                # Essayer d'extraire des informations supplémentaires
                if "wikipedia.org" in url:
                    result["type"] = "wikipedia"
                elif "stackoverflow.com" in url or "stackexchange.com" in url:
                    result["type"] = "stackoverflow"
                elif "github.com" in url:
                    result["type"] = "github"
                elif "youtube.com" in url:
                    result["type"] = "youtube"
                elif "reddit.com" in url:
                    result["type"] = "reddit"
                else:
                    result["type"] = "website"
                
                results.append(result)
        
        # Si pas de résultats avec le pattern amélioré, essayer une approche différente
        if not results:
            results = self._parse_html_fallback(html)
        
        return results
    
    def _parse_html_fallback(self, html: str) -> List[Dict[str, Any]]:
        """
        Méthode de fallback pour parser les résultats HTML.
        
        Args:
            html: Contenu HTML
            
        Returns:
            Liste des résultats
        """
        results = []
        
        # Chercher les liens de résultats
        link_pattern = r'<a\s+href="([^"]+)"[^>]*class="result__a"[^>]*>([^<]+)</a>'
        link_matches = re.findall(link_pattern, html)
        
        for url, title in link_matches:
            # Vérifier que c'est un résultat valide (pas un lien interne)
            if not url.startswith("/") and "duckduckgo.com" not in url:
                # Chercher le snippet correspondant
                snippet_pattern = rf'{re.escape(url)}[^>]*>.*?</a>.*?<a[^>]*class="result__snippet"[^>]*>(.*?)</a>'
                snippet_match = re.search(snippet_pattern, html, re.DOTALL)
                
                snippet = ""
                if snippet_match:
                    snippet = snippet_match.group(1)
                    snippet = re.sub(r'<[^>]+>', '', snippet)
                    snippet = re.sub(r'\s+', ' ', snippet).strip()
                
                result = {
                    "title": title.strip(),
                    "link": url.strip(),
                    "snippet": snippet,
                    "display_link": url.split("//")[-1].split("/")[0] if "//" in url else url,
                    "source": "duckduckgo",
                }
                
                results.append(result)
        
        return results
    
    async def search_instant_answer(self, query: str) -> Optional[Dict[str, Any]]:
        """
        Recherche la réponse instantanée (Instant Answer) de DuckDuckGo.
        
        Args:
            query: Termes de recherche
            
        Returns:
            Réponse instantanée si disponible
        """
        params = {
            "q": query,
            "format": "json",
            "no_html": "1",
            "skip_disambig": "1",
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.api_url, params=params) as response:
                    if response.status != 200:
                        return None
                    
                    data = await response.json()
                    
                    # Vérifier si une réponse instantanée est disponible
                    if data.get("AbstractText"):
                        return {
                            "type": "instant_answer",
                            "heading": data.get("Heading", ""),
                            "abstract": data.get("AbstractText", ""),
                            "abstract_source": data.get("AbstractSource", ""),
                            "abstract_url": data.get("AbstractURL", ""),
                            "image": data.get("Image", ""),
                            "related_topics": data.get("RelatedTopics", []),
                        }
                    
                    # Vérifier les définitions
                    elif data.get("Definition"):
                        return {
                            "type": "definition",
                            "term": data.get("Heading", query),
                            "definition": data.get("Definition", ""),
                            "source": data.get("DefinitionSource", ""),
                            "url": data.get("DefinitionURL", ""),
                        }
                    
                    # Vérifier les infobox
                    elif data.get("Infobox"):
                        return {
                            "type": "infobox",
                            "content": data.get("Infobox", {}),
                            "heading": data.get("Heading", ""),
                        }
                    
        except Exception as e:
            logger.error(f"Erreur lors de la recherche de réponse instantanée: {e}")
        
        return None
    
    async def search_code_examples(self, language: str, concept: str) -> List[Dict[str, Any]]:
        """
        Recherche des exemples de code avec DuckDuckGo.
        
        Args:
            language: Langage de programmation
            concept: Concept à rechercher
            
        Returns:
            Exemples de code pertinents
        """
        query = f"{language} {concept} code example site:github.com OR site:stackoverflow.com"
        
        results = await self.search(query, num_results=15, region="wt-wt")  # Worldwide
        
        # Filtrer pour les résultats de code
        code_results = []
        for result in results:
            # Vérifier si c'est un résultat de code
            if any(keyword in result["title"].lower() or keyword in result["snippet"].lower()
                  for keyword in ["example", "code", "tutorial", "how to", "implementation"]):
                
                # Classer par pertinence
                score = 0
                if language.lower() in result["title"].lower():
                    score += 3
                if concept.lower() in result["title"].lower():
                    score += 2
                if "github.com" in result["link"]:
                    score += 1
                if "stackoverflow.com" in result["link"]:
                    score += 1
                
                result["relevance_score"] = score
                code_results.append(result)
        
        # Trier par score de pertinence
        code_results.sort(key=lambda x: x.get("relevance_score", 0), reverse=True)
        
        return code_results[:10]
    
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
        query = f"{language} {clean_error} solution"
        
        results = await self.search(query, num_results=15, region="wt-wt")
        
        # Filtrer pour les solutions
        solutions = []
        for result in results:
            # Vérifier si c'est une solution
            if any(keyword in result["title"].lower() or keyword in result["snippet"].lower()
                  for keyword in ["solution", "fix", "error", "troubleshoot", "debug"]):
                
                # Classer par pertinence
                score = 0
                if "stackoverflow.com" in result["link"]:
                    score += 3
                if "github.com" in result["link"]:
                    score += 2
                if "issue" in result["title"].lower():
                    score += 1
                
                result["solution_score"] = score
                solutions.append(result)
        
        # Trier par score
        solutions.sort(key=lambda x: x.get("solution_score", 0), reverse=True)
        
        return solutions[:5]
    
    async def search_multiple(self, queries: List[str], num_results: int = 5) -> Dict[str, List[Dict[str, Any]]]:
        """
        Recherche multiple en parallèle.
        
        Args:
            queries: Liste des requêtes
            num_results: Nombre de résultats par requête
            
        Returns:
            Dictionnaire des résultats par requête
        """
        tasks = []
        for query in queries:
            task = self.search(query, num_results=num_results)
            tasks.append(task)
        
        results_list = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Traiter les résultats
        results_dict = {}
        for i, query in enumerate(queries):
            if isinstance(results_list[i], Exception):
                logger.error(f"Erreur pour la requête '{query}': {results_list[i]}")
                results_dict[query] = []
            else:
                results_dict[query] = results_list[i]
        
        return results_dict
    
    def clear_cache(self):
        """Vide le cache."""
        self.cache.clear()
        logger.info("Cache DuckDuckGo vidé")
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques du cache."""
        return {
            "size": len(self.cache),
            "keys": list(self.cache.keys()),
            "ttl_minutes": self.cache_ttl.total_seconds() / 60,
        }


# Instance globale
duckduckgo_search_client = None

def get_duckduckgo_search_client() -> DuckDuckGoSearch:
    """Factory pour obtenir le client DuckDuckGo Search."""
    global duckduckgo_search_client
    if duckduckgo_search_client is None:
        duckduckgo_search_client = DuckDuckGoSearch()
    return duckduckgo_search_client


# Test rapide
if __name__ == "__main__":
    import asyncio
    
    async def test():
        client = DuckDuckGoSearch()
        
        # Test de recherche basique
        print("Test recherche basique...")
        results = await client.search("Python programming tutorial", num_results=5)
        print(f"Résultats: {len(results)}")
        for i, result in enumerate(results[:3], 1):
            print(f"{i}. {result['title']}")
            print(f"   {result['link']}")
            print(f"   {result['snippet'][:100]}...")
            print()
        
        # Test réponse instantanée
        print("\nTest réponse instantanée...")
        instant_answer = await client.search_instant_answer("Python programming language")
        if instant_answer:
            print(f"Type: {instant_answer['type']}")
            if instant_answer['type'] == 'instant_answer':
                print(f"Résumé: {instant_answer['abstract'][:200]}...")
        
        # Test recherche d'exemples de code
        print("\nTest recherche exemples de code...")
        code_results = await client.search_code_examples("python", "list comprehension")
        print(f"Exemples de code: {len(code_results)}")
        
        # Test recherche solution erreur
        print("\nTest recherche solution erreur...")
        error_results = await client.search_error_solution("IndexError: list index out of range", "python")
        print(f"Solutions erreur: {len(error_results)}")
        
        # Test recherche multiple
        print("\nTest recherche multiple...")
        queries = ["Python", "JavaScript", "React"]
        multi_results = await client.search_multiple(queries, num_results=3)
        for query, results in multi_results.items():
            print(f"{query}: {len(results)} résultats")
    
    asyncio.run(test())