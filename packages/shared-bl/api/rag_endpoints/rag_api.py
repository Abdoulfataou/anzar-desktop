"""
Endpoints API pour le système RAG d'ISSALAN
Fournit des endpoints pour la recherche augmentée par récupération
"""

import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query, Body, Depends
from pydantic import BaseModel, Field

from ...rag.vector_db import (
    VectorDatabase, 
    get_vector_database,
    VectorDBBackend,
    Document,
    DocumentSource,
    DocumentType
)
from ...rag.embeddings import EmbeddingProvider

logger = logging.getLogger(__name__)

# Créer le router
rag_router = APIRouter(prefix="/api/rag", tags=["RAG"])

# Modèles Pydantic
class DocumentCreate(BaseModel):
    """Modèle pour créer un document."""
    content: str = Field(..., description="Contenu du document")
    title: str = Field("", description="Titre du document")
    source: DocumentSource = Field(DocumentSource.WEB_SEARCH, description="Source du document")
    doc_type: DocumentType = Field(DocumentType.GENERAL, description="Type de document")
    language: str = Field("python", description="Langage du document")
    url: str = Field("", description="URL du document")
    tags: List[str] = Field([], description="Tags du document")
    metadata: Dict[str, Any] = Field({}, description="Métadonnées supplémentaires")

class DocumentResponse(BaseModel):
    """Modèle pour la réponse d'un document."""
    id: str
    title: str
    source: str
    doc_type: str
    language: str
    url: str
    tags: List[str]
    quality_score: float
    created_at: str
    updated_at: str

class SearchRequest(BaseModel):
    """Modèle pour une requête de recherche RAG."""
    query: str = Field(..., description="Requête de recherche")
    top_k: int = Field(5, description="Nombre de résultats à retourner")
    filters: Optional[Dict[str, Any]] = Field(None, description="Filtres de recherche")
    min_score: float = Field(0.0, description="Score minimum de similarité")

class SearchResult(BaseModel):
    """Modèle pour un résultat de recherche RAG."""
    document: DocumentResponse
    score: float
    relevance_explanation: str

class SearchResponse(BaseModel):
    """Modèle pour la réponse de recherche RAG."""
    query: str
    total_results: int
    results: List[SearchResult]
    search_time_ms: float

class BatchAddRequest(BaseModel):
    """Modèle pour l'ajout batch de documents."""
    documents: List[DocumentCreate]

class BatchAddResponse(BaseModel):
    """Modèle pour la réponse d'ajout batch."""
    total_added: int
    failed_count: int
    document_ids: List[str]
    processing_time_ms: float

class StatsResponse(BaseModel):
    """Modèle pour les statistiques RAG."""
    backend: str
    collection_name: str
    embedding_model: str
    embedding_dimensions: int
    document_count: int
    documents_by_source: Dict[str, int]
    documents_by_type: Dict[str, int]
    documents_by_language: Dict[str, int]
    timestamp: str

# Dépendances
def get_rag_database() -> VectorDatabase:
    """Dépendance pour obtenir la base de données RAG."""
    return get_vector_database(
        backend=VectorDBBackend.SIMPLE,
        embedding_provider=EmbeddingProvider.SENTENCE_TRANSFORMERS,
        collection_name="issalan_rag"
    )

# Endpoints
@rag_router.post("/documents", response_model=DocumentResponse)
async def create_document(
    document: DocumentCreate,
    vector_db: VectorDatabase = Depends(get_rag_database)
):
    """
    Crée un nouveau document dans le système RAG.
    
    Args:
        document: Document à créer
        vector_db: Base de données vectorielle
        
    Returns:
        Document créé
    """
    try:
        # Convertir le modèle Pydantic en Document
        doc = Document(
            id="",  # Généré automatiquement
            content=document.content,
            title=document.title,
            source=document.source,
            doc_type=document.doc_type,
            language=document.language,
            url=document.url,
            tags=document.tags,
            metadata=document.metadata
        )
        
        # Ajouter le document
        doc_id = await vector_db.add_document(doc)
        
        # Récupérer le document créé
        created_doc = vector_db.document_store.get_document(doc_id)
        if not created_doc:
            raise HTTPException(status_code=500, detail="Document non trouvé après création")
        
        # Convertir en réponse
        return DocumentResponse(
            id=created_doc.id,
            title=created_doc.title,
            source=created_doc.source.value,
            doc_type=created_doc.doc_type.value,
            language=created_doc.language,
            url=created_doc.url,
            tags=created_doc.tags,
            quality_score=created_doc.quality_score,
            created_at=created_doc.created_at.isoformat(),
            updated_at=created_doc.updated_at.isoformat()
        )
        
    except Exception as e:
        logger.error(f"Erreur lors de la création du document: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur interne: {str(e)}")

@rag_router.get("/documents/{doc_id}", response_model=DocumentResponse)
async def get_document(
    doc_id: str,
    vector_db: VectorDatabase = Depends(get_rag_database)
):
    """
    Récupère un document par son ID.
    
    Args:
        doc_id: ID du document
        vector_db: Base de données vectorielle
        
    Returns:
        Document
    """
    try:
        document = vector_db.document_store.get_document(doc_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document non trouvé")
        
        return DocumentResponse(
            id=document.id,
            title=document.title,
            source=document.source.value,
            doc_type=document.doc_type.value,
            language=document.language,
            url=document.url,
            tags=document.tags,
            quality_score=document.quality_score,
            created_at=document.created_at.isoformat(),
            updated_at=document.updated_at.isoformat()
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur lors de la récupération du document: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur interne: {str(e)}")

@rag_router.post("/search", response_model=SearchResponse)
async def search_documents(
    search_request: SearchRequest,
    vector_db: VectorDatabase = Depends(get_rag_database)
):
    """
    Recherche sémantique dans les documents RAG.
    
    Args:
        search_request: Requête de recherche
        vector_db: Base de données vectorielle
        
    Returns:
        Résultats de recherche
    """
    import time
    
    start_time = time.time()
    
    try:
        # Effectuer la recherche
        results = await vector_db.search(
            query=search_request.query,
            top_k=search_request.top_k,
            filters=search_request.filters,
            min_score=search_request.min_score
        )
        
        # Convertir les résultats
        search_results = []
        for document, score in results:
            # Générer une explication de pertinence
            relevance_explanation = _generate_relevance_explanation(document, score, search_request.query)
            
            search_results.append(SearchResult(
                document=DocumentResponse(
                    id=document.id,
                    title=document.title,
                    source=document.source.value,
                    doc_type=document.doc_type.value,
                    language=document.language,
                    url=document.url,
                    tags=document.tags,
                    quality_score=document.quality_score,
                    created_at=document.created_at.isoformat(),
                    updated_at=document.updated_at.isoformat()
                ),
                score=score,
                relevance_explanation=relevance_explanation
            ))
        
        search_time_ms = (time.time() - start_time) * 1000
        
        return SearchResponse(
            query=search_request.query,
            total_results=len(search_results),
            results=search_results,
            search_time_ms=search_time_ms
        )
        
    except Exception as e:
        logger.error(f"Erreur lors de la recherche: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur interne: {str(e)}")

@rag_router.post("/documents/batch", response_model=BatchAddResponse)
async def batch_add_documents(
    batch_request: BatchAddRequest,
    vector_db: VectorDatabase = Depends(get_rag_database)
):
    """
    Ajoute plusieurs documents en batch.
    
    Args:
        batch_request: Requête d'ajout batch
        vector_db: Base de données vectorielle
        
    Returns:
        Résultat de l'ajout batch
    """
    import time
    
    start_time = time.time()
    
    try:
        # Convertir les documents
        documents = []
        for doc_data in batch_request.documents:
            doc = Document(
                id="",
                content=doc_data.content,
                title=doc_data.title,
                source=doc_data.source,
                doc_type=doc_data.doc_type,
                language=doc_data.language,
                url=doc_data.url,
                tags=doc_data.tags,
                metadata=doc_data.metadata
            )
            documents.append(doc)
        
        # Ajouter en batch
        doc_ids = await vector_db.batch_add_documents(documents)
        
        processing_time_ms = (time.time() - start_time) * 1000
        
        return BatchAddResponse(
            total_added=len(doc_ids),
            failed_count=len(batch_request.documents) - len(doc_ids),
            document_ids=doc_ids,
            processing_time_ms=processing_time_ms
        )
        
    except Exception as e:
        logger.error(f"Erreur lors de l'ajout batch: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur interne: {str(e)}")

@rag_router.delete("/documents/{doc_id}")
async def delete_document(
    doc_id: str,
    vector_db: VectorDatabase = Depends(get_rag_database)
):
    """
    Supprime un document.
    
    Args:
        doc_id: ID du document
        vector_db: Base de données vectorielle
        
    Returns:
        Message de confirmation
    """
    try:
        success = await vector_db.delete_document(doc_id)
        if not success:
            raise HTTPException(status_code=404, detail="Document non trouvé ou erreur de suppression")
        
        return {"message": f"Document {doc_id} supprimé avec succès"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur lors de la suppression du document: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur interne: {str(e)}")

@rag_router.get("/stats", response_model=StatsResponse)
async def get_stats(
    vector_db: VectorDatabase = Depends(get_rag_database)
):
    """
    Récupère les statistiques du système RAG.
    
    Args:
        vector_db: Base de données vectorielle
        
    Returns:
        Statistiques
    """
    try:
        stats = vector_db.get_stats()
        
        return StatsResponse(
            backend=stats["backend"],
            collection_name=stats["collection_name"],
            embedding_model=stats["embedding_model"],
            embedding_dimensions=stats["embedding_dimensions"],
            document_count=stats["document_count"],
            documents_by_source=stats["documents_by_source"],
            documents_by_type=stats["documents_by_type"],
            documents_by_language=stats["documents_by_language"],
            timestamp=stats["timestamp"]
        )
        
    except Exception as e:
        logger.error(f"Erreur lors de la récupération des statistiques: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur interne: {str(e)}")

@rag_router.post("/clear")
async def clear_all(
    vector_db: VectorDatabase = Depends(get_rag_database)
):
    """
    Vide toute la base de données RAG.
    
    Args:
        vector_db: Base de données vectorielle
        
    Returns:
        Message de confirmation
    """
    try:
        vector_db.clear_all()
        return {"message": "Base de données RAG vidée avec succès"}
        
    except Exception as e:
        logger.error(f"Erreur lors du vidage de la base de données: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur interne: {str(e)}")

@rag_router.get("/health")
async def health_check(
    vector_db: VectorDatabase = Depends(get_rag_database)
):
    """
    Vérifie la santé du système RAG.
    
    Args:
        vector_db: Base de données vectorielle
        
    Returns:
        État de santé
    """
    try:
        stats = vector_db.get_stats()
        
        return {
            "status": "healthy",
            "backend": stats["backend"],
            "document_count": stats["document_count"],
            "embedding_model": stats["embedding_model"],
            "timestamp": stats["timestamp"]
        }
        
    except Exception as e:
        logger.error(f"Erreur lors de la vérification de santé: {e}")
        return {
            "status": "unhealthy",
            "error": str(e)
        }

# Fonctions utilitaires
def _generate_relevance_explanation(document: Document, score: float, query: str) -> str:
    """
    Génère une explication de pertinence pour un résultat.
    
    Args:
        document: Document
        score: Score de similarité
        query: Requête originale
        
    Returns:
        Explication de pertinence
    """
    explanations = []
    
    # Score de similarité
    if score > 0.8:
        explanations.append("Très pertinent (score élevé)")
    elif score > 0.6:
        explanations.append("Pertinent")
    elif score > 0.4:
        explanations.append("Modérément pertinent")
    else:
        explanations.append("Peu pertinent")
    
    # Source
    if document.source == DocumentSource.OFFICIAL_DOCS:
        explanations.append("Source officielle fiable")
    elif document.source == DocumentSource.GITHUB:
        explanations.append("Code source réel")
    elif document.source == DocumentSource.STACKOVERFLOW:
        explanations.append("Solution communautaire vérifiée")
    
    # Type
    if document.doc_type == DocumentType.API_REFERENCE:
        explanations.append("Documentation API officielle")
    elif document.doc_type == DocumentType.BEST_PRACTICE:
        explanations.append("Meilleures pratiques")
    elif document.doc_type == DocumentType.CODE:
        explanations.append("Exemple de code pratique")
    
    # Qualité
    if document.quality_score > 0.7:
        explanations.append("Contenu de haute qualité")
    
    # Langage correspondant
    if "python" in query.lower() and document.language == "python":
        explanations.append("Langage Python correspondant")
    elif "javascript" in query.lower() and document.language == "javascript":
        explanations.append("Langage JavaScript correspondant")
    
    return " • ".join(explanations)

def init_rag_endpoints(app):
    """
    Initialise les endpoints RAG dans l'application FastAPI.
    
    Args:
        app: Application FastAPI
    """
    app.include_router(rag_router)
    logger.info("Endpoints RAG initialisés")