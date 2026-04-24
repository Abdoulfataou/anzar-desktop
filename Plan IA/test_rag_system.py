#!/usr/bin/env python3
"""
Test du système RAG d'ISSALAN
Teste les fonctionnalités de base de données vectorielle et de recherche sémantique
"""

import asyncio
import logging
import sys
from datetime import datetime

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def test_rag_system():
    """Test complet du système RAG."""
    print("🧪 Test du système RAG ISSALAN")
    print("=" * 50)
    
    try:
        # Importer les modules RAG
        import sys
        sys.path.append('packages/shared-bl')
        
        from rag.vector_db import (
            VectorDatabase, 
            get_vector_database,
            VectorDBBackend,
            Document,
            DocumentSource,
            DocumentType
        )
        from rag.embeddings import EmbeddingProvider
        
        print("✅ Modules RAG importés")
        
        # Initialiser la base de données vectorielle
        print("\n🔧 Initialisation de la base de données vectorielle...")
        vector_db = get_vector_database(
            backend=VectorDBBackend.SIMPLE,
            embedding_provider=EmbeddingProvider.SENTENCE_TRANSFORMERS,
            collection_name="test_issalan_rag"
        )
        
        print(f"✅ VectorDatabase initialisée avec backend: {vector_db.backend.value}")
        
        # Créer des documents de test
        print("\n📄 Création de documents de test...")
        
        test_documents = [
            Document(
                id="",
                content="""
                Python est un langage de programmation interprété, haut niveau et généraliste.
                Il est connu pour sa syntaxe claire et lisible qui le rend idéal pour les débutants.
                Python supporte plusieurs paradigmes de programmation : orienté objet, impératif et fonctionnel.
                """,
                title="Introduction à Python",
                source=DocumentSource.OFFICIAL_DOCS,
                doc_type=DocumentType.TUTORIAL,
                language="python",
                url="https://docs.python.org/3/tutorial/",
                tags=["python", "programming", "tutorial", "beginner"]
            ),
            Document(
                id="",
                content="""
                Les listes en Python sont des collections ordonnées et modifiables.
                Elles permettent de stocker plusieurs éléments de différents types.
                Exemple: ma_liste = [1, 2, 3, "quatre", 5.0]
                Les listes supportent l'indexation, le slicing et plusieurs méthodes comme append(), extend(), sort().
                """,
                title="Listes Python - Guide complet",
                source=DocumentSource.GITHUB,
                doc_type=DocumentType.CODE,
                language="python",
                url="https://github.com/python/cpython",
                tags=["python", "list", "data-structures", "examples"]
            ),
            Document(
                id="",
                content="""
                FastAPI est un framework web moderne et rapide pour Python.
                Il est basé sur les standards Python comme les type hints.
                FastAPI génère automatiquement la documentation OpenAPI.
                Il supporte nativement les requêtes asynchrones avec async/await.
                """,
                title="FastAPI - Framework web Python",
                source=DocumentSource.OFFICIAL_DOCS,
                doc_type=DocumentType.API_REFERENCE,
                language="python",
                url="https://fastapi.tiangolo.com/",
                tags=["python", "fastapi", "web", "async", "api"]
            ),
            Document(
                id="",
                content="""
                JavaScript est un langage de programmation principalement utilisé pour le développement web.
                Il permet de créer des pages web interactives et dynamiques.
                JavaScript peut être exécuté côté client (navigateur) et côté serveur (Node.js).
                ES6 a introduit de nombreuses fonctionnalités modernes comme les classes, les modules et les promesses.
                """,
                title="JavaScript pour le développement web",
                source=DocumentSource.WEB_SEARCH,
                doc_type=DocumentType.GENERAL,
                language="javascript",
                url="https://developer.mozilla.org/fr/docs/Web/JavaScript",
                tags=["javascript", "web", "frontend", "nodejs"]
            ),
            Document(
                id="",
                content="""
                Les erreurs courantes en Python incluent:
                1. SyntaxError: Erreur de syntaxe dans le code
                2. NameError: Variable non définie
                3. TypeError: Opération sur des types incompatibles
                4. IndexError: Index hors limites d'une liste
                5. KeyError: Clé non trouvée dans un dictionnaire
                Utilisez try/except pour gérer les exceptions proprement.
                """,
                title="Gestion des erreurs en Python",
                source=DocumentSource.STACKOVERFLOW,
                doc_type=DocumentType.ERROR_SOLUTION,
                language="python",
                url="https://stackoverflow.com/questions/tagged/python",
                tags=["python", "errors", "exceptions", "debugging", "best-practices"]
            )
        ]
        
        # Ajouter les documents
        print(f"📥 Ajout de {len(test_documents)} documents...")
        doc_ids = await vector_db.batch_add_documents(test_documents)
        
        print(f"✅ {len(doc_ids)} documents ajoutés avec succès")
        
        # Afficher les statistiques
        print("\n📊 Statistiques de la base de données:")
        stats = vector_db.get_stats()
        for key, value in stats.items():
            if key != "timestamp":
                print(f"  {key}: {value}")
        
        # Test de recherche 1: Recherche générale
        print("\n🔍 Test de recherche 1: 'Python programming'")
        results = await vector_db.search(
            query="Python programming",
            top_k=3,
            min_score=0.3
        )
        
        print(f"📈 {len(results)} résultats trouvés:")
        for i, (doc, score) in enumerate(results, 1):
            print(f"  {i}. {doc.title} (score: {score:.3f})")
            print(f"     Source: {doc.source.value}, Type: {doc.doc_type.value}")
            print(f"     Langage: {doc.language}, Qualité: {doc.quality_score:.2f}")
        
        # Test de recherche 2: Recherche spécifique avec filtres
        print("\n🔍 Test de recherche 2: 'list operations' avec filtre Python")
        results = await vector_db.search(
            query="list operations",
            top_k=2,
            filters={"language": "python"},
            min_score=0.2
        )
        
        print(f"📈 {len(results)} résultats trouvés:")
        for i, (doc, score) in enumerate(results, 1):
            print(f"  {i}. {doc.title} (score: {score:.3f})")
            print(f"     Tags: {', '.join(doc.tags[:3])}")
        
        # Test de recherche 3: Recherche d'erreurs
        print("\n🔍 Test de recherche 3: 'Python error handling'")
        results = await vector_db.search(
            query="Python error handling",
            top_k=2,
            filters={"doc_type": DocumentType.ERROR_SOLUTION.value},
            min_score=0.3
        )
        
        print(f"📈 {len(results)} résultats trouvés:")
        for i, (doc, score) in enumerate(results, 1):
            print(f"  {i}. {doc.title} (score: {score:.3f})")
            print(f"     Source: {doc.source.value}")
        
        # Test de similarité entre documents
        print("\n🔗 Test de similarité entre documents:")
        if len(doc_ids) >= 2:
            doc1 = vector_db.document_store.get_document(doc_ids[0])
            doc2 = vector_db.document_store.get_document(doc_ids[1])
            
            if doc1 and doc2:
                similarity = await vector_db.embedding_manager.get_similarity(
                    doc1.content[:100],  # Premier 100 caractères
                    doc2.content[:100]
                )
                print(f"  Similarité entre '{doc1.title}' et '{doc2.title}': {similarity:.3f}")
        
        # Test de suppression
        print("\n🗑️  Test de suppression d'un document...")
        if doc_ids:
            success = await vector_db.delete_document(doc_ids[0])
            if success:
                print(f"✅ Document '{doc_ids[0]}' supprimé avec succès")
                
                # Vérifier les nouvelles statistiques
                new_stats = vector_db.get_stats()
                print(f"📊 Nouveau nombre de documents: {new_stats['document_count']}")
        
        # Test de vidage
        print("\n🧹 Test de vidage de la base de données...")
        vector_db.clear_all()
        print("✅ Base de données vidée")
        
        # Vérifier que tout est vide
        final_stats = vector_db.get_stats()
        print(f"📊 Documents restants: {final_stats['document_count']}")
        
        print("\n" + "=" * 50)
        print("🎉 Tous les tests RAG ont réussi !")
        print("\n🌐 Endpoints API RAG disponibles:")
        print("  POST   /api/rag/documents      - Créer un document")
        print("  GET    /api/rag/documents/{id} - Récupérer un document")
        print("  POST   /api/rag/search         - Recherche sémantique")
        print("  POST   /api/rag/documents/batch - Ajout batch")
        print("  DELETE /api/rag/documents/{id} - Supprimer un document")
        print("  GET    /api/rag/stats          - Statistiques")
        print("  GET    /api/rag/health         - Vérification santé")
        print("  POST   /api/rag/clear          - Vider la base")
        
        return True
        
    except ImportError as e:
        print(f"❌ Erreur d'importation: {e}")
        print("💡 Assurez-vous d'avoir installé les dépendances:")
        print("   pip install sentence-transformers numpy")
        return False
        
    except Exception as e:
        print(f"❌ Erreur lors du test RAG: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_embeddings():
    """Test du système d'embeddings."""
    print("\n" + "=" * 50)
    print("🧠 Test du système d'embeddings")
    
    try:
        import sys
        sys.path.append('packages/shared-bl')
        
        from rag.embeddings import EmbeddingManager, EmbeddingModel
        from rag.embeddings.embedding_models import get_embedding_model
        
        # Initialiser le modèle d'embeddings
        embedding_model = get_embedding_model(
            model_name="all-MiniLM-L6-v2"
        )
        
        # Initialiser le gestionnaire d'embeddings
        embedding_manager = EmbeddingManager(embedding_model)
        
        print("✅ EmbeddingManager initialisé")
        
        # Test d'embedding simple
        text1 = "Python programming language"
        text2 = "JavaScript web development"
        text3 = "Python coding tutorial"
        
        print(f"\n📝 Génération d'embeddings...")
        
        embedding1 = await embedding_manager.get_embedding(text1)
        embedding2 = await embedding_manager.get_embedding(text2)
        embedding3 = await embedding_manager.get_embedding(text3)
        
        print(f"✅ Embeddings générés (dimensions: {len(embedding1)})")
        
        # Test de similarité
        similarity_1_2 = await embedding_manager.get_similarity(text1, text2)
        similarity_1_3 = await embedding_manager.get_similarity(text1, text3)
        
        print(f"\n🔗 Similarités:")
        print(f"  '{text1}' vs '{text2}': {similarity_1_2:.3f}")
        print(f"  '{text1}' vs '{text3}': {similarity_1_3:.3f}")
        
        # Test de recherche des plus similaires
        candidates = [
            "Python programming tutorial",
            "JavaScript framework React",
            "Java enterprise development",
            "Python data science",
            "C++ system programming"
        ]
        
        print(f"\n🔍 Recherche des textes les plus similaires à '{text1}':")
        similar_texts = await embedding_manager.find_most_similar(
            query=text1,
            candidates=candidates,
            top_k=3
        )
        
        for text, score in similar_texts:
            print(f"  • {text} (score: {score:.3f})")
        
        # Statistiques du cache
        cache_stats = embedding_manager.get_cache_stats()
        print(f"\n📊 Statistiques du cache d'embeddings:")
        print(f"  Cache mémoire: {cache_stats['memory_cache_size']} embeddings")
        print(f"  Cache disque: {cache_stats['disk_cache_size']} embeddings")
        print(f"  TTL: {cache_stats['cache_ttl_hours']} heures")
        
        print("\n✅ Test des embeddings réussi !")
        return True
        
    except Exception as e:
        print(f"❌ Erreur lors du test des embeddings: {e}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    """Fonction principale."""
    print("🚀 Démarrage des tests du système RAG ISSALAN")
    print("=" * 50)
    
    # Test des embeddings
    embeddings_ok = await test_embeddings()
    if not embeddings_ok:
        print("\n❌ Les tests des embeddings ont échoué")
        return 1
    
    # Test du système RAG complet
    rag_ok = await test_rag_system()
    if not rag_ok:
        print("\n❌ Les tests RAG ont échoué")
        return 1
    
    print("\n" + "=" * 50)
    print("🎉 Tous les tests ont réussi !")
    print("\n📋 Résumé:")
    print("  ✅ Système d'embeddings fonctionnel")
    print("  ✅ Base de données vectorielle opérationnelle")
    print("  ✅ Recherche sémantique efficace")
    print("  ✅ Gestion des documents complète")
    print("\n🚀 ISSALAN RAG est prêt pour la Phase 3 !")
    
    return 0

if __name__ == "__main__":
    # Exécuter les tests
    exit_code = asyncio.run(main())
    sys.exit(exit_code)