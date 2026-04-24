"""
Rate limiter pour ISSALAN API
Limite le nombre de requêtes par client pour prévenir les abus
"""

import asyncio
import logging
import time
from typing import Dict, Any, Optional
from collections import defaultdict
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class RateLimiter:
    """Rate limiter basé sur le token bucket algorithm."""
    
    def __init__(
        self,
        default_rate: int = 100,  # Requêtes par minute
        burst_capacity: int = 150,  # Capacité de burst
        cleanup_interval: int = 300  # Nettoyage toutes les 5 minutes
    ):
        """
        Initialise le rate limiter.
        
        Args:
            default_rate: Nombre de requêtes par minute par défaut
            burst_capacity: Capacité de burst (requêtes supplémentaires autorisées)
            cleanup_interval: Intervalle de nettoyage en secondes
        """
        self.default_rate = default_rate
        self.burst_capacity = burst_capacity
        
        # Stockage des buckets par client
        self.buckets: Dict[str, Dict[str, Any]] = {}
        
        # Configuration par endpoint
        self.endpoint_limits: Dict[str, Dict[str, int]] = {
            "/api/deepseek/chat": {"rate": 50, "burst": 75},  # Plus restrictif pour DeepSeek
            "/api/deepseek/stream": {"rate": 30, "burst": 50},
            "/api/rag/search": {"rate": 200, "burst": 300},
            "/api/web-search/search": {"rate": 100, "burst": 150},
            "/api/solo-builder/build": {"rate": 20, "burst": 30},  # Limité car coûteux
        }
        
        # Statistiques
        self.stats = {
            "total_requests": 0,
            "blocked_requests": 0,
            "allowed_requests": 0,
            "unique_clients": set(),
            "start_time": time.time()
        }
        
        # Tâche de nettoyage
        self.cleanup_task: Optional[asyncio.Task] = None
        self.cleanup_interval = cleanup_interval
        self.is_running = False
        
        logger.info(f"RateLimiter initialisé avec rate={default_rate}/min, burst={burst_capacity}")
    
    async def initialize(self):
        """Initialise le rate limiter."""
        self.is_running = True
        self.cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("RateLimiter initialisé")
    
    async def shutdown(self):
        """Arrête le rate limiter."""
        self.is_running = False
        if self.cleanup_task:
            self.cleanup_task.cancel()
            try:
                await self.cleanup_task
            except asyncio.CancelledError:
                pass
        logger.info("RateLimiter arrêté")
    
    def _get_limit_for_endpoint(self, endpoint: str) -> Dict[str, int]:
        """
        Récupère les limites pour un endpoint spécifique.
        
        Args:
            endpoint: Chemin de l'endpoint
            
        Returns:
            Limites (rate, burst)
        """
        # Chercher une correspondance exacte d'abord
        if endpoint in self.endpoint_limits:
            return self.endpoint_limits[endpoint]
        
        # Chercher une correspondance par préfixe
        for path, limits in self.endpoint_limits.items():
            if endpoint.startswith(path):
                return limits
        
        # Retourner les limites par défaut
        return {"rate": self.default_rate, "burst": self.burst_capacity}
    
    def _get_bucket_key(self, client_id: str, endpoint: str) -> str:
        """
        Génère une clé de bucket pour un client et un endpoint.
        
        Args:
            client_id: Identifiant du client
            endpoint: Chemin de l'endpoint
            
        Returns:
            Clé du bucket
        """
        return f"{client_id}:{endpoint}"
    
    async def is_allowed(self, client_id: str, endpoint: str) -> bool:
        """
        Vérifie si une requête est autorisée.
        
        Args:
            client_id: Identifiant du client (IP, API key, etc.)
            endpoint: Chemin de l'endpoint
            
        Returns:
            True si la requête est autorisée, False sinon
        """
        self.stats["total_requests"] += 1
        self.stats["unique_clients"].add(client_id)
        
        # Obtenir les limites pour cet endpoint
        limits = self._get_limit_for_endpoint(endpoint)
        rate = limits["rate"]
        burst = limits["burst"]
        
        # Calculer le taux de remplissage (tokens par seconde)
        fill_rate = rate / 60.0  # Convertir de par minute à par seconde
        
        # Clé du bucket
        bucket_key = self._get_bucket_key(client_id, endpoint)
        current_time = time.time()
        
        # Initialiser ou récupérer le bucket
        if bucket_key not in self.buckets:
            self.buckets[bucket_key] = {
                "tokens": burst,  # Commencer avec la capacité de burst
                "last_update": current_time,
                "client_id": client_id,
                "endpoint": endpoint,
                "rate": rate,
                "burst": burst,
                "requests": 0,
                "last_request": current_time
            }
        
        bucket = self.buckets[bucket_key]
        
        # Calculer les nouveaux tokens depuis la dernière mise à jour
        time_passed = current_time - bucket["last_update"]
        new_tokens = time_passed * fill_rate
        
        # Mettre à jour les tokens (ne pas dépasser la capacité de burst)
        bucket["tokens"] = min(burst, bucket["tokens"] + new_tokens)
        bucket["last_update"] = current_time
        
        # Vérifier si un token est disponible
        if bucket["tokens"] >= 1.0:
            # Consommer un token
            bucket["tokens"] -= 1.0
            bucket["requests"] += 1
            bucket["last_request"] = current_time
            
            self.stats["allowed_requests"] += 1
            logger.debug(f"Requête autorisée pour {client_id} sur {endpoint} (tokens restants: {bucket['tokens']:.2f})")
            return True
        else:
            # Pas assez de tokens
            self.stats["blocked_requests"] += 1
            
            # Calculer le temps d'attente
            wait_time = (1.0 - bucket["tokens"]) / fill_rate
            
            logger.warning(
                f"Rate limit dépassé pour {client_id} sur {endpoint}. "
                f"Attente requise: {wait_time:.1f}s. "
                f"Limite: {rate}/min, Burst: {burst}"
            )
            
            return False
    
    async def _cleanup_loop(self):
        """Boucle de nettoyage des buckets inactifs."""
        while self.is_running:
            try:
                await asyncio.sleep(self.cleanup_interval)
                await self._cleanup_buckets()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Erreur dans la boucle de nettoyage: {e}")
    
    async def _cleanup_buckets(self):
        """Nettoie les buckets inactifs."""
        current_time = time.time()
        inactive_threshold = 3600  # 1 heure
        
        buckets_to_remove = []
        
        for bucket_key, bucket in self.buckets.items():
            time_since_last_request = current_time - bucket["last_request"]
            
            if time_since_last_request > inactive_threshold:
                buckets_to_remove.append(bucket_key)
        
        # Supprimer les buckets inactifs
        for bucket_key in buckets_to_remove:
            del self.buckets[bucket_key]
        
        if buckets_to_remove:
            logger.info(f"Nettoyage: {len(buckets_to_remove)} buckets inactifs supprimés")
    
    async def get_stats(self) -> Dict[str, Any]:
        """
        Récupère les statistiques du rate limiter.
        
        Returns:
            Statistiques
        """
        current_time = time.time()
        uptime = current_time - self.stats["start_time"]
        
        # Calculer les taux
        if uptime > 0:
            requests_per_second = self.stats["total_requests"] / uptime
            blocked_rate = (self.stats["blocked_requests"] / self.stats["total_requests"]) * 100 if self.stats["total_requests"] > 0 else 0
        else:
            requests_per_second = 0
            blocked_rate = 0
        
        return {
            "total_requests": self.stats["total_requests"],
            "allowed_requests": self.stats["allowed_requests"],
            "blocked_requests": self.stats["blocked_requests"],
            "blocked_percentage": round(blocked_rate, 2),
            "unique_clients": len(self.stats["unique_clients"]),
            "active_buckets": len(self.buckets),
            "requests_per_second": round(requests_per_second, 2),
            "uptime_seconds": round(uptime, 2),
            "default_rate": self.default_rate,
            "burst_capacity": self.burst_capacity,
            "endpoint_limits": len(self.endpoint_limits),
            "timestamp": datetime.now().isoformat()
        }
    
    async def get_request_counts(self) -> Dict[str, Dict[str, Any]]:
        """
        Récupère les compteurs de requêtes par endpoint.
        
        Returns:
            Compteurs par endpoint
        """
        endpoint_counts = defaultdict(lambda: {"total": 0, "clients": set()})
        
        for bucket in self.buckets.values():
            endpoint = bucket["endpoint"]
            client_id = bucket["client_id"]
            
            endpoint_counts[endpoint]["total"] += bucket["requests"]
            endpoint_counts[endpoint]["clients"].add(client_id)
        
        # Convertir en format simple
        result = {}
        for endpoint, data in endpoint_counts.items():
            result[endpoint] = {
                "total_requests": data["total"],
                "unique_clients": len(data["clients"])
            }
        
        return result
    
    async def reset_client(self, client_id: str):
        """
        Réinitialise les limites pour un client.
        
        Args:
            client_id: Identifiant du client
        """
        buckets_to_remove = []
        
        for bucket_key, bucket in self.buckets.items():
            if bucket["client_id"] == client_id:
                buckets_to_remove.append(bucket_key)
        
        for bucket_key in buckets_to_remove:
            del self.buckets[bucket_key]
        
        logger.info(f"Limites réinitialisées pour le client {client_id} ({len(buckets_to_remove)} buckets)")
    
    async def update_limits(self, endpoint: str, rate: int, burst: int):
        """
        Met à jour les limites pour un endpoint.
        
        Args:
            endpoint: Chemin de l'endpoint
            rate: Nouveau taux (requêtes par minute)
            burst: Nouvelle capacité de burst
        """
        self.endpoint_limits[endpoint] = {"rate": rate, "burst": burst}
        
        # Mettre à jour les buckets existants pour cet endpoint
        for bucket_key, bucket in self.buckets.items():
            if bucket["endpoint"] == endpoint:
                bucket["rate"] = rate
                bucket["burst"] = burst
                # Ajuster les tokens si nécessaire
                bucket["tokens"] = min(burst, bucket["tokens"])
        
        logger.info(f"Limites mises à jour pour {endpoint}: rate={rate}/min, burst={burst}")


# Instance globale
_rate_limiter = None

def get_rate_limiter() -> RateLimiter:
    """
    Factory pour obtenir le rate limiter.
    
    Returns:
        Instance du rate limiter
    """
    global _rate_limiter
    
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    
    return _rate_limiter


# Test du module
async def test_rate_limiter():
    """Test du rate limiter."""
    print("🚦 Test du Rate Limiter ISSALAN")
    print("=" * 50)
    
    limiter = RateLimiter(default_rate=10, burst_capacity=15)  # 10 req/min pour les tests
    await limiter.initialize()
    
    client_id = "test_client"
    endpoint = "/api/test"
    
    print(f"Test avec client: {client_id}, endpoint: {endpoint}")
    print(f"Limite: 10 req/min, Burst: 15")
    print()
    
    # Test: 20 requêtes rapides
    print("📈 Test de 20 requêtes rapides:")
    allowed_count = 0
    blocked_count = 0
    
    for i in range(20):
        allowed = await limiter.is_allowed(client_id, endpoint)
        if allowed:
            allowed_count += 1
        else:
            blocked_count += 1
        
        if i < 15:
            # Les 15 premières devraient passer (burst capacity)
            assert allowed, f"Requête {i+1} devrait être autorisée (burst)"
        else:
            # Les suivantes devraient être bloquées
            assert not allowed, f"Requête {i+1} devrait être bloquée"
        
        # Petite pause pour éviter les problèmes de timing
        await asyncio.sleep(0.01)
    
    print(f"  ✅ Autorisés: {allowed_count}, Bloqués: {blocked_count}")
    
    # Test: Attendre et réessayer
    print("\n⏳ Test après attente de 7 secondes:")
    await asyncio.sleep(7)  # Attendre que le bucket se remplisse
    
    # Devrait être autorisé maintenant
    allowed = await limiter.is_allowed(client_id, endpoint)
    print(f"  ✅ Requête après attente: {'Autorisée' if allowed else 'Bloquée'}")
    
    # Test: Différents endpoints
    print("\n🔀 Test avec différents endpoints:")
    
    endpoints = [
        ("/api/deepseek/chat", "Limite: 50/min"),
        ("/api/rag/search", "Limite: 200/min"),
        ("/api/solo-builder/build", "Limite: 20/min"),
    ]
    
    for endpoint, description in endpoints:
        allowed = await limiter.is_allowed("another_client", endpoint)
        print(f"  {endpoint}: {'✅ Autorisée' if allowed else '❌ Bloquée'} ({description})")
    
    # Statistiques
    print("\n📊 Statistiques:")
    stats = await limiter.get_stats()
    for key, value in stats.items():
        if key not in ["timestamp", "endpoint_limits"]:
            print(f"  {key}: {value}")
    
    await limiter.shutdown()
    
    print("=" * 50)
    print("✅ Rate Limiter testé avec succès")

if __name__ == "__main__":
    # Exécuter le test
    asyncio.run(test_rate_limiter())