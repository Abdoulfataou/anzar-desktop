"""
Base de données vectorielle pour ISSALAN RAG
Support pour plusieurs backends de base de données vectorielle
"""

from .vector_database import VectorDatabase, get_vector_database
from .document_store import DocumentStore, Document

__all__ = [
    "VectorDatabase",
    "get_vector_database",
    "DocumentStore",
    "Document",
]