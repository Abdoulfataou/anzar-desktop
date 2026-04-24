"""
Base de données vectorielle pour ISSALAN RAG
Support pour plusieurs backends (ChromaDB, FAISS, etc.)
"""

import os
import logging
import json
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from enum import Enum
import numpy as np

from .document_store import Document, DocumentStore, get_document_store
from ..embeddings import EmbeddingManager, get_embedding_manager, EmbeddingProvider

logger = logging.getLogger(__name__)

class VectorDBBackend(Enum):
    """Backends de base de données vectorielle supportés."""
    CHROMADB = "chromadb"
    FAISS = "faiss"
    QDRANT = "qdrant"
    PINECONE = "pinecone"
    SIMPLE = "simple"  # Backend simple en mémoire pour le développement

class VectorDatabase:
    """Base de données vectorielle pour la recherche sémantique."""
    
    def __init__(
        self,
        backend: VectorDBBackend = VectorDBBackend.SIMPLE,
        embedding_provider: EmbeddingProvider = EmbeddingProvider.SENTENCE_TRANSFORMERS,
        embedding_model: Optional[str] = None,
        collection_name: str = "issalan_docs",
        persist_directory: Optional[str] = None
    ):
        """
        Initialise la base de données vectorielle.
        
        Args:
            backend: Backend de base de données vectorielle
            embedding_provider: Fournisseur d'embeddings
            embedding_model: Modèle d'embeddings spécifique
            collection_name: Nom de la collection
            persist_directory: Répertoire de persistance
        """
        self.backend = backend
        self.collection_name = collection_name
        
        # Initialiser le gestionnaire d'embeddings
        self.embedding_manager = get_embedding_manager(embedding_provider, embedding_model)
        
        # Initialiser le store de documents
        self.document_store = get_document_store()
        
        # Initialiser le backend spécifique
        self._init_backend(backend, persist_directory)
        
        logger.info(f"VectorDatabase initialisée avec backend {backend.value}")
    
    def _init_backend(self, backend: VectorDBBackend, persist_directory: Optional[str]):
        """Initialise le backend spécifique."""
        if backend == VectorDBBackend.CHROMADB:
            self._init_chromadb(persist_directory)
        elif backend == VectorDBBackend.FAISS:
            self._init_faiss(persist_directory)
        elif backend == VectorDBBackend.QDRANT:
            self._init_qdrant(persist_directory)
        elif backend == VectorDBBackend.PINECONE:
            self._init_pinecone(persist_directory)
        else:  # SIMPLE
            self._init_simple_backend()
    
    def _init_chromadb(self, persist_directory: Optional[str]):
        """Initialise ChromaDB."""
        try:
            import chromadb
            from chromadb.config import Settings
            
            if persist_directory:
                self.client = chromadb.PersistentClient(
                    path=persist_directory,
                    settings=Settings(anonymized_telemetry=False)
                )
            else:
                self.client = chromadb.Client(
                    settings=Settings(anonymized_telemetry=False)
                )
            
            # Créer ou récupérer la collection
            try:
                self.collection = self.client.get_collection(self.collection_name)
                logger.info(f"Collection ChromaDB récupérée: {self.collection_name}")
            except:
                self.collection = self.client.create_collection(
                    name=self.collection_name,
                    metadata={"description": "ISSALAN RAG documents"}
                )
                logger.info(f"Collection ChromaDB créée: {self.collection_name}")
            
            self.backend_initialized = True
            
        except ImportError:
            logger.error("ChromaDB non installé, utilisation du backend simple")
            self._init_simple_backend()
        except Exception as e:
            logger.error(f"Erreur lors de l'initialisation de ChromaDB: {e}")
            self._init_simple_backend()
    
    def _init_faiss(self, persist_directory: Optional[str]):
        """Initialise FAISS."""
        try:
            import faiss
            
            # Dimensions des embeddings
            self.embedding_dim = self.embedding_manager.embedding_model.dimensions
            
            # Créer l'index FAISS
            self.faiss_index = faiss.IndexFlatL2(self.embedding_dim)
            
            # Stockage des IDs et documents
            self.faiss_ids = []
            self.faiss_documents = []
            
            # Répertoire de persistance
            self.faiss_persist_dir = persist_directory or os.path.join(
                os.path.expanduser("~"), ".issalan", "faiss"
            )
            os.makedirs(self.faiss_persist_dir, exist_ok=True)
            
            self.backend_initialized = True
            logger.info(f"FAISS initialisé avec dimension {self.embedding_dim}")
            
        except ImportError:
            logger.error("FAISS non installé, utilisation du backend simple")
            self._init_simple_backend()
        except Exception as e:
            logger.error(f"Erreur lors de l'initialisation de FAISS: {e}")
            self._init_simple_backend()
    
    def _init_qdrant(self, persist_directory: Optional[str]):
        """Initialise Qdrant."""
        try:
            from qdrant_client import QdrantClient
            from qdrant_client.models import Distance, VectorParams
            
            # Configuration
            qdrant_host = os.getenv("QDRANT_HOST", "localhost")
            qdrant_port = int(os.getenv("QDRANT_PORT", "6333"))
            
            self.qdrant_client = QdrantClient(host=qdrant_host, port=qdrant_port)
            
            # Dimensions des embeddings
            embedding_dim = self.embedding_manager.embedding_model.dimensions
            
            # Vérifier si la collection existe
            collections = self.qdrant_client.get_collections().collections
            collection_exists = any(c.name == self.collection_name for c in collections)
            
            if not collection_exists:
                self.qdrant_client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=embedding_dim,
                        distance=Distance.COSINE
                    )
                )
                logger.info(f"Collection Qdrant créée: {self.collection_name}")
            else:
                logger.info(f"Collection Qdrant récupérée: {self.collection_name}")
            
            self.backend_initialized = True
            
        except ImportError:
            logger.error("Qdrant non installé, utilisation du backend simple")
            self._init_simple_backend()
        except Exception as e:
            logger.error(f"Erreur lors de l'initialisation de Qdrant: {e}")
            self._init_simple_backend()
    
    def _init_pinecone(self, persist_directory: Optional[str]):
        """Initialise Pinecone."""
        try:
            import pinecone
            
            # Initialiser Pinecone
            api_key = os.getenv("PINECONE_API_KEY")
            if not api_key:
                logger.error("PINECONE_API_KEY non configurée")
                raise ValueError("PINECONE_API_KEY requise")
            
            pinecone.init(api_key=api_key)
            
            # Vérifier si l'index existe
            if self.collection_name not in pinecone.list_indexes():
                # Dimensions des embeddings
                embedding_dim = self.embedding_manager.embedding_model.dimensions
                
                # Créer l'index
                pinecone.create_index(
                    name=self.collection_name,
                    dimension=embedding_dim,
                    metric="cosine"
                )
                logger.info(f"Index Pinecone créé: {self.collection_name}")
            
            # Connecter à l'index
            self.pinecone_index = pinecone.Index(self.collection_name)
            
            self.backend_initialized = True
            
        except ImportError:
            logger.error("Pinecone non installé, utilisation du backend simple")
            self._init_simple_backend()
        except Exception as e:
            logger.error(f"Erreur lors de l'initialisation de Pinecone: {e}")
            self._init_simple_backend()
    
    def _init_simple_backend(self):
        """Initialise le backend simple en mémoire."""
        self.simple_vectors = {}  # doc_id -> embedding
        self.simple_documents = {}  # doc_id -> document
        self.backend_initialized = True
        logger.info("Backend simple initialisé")
    
    async def add_document(self, document: Document, generate_embedding: bool = True) -> str:
        """
        Ajoute un document à la base de données vectorielle.
        
        Args:
            document: Document à ajouter
            generate_embedding: Générer un embedding pour le document
            
        Returns:
            ID du document
        """
        # Ajouter au store de documents
        doc_id = self.document_store.add_document(document)
        
        # Générer l'embedding si nécessaire
        if generate_embedding and not document.embedding:
            embedding = await self.embedding_manager.get_embedding(document.content)
            document.embedding = embedding
            document.embedding_model = self.embedding_manager.model_name
            document.embedding_dimensions = len(embedding)
            
            # Mettre à jour le document dans le store
            self.document_store.update_document(doc_id, {
                "embedding": embedding,
                "embedding_model": document.embedding_model,
                "embedding_dimensions": document.embedding_dimensions
            })
        
        # Ajouter au backend vectoriel
        if document.embedding:
            await self._add_to_vector_backend(doc_id, document.embedding, document)
        
        logger.debug(f"Document ajouté à VectorDB: {doc_id}")
        return doc_id
    
    async def _add_to_vector_backend(self, doc_id: str, embedding: List[float], document: Document):
        """Ajoute un document au backend vectoriel spécifique."""
        if self.backend == VectorDBBackend.CHROMADB:
            await self._add_to_chromadb(doc_id, embedding, document)
        elif self.backend == VectorDBBackend.FAISS:
            await self._add_to_faiss(doc_id, embedding, document)
        elif self.backend == VectorDBBackend.QDRANT:
            await self._add_to_qdrant(doc_id, embedding, document)
        elif self.backend == VectorDBBackend.PINECONE:
            await self._add_to_pinecone(doc_id, embedding, document)
        else:  # SIMPLE
            self._add_to_simple_backend(doc_id, embedding, document)
    
    async def _add_to_chromadb(self, doc_id: str, embedding: List[float], document: Document):
        """Ajoute à ChromaDB."""
        try:
            metadata = {
                "title": document.title,
                "source": document.source.value,
                "doc_type": document.doc_type.value,
                "language": document.language,
                "url": document.url,
                "quality_score": str(document.quality_score),
                "tags": ",".join(document.tags) if document.tags else "",
            }
            
            self.collection.add(
                ids=[doc_id],
                embeddings=[embedding],
                metadatas=[metadata],
                documents=[document.content[:10000]]  # Limiter la taille
            )
            
        except Exception as e:
            logger.error(f"Erreur lors de l'ajout à ChromaDB: {e}")
    
    async def _add_to_faiss(self, doc_id: str, embedding: List[float], document: Document):
        """Ajoute à FAISS."""
        try:
            # Convertir en numpy array
            embedding_array = np.array([embedding], dtype=np.float32)
            
            # Ajouter à l'index
            self.faiss_index.add(embedding_array)
            
            # Stocker les métadonnées
            self.faiss_ids.append(doc_id)
            self.faiss_documents.append(document)
            
            # Sauvegarder périodiquement
            if len(self.faiss_ids) % 100 == 0:
                self._save_faiss()
            
        except Exception as e:
            logger.error(f"Erreur lors de l'ajout à FAISS: {e}")
    
    async def _add_to_qdrant(self, doc_id: str, embedding: List[float], document: Document):
        """Ajoute à Qdrant."""
        try:
            from qdrant_client.models import PointStruct
            
            point = PointStruct(
                id=doc_id,
                vector=embedding,
                payload={
                    "title": document.title,
                    "content": document.content[:5000],  # Limiter la taille
                    "source": document.source.value,
                    "doc_type": document.doc_type.value,
                    "language": document.language,
                    "url": document.url,
                    "quality_score": document.quality_score,
                    "tags": document.tags,
                }
            )
            
            self.qdrant_client.upsert(
                collection_name=self.collection_name,
                points=[point]
            )
            
        except Exception as e:
            logger.error(f"Erreur lors de l'ajout à Qdrant: {e}")
    
    async def _add_to_pinecone(self, doc_id: str, embedding: List[float], document: Document):
        """Ajoute à Pinecone."""
        try:
            metadata = {
                "title": document.title,
                "source": document.source.value,
                "doc_type": document.doc_type.value,
                "language": document.language,
                "url": document.url,
                "quality_score": document.quality_score,
                "content": document.content[:5000],  # Limiter la taille
            }
            
            self.pinecone_index.upsert(
                vectors=[(doc_id, embedding, metadata)]
            )
            
        except Exception as e:
            logger.error(f"Erreur lors de l'ajout à Pinecone: {e}")
    
    def _add_to_simple_backend(self, doc_id: str, embedding: List[float], document: Document):
        """Ajoute au backend simple."""
        self.simple_vectors[doc_id] = embedding
        self.simple_documents[doc_id] = document
    
    async def search(
        self,
        query: str,
        top_k: int = 5,
        filters: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0
    ) -> List[Tuple[Document, float]]:
        """
        Recherche sémantique dans la base de données vectorielle.
        
        Args:
            query: Requête de recherche
            top_k: Nombre de résultats à retourner
            filters: Filtres à appliquer
            min_score: Score minimum de similarité
            
        Returns:
            Liste de tuples (document, score)
        """
        # Générer l'embedding de la requête
        query_embedding = await self.embedding_manager.get_embedding(query)
        
        # Rechercher dans le backend vectoriel
        if self.backend == VectorDBBackend.CHROMADB:
            results = await self._search_chromadb(query_embedding, top_k, filters)
        elif self.backend == VectorDBBackend.FAISS:
            results = await self._search_faiss(query_embedding, top_k, filters)
        elif self.backend == VectorDBBackend.QDRANT:
            results = await self._search_qdrant(query_embedding, top_k, filters)
        elif self.backend == VectorDBBackend.PINECONE:
            results = await self._search_pinecone(query_embedding, top_k, filters)
        else:  # SIMPLE
            results = await self._search_simple_backend(query_embedding, top_k, filters)
        
        # Filtrer par score minimum
        filtered_results = [(doc, score) for doc, score in results if score >= min_score]
        
        # Trier par score décroissant
        filtered_results.sort(key=lambda x: x[1], reverse=True)
        
        # Limiter aux top_k résultats
        return filtered_results[:top_k]
    
    async def _search_chromadb(self, query_embedding: List[float], top_k: int, filters: Optional[Dict]) -> List[Tuple[Document, float]]:
        """Recherche dans ChromaDB."""
        try:
            # Convertir les filtres pour ChromaDB
            where_filter = None
            if filters:
                where_filter = {}
                for key, value in filters.items():
                    where_filter[key] = value
            
            # Rechercher
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k * 2,  # Prendre plus pour le filtrage
                where=where_filter
            )
            
            # Traiter les résultats
            search_results = []
            for i, doc_id in enumerate(results['ids'][0]):
                if doc_id and i < len(results['distances'][0]):
                    distance = results['distances'][0][i]
                    
                    # Convertir la distance en score de similarité
                    # ChromaDB utilise la distance L2, convertir en similarité cosinus approximative
                    score = max(0.0, 1.0 - (distance / 2.0))
                    
                    # Récupérer le document
                    document = self.document_store.get_document(doc_id)
                    if document:
                        search_results.append((document, score))
            
            return search_results
            
        except Exception as e:
            logger.error(f"Erreur lors de la recherche ChromaDB: {e}")
            return []
    
    async def _search_faiss(self, query_embedding: List[float], top_k: int, filters: Optional[Dict]) -> List[Tuple[Document, float]]:
        """Recherche dans FAISS."""
        try:
            # Convertir en numpy array
            query_array = np.array([query_embedding], dtype=np.float32)
            
            # Rechercher dans l'index
            k = min(top_k * 2, len(self.faiss_ids))
            if k == 0:
                return []
            
            distances, indices = self.faiss_index.search(query_array, k)
            
            # Traiter les résultats
            search_results = []
            for i, idx in enumerate(indices[0]):
                if idx >= 0 and idx < len(self.faiss_ids):
                    doc_id = self.faiss_ids[idx]
                    distance = distances[0][i]
                    
                    # Convertir la distance L2 en score de similarité
                    score = max(0.0, 1.0 - (distance / 10.0))  # Normalisation approximative
                    
                    # Récupérer le document
                    document = self.faiss_documents[idx]
                    
                    # Appliquer les filtres si présents
                    if filters and not self._document_matches_filters(document, filters):
                        continue
                    
                    search_results.append((document, score))
            
            return search_results
            
        except Exception as e:
            logger.error(f"Erreur lors de la recherche FAISS: {e}")
            return []
    
    async def _search_qdrant(self, query_embedding: List[float], top_k: int, filters: Optional[Dict]) -> List[Tuple[Document, float]]:
        """Recherche dans Qdrant."""
        try:
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            
            # Convertir les filtres pour Qdrant
            qdrant_filter = None
            if filters:
                conditions = []
                for key, value in filters.items():
                    conditions.append(
                        FieldCondition(
                            key=key,
                            match=MatchValue(value=value)
                        )
                    )
                qdrant_filter = Filter(must=conditions)
            
            # Rechercher
            search_result = self.qdrant_client.search(
                collection_name=self.collection_name,
                query_vector=query_embedding,
                query_filter=qdrant_filter,
                limit=top_k * 2
            )
            
            # Traiter les résultats
            search_results = []
            for result in search_result:
                doc_id = result.id
                score = result.score
                
                # Récupérer le document
                document = self.document_store.get_document(doc_id)
                if document:
                    search_results.append((document, score))
            
            return search_results
            
        except Exception as e:
            logger.error(f"Erreur lors de la recherche Qdrant: {e}")
            return []
    
    async def _search_pinecone(self, query_embedding: List[float], top_k: int, filters: Optional[Dict]) -> List[Tuple[Document, float]]:
        """Recherche dans Pinecone."""
        try:
            # Convertir les filtres pour Pinecone
            pinecone_filter = None
            if filters:
                pinecone_filter = filters
            
            # Rechercher
            results = self.pinecone_index.query(
                vector=query_embedding,
                top_k=top_k * 2,
                filter=pinecone_filter,
                include_metadata=True
            )
            
            # Traiter les résultats
            search_results = []
            for match in results.matches:
                doc_id = match.id
                score = match.score
                
                # Récupérer le document
                document = self.document_store.get_document(doc_id)
                if document:
                    search_results.append((document, score))
            
            return search_results
            
        except Exception as e:
            logger.error(f"Erreur lors de la recherche Pinecone: {e}")
            return []
    
    async def _search_simple_backend(self, query_embedding: List[float], top_k: int, filters: Optional[Dict]) -> List[Tuple[Document, float]]:
        """Recherche dans le backend simple."""
        try:
            import numpy as np
            
            query_vec = np.array(query_embedding)
            similarities = []
            
            for doc_id, doc_embedding in self.simple_vectors.items():
                document = self.simple_documents.get(doc_id)
                if not document:
                    continue
                
                # Appliquer les filtres si présents
                if filters and not self._document_matches_filters(document, filters):
                    continue
                
                # Calculer la similarité cosinus
                doc_vec = np.array(doc_embedding)
                
                dot_product = np.dot(query_vec, doc_vec)
                norm_query = np.linalg.norm(query_vec)
                norm_doc = np.linalg.norm(doc_vec)
                
                if norm_query == 0 or norm_doc == 0:
                    similarity = 0.0
                else:
                    similarity = dot_product / (norm_query * norm_doc)
                
                similarities.append((document, max(0.0, min(1.0, similarity))))
            
            # Trier par similarité décroissante
            similarities.sort(key=lambda x: x[1], reverse=True)
            
            return similarities[:top_k * 2]
            
        except Exception as e:
            logger.error(f"Erreur lors de la recherche backend simple: {e}")
            return []
    
    def _document_matches_filters(self, document: Document, filters: Dict[str, Any]) -> bool:
        """Vérifie si un document correspond aux filtres."""
        for key, value in filters.items():
            if key == "source":
                if document.source.value != value:
                    return False
            elif key == "doc_type":
                if document.doc_type.value != value:
                    return False
            elif key == "language":
                if document.language != value:
                    return False
            elif key == "tags":
                if value not in document.tags:
                    return False
            elif key == "min_quality":
                if document.quality_score < value:
                    return False
            elif hasattr(document, key):
                if getattr(document, key) != value:
                    return False
        
        return True
    
    def _save_faiss(self):
        """Sauvegarde l'index FAISS sur disque."""
        try:
            import faiss
            
            # Sauvegarder l'index
            index_path = os.path.join(self.faiss_persist_dir, "faiss.index")
            faiss.write_index(self.faiss_index, index_path)
            
            # Sauvegarder les métadonnées
            metadata_path = os.path.join(self.faiss_persist_dir, "metadata.json")
            metadata = {
                "ids": self.faiss_ids,
                "documents": [doc.to_dict() for doc in self.faiss_documents],
                "timestamp": datetime.now().isoformat()
            }
            
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            
            logger.debug(f"FAISS sauvegardé: {len(self.faiss_ids)} documents")
            
        except Exception as e:
            logger.error(f"Erreur lors de la sauvegarde FAISS: {e}")
    
    def _load_faiss(self):
        """Charge l'index FAISS depuis le disque."""
        try:
            import faiss
            
            index_path = os.path.join(self.faiss_persist_dir, "faiss.index")
            metadata_path = os.path.join(self.faiss_persist_dir, "metadata.json")
            
            if os.path.exists(index_path) and os.path.exists(metadata_path):
                # Charger l'index
                self.faiss_index = faiss.read_index(index_path)
                
                # Charger les métadonnées
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                self.faiss_ids = metadata.get("ids", [])
                
                # Charger les documents
                self.faiss_documents = []
                for doc_data in metadata.get("documents", []):
                    document = Document.from_dict(doc_data)
                    self.faiss_documents.append(document)
                
                logger.info(f"FAISS chargé: {len(self.faiss_ids)} documents")
                return True
            
        except Exception as e:
            logger.error(f"Erreur lors du chargement FAISS: {e}")
        
        return False
    
    async def batch_add_documents(self, documents: List[Document]) -> List[str]:
        """
        Ajoute plusieurs documents en batch.
        
        Args:
            documents: Liste de documents à ajouter
            
        Returns:
            Liste des IDs des documents ajoutés
        """
        doc_ids = []
        
        for document in documents:
            try:
                doc_id = await self.add_document(document)
                doc_ids.append(doc_id)
            except Exception as e:
                logger.error(f"Erreur lors de l'ajout du document: {e}")
        
        logger.info(f"{len(doc_ids)}/{len(documents)} documents ajoutés en batch")
        return doc_ids
    
    async def delete_document(self, doc_id: str) -> bool:
        """
        Supprime un document de la base de données vectorielle.
        
        Args:
            doc_id: ID du document
            
        Returns:
            True si la suppression a réussi
        """
        try:
            # Supprimer du store de documents
            self.document_store.delete_document(doc_id)
            
            # Supprimer du backend vectoriel
            if self.backend == VectorDBBackend.CHROMADB:
                self.collection.delete(ids=[doc_id])
            elif self.backend == VectorDBBackend.FAISS:
                # FAISS ne supporte pas la suppression, recréer l'index
                self._recreate_faiss_without_document(doc_id)
            elif self.backend == VectorDBBackend.QDRANT:
                self.qdrant_client.delete(
                    collection_name=self.collection_name,
                    points_selector=[doc_id]
                )
            elif self.backend == VectorDBBackend.PINECONE:
                self.pinecone_index.delete(ids=[doc_id])
            else:  # SIMPLE
                if doc_id in self.simple_vectors:
                    del self.simple_vectors[doc_id]
                if doc_id in self.simple_documents:
                    del self.simple_documents[doc_id]
            
            logger.debug(f"Document supprimé de VectorDB: {doc_id}")
            return True
            
        except Exception as e:
            logger.error(f"Erreur lors de la suppression du document {doc_id}: {e}")
            return False
    
    def _recreate_faiss_without_document(self, doc_id_to_remove: str):
        """Recrée l'index FAISS sans un document."""
        try:
            import faiss
            
            # Créer un nouvel index
            new_index = faiss.IndexFlatL2(self.embedding_dim)
            new_ids = []
            new_documents = []
            
            # Copier tous les documents sauf celui à supprimer
            for i, doc_id in enumerate(self.faiss_ids):
                if doc_id != doc_id_to_remove:
                    # Récupérer l'embedding
                    embedding = np.array([self.faiss_documents[i].embedding], dtype=np.float32)
                    new_index.add(embedding)
                    new_ids.append(doc_id)
                    new_documents.append(self.faiss_documents[i])
            
            # Remplacer l'ancien index
            self.faiss_index = new_index
            self.faiss_ids = new_ids
            self.faiss_documents = new_documents
            
            # Sauvegarder
            self._save_faiss()
            
        except Exception as e:
            logger.error(f"Erreur lors de la recréation de FAISS: {e}")
    
    def get_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques de la base de données vectorielle."""
        doc_stats = self.document_store.get_document_count()
        
        stats = {
            "backend": self.backend.value,
            "collection_name": self.collection_name,
            "embedding_model": self.embedding_manager.model_name,
            "embedding_dimensions": self.embedding_manager.embedding_model.dimensions,
            "document_count": doc_stats["total"],
            "documents_by_source": doc_stats["by_source"],
            "documents_by_type": doc_stats["by_type"],
            "documents_by_language": doc_stats["by_language"],
            "timestamp": datetime.now().isoformat(),
        }
        
        # Ajouter les statistiques spécifiques au backend
        if self.backend == VectorDBBackend.FAISS:
            stats["faiss_index_size"] = len(self.faiss_ids)
        elif self.backend == VectorDBBackend.SIMPLE:
            stats["simple_backend_size"] = len(self.simple_vectors)
        
        return stats
    
    def clear_all(self):
        """Vide toute la base de données vectorielle."""
        # Vider le store de documents
        self.document_store.clear_all()
        
        # Vider le backend vectoriel
        if self.backend == VectorDBBackend.CHROMADB:
            self.client.delete_collection(self.collection_name)
            self.collection = self.client.create_collection(name=self.collection_name)
        elif self.backend == VectorDBBackend.FAISS:
            self.faiss_index.reset()
            self.faiss_ids.clear()
            self.faiss_documents.clear()
        elif self.backend == VectorDBBackend.QDRANT:
            self.qdrant_client.delete_collection(self.collection_name)
            # Recréer la collection
            from qdrant_client.models import VectorParams, Distance
            embedding_dim = self.embedding_manager.embedding_model.dimensions
            self.qdrant_client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=embedding_dim, distance=Distance.COSINE)
            )
        elif self.backend == VectorDBBackend.PINECONE:
            import pinecone
            pinecone.delete_index(self.collection_name)
            # Recréer l'index
            embedding_dim = self.embedding_manager.embedding_model.dimensions
            pinecone.create_index(
                name=self.collection_name,
                dimension=embedding_dim,
                metric="cosine"
            )
            self.pinecone_index = pinecone.Index(self.collection_name)
        else:  # SIMPLE
            self.simple_vectors.clear()
            self.simple_documents.clear()
        
        logger.info("VectorDatabase vidée")


# Instance globale
_vector_database = None

def get_vector_database(
    backend: VectorDBBackend = VectorDBBackend.SIMPLE,
    embedding_provider: EmbeddingProvider = EmbeddingProvider.SENTENCE_TRANSFORMERS,
    embedding_model: Optional[str] = None,
    collection_name: str = "issalan_docs",
    persist_directory: Optional[str] = None
) -> VectorDatabase:
    """
    Factory pour obtenir la base de données vectorielle.
    
    Args:
        backend: Backend de base de données vectorielle
        embedding_provider: Fournisseur d'embeddings
        embedding_model: Modèle d'embeddings spécifique
        collection_name: Nom de la collection
        persist_directory: Répertoire de persistance
        
    Returns:
        Instance de la base de données vectorielle
    """
    global _vector_database
    
    if _vector_database is None:
        _vector_database = VectorDatabase(
            backend=backend,
            embedding_provider=embedding_provider,
            embedding_model=embedding_model,
            collection_name=collection_name,
            persist_directory=persist_directory
        )
    
    return _vector_database
