#!/usr/bin/env python3
"""
Test simplifié de la recherche web ISSALAN
"""

import asyncio
import sys
import os

# Ajouter le chemin du projet
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

async def test_basic_search():
    """Test de recherche basique."""
    print("🔍 Test de recherche web ISSALAN")
    print("=" * 60)
    
    try:
        # Importer depuis le package
        from packages.shared_bl.tools.search import TavilySearch
        
        print("1. Initialisation du client Tavily...")
        client = TavilySearch()
        await client.initialize()
        
        print("2. Test de recherche basique...")
        results = await client.search(
            query="Python programming language",
            max_results=3,
            search_depth="basic"
        )
        
        print(f"   ✅ Requête: {results.get('query', 'N/A')}")
        print(f"   ✅ Nombre de résultats: {len(results.get('results', []))}")
        print(f"   ✅ Réponse synthétisée: {'Oui' if results.get('answer') else 'Non'}")
        
        if results.get("results"):
            print(f"   ✅ Premier résultat: {results['results'][0].get('title', 'N/A')[:50]}...")
        
        print("3. Test de fallback (simulé sans clé API)...")
        # Simuler l'absence de clé API
        original_api_key = client.api_key
        client.api_key = None
        
        fallback_results = await client.search(
            query="JavaScript tutorial",
            max_results=2
        )
        
        print(f"   ✅ Source: {fallback_results.get('source', 'N/A')}")
        print(f"   ✅ Résultats fallback: {len(fallback_results.get('results', []))}")
        
        # Restaurer la clé API
        client.api_key = original_api_key
        
        print("4. Test de cache...")
        cache_stats = client.get_cache_stats()
        print(f"   ✅ Taille du cache: {cache_stats.get('size', 0)}")
        
        await client.shutdown()
        
        print("\n✅ Test de recherche basique réussi!")
        return True
        
    except Exception as e:
        print(f"❌ Erreur lors du test: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_integration():
    """Test de l'intégration avec cache Redis."""
    print("\n🔄 Test de l'intégration avec cache Redis")
    print("=" * 60)
    
    try:
        from packages.shared_bl.tools.web_search_integration import WebSearchWithRedisCache
        
        print("1. Initialisation de l'intégration...")
        integration = WebSearchWithRedisCache()
        await integration.initialize()
        
        print("2. Test de recherche avec cache...")
        results = await integration.search(
            query="FastAPI framework",
            max_results=2,
            use_cache=True
        )
        
        print(f"   ✅ Requête: {results.get('query', 'N/A')}")
        print(f"   ✅ Cache utilisé: {results.get('cached', False)}")
        print(f"   ✅ Résultats: {len(results.get('results', []))}")
        
        print("3. Test de recherche pour agent...")
        agent_results = await integration.search_for_agent(
            agent_id="test_agent_001",
            query="React hooks",
            context="Functional components",
            max_results=2
        )
        
        print(f"   ✅ Agent ID: {agent_results.get('metadata', {}).get('agent_id', 'N/A')}")
        print(f"   ✅ Format agent: {type(agent_results)}")
        
        print("4. Test de statistiques...")
        stats = await integration.get_cache_stats()
        print(f"   ✅ Redis disponible: {stats.get('redis_available', False)}")
        print(f"   ✅ Hits cache: {integration.stats.get('cache_hits', 0)}")
        
        await integration.shutdown()
        
        print("\n✅ Test d'intégration réussi!")
        return True
        
    except Exception as e:
        print(f"❌ Erreur lors du test intégration: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_agent_tool():
    """Test de l'outil pour agents."""
    print("\n🤖 Test de l'outil pour agents IA")
    print("=" * 60)
    
    try:
        from packages.shared_bl.tools.web_search_integration import agent_web_search_tool
        
        print("1. Test de l'outil agent...")
        results = await agent_web_search_tool(
            query="Docker containerization",
            search_depth="basic",
            max_results=2,
            include_answer=True
        )
        
        print(f"   ✅ Type de retour: {type(results)}")
        print(f"   ✅ Clés disponibles: {list(results.keys())[:5]}...")
        print(f"   ✅ Résultats: {len(results.get('results', []))}")
        
        print("2. Test d'enregistrement de fonction (simulé)...")
        
        class MockAgent:
            def __init__(self):
                self.agent_id = "mock_agent_001"
                self.registered_functions = {}
            
            def register_function(self, func, name, description):
                self.registered_functions[name] = {
                    "func": func,
                    "description": description
                }
                print(f"   ✅ Fonction '{name}' enregistrée")
        
        from packages.shared_bl.tools.web_search_integration import get_web_search_integration
        integration = get_web_search_integration()
        await integration.initialize()
        
        mock_agent = MockAgent()
        await integration.register_agent_function(mock_agent)
        
        print(f"   ✅ Fonctions enregistrées: {list(mock_agent.registered_functions.keys())}")
        
        await integration.shutdown()
        
        print("\n✅ Test d'outil agent réussi!")
        return True
        
    except Exception as e:
        print(f"❌ Erreur lors du test agent: {e}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    """Fonction principale de test."""
    print("🚀 Test simplifié de la recherche web ISSALAN")
    print("=" * 60)
    
    tests = [
        ("Recherche basique", test_basic_search),
        ("Intégration Redis", test_integration),
        ("Outil Agent", test_agent_tool),
    ]
    
    results = []
    
    for test_name, test_func in tests:
        print(f"\n{'='*60}")
        print(f"Test: {test_name}")
        print(f"{'='*60}")
        
        try:
            success = await test_func()
            results.append((test_name, success))
            
            if success:
                print(f"\n✅ {test_name}: PASSÉ")
            else:
                print(f"\n❌ {test_name}: ÉCHOUÉ")
                
        except Exception as e:
            print(f"\n💥 {test_name}: ERREUR - {e}")
            import traceback
            traceback.print_exc()
            results.append((test_name, False))
    
    # Résumé
    print("\n" + "=" * 60)
    print("📊 RÉSUMÉ DES TESTS")
    print("=" * 60)
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    for test_name, success in results:
        status = "✅ PASSÉ" if success else "❌ ÉCHOUÉ"
        print(f"{test_name}: {status}")
    
    print(f"\nTotal: {passed}/{total} tests passés ({passed/total*100:.1f}%)")
    
    if passed == total:
        print("\n🎉 TOUS LES TESTS ONT RÉUSSI !")
        print("La recherche web ISSALAN est fonctionnelle.")
    else:
        print(f"\n⚠️  {total - passed} test(s) ont échoué.")
        print("Vérifiez les erreurs ci-dessus.")
    
    return passed == total

if __name__ == "__main__":
    # Exécuter les tests
    success = asyncio.run(main())
    
    # Code de sortie
    sys.exit(0 if success else 1)