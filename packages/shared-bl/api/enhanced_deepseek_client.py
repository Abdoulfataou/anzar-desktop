"""
Client DeepSeek amélioré - Optimisé pour la performance et la fiabilité.
Inspiré de l'efficacité chinoise : rapide, fiable, scalable.
"""

import os
import json
import asyncio
import logging
from typing import Dict, List, Any, Optional, AsyncGenerator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import hashlib
import redis.asyncio as redis
from openai import AsyncOpenAI, APIError, RateLimitError, APITimeoutError
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


@dataclass
class CacheConfig:
    """Configuration du cache."""
    enabled: bool = True
    ttl: int = 3600  # 1 heure
    max_size: int = 1000


@dataclass
class RateLimitConfig:
    """Configuration de la limitation de débit."""
    requests_per_minute: int = 60
    tokens_per_minute: int = 100000


@dataclass
class FallbackConfig:
    """Configuration des solutions de repli."""
    enabled: bool = True
    providers: List[str] = field(default_factory=lambda: ["openai", "claude"])
    priority: List[str] = field(default_factory=lambda: ["deepseek", "openai", "claude"])


class EnhancedDeepSeekClient:
    """
    Client DeepSeek amélioré avec :
    1. Cache intelligent (Redis)
    2. Limitation de débit
    3. Repli automatique sur d'autres fournisseurs
    4. Métriques de performance
    5. Optimisation pour le développement
    """
    
    def __init__(self, cache_config: Optional[CacheConfig] = None,
                 rate_limit_config: Optional[RateLimitConfig] = None,
                 fallback_config: Optional[FallbackConfig] = None):
        
        # Configuration
        self.cache_config = cache_config or CacheConfig()
        self.rate_limit_config = rate_limit_config or RateLimitConfig()
        self.fallback_config = fallback_config or FallbackConfig()
        
        # Clé API DeepSeek
        api_key = os.getenv('DEEPSEEK_API_KEY')
        base_url = os.getenv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')
        
        if not api_key or api_key == 'your_deepseek_api_key_here':
            raise ValueError("Clé API DeepSeek non configurée. Ajoutez-la dans .env")
        
        # Client DeepSeek principal
        self.primary_client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=30.0,
            max_retries=3
        )
        
        # Modèles
        self.standard_model = os.getenv('DEEPSEEK_MODEL', 'deepseek-chat')
        self.reasoner_model = os.getenv('DEEPSEEK_REASONER_MODEL', 'deepseek-reasoner')
        
        # Cache Redis
        self.redis_client = None
        if self.cache_config.enabled:
            self._init_redis()
        
        # Limitation de débit
        self.request_timestamps: List[datetime] = []
        self.token_count = 0
        self.token_reset_time = datetime.now()
        
        # Métriques
        self.metrics = {
            'total_requests': 0,
            'successful_requests': 0,
            'failed_requests': 0,
            'cache_hits': 0,
            'cache_misses': 0,
            'fallback_used': 0,
            'average_response_time': 0.0,
            'total_tokens_used': 0
        }
        
        # Clients de repli
        self.fallback_clients = {}
        self._init_fallback_clients()
        
        logger.info(f"Client DeepSeek amélioré initialisé")
        logger.info(f"Cache: {'activé' if self.cache_config.enabled else 'désactivé'}")
        logger.info(f"Limitation: {self.rate_limit_config.requests_per_minute} req/min")
        logger.info(f"Repli: {', '.join(self.fallback_config.providers)}")
    
    def _init_redis(self):
        """Initialise la connexion Redis."""
        try:
            redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
            self.redis_client = redis.from_url(redis_url)
            logger.info("Redis connecté pour le cache")
        except Exception as e:
            logger.warning(f"Impossible de connecter Redis: {e}. Cache désactivé.")
            self.cache_config.enabled = False
    
    def _init_fallback_clients(self):
        """Initialise les clients de repli."""
        if not self.fallback_config.enabled:
            return
        
        # OpenAI (repli principal)
        openai_key = os.getenv('OPENAI_API_KEY')
        if openai_key and openai_key != 'your_openai_api_key_here':
            self.fallback_clients['openai'] = AsyncOpenAI(
                api_key=openai_key,
                timeout=30.0
            )
            logger.info("Client OpenAI de repli initialisé")
        
        # Claude (si disponible)
        claude_key = os.getenv('ANTHROPIC_API_KEY')
        if claude_key and claude_key != 'your_claude_api_key_here':
            # Note: Implémenter le client Claude si nécessaire
            pass
    
    def _generate_cache_key(self, messages: List[Dict[str, str]], 
                          model: str, **kwargs) -> str:
        """Génère une clé de cache unique."""
        cache_data = {
            'messages': messages,
            'model': model,
            **{k: v for k, v in kwargs.items() if k not in ['stream', 'timeout']}
        }
        
        cache_json = json.dumps(cache_data, sort_keys=True)
        return f"deepseek:{hashlib.md5(cache_json.encode()).hexdigest()}"
    
    async def _get_cached_response(self, cache_key: str) -> Optional[Any]:
        """Récupère une réponse depuis le cache."""
        if not self.cache_config.enabled or not self.redis_client:
            return None
        
        try:
            cached = await self.redis_client.get(cache_key)
            if cached:
                self.metrics['cache_hits'] += 1
                return json.loads(cached)
        except Exception as e:
            logger.warning(f"Erreur de cache: {e}")
        
        self.metrics['cache_misses'] += 1
        return None
    
    async def _set_cached_response(self, cache_key: str, response: Any):
        """Stocke une réponse dans le cache."""
        if not self.cache_config.enabled or not self.redis_client:
            return
        
        try:
            await self.redis_client.setex(
                cache_key,
                self.cache_config.ttl,
                json.dumps(response)
            )
        except Exception as e:
            logger.warning(f"Erreur de mise en cache: {e}")
    
    async def _check_rate_limit(self, estimated_tokens: int = 1000) -> bool:
        """Vérifie et applique la limitation de débit."""
        now = datetime.now()
        
        # Réinitialiser le compteur de tokens si nécessaire
        if now - self.token_reset_time > timedelta(minutes=1):
            self.token_count = 0
            self.token_reset_time = now
        
        # Vérifier les limites
        if len(self.request_timestamps) >= self.rate_limit_config.requests_per_minute:
            # Supprimer les timestamps vieux de plus d'une minute
            self.request_timestamps = [
                ts for ts in self.request_timestamps 
                if now - ts < timedelta(minutes=1)
            ]
            
            if len(self.request_timestamps) >= self.rate_limit_config.requests_per_minute:
                # Attendre
                oldest = min(self.request_timestamps)
                wait_time = 60 - (now - oldest).seconds + 1
                logger.info(f"Limite de débit atteinte, attente de {wait_time}s")
                await asyncio.sleep(wait_time)
        
        # Vérifier les tokens
        if self.token_count + estimated_tokens > self.rate_limit_config.tokens_per_minute:
            wait_time = 60 - (now - self.token_reset_time).seconds + 1
            logger.info(f"Limite de tokens atteinte, attente de {wait_time}s")
            await asyncio.sleep(wait_time)
            self.token_count = 0
            self.token_reset_time = datetime.now()
        
        return True
    
    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
        stream: bool = False,
        use_cache: bool = True,
        **kwargs
    ) -> Any:
        """
        Appel de complétion amélioré avec cache et repli.
        
        Args:
            messages: Messages de conversation
            model: Modèle à utiliser
            temperature: Créativité (0.0-2.0)
            max_tokens: Tokens maximum en sortie
            stream: Streamer la réponse
            use_cache: Utiliser le cache
            **kwargs: Paramètres additionnels
            
        Returns:
            Réponse de l'API
        """
        start_time = datetime.now()
        self.metrics['total_requests'] += 1
        
        # Sélection automatique du modèle
        if model is None:
            model = self._detect_model_from_context(messages)
        
        # Générer la clé de cache
        cache_key = None
        if use_cache and not stream:
            cache_key = self._generate_cache_key(messages, model, **kwargs)
            cached = await self._get_cached_response(cache_key)
            if cached:
                logger.debug(f"Cache hit pour {cache_key[:50]}...")
                return cached
        
        # Vérifier la limitation de débit
        estimated_tokens = sum(len(str(m.get('content', ''))) // 4 for m in messages)
        await self._check_rate_limit(estimated_tokens)
        
        # Paramètres de l'appel
        params = {
            'model': model,
            'messages': messages,
            'max_tokens': max_tokens,
            'stream': stream,
        }
        
        if model != self.reasoner_model:
            params['temperature'] = temperature
        
        params.update(kwargs)
        
        try:
            # Appel principal à DeepSeek
            logger.debug(f"Appel DeepSeek: modèle={model}, messages={len(messages)}")
            
            if stream:
                response = await self._stream_completion(params)
            else:
                response = await self.primary_client.chat.completions.create(**params)
                
                # Mettre en cache
                if cache_key and use_cache:
                    await self._set_cached_response(cache_key, response)
                
                # Mettre à jour les métriques
                if hasattr(response, 'usage'):
                    self.token_count += response.usage.total_tokens
                    self.metrics['total_tokens_used'] += response.usage.total_tokens
            
            self.metrics['successful_requests'] += 1
            self.request_timestamps.append(datetime.now())
            
            # Calculer le temps de réponse
            response_time = (datetime.now() - start_time).total_seconds()
            self._update_average_response_time(response_time)
            
            return response
            
        except (RateLimitError, APITimeoutError, APIError) as e:
            logger.warning(f"Erreur DeepSeek: {e}. Tentative de repli...")
            return await self._fallback_completion(messages, model, **params)
            
        except Exception as e:
            logger.error(f"Erreur inattendue: {e}")
            self.metrics['failed_requests'] += 1
            raise
    
    async def _stream_completion(self, params: Dict[str, Any]) -> AsyncGenerator[str, None]:
        """Gère les réponses streamées."""
        try:
            stream = await self.primary_client.chat.completions.create(**params)
            
            async for chunk in stream:
                if chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content
                    
        except Exception as e:
            logger.error(f"Erreur de streaming: {e}")
            yield f"[Erreur: {str(e)}]"
    
    async def _fallback_completion(self, messages: List[Dict[str, str]], 
                                 model: str, **kwargs) -> Any:
        """Utilise un fournisseur de repli."""
        if not self.fallback_config.enabled:
            raise ValueError("Aucun fournisseur de repli disponible")
        
        self.metrics['fallback_used'] += 1
        
        for provider in self.fallback_config.priority:
            if provider == 'deepseek':
                continue  # On vient d'échouer avec DeepSeek
            
            client = self.fallback_clients.get(provider)
            if not client:
                continue
            
            try:
                logger.info(f"Utilisation du repli: {provider}")
                
                # Adapter les paramètres pour le fournisseur
                fallback_params = kwargs.copy()
                if provider == 'openai':
                    # OpenAI n'a pas de modèle reasoner, utiliser gpt-4
                    if model == self.reasoner_model:
                        fallback_params['model'] = 'gpt-4-turbo-preview'
                    else:
                        fallback_params['model'] = 'gpt-4'
                
                response = await client.chat.completions.create(**fallback_params)
                logger.info(f"Repli {provider} réussi")
                return response
                
            except Exception as e:
                logger.warning(f"Échec du repli {provider}: {e}")
                continue
        
        raise ValueError("Tous les fournisseurs de repli ont échoué")
    
    def _detect_model_from_context(self, messages: List[Dict[str, str]]) -> str:
        """
        Détecte le modèle approprié basé sur le contexte.
        Optimisé pour le développement logiciel.
        """
        if not messages:
            return self.standard_model
        
        # Analyser le dernier message utilisateur
        last_user_message = None
        for msg in reversed(messages):
            if msg.get('role') == 'user':
                last_user_message = msg.get('content', '')
                break
        
        if not last_user_message:
            return self.standard_model
        
        last_message_lower = last_user_message.lower()
        
        # Raisonnement pour les tâches complexes de développement
        reasoner_keywords = [
            # Architecture
            'architecture', 'architect', 'design pattern', 'microservices',
            'monolith', 'scalability', 'performance', 'optimization',
            
            # Planification
            'plan', 'roadmap', 'timeline', 'estimation', 'budget',
            'resource', 'team', 'sprint', 'agile', 'waterfall',
            
            # Analyse complexe
            'analyze', 'analysis', 'evaluate', 'assessment', 'audit',
            'review', 'inspect', 'debug', 'troubleshoot', 'diagnose',
            
            # Algorithmes
            'algorithm', 'data structure', 'complexity', 'big o',
            'sort', 'search', 'graph', 'tree', 'dynamic programming',
            
            # Sécurité
            'security', 'vulnerability', 'penetration test', 'audit',
            'encryption', 'authentication', 'authorization', 'oauth',
            
            # Déploiement
            'deployment', 'ci/cd', 'docker', 'kubernetes', 'cloud',
            'aws', 'azure', 'gcp', 'scaling', 'load balancing'
        ]
        
        # Standard pour le développement quotidien
        standard_keywords = [
            # Code
            'code', 'function', 'class', 'method', 'variable',
            'write', 'generate', 'create', 'implement', 'develop',
            
            # Correction
            'fix', 'bug', 'error', 'exception', 'crash',
            'debug', 'troubleshoot', 'issue', 'problem',
            
            # Tests
            'test', 'unit test', 'integration test', 'test case',
            'coverage', 'mock', 'stub', 'fixture',
            
            # Documentation
            'document', 'comment', 'readme', 'api docs', 'tutorial',
            
            # Simple questions
            'how to', 'what is', 'explain', 'example', 'simple',
            'quick', 'fast', 'easy', 'basic', 'beginner'
        ]
        
        # Compter les occurrences
        reasoner_count = sum(1 for keyword in reasoner_keywords 
                           if keyword in last_message_lower)
        standard_count = sum(1 for keyword in standard_keywords 
                           if keyword in last_message_lower)
        
        # Décision
        if reasoner_count > standard_count:
            return self.reasoner_model
        elif len(last_user_message) > 800:  # Messages longs → reasoner
            return self.reasoner_model
        elif any(word in last_message_lower for word in ['complex', 'difficult', 'challenging']):
            return self.reasoner_model
        else:
            return self.standard_model
    
    def _update_average_response_time(self, new_time: float):
        """Met à jour le temps de réponse moyen."""
        total_time = self.metrics['average_response_time'] * (self.metrics['total_requests'] - 1)
        self.metrics['average_response_time'] = (total_time + new_time) / self.metrics['total_requests']
    
    async def generate_code(
        self,
        prompt: str,
        language: str,
        framework: Optional[str] = None,
        context: Optional[str] = None,
        **kwargs
    ) -> str:
        """
        Génère du code optimisé pour un langage spécifique.
        
        Args:
            prompt: Description du code à générer
            language: Langage de programmation
            framework: Framework (optionnel)
            context: Contexte additionnel
            **kwargs: Paramètres additionnels
            
        Returns:
            Code généré
        """
        system_prompt = f"""Tu es un expert en développement {language}{f' et {framework}' if framework else ''}.
Tu dois générer du code propre, efficace, et professionnel.

Principes :
1. Suis les meilleures pratiques du langage
2. Écris du code lisible et bien documenté
3. Gère les erreurs de manière élégante
4. Optimise les performances
5. Sécurise le code

Format de réponse :
```{language}
// Ton code ici
```

Ne fournis que le code, sans explications supplémentaires."""
        
        user_prompt = f"Langage: {language}"
        if framework:
            user_prompt += f"\nFramework: {framework}"
        if context:
            user_prompt += f"\nContexte: {context}"
        user_prompt += f"\n\nRequête: {prompt}"
        
        response = await self.chat_completion(
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt}
            ],
            **kwargs
        )
        
        if hasattr(response, 'choices') and response.choices:
            return response.choices[0].message.content
        else:
            return str(response)
    
    def get_metrics(self) -> Dict[str, Any]:
        """Retourne les métriques de performance."""
        return self.metrics.copy()
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques du cache."""
        if not self.cache_config.enabled:
            return {'enabled': False}
        
        hit_rate = 0
        if self.metrics['cache_hits'] + self.metrics['cache_misses'] > 0:
            hit_rate = self.metrics['cache_hits'] / (self.metrics['cache_hits'] + self.metrics['cache_misses']) * 100
        
        return {
            'enabled': True,
            'hits': self.metrics['cache_hits'],
            'misses': self.metrics['cache_misses'],
            'hit_rate': round(hit_rate, 2),
            'total_requests': self.metrics['total_requests']
        }
    
    async def clear_cache(self):
        """Vide le cache."""
        if self.redis_client:
            try:
                await self.redis_client.flushdb()
                logger.info("Cache vidé")
            except Exception as e:
                logger.error(f"Erreur lors du vidage du cache: {e}")


# Instance globale
_enhanced_client: Optional[EnhancedDeepSeekClient] = None

async def get_enhanced_deepseek_client() -> EnhancedDeepSeekClient:
    """Factory pour obtenir le client amélioré."""
    global _enhanced_client
    if _enhanced_client is None:
        _enhanced_client = EnhancedDeepSeekClient()
    return _enhanced_client