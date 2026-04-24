#!/usr/bin/env python3
"""
Test simple de la recherche web ISSALAN
"""

import asyncio
import sys
import os

# Ajouter le chemin du projet
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Ajouter le chemin du package shared-bl
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'packages/shared-bl'))

# Importer directement depuis le module
from tools.search_orchestrator import SearchOrchestrator, SearchType, SearchEngine

async def main():
    """Test principal."""
    print("🔍 Test de la recherche web ISSALAN")
    print("=" * 50)
    
    try:
        # Initialiser l'orchestrateur
        orchestrator = SearchOrchestrator()
        print("✅ Orchestrateur initialisé")
        
        # Test simple
        print("\n🔎 Test recherche simple...")
        result = await orchestrator.search(
            "Python programming",
            search_type=SearchType.GENERAL,
            config={"max_results": 2}
        )
        
        print(f"✅ Recherche réussie: {result['total_results']} résultats")
        
        if result['total_results'] > 0:
            print("\n📋 Résultats:")
            for i, res in enumerate(result['results'], 1):
                print(f"  {i}. {res.get('title', 'Sans titre')[:60]}...")
                print(f"     Source: {res.get('search_engine', 'unknown')}")
                print(f"     URL: {res.get('link', '')[:80]}...")
                print()
        
        # Test cache
        print("📊 Statistiques cache:")
        stats = orchestrator.get_cache_stats()
        print(f"  Taille: {stats['size']}")
        
        # Nettoyer
        orchestrator.clear_cache()
        print("🧹 Cache nettoyé")
        
        print("\n" + "=" * 50)
        print("🎉 Test réussi !")
        
        # Afficher les endpoints disponibles
        print("\n🌐 Endpoints API disponibles:")
        print("  POST /api/web/search - Recherche web")
        print("  POST /api/web/search/code-context - Recherche contextuelle")
        print("  POST /api/web/search/batch - Recherche par lots")
        print("  GET  /api/web/search/trends - Tendances de recherche")
        print("  GET  /api/web/cache/stats - Statistiques cache")
        print("  POST /api/web/cache/clear - Nettoyer cache")
        
    except Exception as e:
        print(f"❌ Erreur: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)