"""
Store de documents pour ISSALAN RAG
Gère le stockage et la récupération des documents
"""

import os
import json
import logging
import hashlib
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)

class DocumentType(Enum):
    """Types de documents supportés."""
    CODE = "code"
    DOCUMENTATION = "documentation"
    ERROR_SOLUTION = "error_solution"
    BEST_PRACTICE = "best_practice"
    TUTORIAL = "tutorial"
    API_REFERENCE = "api_reference"
    GENERAL = "general"

class DocumentSource(Enum):
    """Sources de documents."""
    GITHUB = "github"
    STACKOVERFLOW = "stackoverflow"
    OFFICIAL_DOCS = "official_docs"
    MEDIUM = "medium"
    BLOG = "blog"
    WIKIPEDIA = "wikipedia"
    USER_UPLOAD = "user_upload"
    WEB_SEARCH = "web_search"

@dataclass
class Document:
    """Représente un document dans le système RAG."""
    
    # Identifiants
    id: str
    content: str
    
    # Métadonnées
    title: str = ""
    source: DocumentSource = DocumentSource.WEB_SEARCH
    doc_type: DocumentType = DocumentType.GENERAL
    language: str = "python"
    url: str = ""
    tags: List[str] = field(default_factory=list)
    
    # Informations techniques
    embedding: Optional[List[float]] = None
    embedding_model: str = ""
    embedding_dimensions: int = 0
    
    # Métriques
    relevance_score: float = 0.0
    quality_score: float = 0.0
    popularity_score: float = 0.0
    
    # Métadonnées temporelles
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    last_accessed: datetime = field(default_factory=datetime.now)
    
    # Métadonnées supplémentaires
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convertit le document en dictionnaire."""
        data = asdict(self)
        
        # Convertir les enums en strings
        data["source"] = self.source.value
        data["doc_type"] = self.doc_type.value
        
        # Convertir les datetimes en strings ISO
        data["created_at"] = self.created_at.isoformat()
        data["updated_at"] = self.updated_at.isoformat()
        data["last_accessed"] = self.last_accessed.isoformat()
        
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Document':
        """Crée un document à partir d'un dictionnaire."""
        # Convertir les strings en enums
        if "source" in data and isinstance(data["source"], str):
            data["source"] = DocumentSource(data["source"])
        
        if "doc_type" in data and isinstance(data["doc_type"], str):
            data["doc_type"] = DocumentType(data["doc_type"])
        
        # Convertir les strings ISO en datetimes
        datetime_fields = ["created_at", "updated_at", "last_accessed"]
        for field_name in datetime_fields:
            if field_name in data and isinstance(data[field_name], str):
                data[field_name] = datetime.fromisoformat(data[field_name])
        
        return cls(**data)
    
    def generate_id(self) -> str:
        """Génère un ID unique basé sur le contenu et les métadonnées."""
        content_hash = hashlib.md5(self.content.encode()).hexdigest()
        metadata_hash = hashlib.md5(json.dumps(self.metadata, sort_keys=True).encode()).hexdigest()
        return f"{content_hash[:8]}_{metadata_hash[:8]}"
    
    def update_access_time(self):
        """Met à jour le temps d'accès."""
        self.last_accessed = datetime.now()
    
    def calculate_quality_score(self) -> float:
        """Calcule un score de qualité basé sur le contenu."""
        score = 0.0
        
        # Longueur du contenu
        content_length = len(self.content)
        if content_length > 1000:
            score += 0.3
        elif content_length > 500:
            score += 0.2
        elif content_length > 100:
            score += 0.1
        
        # Source
        if self.source == DocumentSource.OFFICIAL_DOCS:
            score += 0.4
        elif self.source == DocumentSource.GITHUB:
            score += 0.3
        elif self.source == DocumentSource.STACKOVERFLOW:
            score += 0.2
        
        # Type
        if self.doc_type == DocumentType.API_REFERENCE:
            score += 0.2
        elif self.doc_type == DocumentType.BEST_PRACTICE:
            score += 0.15
        
        # Tags
        if self.tags:
            score += min(0.1, len(self.tags) * 0.02)
        
        # URL
        if self.url:
            score += 0.05
        
        self.quality_score = min(1.0, score)
        return self.quality_score

class DocumentStore:
    """Store de documents avec persistance sur disque."""
    
    def __init__(self, storage_dir: Optional[str] = None):
        """
        Initialise le store de documents.
        
        Args:
            storage_dir: Répertoire de stockage
        """
        if storage_dir:
            self.storage_dir = Path(storage_dir)
        else:
            self.storage_dir = Path.home() / ".issalan" / "documents"
        
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        # Cache en mémoire
        self.documents: Dict[str, Document] = {}
        
        # Indexes
        self.source_index: Dict[DocumentSource, List[str]] = {}
        self.type_index: Dict[DocumentType, List[str]] = {}
        self.language_index: Dict[str, List[str]] = {}
        self.tag_index: Dict[str, List[str]] = {}
        
        logger.info(f"DocumentStore initialisé: {self.storage_dir}")
    
    def _get_document_path(self, doc_id: str) -> Path:
        """
        Obtient le chemin du fichier pour un document.
        
        Args:
            doc_id: ID du document
            
        Returns:
            Chemin du fichier
        """
        # Créer une structure de répertoire basée sur l'ID
        subdir = doc_id[:2]
        subdir_path = self.storage_dir / subdir
        subdir_path.mkdir(exist_ok=True)
        
        return subdir_path / f"{doc_id}.json"
    
    def add_document(self, document: Document, save_to_disk: bool = True) -> str:
        """
        Ajoute un document au store.
        
        Args:
            document: Document à ajouter
            save_to_disk: Sauvegarder sur disque
            
        Returns:
            ID du document
        """
        # Générer un ID si nécessaire
        if not document.id:
            document.id = document.generate_id()
        
        # Calculer le score de qualité
        document.calculate_quality_score()
        
        # Mettre à jour les timestamps
        document.updated_at = datetime.now()
        document.last_accessed = datetime.now()
        
        # Ajouter au cache mémoire
        self.documents[document.id] = document
        
        # Mettre à jour les indexes
        self._update_indexes(document)
        
        # Sauvegarder sur disque
        if save_to_disk:
            self._save_document_to_disk(document)
        
        logger.debug(f"Document ajouté: {document.id} - {document.title[:50]}...")
        return document.id
    
    def _update_indexes(self, document: Document):
        """Met à jour tous les indexes pour un document."""
        # Index par source
        if document.source not in self.source_index:
            self.source_index[document.source] = []
        if document.id not in self.source_index[document.source]:
            self.source_index[document.source].append(document.id)
        
        # Index par type
        if document.doc_type not in self.type_index:
            self.type_index[document.doc_type] = []
        if document.id not in self.type_index[document.doc_type]:
            self.type_index[document.doc_type].append(document.id)
        
        # Index par langage
        if document.language not in self.language_index:
            self.language_index[document.language] = []
        if document.id not in self.language_index[document.language]:
            self.language_index[document.language].append(document.id)
        
        # Index par tag
        for tag in document.tags:
            if tag not in self.tag_index:
                self.tag_index[tag] = []
            if document.id not in self.tag_index[tag]:
                self.tag_index[tag].append(document.id)
    
    def _save_document_to_disk(self, document: Document):
        """Sauvegarde un document sur disque."""
        try:
            doc_path = self._get_document_path(document.id)
            
            with open(doc_path, 'w', encoding='utf-8') as f:
                json.dump(document.to_dict(), f, ensure_ascii=False, indent=2)
            
            logger.debug(f"Document sauvegardé sur disque: {document.id}")
            
        except Exception as e:
            logger.error(f"Erreur lors de la sauvegarde du document {document.id}: {e}")
    
    def get_document(self, doc_id: str, load_from_disk: bool = True) -> Optional[Document]:
        """
        Récupère un document par son ID.
        
        Args:
            doc_id: ID du document
            load_from_disk: Charger depuis le disque si non trouvé en mémoire
            
        Returns:
            Document ou None
        """
        # Vérifier le cache mémoire
        if doc_id in self.documents:
            document = self.documents[doc_id]
            document.update_access_time()
            return document
        
        # Charger depuis le disque
        if load_from_disk:
            document = self._load_document_from_disk(doc_id)
            if document:
                # Mettre en cache mémoire
                self.documents[doc_id] = document
                document.update_access_time()
                return document
        
        return None
    
    def _load_document_from_disk(self, doc_id: str) -> Optional[Document]:
        """Charge un document depuis le disque."""
        try:
            doc_path = self._get_document_path(doc_id)
            
            if not doc_path.exists():
                return None
            
            with open(doc_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            document = Document.from_dict(data)
            logger.debug(f"Document chargé depuis le disque: {doc_id}")
            return document
            
        except Exception as e:
            logger.error(f"Erreur lors du chargement du document {doc_id}: {e}")
            return None
    
    def update_document(self, doc_id: str, updates: Dict[str, Any]) -> bool:
        """
        Met à jour un document.
        
        Args:
            doc_id: ID du document
            updates: Mises à jour à appliquer
            
        Returns:
            True si la mise à jour a réussi
        """
        document = self.get_document(doc_id)
        if not document:
            return False
        
        # Appliquer les mises à jour
        for key, value in updates.items():
            if hasattr(document, key):
                setattr(document, key, value)
        
        # Mettre à jour les timestamps
        document.updated_at = datetime.now()
        
        # Recalculer le score de qualité
        document.calculate_quality_score()
        
        # Sauvegarder
        self._save_document_to_disk(document)
        
        logger.debug(f"Document mis à jour: {doc_id}")
        return True
    
    def delete_document(self, doc_id: str) -> bool:
        """
        Supprime un document.
        
        Args:
            doc_id: ID du document
            
        Returns:
            True si la suppression a réussi
        """
        # Supprimer du cache mémoire
        if doc_id in self.documents:
            del self.documents[doc_id]
        
        # Supprimer des indexes
        self._remove_from_indexes(doc_id)
        
        # Supprimer du disque
        try:
            doc_path = self._get_document_path(doc_id)
            if doc_path.exists():
                doc_path.unlink()
                logger.debug(f"Document supprimé: {doc_id}")
                return True
        except Exception as e:
            logger.error(f"Erreur lors de la suppression du document {doc_id}: {e}")
        
        return False
    
    def _remove_from_indexes(self, doc_id: str):
        """Supprime un document de tous les indexes."""
        # Source index
        for source, doc_ids in self.source_index.items():
            if doc_id in doc_ids:
                doc_ids.remove(doc_id)
        
        # Type index
        for doc_type, doc_ids in self.type_index.items():
            if doc_id in doc_ids:
                doc_ids.remove(doc_id)
        
        # Language index
        for language, doc_ids in self.language_index.items():
            if doc_id in doc_ids:
                doc_ids.remove(doc_id)
        
        # Tag index
        for tag, doc_ids in self.tag_index.items():
            if doc_id in doc_ids:
                doc_ids.remove(doc_id)
    
    def search_documents(
        self,
        query: Optional[str] = None,
        source: Optional[DocumentSource] = None,
        doc_type: Optional[DocumentType] = None,
        language: Optional[str] = None,
        tags: Optional[List[str]] = None,
        min_quality: float = 0.0,
        limit: int = 100
    ) -> List[Document]:
        """
        Recherche des documents avec des filtres.
        
        Args:
            query: Texte de recherche (recherche simple dans le contenu)
            source: Filtrer par source
            doc_type: Filtrer par type
            language: Filtrer par langage
            tags: Filtrer par tags
            min_quality: Score de qualité minimum
            limit: Nombre maximum de résultats
            
        Returns:
            Liste de documents correspondants
        """
        # Commencer avec tous les IDs
        candidate_ids = set(self.documents.keys())
        
        # Appliquer les filtres
        if source:
            source_ids = set(self.source_index.get(source, []))
            candidate_ids = candidate_ids.intersection(source_ids)
        
        if doc_type:
            type_ids = set(self.type_index.get(doc_type, []))
            candidate_ids = candidate_ids.intersection(type_ids)
        
        if language:
            language_ids = set(self.language_index.get(language, []))
            candidate_ids = candidate_ids.intersection(language_ids)
        
        if tags:
            for tag in tags:
                tag_ids = set(self.tag_index.get(tag, []))
                candidate_ids = candidate_ids.intersection(tag_ids)
        
        # Récupérer les documents
        documents = []
        for doc_id in list(candidate_ids)[:limit * 2]:  # Prendre plus pour le filtrage qualité
            document = self.get_document(doc_id)
            if document and document.quality_score >= min_quality:
                documents.append(document)
        
        # Filtrer par recherche textuelle si une query est fournie
        if query and query.strip():
            query_lower = query.lower()
            filtered_documents = []
            
            for document in documents:
                # Rechercher dans le titre et le contenu
                if (query_lower in document.title.lower() or 
                    query_lower in document.content.lower()):
                    filtered_documents.append(document)
            
            documents = filtered_documents
        
        # Trier par score de qualité
        documents.sort(key=lambda x: x.quality_score, reverse=True)
        
        # Limiter les résultats
        return documents[:limit]
    
    def get_document_count(self) -> Dict[str, int]:
        """Retourne les statistiques du store."""
        total = len(self.documents)
        
        counts = {
            "total": total,
            "by_source": {source.value: len(ids) for source, ids in self.source_index.items()},
            "by_type": {doc_type.value: len(ids) for doc_type, ids in self.type_index.items()},
            "by_language": {lang: len(ids) for lang, ids in self.language_index.items()},
            "storage_dir": str(self.storage_dir),
        }
        
        return counts
    
    def load_all_documents(self) -> int:
        """
        Charge tous les documents depuis le disque.
        
        Returns:
            Nombre de documents chargés
        """
        count = 0
        
        for json_file in self.storage_dir.rglob("*.json"):
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                document = Document.from_dict(data)
                self.documents[document.id] = document
                self._update_indexes(document)
                count += 1
                
            except Exception as e:
                logger.error(f"Erreur lors du chargement de {json_file}: {e}")
        
        logger.info(f"{count} documents chargés depuis le disque")
        return count
    
    def clear_all(self):
        """Vide tous les documents."""
        self.documents.clear()
        self.source_index.clear()
        self.type_index.clear()
        self.language_index.clear()
        self.tag_index.clear()
        
        # Supprimer tous les fichiers
        try:
            import shutil
            if self.storage_dir.exists():
                shutil.rmtree(self.storage_dir)
                self.storage_dir.mkdir(parents=True, exist_ok=True)
                logger.info("Tous les documents supprimés")
        except Exception as e:
            logger.error(f"Erreur lors du vidage du store: {e}")
    
    def batch_add_documents(self, documents: List[Document]) -> List[str]:
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
                doc_id = self.add_document(document, save_to_disk=True)
                doc_ids.append(doc_id)
            except Exception as e:
                logger.error(f"Erreur lors de l'ajout du document: {e}")
        
        logger.info(f"{len(doc_ids)}/{len(documents)} documents ajoutés en batch")
        return doc_ids
    
    def export_to_json(self, output_file: str) -> bool:
        """
        Exporte tous les documents vers un fichier JSON.
        
        Args:
            output_file: Chemin du fichier de sortie
            
        Returns:
            True si l'export a réussi
        """
        try:
            all_documents = []
            for doc_id in self.documents.keys():
                document = self.get_document(doc_id)
                if document:
                    all_documents.append(document.to_dict())
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(all_documents, f, ensure_ascii=False, indent=2)
            
            logger.info(f"{len(all_documents)} documents exportés vers {output_file}")
            return True
            
        except Exception as e:
            logger.error(f"Erreur lors de l'export: {e}")
            return False
    
    def import_from_json(self, input_file: str) -> int:
        """
        Importe des documents depuis un fichier JSON.
        
        Args:
            input_file: Chemin du fichier d'entrée
            
        Returns:
            Nombre de documents importés
        """
        try:
            with open(input_file, 'r', encoding='utf-8') as f:
                documents_data = json.load(f)
            
            count = 0
            for doc_data in documents_data:
                try:
                    document = Document.from_dict(doc_data)
                    self.add_document(document, save_to_disk=True)
                    count += 1
                except Exception as e:
                    logger.error(f"Erreur lors de l'import d'un document: {e}")
            
            logger.info(f"{count} documents importés depuis {input_file}")
            return count
            
        except Exception as e:
            logger.error(f"Erreur lors de l'import: {e}")
            return 0


# Instance globale
_document_store = None

def get_document_store(storage_dir: Optional[str] = None) -> DocumentStore:
    """
    Factory pour obtenir le store de documents.
    
    Args:
        storage_dir: Répertoire de stockage
        
    Returns:
        Instance du store de documents
    """
    global _document_store
    
    if _document_store is None:
        _document_store = DocumentStore(storage_dir)
        # Charger tous les documents existants
        _document_store.load_all_documents()
    
    return _document_store
