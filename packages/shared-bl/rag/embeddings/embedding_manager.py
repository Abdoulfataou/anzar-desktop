"""
Gestionnaire d'embeddings pour ISSALAN RAG
Gère la création, le cache et l'optimisation des embeddings
"""

import os
import logging
import json
import hashlib
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
import asyncio
from pathlib import Path

from .embedding_models import EmbeddingModel, get_embedding_model, EmbeddingProvider

logger = logging.getLogger(__name__)

class EmbeddingManager:
    """Gestionnaire d'embeddings avec cache et optimisation."""
    
    def __init__(
        self,
        provider: EmbeddingProvider = EmbeddingProvider.SENTENCE_TRANSFORMERS,
        model_name: Optional[str] = None,
        cache_dir: Optional[str] = None
    ):
        """
        Initialise le gestionnaire d'embeddings.
        
        Args:
            provider: Fournisseur d'embeddings
            model_name: Nom spécifique du modèle
            cache_dir: Répertoire pour le cache disque
        """
        self.embedding_model = get_embedding_model(provider, model_name)
        self.provider = provider
        self.model_name = model_name or self.embedding_model.model_name
        
        # Cache en mémoire
        self.memory_cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl = timedelta(hours=24)  # 24 heures
        
        # Cache disque
        if cache_dir:
            self.cache_dir = Path(cache_dir)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        else:
            self.cache_dir = Path.home() / ".issalan" / "embeddings_cache"
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Obtenir le nom du modèle
        model_name = getattr(provider, 'model_name', str(provider))
        logger.info(f"EmbeddingManager initialisé avec {model_name}")
    
    def _get_cache_key(self, text: str) -> str:
        """
        Génère une clé de cache pour un texte.
        
        Args:
            text: Texte à cacher
            
        Returns:
            Clé de cache
        """
        # Utiliser un hash du texte + modèle
        text_hash = hashlib.md5(text.encode()).hexdigest()
        return f"{self.provider.value}_{self.model_name}_{text_hash}"
    
    def _get_disk_cache_path(self, cache_key: str) -> Path:
        """
        Obtient le chemin du cache disque.
        
        Args:
            cache_key: Clé de cache
            
        Returns:
            Chemin du fichier de cache
        """
        # Créer une structure de répertoire basée sur le hash
        subdir = cache_key[:2]
        subdir_path = self.cache_dir / subdir
        subdir_path.mkdir(exist_ok=True)
        
        return subdir_path / f"{cache_key}.json"
    
    def _load_from_disk_cache(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """
        Charge un embedding depuis le cache disque.
        
        Args:
            cache_key: Clé de cache
            
        Returns:
            Données du cache ou None
        """
        cache_path = self._get_disk_cache_path(cache_key)
        
        if not cache_path.exists():
            return None
        
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Vérifier la date d'expiration
            timestamp = datetime.fromisoformat(data.get("timestamp", "2000-01-01"))
            if datetime.now() - timestamp > self.cache_ttl:
                logger.debug(f"Cache expiré pour {cache_key}")
                cache_path.unlink()  # Supprimer le fichier expiré
                return None
            
            logger.debug(f"Embedding chargé depuis le cache disque: {cache_key}")
            return data
            
        except Exception as e:
            logger.warning(f"Erreur lors du chargement du cache disque: {e}")
            return None
    
    def _save_to_disk_cache(self, cache_key: str, embedding: List[float], metadata: Dict[str, Any] = None):
        """
        Sauvegarde un embedding dans le cache disque.
        
        Args:
            cache_key: Clé de cache
            embedding: Embedding à sauvegarder
            metadata: Métadonnées supplémentaires
        """
        try:
            cache_path = self._get_disk_cache_path(cache_key)
            
            data = {
                "embedding": embedding,
                "timestamp": datetime.now().isoformat(),
                "provider": self.provider.value,
                "model_name": self.model_name,
                "dimensions": len(embedding),
            }
            
            if metadata:
                data["metadata"] = metadata
            
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            
            logger.debug(f"Embedding sauvegardé dans le cache disque: {cache_key}")
            
        except Exception as e:
            logger.warning(f"Erreur lors de la sauvegarde du cache disque: {e}")
    
    async def get_embedding(self, text: str, use_cache: bool = True) -> List[float]:
        """
        Obtient l'embedding d'un texte.
        
        Args:
            text: Texte à embedder
            use_cache: Utiliser le cache
            
        Returns:
            Embedding du texte
        """
        if not text or not text.strip():
            logger.warning("Texte vide fourni à get_embedding")
            return [0.0] * self.embedding_model.dimensions
        
        cache_key = self._get_cache_key(text)
        
        # Vérifier le cache en mémoire
        if use_cache and cache_key in self.memory_cache:
            cached_data = self.memory_cache[cache_key]
            if datetime.now() - cached_data["timestamp"] < self.cache_ttl:
                logger.debug(f"Embedding depuis le cache mémoire: {cache_key}")
                return cached_data["embedding"]
        
        # Vérifier le cache disque
        if use_cache:
            disk_data = self._load_from_disk_cache(cache_key)
            if disk_data:
                # Mettre en cache mémoire
                self.memory_cache[cache_key] = {
                    "embedding": disk_data["embedding"],
                    "timestamp": datetime.fromisoformat(disk_data["timestamp"])
                }
                return disk_data["embedding"]
        
        # Générer l'embedding
        logger.debug(f"Génération d'embedding pour: {text[:50]}...")
        embedding = await self.embedding_model.embed_text(text)
        
        # Mettre en cache
        if use_cache:
            # Cache mémoire
            self.memory_cache[cache_key] = {
                "embedding": embedding,
                "timestamp": datetime.now()
            }
            
            # Cache disque
            self._save_to_disk_cache(cache_key, embedding)
        
        return embedding
    
    async def get_embeddings_batch(self, texts: List[str], use_cache: bool = True) -> List[List[float]]:
        """
        Obtient les embeddings d'un batch de textes.
        
        Args:
            texts: Liste de textes à embedder
            use_cache: Utiliser le cache
            
        Returns:
            Liste d'embeddings
        """
        if not texts:
            return []
        
        embeddings = []
        texts_to_embed = []
        indices_to_embed = []
        
        # Vérifier le cache pour chaque texte
        for i, text in enumerate(texts):
            if not text or not text.strip():
                embeddings.append([0.0] * self.embedding_model.dimensions)
                continue
            
            cache_key = self._get_cache_key(text)
            cached_embedding = None
            
            # Vérifier le cache mémoire
            if use_cache and cache_key in self.memory_cache:
                cached_data = self.memory_cache[cache_key]
                if datetime.now() - cached_data["timestamp"] < self.cache_ttl:
                    cached_embedding = cached_data["embedding"]
            
            # Vérifier le cache disque
            if use_cache and cached_embedding is None:
                disk_data = self._load_from_disk_cache(cache_key)
                if disk_data:
                    cached_embedding = disk_data["embedding"]
                    # Mettre en cache mémoire
                    self.memory_cache[cache_key] = {
                        "embedding": cached_embedding,
                        "timestamp": datetime.fromisoformat(disk_data["timestamp"])
                    }
            
            if cached_embedding is not None:
                embeddings.append(cached_embedding)
            else:
                embeddings.append(None)  # Placeholder
                texts_to_embed.append(text)
                indices_to_embed.append(i)
        
        # Générer les embeddings manquants
        if texts_to_embed:
            logger.debug(f"Génération de {len(texts_to_embed)} embeddings par batch")
            
            # Utiliser la méthode batch si disponible
            if hasattr(self.embedding_model, 'embed_batch'):
                try:
                    new_embeddings = await self.embedding_model.embed_batch(texts_to_embed)
                except Exception as e:
                    logger.error(f"Erreur lors de l'embedding batch: {e}")
                    new_embeddings = [[0.0] * self.embedding_model.dimensions for _ in texts_to_embed]
            else:
                # Fallback: embeddings séquentiels
                new_embeddings = []
                for text in texts_to_embed:
                    try:
                        embedding = await self.embedding_model.embed_text(text)
                        new_embeddings.append(embedding)
                    except Exception as e:
                        logger.error(f"Erreur lors de l'embedding: {e}")
                        new_embeddings.append([0.0] * self.embedding_model.dimensions)
            
            # Mettre à jour les embeddings et le cache
            for idx, embedding in zip(indices_to_embed, new_embeddings):
                embeddings[idx] = embedding
                
                # Mettre en cache
                if use_cache:
                    text = texts[idx]
                    cache_key = self._get_cache_key(text)
                    
                    # Cache mémoire
                    self.memory_cache[cache_key] = {
                        "embedding": embedding,
                        "timestamp": datetime.now()
                    }
                    
                    # Cache disque
                    self._save_to_disk_cache(cache_key, embedding)
        
        return embeddings
    
    async def get_similarity(self, text1: str, text2: str, use_cache: bool = True) -> float:
        """
        Calcule la similarité cosinus entre deux textes.
        
        Args:
            text1: Premier texte
            text2: Deuxième texte
            use_cache: Utiliser le cache
            
        Returns:
            Score de similarité (0-1)
        """
        try:
            import numpy as np
            
            # Obtenir les embeddings
            embedding1 = await self.get_embedding(text1, use_cache)
            embedding2 = await self.get_embedding(text2, use_cache)
            
            # Convertir en numpy arrays
            vec1 = np.array(embedding1)
            vec2 = np.array(embedding2)
            
            # Calculer la similarité cosinus
            dot_product = np.dot(vec1, vec2)
            norm1 = np.linalg.norm(vec1)
            norm2 = np.linalg.norm(vec2)
            
            if norm1 == 0 or norm2 == 0:
                return 0.0
            
            similarity = dot_product / (norm1 * norm2)
            
            # S'assurer que le score est entre 0 et 1
            return max(0.0, min(1.0, similarity))
            
        except Exception as e:
            logger.error(f"Erreur lors du calcul de similarité: {e}")
            return 0.0
    
    async def find_most_similar(
        self, 
        query: str, 
        candidates: List[str], 
        top_k: int = 5,
        use_cache: bool = True
    ) -> List[Tuple[str, float]]:
        """
        Trouve les textes les plus similaires à une requête.
        
        Args:
            query: Texte de requête
            candidates: Liste de textes candidats
            top_k: Nombre de résultats à retourner
            use_cache: Utiliser le cache
            
        Returns:
            Liste de tuples (texte, score)
        """
        if not candidates:
            return []
        
        # Obtenir l'embedding de la requête
        query_embedding = await self.get_embedding(query, use_cache)
        
        # Obtenir les embeddings des candidats
        candidate_embeddings = await self.get_embeddings_batch(candidates, use_cache)
        
        # Calculer les similarités
        similarities = []
        try:
            import numpy as np
            
            query_vec = np.array(query_embedding)
            
            for i, candidate_embedding in enumerate(candidate_embeddings):
                if candidate_embedding is None:
                    similarities.append((candidates[i], 0.0))
                    continue
                
                candidate_vec = np.array(candidate_embedding)
                
                # Similarité cosinus
                dot_product = np.dot(query_vec, candidate_vec)
                norm1 = np.linalg.norm(query_vec)
                norm2 = np.linalg.norm(candidate_vec)
                
                if norm1 == 0 or norm2 == 0:
                    similarity = 0.0
                else:
                    similarity = dot_product / (norm1 * norm2)
                
                similarities.append((candidates[i], max(0.0, min(1.0, similarity))))
        
        except Exception as e:
            logger.error(f"Erreur lors du calcul des similarités: {e}")
            return []
        
        # Trier par similarité décroissante
        similarities.sort(key=lambda x: x[1], reverse=True)
        
        # Retourner les top_k résultats
        return similarities[:top_k]
    
    def clear_memory_cache(self):
        """Vide le cache mémoire."""
        self.memory_cache.clear()
        logger.info("Cache mémoire des embeddings vidé")
    
    def clear_disk_cache(self):
        """Vide le cache disque."""
        try:
            import shutil
            if self.cache_dir.exists():
                shutil.rmtree(self.cache_dir)
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                logger.info("Cache disque des embeddings vidé")
        except Exception as e:
            logger.error(f"Erreur lors du vidage du cache disque: {e}")
    
    def clear_all_cache(self):
        """Vide tous les caches."""
        self.clear_memory_cache()
        self.clear_disk_cache()
        self.embedding_model.clear_cache()
        logger.info("Tous les caches d'embeddings vidés")
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques du cache."""
        # Compter les fichiers dans le cache disque
        disk_cache_count = 0
        if self.cache_dir.exists():
            disk_cache_count = sum(1 for _ in self.cache_dir.rglob("*.json"))
        
        return {
            "memory_cache_size": len(self.memory_cache),
            "disk_cache_size": disk_cache_count,
            "cache_ttl_hours": self.cache_ttl.total_seconds() / 3600,
            "provider": self.provider.value,
            "model_name": self.model_name,
            "dimensions": self.embedding_model.dimensions,
            "timestamp": datetime.now().isoformat(),
        }


# Instance globale
_embedding_manager = None

def get_embedding_manager(
    provider: EmbeddingProvider = EmbeddingProvider.SENTENCE_TRANSFORMERS,
    model_name: Optional[str] = None,
    cache_dir: Optional[str] = None
) -> EmbeddingManager:
    """
    Factory pour obtenir le gestionnaire d'embeddings.
    
    Args:
        provider: Fournisseur d'embeddings
        model_name: Nom spécifique du modèle
        cache_dir: Répertoire pour le cache disque
        
    Returns:
        Instance du gestionnaire d'embeddings
    """
    global _embedding_manager
    
    if _embedding_manager is None:
        _embedding_manager = EmbeddingManager(provider, model_name, cache_dir)
    
    return _embedding_manager