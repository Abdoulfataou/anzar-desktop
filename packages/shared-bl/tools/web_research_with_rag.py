"""
Recherche web enrichie avec RAG pour ISSALAN
Combine la recherche web traditionnelle avec le système RAG pour des résultats améliorés
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
import asyncio
from datetime import datetime

from .web_research import WebResearchTool, SearchResult
from ..rag.vector_db import (
    VectorDatabase,
    get_vector_database,
    VectorDBBackend,
    Document,
    DocumentSource,
    DocumentType
)
from ..rag.embeddings import EmbeddingProvider

logger = logging.getLogger(__name__)

class WebResearchWithRAG:
    """Recherche web enrichie avec système RAG."""
    
    def __init__(
        self,
        web_search_tool: Optional[WebResearchTool] = None,
        vector_db: Optional[VectorDatabase] = None,
        rag_enabled: bool = True,
        cache_web_results: bool = True
    ):
        """
        Initialise la recherche web avec RAG.
        
        Args:
            web_search_tool: Outil de recherche web
            vector_db: Base de données vectorielle RAG
            rag_enabled: Activer/désactiver RAG
            cache_web_results: Mettre en cache les résultats web dans RAG
        """
        self.web_search = web_search_tool or WebResearchTool()
        self.rag_enabled = rag_enabled
        self.cache_web_results = cache_web_results
        
        if rag_enabled:
            self.vector_db = vector_db or get_vector_database(
                backend=VectorDBBackend.SIMPLE,
                embedding_provider=EmbeddingProvider.SENTENCE_TRANSFORMERS,
                collection_name="issalan_web_rag"
            )
        
        logger.info(f"WebResearchWithRAG initialisé (RAG: {rag_enabled})")
    
    async def enhanced_search(
        self,
        query: str,
        num_results: int = 10,
        search_depth: str = "moderate",
        include_rag: bool = True,
        rag_top_k: int = 3,
        min_rag_score: float = 0.3
    ) -> Dict[str, Any]:
        """
        Recherche web enrichie avec résultats RAG.
        
        Args:
            query: Requête de recherche
            num_results: Nombre de résultats web
            search_depth: Profondeur de recherche
            include_rag: Inclure les résultats RAG
            rag_top_k: Nombre de résultats RAG
            min_rag_score: Score minimum pour les résultats RAG
            
        Returns:
            Résultats combinés
        """
        import time
        start_time = time.time()
        
        # Recherche web standard
        web_results = await self.web_search.search(
            query=query,
            num_results=num_results,
            search_depth=search_depth
        )
        
        # Recherche RAG si activé
        rag_results = []
        if self.rag_enabled and include_rag:
            rag_results = await self._search_rag(
                query=query,
                top_k=rag_top_k,
                min_score=min_rag_score
            )
        
        # Mettre en cache les résultats web dans RAG
        if self.rag_enabled and self.cache_web_results and web_results:
            await self._cache_web_results(web_results, query)
        
        # Fusionner et classer les résultats
        combined_results = self._merge_and_rank_results(
            web_results=web_results,
            rag_results=rag_results,
            query=query
        )
        
        search_time = time.time() - start_time
        
        return {
            "query": query,
            "total_results": len(combined_results),
            "web_results_count": len(web_results),
            "rag_results_count": len(rag_results),
            "combined_results": combined_results,
            "search_time_seconds": search_time,
            "rag_enabled": self.rag_enabled,
            "timestamp": datetime.now().isoformat()
        }
    
    async def _search_rag(
        self,
        query: str,
        top_k: int = 3,
        min_score: float = 0.3
    ) -> List[Dict[str, Any]]:
        """Recherche dans le système RAG."""
        try:
            # Recherche sémantique
            results = await self.vector_db.search(
                query=query,
                top_k=top_k,
                min_score=min_score
            )
            
            # Convertir en format standard
            rag_results = []
            for document, score in results:
                rag_results.append({
                    "title": document.title,
                    "content": document.content[:500],  # Extraire un extrait
                    "url": document.url,
                    "source": document.source.value,
                    "doc_type": document.doc_type.value,
                    "language": document.language,
                    "tags": document.tags,
                    "quality_score": document.quality_score,
                    "rag_score": score,
                    "is_rag_result": True,
                    "document_id": document.id,
                    "created_at": document.created_at.isoformat() if document.created_at else None
                })
            
            return rag_results
            
        except Exception as e:
            logger.error(f"Erreur lors de la recherche RAG: {e}")
            return []
    
    async def _cache_web_results(
        self,
        web_results: List[SearchResult],
        original_query: str
    ):
        """Met en cache les résultats web dans le système RAG."""
        try:
            documents = []
            
            for result in web_results:
                # Vérifier si le résultat est de bonne qualité
                if self._is_high_quality_result(result):
                    # Créer un document RAG
                    document = Document(
                        id="",  # Généré automatiquement
                        content=result.content or result.snippet or "",
                        title=result.title or "Résultat web",
                        source=DocumentSource.WEB_SEARCH,
                        doc_type=self._determine_doc_type(result),
                        language=self._detect_language(result),
                        url=result.url or "",
                        tags=self._extract_tags(result, original_query),
                        metadata={
                            "original_query": original_query,
                            "search_engine": result.search_engine or "unknown",
                            "cached_at": datetime.now().isoformat(),
                            "web_result_metadata": result.metadata or {}
                        }
                    )
                    
                    documents.append(document)
            
            # Ajouter en batch si nous avons des documents
            if documents:
                await self.vector_db.batch_add_documents(documents)
                logger.debug(f"{len(documents)} résultats web mis en cache dans RAG")
                
        except Exception as e:
            logger.error(f"Erreur lors de la mise en cache RAG: {e}")
    
    def _is_high_quality_result(self, result: SearchResult) -> bool:
        """Détermine si un résultat web est de haute qualité."""
        # Vérifier le contenu
        content = result.content or result.snippet or ""
        if len(content) < 50:  # Trop court
            return False
        
        # Vérifier la source
        if result.url:
            # Sources de haute qualité
            high_quality_domains = [
                "github.com", "stackoverflow.com", "docs.python.org",
                "developer.mozilla.org", "w3schools.com", "medium.com",
                "towardsdatascience.com", "realpython.com"
            ]
            
            for domain in high_quality_domains:
                if domain in result.url:
                    return True
        
        # Vérifier le titre
        if result.title and len(result.title) > 10:
            return True
        
        return False
    
    def _determine_doc_type(self, result: SearchResult) -> DocumentType:
        """Détermine le type de document basé sur le résultat."""
        content = (result.content or result.snippet or "").lower()
        url = (result.url or "").lower()
        
        # Vérifier les patterns dans l'URL
        if "github.com" in url:
            return DocumentType.CODE
        elif "stackoverflow.com" in url:
            return DocumentType.ERROR_SOLUTION
        elif "docs." in url or "documentation" in url:
            return DocumentType.DOCUMENTATION
        elif "tutorial" in url or "learn" in url:
            return DocumentType.TUTORIAL
        elif "api" in url:
            return DocumentType.API_REFERENCE
        
        # Vérifier les patterns dans le contenu
        if "error" in content or "exception" in content or "debug" in content:
            return DocumentType.ERROR_SOLUTION
        elif "best practice" in content or "recommend" in content:
            return DocumentType.BEST_PRACTICE
        elif "example" in content or "code" in content:
            return DocumentType.CODE
        
        return DocumentType.GENERAL
    
    def _detect_language(self, result: SearchResult) -> str:
        """Détecte le langage de programmation."""
        content = (result.content or result.snippet or "").lower()
        url = (result.url or "").lower()
        
        # Langages courants
        languages = {
            "python": ["python", "py", "django", "flask", "fastapi"],
            "javascript": ["javascript", "js", "node", "react", "vue", "angular"],
            "typescript": ["typescript", "ts"],
            "java": ["java", "spring", "android"],
            "c++": ["c++", "cpp"],
            "c#": ["c#", "csharp", ".net"],
            "go": ["go", "golang"],
            "rust": ["rust"],
            "php": ["php", "laravel", "wordpress"],
            "ruby": ["ruby", "rails"],
            "swift": ["swift", "ios"],
            "kotlin": ["kotlin", "android"],
        }
        
        for lang, keywords in languages.items():
            for keyword in keywords:
                if keyword in content or keyword in url:
                    return lang
        
        return "unknown"
    
    def _extract_tags(self, result: SearchResult, query: str) -> List[str]:
        """Extrait des tags du résultat et de la requête."""
        tags = set()
        
        # Tags de la requête
        query_words = query.lower().split()
        for word in query_words:
            if len(word) > 3:  # Ignorer les mots courts
                tags.add(word)
        
        # Tags du titre
        if result.title:
            title_words = result.title.lower().split()
            for word in title_words:
                if len(word) > 3 and word.isalpha():
                    tags.add(word)
        
        # Tags du contenu (mots fréquents)
        content = (result.content or result.snippet or "").lower()
        words = content.split()
        from collections import Counter
        word_freq = Counter(words)
        
        # Ajouter les mots les plus fréquents (hors mots vides)
        stop_words = {"the", "and", "for", "with", "this", "that", "are", "was", "were"}
        for word, freq in word_freq.most_common(10):
            if freq > 1 and len(word) > 3 and word.isalpha() and word not in stop_words:
                tags.add(word)
        
        # Tags basés sur le langage détecté
        language = self._detect_language(result)
        if language != "unknown":
            tags.add(language)
        
        # Tags basés sur le type de document
        doc_type = self._determine_doc_type(result)
        tags.add(doc_type.value)
        
        return list(tags)[:10]  # Limiter à 10 tags
    
    def _merge_and_rank_results(
        self,
        web_results: List[SearchResult],
        rag_results: List[Dict[str, Any]],
        query: str
    ) -> List[Dict[str, Any]]:
        """Fusionne et classe les résultats web et RAG."""
        combined = []
        
        # Convertir les résultats web
        for i, result in enumerate(web_results):
            combined.append({
                "title": result.title or "Sans titre",
                "content": result.content or result.snippet or "",
                "url": result.url or "",
                "source": result.search_engine or "web",
                "rank": i + 1,
                "is_rag_result": False,
                "score": 1.0 - (i * 0.1),  # Score décroissant
                "type": "web",
                "metadata": result.metadata or {}
            })
        
        # Ajouter les résultats RAG
        for rag_result in rag_results:
            # Vérifier les doublons avec les résultats web
            is_duplicate = False
            for web_result in combined:
                if (rag_result.get("url") and web_result.get("url") and 
                    rag_result["url"] == web_result["url"]):
                    is_duplicate = True
                    # Améliorer le score du résultat web
                    web_result["rag_enhanced"] = True
                    web_result["rag_score"] = rag_result.get("rag_score", 0)
                    web_result["quality_score"] = rag_result.get("quality_score", 0)
                    break
            
            if not is_duplicate:
                combined.append({
                    "title": rag_result.get("title", "Document RAG"),
                    "content": rag_result.get("content", ""),
                    "url": rag_result.get("url", ""),
                    "source": rag_result.get("source", "rag"),
                    "rank": len(combined) + 1,
                    "is_rag_result": True,
                    "score": rag_result.get("rag_score", 0),
                    "type": "rag",
                    "rag_score": rag_result.get("rag_score", 0),
                    "quality_score": rag_result.get("quality_score", 0),
                    "document_id": rag_result.get("document_id"),
                    "tags": rag_result.get("tags", []),
                    "language": rag_result.get("language", "unknown"),
                    "doc_type": rag_result.get("doc_type", "general")
                })
        
        # Classer les résultats
        combined.sort(key=lambda x: self._calculate_final_score(x, query), reverse=True)
        
        # Réattribuer les rangs
        for i, result in enumerate(combined):
            result["final_rank"] = i + 1
        
        return combined
    
    def _calculate_final_score(self, result: Dict[str, Any], query: str) -> float:
        """Calcule un score final pour le classement."""
        base_score = result.get("score", 0)
        
        # Bonus pour les résultats RAG
        if result.get("is_rag_result"):
            base_score += 0.2  # Bonus RAG
        
        # Bonus pour la qualité
        quality_score = result.get("quality_score", 0)
        base_score += quality_score * 0.3
        
        # Bonus pour la pertinence de la requête
        query_lower = query.lower()
        title = result.get("title", "").lower()
        content = result.get("content", "").lower()
        
        if query_lower in title:
            base_score += 0.3
        elif any(word in title for word in query_lower.split()):
            base_score += 0.1
        
        if query_lower in content:
            base_score += 0.2
        
        # Bonus pour les sources fiables
        source = result.get("source", "").lower()
        reliable_sources = ["github", "stackoverflow", "docs.python", "mozilla"]
        if any(reliable in source for reliable in reliable_sources):
            base_score += 0.15
        
        return min(1.0, base_score)  # Normaliser à 1.0 max
    
    async def add_document_to_rag(
        self,
        content: str,
        title: str = "",
        url: str = "",
        source: DocumentSource = DocumentSource.USER_UPLOAD,
        doc_type: DocumentType = DocumentType.GENERAL,
        language: str = "",
        tags: List[str] = None
    ) -> str:
        """
        Ajoute manuellement un document au système RAG.
        
        Args:
            content: Contenu du document
            title: Titre du document
            url: URL du document
            source: Source du document
            doc_type: Type de document
            language: Langage du document
            tags: Tags du document
            
        Returns:
            ID du document ajouté
        """
        if not self.rag_enabled:
            raise ValueError("RAG n'est pas activé")
        
        document = Document(
            id="",
            content=content,
            title=title,
            source=source,
            doc_type=doc_type,
            language=language or self._detect_language_from_content(content),
            url=url,
            tags=tags or []
        )
        
        doc_id = await self.vector_db.add_document(document)
        logger.info(f"Document ajouté manuellement au RAG: {doc_id}")
        
        return doc_id
    
    def _detect_language_from_content(self, content: str) -> str:
        """Détecte le langage à partir du contenu."""
        content_lower = content.lower()
        
        language_patterns = {
            "python": ["def ", "import ", "from ", "class ", "print(", "lambda "],
            "javascript": ["function ", "const ", "let ", "var ", "console.log", "=>"],
            "html": ["<!DOCTYPE", "<html", "<div", "<script", "<style"],
            "css": ["{", "}", ":", ";", ".class", "#id"],
            "java": ["public class", "void ", "String ", "System.out.println"],
            "sql": ["SELECT ", "FROM ", "WHERE ", "INSERT INTO", "UPDATE "],
        }
        
        for lang, patterns in language_patterns.items():
            for pattern in patterns:
                if pattern in content_lower:
                    return lang
        
        return "unknown"
    
    async def get_rag_stats(self) -> Dict[str, Any]:
        """Récupère les statistiques du système RAG."""
        if not self.rag_enabled:
            return {"rag_enabled": False}
        
        try:
            stats = self.vector_db.get_stats()
            return {
                "rag_enabled": True,
                **stats
            }
        except Exception as e:
            logger.error(f"Erreur lors de la récupération des stats RAG: {e}")
            return {"rag_enabled": True, "error": str(e)}
    
    async def clear_rag_cache(self):
        """Vide le cache RAG."""
        if not self.rag_enabled:
            raise ValueError("RAG n'est pas activé")
        
        self.vector_db.clear_all()
        logger.info("Cache RAG vidé")
    
    async def search_similar_documents(
        self,
        document_id: str,
        top_k: int = 5,
        min_score: float = 0.3
    ) -> List[Dict[str, Any]]:
        """
        Recherche des documents similaires à un document existant.
        
        Args:
            document_id: ID du document de référence
            top_k: Nombre de résultats
            min_score: Score minimum de similarité
            
        Returns:
            Documents similaires
        """
        if not self.rag_enabled:
            raise ValueError("RAG n'est pas activé")
        
        try:
            # Récupérer le document
            document = self.vector_db.document_store.get_document(document_id)
            if not document:
                raise ValueError(f"Document {document_id} non trouvé")
            
            # Rechercher des documents similaires
            results = await self.vector_db.search(
                query=document.content[:1000],  # Utiliser le contenu comme requête
                top_k=top_k + 1,  # +1 pour exclure le document lui-même
                min_score=min_score
            )
            
            # Filtrer le document lui-même
            similar_docs = []
            for doc, score in results:
                if doc.id != document_id:
                    similar_docs.append({
                        "id": doc.id,
                        "title": doc.title,
                        "content": doc.content[:300],
                        "source": doc.source.value,
                        "doc_type": doc.doc_type.value,
                        "language": doc.language,
                        "similarity_score": score,
                        "quality_score": doc.quality_score,
                        "url": doc.url
                    })
            
            return similar_docs[:top_k]
            
        except Exception as e:
            logger.error(f"Erreur lors de la recherche de documents similaires: {e}")
            return []
    
    async def export_rag_data(self, output_file: str) -> bool:
        """
        Exporte les données RAG vers un fichier JSON.
        
        Args:
            output_file: Chemin du fichier de sortie
            
        Returns:
            True si l'export a réussi
        """
        if not self.rag_enabled:
            raise ValueError("RAG n'est pas activé")
        
        try:
            return self.vector_db.document_store.export_to_json(output_file)
        except Exception as e:
            logger.error(f"Erreur lors de l'export RAG: {e}")
            return False
    
    async def import_rag_data(self, input_file: str) -> int:
        """
        Importe des données RAG depuis un fichier JSON.
        
        Args:
            input_file: Chemin du fichier d'entrée
            
        Returns:
            Nombre de documents importés
        """
        if not self.rag_enabled:
            raise ValueError("RAG n'est pas activé")
        
        try:
            return self.vector_db.document_store.import_from_json(input_file)
        except Exception as e:
            logger.error(f"Erreur lors de l'import RAG: {e}")
            return 0


# Exemple d'utilisation
async def example_usage():
    """Exemple d'utilisation de WebResearchWithRAG."""
    
    # Initialiser
    research_tool = WebResearchWithRAG(
        rag_enabled=True,
        cache_web_results=True
    )
    
    # Recherche enrichie
    results = await research_tool.enhanced_search(
        query="Comment utiliser FastAPI avec MongoDB",
        num_results=5,
        rag_top_k=2
    )
    
    print(f"Requête: {results['query']}")
    print(f"Total résultats: {results['total_results']}")
    print(f"Temps de recherche: {results['search_time_seconds']:.2f}s")
    
    # Afficher les résultats
    for i, result in enumerate(results['combined_results'][:3], 1):
        print(f"\n{i}. {result['title']}")
        print(f"   Source: {result['source']}")
        print(f"   Type: {result.get('type', 'unknown')}")
        print(f"   Score: {result.get('score', 0):.3f}")
        if result.get('is_rag_result'):
            print(f"   ⭐ Résultat RAG (score: {result.get('rag_score', 0):.3f})")
    
    # Statistiques RAG
    stats = await research_tool.get_rag_stats()
    print(f"\n📊 Statistiques RAG:")
    print(f"   Documents: {stats.get('document_count', 0)}")
    print(f"   Backend: {stats.get('backend', 'unknown')}")


if __name__ == "__main__":
    # Exécuter l'exemple
    asyncio.run(example_usage())
