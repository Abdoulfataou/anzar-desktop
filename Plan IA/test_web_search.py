#!/usr/bin/env python3
"""
Test de la recherche web intégrée ISSALAN
"""

import asyncio
import sys
import os

# Ajouter le chemin du projet
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import relatif
try:
    from packages.shared_bl.tools.search_orchestrator import SearchOrchestrator, SearchType, SearchEngine
except ImportError:
    # Fallback pour les systèmes où le tiret pose problème
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'packages/shared-bl'))
    from tools.search_orchestrator import SearchOrchestrator, SearchType, SearchEngine

async def test_web_search():
    """Test complet de la recherche web."""
    print("🚀 Test de la recherche web intégrée ISSALAN")
    print("=" * 60)
    
    # Initialiser l'orchestrateur
    orchestrator = SearchOrchestrator()
    
    # Test 1: Recherche générale
    print("\n1. Test recherche générale...")
    result = await orchestrator.search(
        "Python async programming tutorial",
        search_type=SearchType.GENERAL,
        config={"max_results": 3}
    )
    
    print(f"   Résultats: {result['total_results']}")
    for i, res in enumerate(result['results'][:3], 1):
        print(f"   {i}. {res['title'][:50]}...")
        print(f"      Source: {res.get('search_engine', 'unknown')}")
        print(f"      URL: {res['link'][:80]}...")
    
    # Test 2: Recherche d'exemples de code
    print("\n2. Test recherche exemples de code...")
    result = await orchestrator.search(
        "Python list comprehension examples",
        search_type=SearchType.CODE_EXAMPLES,
        config={"max_results": 3}
    )
    
    print(f"   Exemples de code: {result['total_results']}")
    for i, res in enumerate(result['results'][:3], 1):
        print(f"   {i}. {res['title'][:50]}...")
        if 'relevance_score' in res:
            print(f"      Score: {res['relevance_score']}")
    
    # Test 3: Recherche solution erreur
    print("\n3. Test recherche solution erreur...")
    result = await orchestrator.search(
        "Python TypeError NoneType object is not iterable",
        search_type=SearchType.ERROR_SOLUTION,
        config={"max_results": 3}
    )
    
    print(f"   Solutions erreur: {result['total_results']}")
    for i, res in enumerate(result['results'][:3], 1):
        print(f"   {i}. {res['title'][:50]}...")
        if 'solution_score' in res:
            print(f"      Score: {res['solution_score']}")
    
    # Test 4: Recherche avec contexte de code
    print("\n4. Test recherche avec contexte de code...")
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
    
    print(f"   Concepts extraits: {result['code_context']['concepts']}")
    print(f"   Requêtes générées: {result['search_queries']}")
    print(f"   Résultats contextuels: {result['total_results']}")
    
    # Test 5: Statistiques cache
    print("\n5. Test statistiques cache...")
    stats = orchestrator.get_cache_stats()
    print(f"   Taille cache: {stats['size']}")
    
    # Test 6: Recherche avec moteur spécifique
    print("\n6. Test recherche Google uniquement...")
    result = await orchestrator.search(
        "React hooks tutorial",
        search_type=SearchType.GENERAL,
        config={
            "max_results": 2,
            "preferred_engine": SearchEngine.GOOGLE
        }
    )
    
    print(f"   Résultats Google: {result['total_results']}")
    for i, res in enumerate(result['results'][:2], 1):
        print(f"   {i}. {res['title'][:50]}...")
        print(f"      Source: {res.get('search_engine', 'unknown')}")
    
    # Test 7: Recherche DuckDuckGo uniquement
    print("\n7. Test recherche DuckDuckGo uniquement...")
    result = await orchestrator.search(
        "Vue.js components",
        search_type=SearchType.GENERAL,
        config={
            "max_results": 2,
            "preferred_engine": SearchEngine.DUCKDUCKGO
        }
    )
    
    print(f"   Résultats DuckDuckGo: {result['total_results']}")
    for i, res in enumerate(result['results'][:2], 1):
        print(f"   {i}. {res['title'][:50]}...")
        print(f"      Source: {res.get('search_engine', 'unknown')}")
    
    print("\n" + "=" * 60)
    print("✅ Tests de recherche web complétés avec succès !")
    
    # Nettoyer le cache
    orchestrator.clear_cache()
    print("🧹 Cache nettoyé")

async def test_api_endpoints():
    """Test des endpoints API."""
    print("\n🔧 Test des endpoints API...")
    
    try:
        import httpx
        import json
        
        # URL de l'API
        base_url = "http://localhost:8000"
        
        # Test endpoint racine
        print("   Test endpoint racine...")
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{base_url}/")
            if response.status_code == 200:
                print("   ✅ Endpoint racine fonctionnel")
            else:
                print(f"   ❌ Erreur: {response.status_code}")
        
        # Test endpoint recherche web
        print("   Test endpoint recherche web...")
        search_data = {
            "query": "Python programming",
            "search_type": "general",
            "max_results": 2
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/api/web/search",
                json=search_data,
                timeout=30.0
            )
            
            if response.status_code == 200:
                result = response.json()
                print(f"   ✅ Recherche réussie: {result['total_results']} résultats")
            else:
                print(f"   ❌ Erreur: {response.status_code}")
                print(f"   Détail: {response.text}")
    
    except Exception as e:
        print(f"   ⚠️  Impossible de tester les endpoints: {e}")
        print("   Assurez-vous que le serveur est démarré: python3 packages/shared-bl/api/main.py")

def main():
    """Fonction principale."""
    print("ISSALAN - Test de la recherche web intégrée")
    print("Version: Phase 2 - Recherche Web")
    print()
    
    # Exécuter les tests
    asyncio.run(test_web_search())
    
    # Demander si l'utilisateur veut tester les endpoints API
    print("\n" + "=" * 60)
    test_api = input("Voulez-vous tester les endpoints API ? (o/n): ")
    
    if test_api.lower() == 'o':
        asyncio.run(test_api_endpoints())
    
    print("\n" + "=" * 60)
    print("🎉 Tests terminés !")
    print("\nPour démarrer le serveur API:")
    print("  cd /Users/agahmadou/Desktop/ISSALAN")
    print("  python3 packages/shared-bl/api/main.py")
    print("\nPour utiliser la recherche web:")
    print("  POST http://localhost:8000/api/web/search")
    print("  POST http://localhost:8000/api/web/search/code-context")
    print("  GET  http://localhost:8000/api/web/search/trends")

if __name__ == "__main__":
    main()