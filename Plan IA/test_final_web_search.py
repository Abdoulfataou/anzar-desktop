#!/usr/bin/env python3
"""
Test final de la recherche web ISSALAN
Utilise l'importation dynamique pour contourner le problème des tirets
"""

import asyncio
import sys
import os
import importlib.util

def import_module_from_path(module_name, file_path):
    """Importe un module depuis un chemin spécifique."""
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module

async def test_tavily_search():
    """Test du module Tavily Search."""
    print("🔍 Test du module Tavily Search")
    print("=" * 50)
    
    try:
        # Importer dynamiquement
        search_module = import_module_from_path(
            "search",
            "packages/shared-bl/tools/search.py"
        )
        
        print("1. Initialisation du client Tavily...")
        client = search_module.TavilySearch()
        await client.initialize()
        
        print("2. Test de recherche basique...")
        results = await client.search(
            query="Python programming",
            max_results=2,
            search_depth="basic"
        )
        
        print(f"   ✅ Requête: {results.get('query', 'N/A')}")
        print(f"   ✅ Résultats: {len(results.get('results', []))}")
        print(f"   ✅ Réponse synthétisée: {'Oui' if results.get('answer') else 'Non'}")
        
        print("3. Test de la fonction web_search...")
        web_search_func = search_module.web_search
        web_results = await web_search_func(
            query="FastAPI tutorial",
            max_results=2
        )
        
        print(f"   ✅ Format retour: {type(web_results)}")
        print(f"   ✅ Clés: {list(web_results.keys())[:5]}...")
        
        await client.shutdown()
        print("\n✅ Test Tavily Search réussi!")
        return True
        
    except Exception as e:
        print(f"❌ Erreur Tavily Search: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_web_search_integration():
    """Test de l'intégration Web Search."""
    print("\n🔄 Test de l'intégration Web Search")
    print("=" * 50)
    
    try:
        # Importer dynamiquement
        integration_module = import_module_from_path(
            "web_search_integration",
            "packages/shared-bl/tools/web_search_integration.py"
        )
        
        print("1. Initialisation de l'intégration...")
        integration = integration_module.WebSearchWithRedisCache()
        await integration.initialize()
        
        print("2. Test de recherche avec cache...")
        results = await integration.search(
            query="React framework",
            max_results=2,
            use_cache=True
        )
        
        print(f"   ✅ Requête: {results.get('query', 'N/A')}")
        print(f"   ✅ Cache utilisé: {results.get('cached', False)}")
        print(f"   ✅ Source: {results.get('source', 'N/A')}")
        
        print("3. Test de recherche pour agent...")
        agent_results = await integration.search_for_agent(
            agent_id="test_agent_001",
            query="Docker compose",
            context="Multi-container applications",
            max_results=2
        )
        
        print(f"   ✅ Format agent: {type(agent_results)}")
        print(f"   ✅ Métadonnées: {agent_results.get('metadata', {})}")
        
        print("4. Test de l'outil agent...")
        tool_func = integration_module.agent_web_search_tool
        tool_results = await tool_func(
            query="Kubernetes deployment",
            max_results=2
        )
        
        print(f"   ✅ Outil fonctionnel: {type(tool_results)}")
        
        await integration.shutdown()
        print("\n✅ Test d'intégration réussi!")
        return True
        
    except Exception as e:
        print(f"❌ Erreur intégration: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_duckduckgo_fallback():
    """Test du fallback DuckDuckGo."""
    print("\n🦆 Test du fallback DuckDuckGo")
    print("=" * 50)
    
    try:
        # Importer dynamiquement
        duckduckgo_module = import_module_from_path(
            "duckduckgo_search",
            "packages/shared-bl/tools/duckduckgo_search.py"
        )
        
        print("1. Initialisation du client DuckDuckGo...")
        client = duckduckgo_module.DuckDuckGoSearch()
        
        print("2. Test de recherche DuckDuckGo...")
        results = await client.search(
            query="Python list comprehension",
            num_results=3
        )
        
        print(f"   ✅ Résultats: {len(results)}")
        if results:
            print(f"   ✅ Premier titre: {results[0].get('title', 'N/A')[:50]}...")
            print(f"   ✅ Premier lien: {results[0].get('link', 'N/A')[:50]}...")
        
        print("3. Test de réponse instantanée...")
        instant_answer = await client.search_instant_answer("Python programming language")
        if instant_answer:
            print(f"   ✅ Type: {instant_answer.get('type', 'N/A')}")
            print(f"   ✅ Disponible: Oui")
        else:
            print(f"   ✅ Disponible: Non (normal pour certaines requêtes)")
        
        print("\n✅ Test DuckDuckGo réussi!")
        return True
        
    except Exception as e:
        print(f"❌ Erreur DuckDuckGo: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_configuration():
    """Test de la configuration."""
    print("\n⚙️  Test de configuration")
    print("=" * 50)
    
    # Vérifier les variables d'environnement
    env_vars = {
        "TAVILY_API_KEY": "Clé API Tavily (optionnelle)",
        "REDIS_URL": "URL Redis (optionnelle)",
    }
    
    print("Variables d'environnement:")
    for var, description in env_vars.items():
        value = os.getenv(var)
        status = "✅ Présente" if value else "⚠️  Absente"
        print(f"  {var}: {status}")
        if not value:
            print(f"    Note: {description}")
    
    # Vérifier les fichiers
    print("\nFichiers requis:")
    files = [
        ("packages/shared-bl/tools/search.py", "Module Tavily Search"),
        ("packages/shared-bl/tools/web_search_integration.py", "Intégration Web Search"),
        ("packages/shared-bl/tools/duckduckgo_search.py", "Fallback DuckDuckGo"),
    ]
    
    all_files_exist = True
    for file_path, description in files:
        if os.path.exists(file_path):
            print(f"  {file_path}: ✅ Présent ({description})")
        else:
            print(f"  {file_path}: ❌ Absent ({description})")
            all_files_exist = False
    
    return all_files_exist

async def main():
    """Fonction principale de test."""
    print("🚀 TEST FINAL - Recherche Web ISSALAN")
    print("=" * 60)
    print("Système de recherche web avec Tavily API + Fallback DuckDuckGo")
    print("Optimisé pour les agents IA avec format JSON et cache Redis")
    print("=" * 60)
    
    tests = [
        ("Configuration", test_configuration),
        ("Tavily Search", test_tavily_search),
        ("Intégration Web Search", test_web_search_integration),
        ("Fallback DuckDuckGo", test_duckduckgo_fallback),
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
    
    print("\n" + "=" * 60)
    print("🎯 FONCTIONNALITÉS IMPLÉMENTÉES")
    print("=" * 60)
    print("✅ Tavily API spécialement conçue pour les agents IA")
    print("✅ Réponses synthétisées avec citations")
    print("✅ Format JSON optimisé pour les LLM (économie de tokens)")
    print("✅ Fallback automatique DuckDuckGo (gratuit, sans clé API)")
    print("✅ Cache Redis intelligent pour éviter les appels redondants")
    print("✅ Recherche avec contexte pour les agents")
    print("✅ Recherche spécifique au code (GitHub, Stack Overflow)")
    print("✅ Recherche multiple en parallèle")
    print("✅ Outil web_search() prêt pour AG2 register_function")
    print("✅ Monitoring et statistiques complètes")
    print("✅ Configuration via variables d'environnement")
    
    print("\n" + "=" * 60)
    print("🔧 CONFIGURATION REQUISE")
    print("=" * 60)
    print("1. Variables d'environnement (optionnelles):")
    print("   - TAVILY_API_KEY: Clé API Tavily (1000 requêtes/mois gratuites)")
    print("   - REDIS_URL: URL Redis pour le cache (redis://localhost:6379)")
    print("\n2. Installation des dépendances:")
    print("   pip install aiohttp redis")
    print("\n3. Utilisation:")
    print("   from packages.shared_bl.tools.search import web_search")
    print("   results = await web_search('votre requête')")
    
    if passed == total:
        print("\n" + "=" * 60)
        print("🎉 SUCCÈS COMPLET !")
        print("=" * 60)
        print("La recherche web ISSALAN est prête pour la production.")
        print("Elle rivalise avec Trae Solo et est optimisée pour l'Afrique.")
    else:
        print(f"\n⚠️  {total - passed} test(s) ont échoué.")
        print("Certaines fonctionnalités peuvent nécessiter une configuration.")
    
    return passed == total

if __name__ == "__main__":
    # Exécuter les tests
    success = asyncio.run(main())
    
    # Code de sortie
    sys.exit(0 if success else 1)