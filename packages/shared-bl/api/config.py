"""
Configuration du backend ISSALAN
Optimisé pour la performance et la scalabilité à la chinoise
"""

import os
from typing import Dict, Any, Optional
from pydantic import Field, validator
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Charger les variables d'environnement
load_dotenv()

class Settings(BaseSettings):
    """Configuration de l'application."""
    
    model_config = {
        "env_file": ".env",
        "case_sensitive": True,
        "extra": "allow",  # Permettre les variables d'environnement supplémentaires
    }
    
    # Application
    APP_NAME: str = "ISSALAN Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    
    # Serveur
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    WORKERS: int = int(os.getenv("WORKERS", "4"))
    
    # CORS
    CORS_ORIGINS: list = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "https://tauri.localhost",
    ]
    
    # DeepSeek API
    DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
    DEEPSEEK_BASE_URL: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    DEEPSEEK_REASONER_MODEL: str = os.getenv("DEEPSEEK_REASONER_MODEL", "deepseek-reasoner")
    DEEPSEEK_TIMEOUT: int = int(os.getenv("DEEPSEEK_TIMEOUT", "30"))
    DEEPSEEK_MAX_RETRIES: int = int(os.getenv("DEEPSEEK_MAX_RETRIES", "3"))
    
    # Redis (pour le cache)
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    REDIS_CACHE_TTL: int = int(os.getenv("REDIS_CACHE_TTL", "300"))  # 5 minutes
    
    # Base de données
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./issalan.db")
    
    # Sécurité
    SECRET_KEY: str = os.getenv("SECRET_KEY", "issalan-secret-key-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # Limites de taux
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_PER_HOUR: int = 1000
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    LOG_FORMAT: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    
    # Chemins
    PROJECTS_DIR: str = os.getenv("PROJECTS_DIR", "./generated_projects")
    LOGS_DIR: str = os.getenv("LOGS_DIR", "./logs")
    
    # Configuration IA
    AI_COMPLETION_ENABLED: bool = os.getenv("AI_COMPLETION_ENABLED", "True").lower() == "true"
    AI_ANALYSIS_ENABLED: bool = os.getenv("AI_ANALYSIS_ENABLED", "True").lower() == "true"
    AI_GENERATION_ENABLED: bool = os.getenv("AI_GENERATION_ENABLED", "True").lower() == "true"
    AI_REFACTORING_ENABLED: bool = os.getenv("AI_REFACTORING_ENABLED", "True").lower() == "true"
    AI_DEBUGGING_ENABLED: bool = os.getenv("AI_DEBUGGING_ENABLED", "True").lower() == "true"
    
    # Performance
    MAX_COMPLETIONS: int = int(os.getenv("MAX_COMPLETIONS", "10"))
    MAX_CODE_LENGTH: int = int(os.getenv("MAX_CODE_LENGTH", "10000"))
    MAX_PROMPT_LENGTH: int = int(os.getenv("MAX_PROMPT_LENGTH", "2000"))
    
    # Monitoring
    ENABLE_METRICS: bool = os.getenv("ENABLE_METRICS", "True").lower() == "true"
    METRICS_PORT: int = int(os.getenv("METRICS_PORT", "9090"))
    
    @validator("DEEPSEEK_API_KEY")
    def validate_deepseek_api_key(cls, v):
        if not v:
            raise ValueError("DEEPSEEK_API_KEY est requis")
        return v
    
    @validator("CORS_ORIGINS", pre=True)
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v

# Instance globale des paramètres
settings = Settings()

def get_settings() -> Settings:
    """Retourne l'instance des paramètres."""
    return settings

def get_config_dict() -> Dict[str, Any]:
    """Retourne la configuration sous forme de dictionnaire."""
    return settings.dict()

def validate_config() -> bool:
    """Valide la configuration."""
    try:
        settings = get_settings()
        
        # Vérifications critiques
        if not settings.DEEPSEEK_API_KEY:
            print("⚠️  DEEPSEEK_API_KEY n'est pas défini")
            return False
        
        # Vérifier les répertoires
        os.makedirs(settings.PROJECTS_DIR, exist_ok=True)
        os.makedirs(settings.LOGS_DIR, exist_ok=True)
        
        print("✅ Configuration validée avec succès")
        print(f"📱 Application: {settings.APP_NAME} v{settings.APP_VERSION}")
        print(f"🌐 Serveur: {settings.HOST}:{settings.PORT}")
        print(f"🤖 IA: {'Activée' if settings.AI_COMPLETION_ENABLED else 'Désactivée'}")
        print(f"📁 Projets: {settings.PROJECTS_DIR}")
        
        return True
        
    except Exception as e:
        print(f"❌ Erreur de validation de configuration: {e}")
        return False

# Configuration du logging
def setup_logging():
    """Configure le logging."""
    import logging
    from logging.handlers import RotatingFileHandler
    
    settings = get_settings()
    
    # Créer le formateur
    formatter = logging.Formatter(settings.LOG_FORMAT)
    
    # Handler console
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    
    # Handler fichier
    log_file = os.path.join(settings.LOGS_DIR, "issalan.log")
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5
    )
    file_handler.setFormatter(formatter)
    
    # Configurer le logger racine
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, settings.LOG_LEVEL))
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)
    
    # Désactiver les logs verbeux de certaines bibliothèques
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    
    return root_logger

# Configuration CORS
def get_cors_config() -> Dict[str, Any]:
    """Retourne la configuration CORS."""
    settings = get_settings()
    
    return {
        "allow_origins": settings.CORS_ORIGINS,
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
        "expose_headers": ["*"],
        "max_age": 600,
    }

# Configuration de la base de données
def get_database_config() -> Dict[str, Any]:
    """Retourne la configuration de la base de données."""
    settings = get_settings()
    
    return {
        "url": settings.DATABASE_URL,
        "echo": settings.DEBUG,
        "pool_size": 20,
        "max_overflow": 30,
        "pool_timeout": 30,
        "pool_recycle": 3600,
    }

# Configuration Redis
def get_redis_config() -> Dict[str, Any]:
    """Retourne la configuration Redis."""
    settings = get_settings()
    
    return {
        "url": settings.REDIS_URL,
        "encoding": "utf-8",
        "decode_responses": True,
        "socket_timeout": 5,
        "socket_connect_timeout": 5,
        "retry_on_timeout": True,
        "max_connections": 100,
    }

# Configuration des limites de taux
def get_rate_limit_config() -> Dict[str, Any]:
    """Retourne la configuration des limites de taux."""
    settings = get_settings()
    
    return {
        "per_minute": settings.RATE_LIMIT_PER_MINUTE,
        "per_hour": settings.RATE_LIMIT_PER_HOUR,
        "burst": 10,
        "window": 60,  # secondes
    }

# Configuration des agents IA
def get_ai_agents_config() -> Dict[str, Any]:
    """Retourne la configuration des agents IA."""
    settings = get_settings()
    
    return {
        "completion": {
            "enabled": settings.AI_COMPLETION_ENABLED,
            "max_completions": settings.MAX_COMPLETIONS,
            "cache_ttl": settings.REDIS_CACHE_TTL,
        },
        "analysis": {
            "enabled": settings.AI_ANALYSIS_ENABLED,
            "max_code_length": settings.MAX_CODE_LENGTH,
        },
        "generation": {
            "enabled": settings.AI_GENERATION_ENABLED,
            "max_prompt_length": settings.MAX_PROMPT_LENGTH,
            "max_tokens": 2000,
            "temperature": 0.7,
        },
        "refactoring": {
            "enabled": settings.AI_REFACTORING_ENABLED,
        },
        "debugging": {
            "enabled": settings.AI_DEBUGGING_ENABLED,
        },
    }

# Configuration du monitoring
def get_monitoring_config() -> Dict[str, Any]:
    """Retourne la configuration du monitoring."""
    settings = get_settings()
    
    return {
        "enabled": settings.ENABLE_METRICS,
        "port": settings.METRICS_PORT,
        "endpoint": "/metrics",
        "namespace": "issalan",
        "labels": {
            "app": settings.APP_NAME,
            "version": settings.APP_VERSION,
        }
    }

# Exporter la configuration
__all__ = [
    "Settings",
    "settings",
    "get_settings",
    "get_config_dict",
    "validate_config",
    "setup_logging",
    "get_cors_config",
    "get_database_config",
    "get_redis_config",
    "get_rate_limit_config",
    "get_ai_agents_config",
    "get_monitoring_config",
]