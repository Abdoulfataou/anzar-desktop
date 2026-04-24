"""
Système de cache pour ISSALAN API
Gère la mise en cache des réponses pour améliorer les performances
"""

import asyncio
import logging
import json
import hashlib
import pickle
import gzip
from typing import Dict, Any, Optional, Union
from datetime import datetime, timedelta
from pathlib import Path
import time

logger = logging.getLogger(__name__)

class CacheManager:
    """Gestionnaire de cache multi-niveaux pour ISSALAN API."""
    
    def __init__(
        self,
        memory_cache_size: int = 1000,  # Nombre d'éléments en cache mémoire
        disk_cache_dir: Optional[str] = None,
        default_ttl: int = 300,  # 5 minutes par défaut
        compression_enabled: bool = True
    ):
        """
        Initialise le gestionnaire de cache.
        
        Args:
            memory_cache_size: Taille maximale du cache mémoire
            disk_cache_dir: Répertoire pour le cache disque
            default_ttl: TTL par défaut en secondes
            compression_enabled: Activer la compression des données
        """
        self.memory_cache_size = memory_cache_size
        self.default_ttl = default_ttl
        self.compression_enabled = compression_enabled
        
        # Cache mémoire (LRU-like)
        self.memory_cache: Dict[str, Dict[str, Any]] = {}
        self.cache_order: list = []  # Pour l'éviction LRU
        
        # Cache disque
        if disk_cache_dir:
            self.disk_cache_dir = Path(disk_cache_dir)
        else:
            self.disk_cache_dir = Path.home() / ".issalan" / "api_cache"
        
        self.disk_cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Statistiques
        self.stats = {
            "memory_hits": 0,
            "memory_misses": 0,
            "disk_hits": 0,
            "disk_misses": 0,
            "sets": 0,
            "deletes": 0,
            "evictions": 0,
            "compressed_bytes": 0,
            "uncompressed_bytes": 0,
            "start_time": time.time()
        }
        
        # Tâche de nettoyage
        self.cleanup_task: Optional[asyncio.Task] = None
        self.is_running = False
        
        logger.info(
            f"CacheManager initialisé: "
            f"memory={memory_cache_size}, "
            f"disk={self.disk_cache_dir}, "
            f"ttl={default_ttl}s"
        )
    
    async def initialize(self):
        """Initialise le cache manager."""
        self.is_running = True
        self.cleanup_task = asyncio.create_task(self._cleanup_loop())
        
        # Charger le cache disque existant
        await self._load_disk_cache_stats()
        
        logger.info("CacheManager initialisé")
    
    async def shutdown(self):
        """Arrête le cache manager."""
        self.is_running = False
        if self.cleanup_task:
            self.cleanup_task.cancel()
            try:
                await self.cleanup_task
            except asyncio.CancelledError:
                pass
        
        # Sauvegarder les statistiques
        await self._save_stats()
        
        logger.info("CacheManager arrêté")
    
    def _generate_cache_key(self, data: Union[str, Dict[str, Any]]) -> str:
        """
        Génère une clé de cache à partir de données.
        
        Args:
            data: Données à cacher
            
        Returns:
            Clé de cache
        """
        if isinstance(data, dict):
            data_str = json.dumps(data, sort_keys=True)
        else:
            data_str = str(data)
        
        # Utiliser SHA256 pour une clé unique
        return hashlib.sha256(data_str.encode()).hexdigest()
    
    def _get_memory_cache_key(self, key: str) -> str:
        """Génère une clé pour le cache mémoire."""
        return f"mem:{key}"
    
    def _get_disk_cache_path(self, key: str) -> Path:
        """
        Obtient le chemin du fichier de cache disque.
        
        Args:
            key: Clé de cache
            
        Returns:
            Chemin du fichier
        """
        # Créer une structure de répertoire basée sur le hash
        subdir = key[:2]
        subdir_path = self.disk_cache_dir / subdir
        subdir_path.mkdir(exist_ok=True)
        
        return subdir_path / f"{key}.cache"
    
    def _compress_data(self, data: bytes) -> bytes:
        """
        Compresse les données si activé.
        
        Args:
            data: Données à compresser
            
        Returns:
            Données compressées
        """
        if not self.compression_enabled:
            return data
        
        try:
            compressed = gzip.compress(data)
            
            # Mettre à jour les statistiques
            self.stats["compressed_bytes"] += len(compressed)
            self.stats["uncompressed_bytes"] += len(data)
            
            compression_ratio = len(data) / len(compressed) if len(compressed) > 0 else 1
            logger.debug(f"Compression ratio: {compression_ratio:.2f}x")
            
            return compressed
        except Exception as e:
            logger.warning(f"Erreur lors de la compression: {e}")
            return data
    
    def _decompress_data(self, data: bytes) -> bytes:
        """
        Décompresse les données si nécessaire.
        
        Args:
            data: Données à décompresser
            
        Returns:
            Données décompressées
        """
        if not self.compression_enabled:
            return data
        
        try:
            return gzip.decompress(data)
        except Exception:
            # Si la décompression échoue, retourner les données telles quelles
            return data
    
    async def get(self, key: str) -> Optional[Any]:
        """
        Récupère des données du cache.
        
        Args:
            key: Clé de cache
            
        Returns:
            Données en cache ou None
        """
        # Essayer le cache mémoire d'abord
        memory_key = self._get_memory_cache_key(key)
        if memory_key in self.memory_cache:
            cache_item = self.memory_cache[memory_key]
            
            # Vérifier l'expiration
            if cache_item["expires_at"] > time.time():
                # Mettre à jour l'ordre LRU
                self.cache_order.remove(memory_key)
                self.cache_order.append(memory_key)
                
                self.stats["memory_hits"] += 1
                logger.debug(f"Cache mémoire hit: {key}")
                return cache_item["data"]
            else:
                # Supprimer l'élément expiré
                del self.memory_cache[memory_key]
                self.cache_order.remove(memory_key)
                self.stats["evictions"] += 1
        
        self.stats["memory_misses"] += 1
        
        # Essayer le cache disque
        cache_path = self._get_disk_cache_path(key)
        
        if not cache_path.exists():
            self.stats["disk_misses"] += 1
            logger.debug(f"Cache miss: {key}")
            return None
        
        try:
            # Lire le fichier de cache
            with open(cache_path, 'rb') as f:
                cached_data = f.read()
            
            # Décompresser si nécessaire
            cached_data = self._decompress_data(cached_data)
            
            # Désérialiser
            cache_item = pickle.loads(cached_data)
            
            # Vérifier l'expiration
            if cache_item["expires_at"] > time.time():
                # Mettre en cache mémoire pour les prochaines requêtes
                await self._set_memory_cache(memory_key, cache_item["data"], cache_item["expires_at"])
                
                self.stats["disk_hits"] += 1
                logger.debug(f"Cache disque hit: {key}")
                return cache_item["data"]
            else:
                # Supprimer le fichier expiré
                cache_path.unlink()
                self.stats["deletes"] += 1
                logger.debug(f"Cache expiré supprimé: {key}")
                
        except Exception as e:
            logger.warning(f"Erreur lors de la lecture du cache disque: {e}")
            # Supprimer le fichier corrompu
            if cache_path.exists():
                cache_path.unlink()
        
        self.stats["disk_misses"] += 1
        return None
    
    async def set(self, key: str, data: Any, ttl: Optional[int] = None) -> bool:
        """
        Stocke des données dans le cache.
        
        Args:
            key: Clé de cache
            data: Données à stocker
            ttl: Time-to-live en secondes
            
        Returns:
            True si réussi, False sinon
        """
        if ttl is None:
            ttl = self.default_ttl
        
        expires_at = time.time() + ttl
        
        # Stocker en mémoire
        memory_key = self._get_memory_cache_key(key)
        await self._set_memory_cache(memory_key, data, expires_at)
        
        # Stocker sur disque
        try:
            cache_item = {
                "data": data,
                "expires_at": expires_at,
                "created_at": time.time(),
                "key": key,
                "ttl": ttl
            }
            
            # Sérialiser
            serialized_data = pickle.dumps(cache_item)
            
            # Compresser si activé
            serialized_data = self._compress_data(serialized_data)
            
            # Écrire sur disque
            cache_path = self._get_disk_cache_path(key)
            with open(cache_path, 'wb') as f:
                f.write(serialized_data)
            
            self.stats["sets"] += 1
            logger.debug(f"Données mises en cache: {key} (TTL: {ttl}s)")
            return True
            
        except Exception as e:
            logger.error(f"Erreur lors de l'écriture du cache disque: {e}")
            return False
    
    async def _set_memory_cache(self, key: str, data: Any, expires_at: float):
        """
        Stocke des données dans le cache mémoire.
        
        Args:
            key: Clé de cache
            data: Données à stocker
            expires_at: Timestamp d'expiration
        """
        # Éviction LRU si nécessaire
        if len(self.memory_cache) >= self.memory_cache_size:
            # Supprimer le plus ancien
            oldest_key = self.cache_order.pop(0)
            del self.memory_cache[oldest_key]
            self.stats["evictions"] += 1
            logger.debug(f"Éviction LRU: {oldest_key}")
        
        # Stocker les données
        self.memory_cache[key] = {
            "data": data,
            "expires_at": expires_at,
            "accessed_at": time.time()
        }
        
        # Mettre à jour l'ordre
        if key in self.cache_order:
            self.cache_order.remove(key)
        self.cache_order.append(key)
    
    async def delete(self, key: str) -> bool:
        """
        Supprime des données du cache.
        
        Args:
            key: Clé de cache
            
        Returns:
            True si supprimé, False sinon
        """
        deleted = False
        
        # Supprimer du cache mémoire
        memory_key = self._get_memory_cache_key(key)
        if memory_key in self.memory_cache:
            del self.memory_cache[memory_key]
            if memory_key in self.cache_order:
                self.cache_order.remove(memory_key)
            deleted = True
        
        # Supprimer du cache disque
        cache_path = self._get_disk_cache_path(key)
        if cache_path.exists():
            try:
                cache_path.unlink()
                deleted = True
            except Exception as e:
                logger.warning(f"Erreur lors de la suppression du cache disque: {e}")
        
        if deleted:
            self.stats["deletes"] += 1
            logger.debug(f"Cache supprimé: {key}")
        
        return deleted
    
    async def clear(self):
        """Vide tout le cache."""
        # Vider le cache mémoire
        self.memory_cache.clear()
        self.cache_order.clear()
        
        # Vider le cache disque
        try:
            import shutil
            if self.disk_cache_dir.exists():
                shutil.rmtree(self.disk_cache_dir)
                self.disk_cache_dir.mkdir(parents=True, exist_ok=True)
            
            logger.info("Cache vidé")
        except Exception as e:
            logger.error(f"Erreur lors du vidage du cache: {e}")
    
    async def _cleanup_loop(self):
        """Boucle de nettoyage des caches expirés."""
        while self.is_running:
            try:
                await asyncio.sleep(60)  # Nettoyer toutes les minutes
                await self._cleanup_expired()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Erreur dans la boucle de nettoyage: {e}")
    
    async def _cleanup_expired(self):
        """Nettoie les éléments de cache expirés."""
        current_time = time.time()
        
        # Nettoyer le cache mémoire
        expired_keys = []
        for key, item in self.memory_cache.items():
            if item["expires_at"] <= current_time:
                expired_keys.append(key)
        
        for key in expired_keys:
            del self.memory_cache[key]
            if key in self.cache_order:
                self.cache_order.remove(key)
        
        if expired_keys:
            self.stats["evictions"] += len(expired_keys)
            logger.debug(f"{len(expired_keys)} éléments expirés nettoyés du cache mémoire")
        
        # Nettoyer le cache disque (moins fréquemment)
        if hasattr(self, '_last_disk_cleanup'):
            time_since_last_cleanup = current_time - self._last_disk_cleanup
            if time_since_last_cleanup < 300:  # 5 minutes
                return
        
        self._last_disk_cleanup = current_time
        
        # Nettoyer les fichiers expirés sur disque
        expired_files = 0
        for cache_file in self.disk_cache_dir.rglob("*.cache"):
            try:
                with open(cache_file, 'rb') as f:
                    cached_data = f.read()
                
                cached_data = self._decompress_data(cached_data)
                cache_item = pickle.loads(cached_data)
                
                if cache_item["expires_at"] <= current_time:
                    cache_file.unlink()
                    expired_files += 1
                    
            except Exception:
                # Fichier corrompu, le supprimer
                cache_file.unlink()
                expired_files += 1
        
        if expired_files:
            self.stats["deletes"] += expired_files
            logger.info(f"{expired_files} fichiers expirés nettoyés du cache disque")
    
    async def _load_disk_cache_stats(self):
        """Charge les statistiques du cache disque."""
        try:
            stats_file = self.disk_cache_dir / "cache_stats.json"
            if stats_file.exists():
                with open(stats_file, 'r') as f:
                    saved_stats = json.load(f)
                
                # Fusionner certaines statistiques
                for key in ["compressed_bytes", "uncompressed_bytes"]:
                    if key in saved_stats:
                        self.stats[key] = saved_stats[key]
                
                logger.debug("Statistiques du cache disque chargées")
        except Exception as e:
            logger.warning(f"Erreur lors du chargement des statistiques: {e}")
    
    async def _save_stats(self):
        """Sauvegarde les statistiques du cache."""
        try:
            stats_file = self.disk_cache_dir / "cache_stats.json"
            with open(stats_file, 'w') as f:
                json.dump(self.stats, f, indent=2)
            
            logger.debug("Statistiques du cache sauvegardées")
        except Exception as e:
            logger.warning(f"Erreur lors de la sauvegarde des statistiques: {e}")
    
    async def get_stats(self) -> Dict[str, Any]:
        """
        Récupère les statistiques du cache.
        
        Returns:
            Statistiques
        """
        current_time = time.time()
        uptime = current_time - self.stats["start_time"]
        
        # Calculer les taux de hit
        total_hits = self.stats["memory_hits"] + self.stats["disk_hits"]
        total_misses = self.stats["memory_misses"] + self.stats["disk_misses"]
        total_requests = total_hits + total_misses
        
        if total_requests > 0:
            hit_rate = (total_hits / total_requests) * 100
            memory_hit_rate = (self.stats["memory_hits"] / total_requests) * 100 if total_requests > 0 else 0
            disk_hit_rate = (self.stats["disk_hits"] / total_requests) * 100 if total_requests > 0 else 0
        else:
            hit_rate = 0
            memory_hit_rate = 0
            disk_hit_rate = 0
        
        # Calculer la compression ratio
        if self.stats["compressed_bytes"] > 0:
            compression_ratio = self.stats["uncompressed_bytes"] / self.stats["compressed_bytes"]
        else:
            compression_ratio = 1.0
        
        # Compter les fichiers de cache disque
        disk_file_count = 0
        disk_total_size = 0
        
        if self.disk_cache_dir.exists():
            for cache_file in self.disk_cache_dir.rglob("*.cache"):
                disk_file_count += 1
                disk_total_size += cache_file.stat().st_size
        
        return {
            "memory_cache_size": len(self.memory_cache),
            "memory_cache_max": self.memory_cache_size,
            "disk_cache_files": disk_file_count,
            "disk_cache_size_bytes": disk_total_size,
            "disk_cache_size_mb": round(disk_total_size / (1024 * 1024), 2),
            "memory_hits": self.stats["memory_hits"],
            "memory_misses": self.stats["memory_misses"],
            "disk_hits": self.stats["disk_hits"],
            "disk_misses": self.stats["disk_misses"],
            "total_hits": total_hits,
            "total_misses": total_misses,
            "total_requests": total_requests,
            "hit_rate_percent": round(hit_rate, 2),
            "memory_hit_rate_percent": round(memory_hit_rate, 2),
            "disk_hit_rate_percent": round(disk_hit_rate, 2),
            "sets": self.stats["sets"],
            "deletes": self.stats["deletes"],
            "evictions": self.stats["evictions"],
            "compressed_bytes": self.stats["compressed_bytes"],
            "uncompressed_bytes": self.stats["uncompressed_bytes"],
            "compression_ratio": round(compression_ratio, 2),
            "compression_enabled": self.compression_enabled,
            "default_ttl": self.default_ttl,
            "uptime_seconds": round(uptime, 2),
            "timestamp": datetime.now().isoformat()
        }


# Instance globale
_cache_manager = None

def get_cache_manager() -> CacheManager:
    """
    Factory pour obtenir le gestionnaire de cache.
    
    Returns:
        Instance du gestionnaire de cache
    """
    global _cache_manager
    
    if _cache_manager is None:
        _cache_manager = CacheManager()
    
    return _cache_manager


# Test du module
async def test_cache_manager():
    """Test du cache manager."""
    print("💾 Test du Cache Manager ISSALAN")
    print("=" * 50)
    
    cache = CacheManager(memory_cache_size=10, compression_enabled=True)
    await cache.initialize()
    
    # Test 1: Stocker et récupérer
    print("📝 Test 1: Stocker et récupérer")
    test_data = {"message": "Hello ISSALAN", "timestamp": time.time()}
    
    # Stocker
    success = await cache.set("test_key", test_data, ttl=10)
    print(f"  ✅ Données stockées: {success}")
    
    # Récupérer
    cached_data = await cache.get("test_key")
    print(f"  ✅ Données récupérées: {cached_data is not None}")
    
    if cached_data:
        print(f"  ✅ Données correctes: {cached_data['message']}")
    
    # Test 2: Expiration
    print("\n⏰ Test 2: Expiration")
    await cache.set("expiring_key", "Données temporaires", ttl=1)
    
    # Attendre l'expiration
    await asyncio.sleep(1.5)
    
    expired_data = await cache.get("expiring_key")
    print(f"  ✅ Données expirées: {expired_data is None}")
    
    # Test 3: Compression
    print("\n🗜️  Test 3: Compression")
    large_data = "x" * 10000  # 10KB de données
    await cache.set("large_key", large_data)
    
    # Vérifier la compression dans les statistiques
    stats = await cache.get_stats()
    print(f"  ✅ Compression ratio: {stats['compression_ratio']:.2f}x")
    
    # Test 4: Éviction LRU
    print("\n🔄 Test 4: Éviction LRU")
    for i in range(15):  # Plus que la taille du cache
        await cache.set(f"key_{i}", f"value_{i}")
    
    # Le premier élément devrait être évincé
    first_data = await cache.get("key_0")
    print(f"  ✅ Premier élément évincé: {first_data is None}")
    
    # Test 5: Suppression
    print("\n🗑️  Test 5: Suppression")
    await cache.set("to_delete", "Données à supprimer")
    await cache.delete("to_delete")
    
    deleted_data = await cache.get("to_delete")
    print(f"  ✅ Données supprimées: {deleted_data is None}")
    
    # Statistiques finales
    print("\n📊 Statistiques finales:")
    final_stats = await cache.get_stats()
    for key, value in final_stats.items():
        if key not in ["timestamp", "compressed_bytes", "uncompressed_bytes"]:
            print(f"  {key}: {value}")
    
    await cache.shutdown()
    
    print("=" * 50)
    print("✅ Cache Manager testé avec succès")


if __name__ == "__main__":
    # Exécuter le test
    asyncio.run(test_cache_manager())
