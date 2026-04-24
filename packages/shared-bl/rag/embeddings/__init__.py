"""
Système d'embeddings pour ISSALAN RAG
Supporte plusieurs modèles d'embeddings
"""

from .embedding_models import EmbeddingModel, get_embedding_model
from .embedding_manager import EmbeddingManager

__all__ = [
    "EmbeddingModel",
    "get_embedding_model",
    "EmbeddingManager",
]