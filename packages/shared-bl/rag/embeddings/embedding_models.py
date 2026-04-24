"""
Modèles d'embeddings pour ISSALAN RAG
Support pour plusieurs fournisseurs d'embeddings
"""

import os
import logging
from typing import List, Optional, Dict, Any
from enum import Enum
import numpy as np
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)

class EmbeddingProvider(Enum):
    """Fournisseurs d'embeddings supportés."""
    OPENAI = "openai"
    DEEPSEEK = "deepseek"
    SENTENCE_TRANSFORMERS = "sentence_transformers"
    HUGGINGFACE = "huggingface"
    OLLAMA = "ollama"

class EmbeddingModel(ABC):
    """Classe abstraite pour les modèles d'embeddings."""
    
    def __init__(self, model_name: str, dimensions: int):
        """
        Initialise le modèle d'embeddings.
        
        Args:
            model_name: Nom du modèle
            dimensions: Dimensions des embeddings
        """
        self.model_name = model_name
        self.dimensions = dimensions
        self.cache: Dict[str, List[float]] = {}
    
    @abstractmethod
    async def embed_text(self, text: str) -> List[float]:
        """
        Génère un embedding pour un texte.
        
        Args:
            text: Texte à embedder
            
        Returns:
            Liste de floats représentant l'embedding
        """
        pass
    
    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Génère des embeddings pour un batch de textes.
        
        Args:
            texts: Liste de textes à embedder
            
        Returns:
            Liste d'embeddings
        """
        embeddings = []
        for text in texts:
            embedding = await self.embed_text(text)
            embeddings.append(embedding)
        return embeddings
    
    def clear_cache(self):
        """Vide le cache des embeddings."""
        self.cache.clear()
        logger.info(f"Cache vidé pour le modèle {self.model_name}")

class OpenAIEmbedding(EmbeddingModel):
    """Embeddings OpenAI."""
    
    def __init__(self, model_name: str = "text-embedding-3-small"):
        """
        Initialise le modèle OpenAI.
        
        Args:
            model_name: Nom du modèle OpenAI
        """
        # Dimensions par défaut pour les modèles OpenAI
        dimensions_map = {
            "text-embedding-3-small": 1536,
            "text-embedding-3-large": 3072,
            "text-embedding-ada-002": 1536,
        }
        
        dimensions = dimensions_map.get(model_name, 1536)
        super().__init__(model_name, dimensions)
        
        try:
            from openai import AsyncOpenAI
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                logger.warning("OPENAI_API_KEY non configurée")
            
            self.client = AsyncOpenAI(api_key=api_key)
            logger.info(f"Modèle OpenAI initialisé: {model_name}")
        except ImportError:
            logger.error("OpenAI package non installé")
            raise
    
    async def embed_text(self, text: str) -> List[float]:
        """Génère un embedding avec OpenAI."""
        # Vérifier le cache
        cache_key = f"openai_{self.model_name}_{text}"
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        try:
            response = await self.client.embeddings.create(
                model=self.model_name,
                input=text
            )
            
            embedding = response.data[0].embedding
            
            # Mettre en cache
            self.cache[cache_key] = embedding
            
            return embedding
            
        except Exception as e:
            logger.error(f"Erreur OpenAI embedding: {e}")
            # Retourner un embedding de zéros en fallback
            return [0.0] * self.dimensions

class DeepSeekEmbedding(EmbeddingModel):
    """Embeddings DeepSeek."""
    
    def __init__(self, model_name: str = "deepseek-embedding"):
        """
        Initialise le modèle DeepSeek.
        
        Args:
            model_name: Nom du modèle DeepSeek
        """
        super().__init__(model_name, 1536)  # DeepSeek a 1536 dimensions
        
        try:
            from openai import AsyncOpenAI
            api_key = os.getenv("DEEPSEEK_API_KEY")
            if not api_key:
                logger.warning("DEEPSEEK_API_KEY non configurée")
            
            self.client = AsyncOpenAI(
                api_key=api_key,
                base_url="https://api.deepseek.com"
            )
            logger.info(f"Modèle DeepSeek initialisé: {model_name}")
        except ImportError:
            logger.error("OpenAI package non installé")
            raise
    
    async def embed_text(self, text: str) -> List[float]:
        """Génère un embedding avec DeepSeek."""
        # Vérifier le cache
        cache_key = f"deepseek_{self.model_name}_{text}"
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        try:
            response = await self.client.embeddings.create(
                model="deepseek-embedding",
                input=text
            )
            
            embedding = response.data[0].embedding
            
            # Mettre en cache
            self.cache[cache_key] = embedding
            
            return embedding
            
        except Exception as e:
            logger.error(f"Erreur DeepSeek embedding: {e}")
            # Retourner un embedding de zéros en fallback
            return [0.0] * self.dimensions

class SentenceTransformersEmbedding(EmbeddingModel):
    """Embeddings Sentence Transformers (local)."""
    
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialise le modèle Sentence Transformers.
        
        Args:
            model_name: Nom du modèle Sentence Transformers
        """
        # Dimensions par défaut pour les modèles courants
        dimensions_map = {
            "all-MiniLM-L6-v2": 384,
            "all-mpnet-base-v2": 768,
            "paraphrase-multilingual-MiniLM-L12-v2": 384,
        }
        
        dimensions = dimensions_map.get(model_name, 384)
        super().__init__(model_name, dimensions)
        
        try:
            from sentence_transformers import SentenceTransformer
            self.model = SentenceTransformer(model_name)
            logger.info(f"Modèle Sentence Transformers initialisé: {model_name}")
        except ImportError:
            logger.error("sentence-transformers package non installé")
            raise
    
    async def embed_text(self, text: str) -> List[float]:
        """Génère un embedding avec Sentence Transformers."""
        # Vérifier le cache
        cache_key = f"st_{self.model_name}_{text}"
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        try:
            # Sentence Transformers est synchrone
            embedding = self.model.encode(text).tolist()
            
            # Mettre en cache
            self.cache[cache_key] = embedding
            
            return embedding
            
        except Exception as e:
            logger.error(f"Erreur Sentence Transformers embedding: {e}")
            # Retourner un embedding de zéros en fallback
            return [0.0] * self.dimensions
    
    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Génère des embeddings par batch avec Sentence Transformers."""
        try:
            embeddings = self.model.encode(texts).tolist()
            return embeddings
        except Exception as e:
            logger.error(f"Erreur Sentence Transformers batch embedding: {e}")
            return [[0.0] * self.dimensions for _ in texts]

class OllamaEmbedding(EmbeddingModel):
    """Embeddings Ollama (local)."""
    
    def __init__(self, model_name: str = "nomic-embed-text"):
        """
        Initialise le modèle Ollama.
        
        Args:
            model_name: Nom du modèle Ollama
        """
        super().__init__(model_name, 768)  # Ollama a généralement 768 dimensions
        
        try:
            import aiohttp
            self.session = aiohttp.ClientSession()
            self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            logger.info(f"Modèle Ollama initialisé: {model_name}")
        except ImportError:
            logger.error("aiohttp package non installé")
            raise
    
    async def embed_text(self, text: str) -> List[float]:
        """Génère un embedding avec Ollama."""
        # Vérifier le cache
        cache_key = f"ollama_{self.model_name}_{text}"
        if cache_key in self.cache:
            return self.cache[cache_key]
        
        try:
            import aiohttp
            import json
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/api/embeddings",
                    json={
                        "model": self.model_name,
                        "prompt": text
                    }
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        embedding = data.get("embedding", [])
                        
                        # Mettre en cache
                        self.cache[cache_key] = embedding
                        
                        return embedding
                    else:
                        logger.error(f"Erreur Ollama API: {response.status}")
                        return [0.0] * self.dimensions
                        
        except Exception as e:
            logger.error(f"Erreur Ollama embedding: {e}")
            # Retourner un embedding de zéros en fallback
            return [0.0] * self.dimensions

# Factory pour obtenir le modèle d'embeddings
_embedding_model = None

def get_embedding_model(
    provider: EmbeddingProvider = EmbeddingProvider.SENTENCE_TRANSFORMERS,
    model_name: Optional[str] = None
) -> EmbeddingModel:
    """
    Factory pour obtenir le modèle d'embeddings.
    
    Args:
        provider: Fournisseur d'embeddings
        model_name: Nom spécifique du modèle
        
    Returns:
        Instance du modèle d'embeddings
    """
    global _embedding_model
    
    if _embedding_model is not None:
        return _embedding_model
    
    # Déterminer le nom du modèle par défaut
    if model_name is None:
        model_name_map = {
            EmbeddingProvider.OPENAI: "text-embedding-3-small",
            EmbeddingProvider.DEEPSEEK: "deepseek-embedding",
            EmbeddingProvider.SENTENCE_TRANSFORMERS: "all-MiniLM-L6-v2",
            EmbeddingProvider.HUGGINGFACE: "sentence-transformers/all-MiniLM-L6-v2",
            EmbeddingProvider.OLLAMA: "nomic-embed-text",
        }
        model_name = model_name_map.get(provider, "all-MiniLM-L6-v2")
    
    # Créer le modèle approprié
    if provider == EmbeddingProvider.OPENAI:
        _embedding_model = OpenAIEmbedding(model_name)
    elif provider == EmbeddingProvider.DEEPSEEK:
        _embedding_model = DeepSeekEmbedding(model_name)
    elif provider == EmbeddingProvider.SENTENCE_TRANSFORMERS:
        _embedding_model = SentenceTransformersEmbedding(model_name)
    elif provider == EmbeddingProvider.OLLAMA:
        _embedding_model = OllamaEmbedding(model_name)
    else:
        # Fallback sur Sentence Transformers
        logger.warning(f"Fournisseur {provider} non supporté, utilisation de Sentence Transformers")
        _embedding_model = SentenceTransformersEmbedding("all-MiniLM-L6-v2")
    
    return _embedding_model