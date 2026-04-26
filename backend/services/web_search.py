"""
Web Search Service — Recherche internet via Serper (Google Search API).

Utilisé comme outil (tool) par DeepSeek via function calling.
Serper offre 2 500 recherches gratuites, puis $0.30/1000 requêtes.

Usage:
    from services.web_search import search_web
    results = await search_web("dernière version de React")
"""

import logging
from typing import Optional
import httpx

from config import settings

logger = logging.getLogger(__name__)

SERPER_API_URL = "https://google.serper.dev/search"

# Définition de l'outil pour DeepSeek function calling
WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Recherche sur internet via Google. Utilise cet outil quand l'utilisateur "
            "pose une question sur des informations récentes, actuelles, des prix, "
            "des versions, des actualités, ou toute donnée qui change dans le temps."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "La requête de recherche Google (en français ou anglais)",
                },
                "num_results": {
                    "type": "integer",
                    "description": "Nombre de résultats (1-10, défaut 5)",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
}


async def search_web(
    query: str,
    num_results: int = 5,
    language: str = "fr",
    country: str = "ci",
) -> dict:
    """
    Recherche Google via Serper API.

    Args:
        query: Requête de recherche.
        num_results: Nombre de résultats (1-10).
        language: Langue des résultats (fr, en).
        country: Pays pour la localisation (ci = Côte d'Ivoire, sn = Sénégal).

    Returns:
        Dict avec clés: "results" (list), "query", "error" (si erreur).
    """
    api_key = getattr(settings, "serper_api_key", "")
    if not api_key:
        logger.warning("SERPER_API_KEY non configurée — recherche web désactivée")
        return {
            "query": query,
            "results": [],
            "error": "Recherche web non configurée (SERPER_API_KEY manquante)",
        }

    num_results = max(1, min(10, num_results))

    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }

    payload = {
        "q": query,
        "num": num_results,
        "hl": language,
        "gl": country,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            response = await client.post(SERPER_API_URL, json=payload, headers=headers)

        if response.status_code != 200:
            logger.error(f"Serper API error {response.status_code}: {response.text[:200]}")
            return {
                "query": query,
                "results": [],
                "error": f"Erreur Serper (HTTP {response.status_code})",
            }

        data = response.json()

        # Extraire les résultats organiques
        organic = data.get("organic", [])
        results = []
        for item in organic[:num_results]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("link", ""),
                "snippet": item.get("snippet", ""),
            })

        # Ajouter l'answer box si présente
        answer_box = data.get("answerBox")
        knowledge = data.get("knowledgeGraph")

        summary = ""
        if answer_box:
            summary = answer_box.get("answer") or answer_box.get("snippet", "")
        elif knowledge:
            summary = knowledge.get("description", "")

        logger.info(f"Web search: '{query}' -> {len(results)} résultats")

        return {
            "query": query,
            "summary": summary,
            "results": results,
        }

    except httpx.TimeoutException:
        logger.error(f"Serper timeout pour: {query}")
        return {"query": query, "results": [], "error": "Timeout recherche web"}
    except Exception as e:
        logger.error(f"Serper error: {e}")
        return {"query": query, "results": [], "error": str(e)}


def format_search_results(data: dict) -> str:
    """
    Formate les résultats de recherche en texte lisible pour le LLM.

    Args:
        data: Résultat de search_web().

    Returns:
        Texte formaté avec les résultats.
    """
    if data.get("error"):
        return f"Erreur de recherche: {data['error']}"

    parts = []

    if data.get("summary"):
        parts.append(f"Réponse rapide: {data['summary']}")

    for i, r in enumerate(data.get("results", []), 1):
        parts.append(f"{i}. {r['title']}\n   {r['snippet']}\n   Source: {r['url']}")

    if not parts:
        return f"Aucun résultat trouvé pour: {data.get('query', '')}"

    return "\n\n".join(parts)
