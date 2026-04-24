#!/usr/bin/env python3
"""
Test complet de la recherche web ISSALAN avec Tavily API et fallback DuckDuckGo
"""

import asyncio
import sys
import os

# Ajouter le chemin du projet
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

async def test_tavily_module():
    """Test du module Tavily Search."""
    print("🧪 Test du module Tavily Search")
    print("=" * 50)
    
    try:
        from packages.shared-bl.tools.search import test_tavily_search
        await test_tavily_search()
        return True
    except Exception as e:
        print(f"❌ Erreur lors du test Tavily: {e}")
        return False

async def test_web_search_integration():
    """Test de l'intégration Web Search."""
    print("\n🧪 Test de l'intégration Web Search")
    print("=" * 50)
    
    try:
        from packages.shared_bl.tools.web_search_integration import test_web_search_integration
        await test_web_search_integration()
        return True
    except Exception as e:
        print(f"❌ Erreur lors du test intégration: {e}")
        return False

async def test_agent_integration():
    """Test de l'intégration avec les agents."""
    print("\n🤖 Test d'intégration avec les agents")
    print("=" * 50)
    
    try:
        from packages.shared_bl.tools.web_search_integration import (
            get_web_search_integration,
            agent_web_search_tool
        )
        
        # Test de la fonction outil agent
        print("1. Test de la fonction outil agent:")
        results = await agent_web_search_tool(
            query="Python asyncio tutorial",
            max_results=2
        )
        
        print(f"   ✅ Requête: {results.get('query', 'N/A')}")
        print(f"   ✅ Résultats: {len(results.get('results', []))}")
        print(f"   ✅ Réponse synthétisée: {'Oui' if results.get('answer') else 'Non'}")
        
        # Test de l'intégration complète
        print("\n2. Test de l'intégration complète:")
        integration = get_web_search_integration()
        await integration.initialize()
        
        # Recherche pour agent
        agent_results = await integration.search_for_agent(
            agent_id="test_agent_001",
            query="FastAPI authentication",
            context="JWT tokens implementation",
            max_results=2
        )
        
        print(f"   ✅ Format agent: {type(agent_results)}")
        print(f"   ✅ Métadonnées: {agent_results.get('metadata', {})}")
        print(f"   ✅ Statistiques: {agent_results.get('statistics', {})}")
        
        # Test d'enregistrement de fonction (simulé)
        print("\n3. Test d'enregistrement de fonction (simulé):")
        
        class MockAgent:
            def __init__(self):
                self.agent_id = "mock_agent_001"
                self.registered_functions = {}
            
            def register_function(self, func, name, description):
                self.registered_functions[name] = {
                    "func": func,
                    "description": description
                }
                print(f"   ✅ Fonction '{name}' enregistrée: {description[:50]}...")
        
        mock_agent = MockAgent()
        await integration.register_agent_function(mock_agent)
        
        print(f"   ✅ Fonctions enregistrées: {list(mock_agent.registered_functions.keys())}")
        
        await integration.shutdown()
        return True
        
    except Exception as e:
        print(f"❌ Erreur lors du test agent: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_configuration():
    """Test de la configuration."""
    print("\n⚙️  Test de configuration")
    print("=" * 50)
    
    # Vérifier les variables d'environnement
    env_vars = {
        "TAVILY_API_KEY": "Clé API Tavily (optionnelle, fallback disponible)",
        "REDIS_URL": "URL Redis (optionnelle, cache mémoire utilisé sinon)",
    }
    
    print("Variables d'environnement requises:")
    for var, description in env_vars.items():
        value = os.getenv(var)
        status = "✅ Présente" if value else "⚠️  Absente (fallback disponible)"
        print(f"  {var}: {status}")
        if not value and var == "TAVILY_API_KEY":
            print(f"    Note: {description}")
    
    # Vérifier les dépendances
    print("\nDépendances Python:")
    dependencies = [
        ("aiohttp", "Client HTTP asynchrone"),
        ("redis", "Client Redis asynchrone"),
        ("asyncio", "Bibliothèque asynchrone standard"),
    ]
    
    for dep, description in dependencies:
        try:
            __import__(dep)
            print(f"  {dep}: ✅ Installée ({description})")
        except ImportError:
            print(f"  {dep}: ❌ Manquante ({description})")
    
    return True

async def test_performance():
    """Test de performance."""
    print("\n⚡ Test de performance")
    print("=" * 50)
    
    try:
        from packages.shared_bl.tools.web_search_integration import get_web_search_integration
        
        integration = get_web_search_integration()
        await integration.initialize()
        
        # Test de recherche simple
        import time
        start_time = time.time()
        
        results = await integration.search(
            query="Python programming",
            max_results=3,
            use_cache=True
        )
        
        elapsed = time.time() - start_time
        
        print(f"Temps de recherche: {elapsed:.2f} secondes")
        print(f"Résultats: {len(results.get('results', []))}")
        print(f"Cache utilisé: {results.get('cached', False)}")
        
        if elapsed < 5:
            print("✅ Performance acceptable")
        else:
            print("⚠️  Performance lente (vérifier la connexion internet)")
        
        # Test de recherche multiple
        print("\nTest de recherche multiple:")
        queries = [
            {"query": "React", "max_results": 2},
            {"query": "Vue", "max_results": 2},
            {"query": "Angular", "max_results": 2},
        ]
        
        start_time = time.time()
        batch_results = await integration.batch_search(queries)
        elapsed = time.time() - start_time
        
        print(f"Temps de recherche multiple: {elapsed:.2f} secondes")
        print(f"Requêtes: {batch_results.get('statistics', {}).get('total_queries', 0)}")
        print(f"Réussies: {batch_results.get('statistics', {}).get('successful', 0)}")
        
        await integration.shutdown()
        return True
        
    except Exception as e:
        print(f"❌ Erreur lors du test performance: {e}")
        return False

async def main():
    """Fonction principale de test."""
    print("🚀 Test complet de la recherche web ISSALAN")
    print("=" * 60)
    
    tests = [
        ("Configuration", test_configuration),
        ("Module Tavily", test_tavily_module),
        ("Intégration Web Search", test_web_search_integration),
        ("Intégration Agents", test_agent_integration),
        ("Performance", test_performance),
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
    print("📊 RÉSUMUM DES TESTS")
    print("=" * 60)
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    for test_name, success in results:
        status = "✅ PASSÉ" if success else "❌ ÉCHOUÉ"
        print(f"{test_name}: {status}")
    
    print(f"\nTotal: {passed}/{total} tests passés ({passed/total*100:.1f}%)")
    
    if passed == total:
        print("\n🎉 TOUS LES TESTS ONT RÉUSSI !")
        print("La recherche web ISSALAN est prête pour la production.")
    else:
        print(f"\n⚠️  {total - passed} test(s) ont échoué.")
        print("Vérifiez les erreurs ci-dessus.")
    
    return passed == total

if __name__ == "__main__":
    # Exécuter les tests
    success = asyncio.run(main())
    
    # Code de sortie
    sys.exit(0 if success else 1)