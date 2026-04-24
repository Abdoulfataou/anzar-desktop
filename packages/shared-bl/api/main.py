"""
API Gateway unifiée pour ISSALAN
Point d'entrée unique pour tous les services ISSALAN
"""

import logging
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import time

from .deepseek_endpoints import init_deepseek_endpoints
from .rag_endpoints import init_rag_endpoints
from .web_search_endpoints import init_web_search_endpoints
from .solo_builder_endpoints import init_solo_builder_endpoints
from .auth import get_current_user, User, create_access_token
from .rate_limiter import RateLimiter
from .cache import CacheManager

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Variables globales
rate_limiter = RateLimiter()
cache_manager = CacheManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gestion du cycle de vie de l'application.
    """
    # Démarrage
    logger.info("🚀 Démarrage de l'API Gateway ISSALAN...")
    
    # Initialiser les services
    await cache_manager.initialize()
    await rate_limiter.initialize()
    
    logger.info("✅ API Gateway ISSALAN démarrée avec succès")
    
    yield
    
    # Arrêt
    logger.info("🛑 Arrêt de l'API Gateway ISSALAN...")
    await cache_manager.shutdown()
    await rate_limiter.shutdown()
    logger.info("✅ API Gateway ISSALAN arrêtée")

# Créer l'application FastAPI
app = FastAPI(
    title="ISSALAN API Gateway",
    description="API Gateway unifiée pour tous les services ISSALAN",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Middleware CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # À restreindre en production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Middleware de sécurité
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]  # À configurer en production
)

# Middleware de logging
@app.middleware("http")
async def log_requests(request, call_next):
    start_time = time.time()
    
    # Log de la requête
    logger.info(f"📥 {request.method} {request.url.path} - Client: {request.client.host}")
    
    # Traiter la requête
    response = await call_next(request)
    
    # Calcul du temps de traitement
    process_time = time.time() - start_time
    
    # Log de la réponse
    logger.info(f"📤 {request.method} {request.url.path} - Status: {response.status_code} - Time: {process_time:.3f}s")
    
    # Ajouter le temps de traitement dans les headers
    response.headers["X-Process-Time"] = str(process_time)
    
    return response

# Middleware de rate limiting
@app.middleware("http")
async def rate_limit_middleware(request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    endpoint = request.url.path
    
    # Vérifier le rate limiting
    if not await rate_limiter.is_allowed(client_ip, endpoint):
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": "Rate limit exceeded. Please try again later."}
        )
    
    return await call_next(request)

# Middleware de cache
@app.middleware("http")
async def cache_middleware(request, call_next):
    # Ne mettre en cache que les requêtes GET
    if request.method == "GET":
        cache_key = f"{request.url.path}:{str(request.query_params)}"
        
        # Vérifier le cache
        cached_response = await cache_manager.get(cache_key)
        if cached_response:
            logger.debug(f"Cache hit pour: {cache_key}")
            response = JSONResponse(content=cached_response)
            response.headers["X-Cache"] = "HIT"
            return response
        
        # Exécuter la requête
        response = await call_next(request)
        
        # Mettre en cache si succès
        if response.status_code == 200:
            try:
                response_body = response.body
                # Stocker dans le cache (TTL: 5 minutes)
                await cache_manager.set(cache_key, response_body, ttl=300)
                response.headers["X-Cache"] = "MISS"
            except Exception as e:
                logger.warning(f"Erreur lors de la mise en cache: {e}")
        
        return response
    
    return await call_next(request)

# Initialiser tous les endpoints
logger.info("Initialisation des endpoints...")

# Endpoints d'authentification
init_deepseek_endpoints(app)
init_rag_endpoints(app)
init_web_search_endpoints(app)
init_solo_builder_endpoints(app)

# Routes de base
@app.get("/")
async def root():
    """Page d'accueil de l'API."""
    return {
        "message": "Bienvenue sur l'API Gateway ISSALAN",
        "version": "1.0.0",
        "services": [
            {"name": "DeepSeek", "endpoint": "/api/deepseek", "status": "active"},
            {"name": "RAG", "endpoint": "/api/rag", "status": "active"},
            {"name": "Web Search", "endpoint": "/api/web-search", "status": "active"},
            {"name": "Solo Builder", "endpoint": "/api/solo-builder", "status": "active"}
        ],
        "documentation": "/docs",
        "health": "/health"
    }

@app.get("/health")
async def health_check():
    """Vérification de la santé de tous les services."""
    import asyncio
    
    services = [
        ("deepseek", check_deepseek_health),
        ("rag", check_rag_health),
        ("web_search", check_web_search_health),
        ("solo_builder", check_solo_builder_health),
        ("cache", check_cache_health),
        ("rate_limiter", check_rate_limiter_health)
    ]
    
    # Vérifier tous les services en parallèle
    tasks = [check_service(name, check_func) for name, check_func in services]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Analyser les résultats
    service_statuses = {}
    all_healthy = True
    
    for (name, _), result in zip(services, results):
        if isinstance(result, Exception):
            service_statuses[name] = {
                "status": "unhealthy",
                "error": str(result)
            }
            all_healthy = False
        else:
            service_statuses[name] = result
    
    return {
        "status": "healthy" if all_healthy else "unhealthy",
        "timestamp": time.time(),
        "services": service_statuses,
        "cache_stats": await cache_manager.get_stats(),
        "rate_limiter_stats": await rate_limiter.get_stats()
    }

async def check_service(name: str, check_func):
    """Vérifie un service spécifique."""
    try:
        return await check_func()
    except Exception as e:
        logger.error(f"Erreur lors de la vérification du service {name}: {e}")
        raise

async def check_deepseek_health() -> Dict[str, Any]:
    """Vérifie la santé du service DeepSeek."""
    from .deepseek_endpoints import deepseek_router
    
    # Simuler une requête simple
    return {
        "status": "healthy",
        "endpoints": len(deepseek_router.routes),
        "message": "DeepSeek service operational"
    }

async def check_rag_health() -> Dict[str, Any]:
    """Vérifie la santé du service RAG."""
    from .rag_endpoints import rag_router
    
    return {
        "status": "healthy",
        "endpoints": len(rag_router.routes),
        "message": "RAG service operational"
    }

async def check_web_search_health() -> Dict[str, Any]:
    """Vérifie la santé du service Web Search."""
    from .web_search_endpoints import web_search_router
    
    return {
        "status": "healthy",
        "endpoints": len(web_search_router.routes),
        "message": "Web Search service operational"
    }

async def check_solo_builder_health() -> Dict[str, Any]:
    """Vérifie la santé du service Solo Builder."""
    from .solo_builder_endpoints import solo_builder_router
    
    return {
        "status": "healthy",
        "endpoints": len(solo_builder_router.routes),
        "message": "Solo Builder service operational"
    }

async def check_cache_health() -> Dict[str, Any]:
    """Vérifie la santé du cache."""
    try:
        stats = await cache_manager.get_stats()
        return {
            "status": "healthy",
            **stats
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }

async def check_rate_limiter_health() -> Dict[str, Any]:
    """Vérifie la santé du rate limiter."""
    try:
        stats = await rate_limiter.get_stats()
        return {
            "status": "healthy",
            **stats
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }

@app.get("/metrics")
async def get_metrics():
    """Retourne les métriques de l'API."""
    return {
        "requests": await rate_limiter.get_request_counts(),
        "cache": await cache_manager.get_stats(),
        "uptime": time.time() - app_start_time if 'app_start_time' in globals() else 0,
        "timestamp": time.time()
    }

@app.get("/config")
async def get_config():
    """Retourne la configuration de l'API."""
    return {
        "cors": {
            "allow_origins": ["*"],
            "allow_credentials": True
        },
        "rate_limiting": {
            "enabled": True,
            "default_limit": "100 requests/minute"
        },
        "caching": {
            "enabled": True,
            "default_ttl": "300 seconds"
        },
        "services": {
            "deepseek": {"enabled": True},
            "rag": {"enabled": True},
            "web_search": {"enabled": True},
            "solo_builder": {"enabled": True}
        }
    }

# Routes protégées
@app.get("/api/user/profile", dependencies=[Depends(get_current_user)])
async def get_user_profile(current_user: User = Depends(get_current_user)):
    """Récupère le profil de l'utilisateur connecté."""
    return {
        "username": current_user.username,
        "email": current_user.email,
        "created_at": current_user.created_at,
        "permissions": current_user.permissions
    }

@app.post("/api/auth/login")
async def login(username: str, password: str):
    """Endpoint de connexion."""
    # Ici, vous devriez vérifier les credentials dans une base de données
    # Pour l'exemple, nous utilisons des credentials factices
    if username == "admin" and password == "admin123":
        access_token = create_access_token(data={"sub": username})
        return {"access_token": access_token, "token_type": "bearer"}
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

# Gestion des erreurs
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Gestionnaire d'erreurs HTTP."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "path": request.url.path,
            "method": request.method,
            "timestamp": time.time()
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Gestionnaire d'erreurs générales."""
    logger.error(f"Erreur non gérée: {exc}", exc_info=True)
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "Internal server error",
            "path": request.url.path,
            "method": request.method,
            "timestamp": time.time()
        }
    )

# Variable pour suivre le temps de démarrage
app_start_time = time.time()

if __name__ == "__main__":
    import uvicorn
    
    logger.info("Lancement du serveur API Gateway...")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )