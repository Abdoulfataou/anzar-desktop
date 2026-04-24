"""
Module d'authentification pour ISSALAN API
Gère l'authentification des utilisateurs et la création de tokens JWT
"""

import os
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from pydantic import BaseModel

from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt.exceptions import InvalidTokenError

logger = logging.getLogger(__name__)

# Configuration
SECRET_KEY = os.getenv("ISSALAN_SECRET_KEY", "issalan-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 heures

# Modèles Pydantic
class User(BaseModel):
    """Modèle d'utilisateur."""
    username: str
    email: str
    permissions: list = ["read", "write"]
    created_at: datetime = datetime.now()

class Token(BaseModel):
    """Modèle de token."""
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    """Données du token."""
    username: Optional[str] = None

# Schéma d'authentification
security = HTTPBearer()

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """
    Crée un token JWT.
    
    Args:
        data: Données à encoder dans le token
        expires_delta: Durée de validité du token
        
    Returns:
        Token JWT encodé
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    
    try:
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        return encoded_jwt
    except Exception as e:
        logger.error(f"Erreur lors de la création du token: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create access token"
        )

def verify_token(token: str) -> Dict[str, Any]:
    """
    Vérifie et décode un token JWT.
    
    Args:
        token: Token JWT à vérifier
        
    Returns:
        Données décodées du token
        
    Raises:
        HTTPException: Si le token est invalide
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        logger.warning("Token expiré")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except InvalidTokenError:
        logger.warning("Token invalide")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        logger.error(f"Erreur lors de la vérification du token: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> User:
    """
    Récupère l'utilisateur courant à partir du token.
    
    Args:
        credentials: Credentials d'authentification
        
    Returns:
        Utilisateur courant
        
    Raises:
        HTTPException: Si l'authentification échoue
    """
    token = credentials.credentials
    
    try:
        payload = verify_token(token)
        username: str = payload.get("sub")
        
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Ici, vous devriez récupérer l'utilisateur depuis une base de données
        # Pour l'exemple, nous créons un utilisateur factice
        user = User(
            username=username,
            email=f"{username}@issalan.africa",
            permissions=["read", "write", "execute"]
        )
        
        return user
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur lors de la récupération de l'utilisateur: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not retrieve user",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Vérifie que l'utilisateur courant est actif.
    
    Args:
        current_user: Utilisateur courant
        
    Returns:
        Utilisateur courant si actif
        
    Raises:
        HTTPException: Si l'utilisateur est inactif
    """
    # Ici, vous devriez vérifier si l'utilisateur est actif dans la base de données
    # Pour l'exemple, tous les utilisateurs sont actifs
    return current_user

async def get_current_user_with_permissions(
    required_permissions: list,
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Vérifie que l'utilisateur courant a les permissions requises.
    
    Args:
        required_permissions: Liste des permissions requises
        current_user: Utilisateur courant
        
    Returns:
        Utilisateur courant si autorisé
        
    Raises:
        HTTPException: Si l'utilisateur n'a pas les permissions
    """
    user_permissions = set(current_user.permissions)
    required_permissions_set = set(required_permissions)
    
    if not required_permissions_set.issubset(user_permissions):
        logger.warning(f"Utilisateur {current_user.username} n'a pas les permissions: {required_permissions}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    
    return current_user

# Fonctions utilitaires
def hash_password(password: str) -> str:
    """
    Hash un mot de passe (à implémenter avec bcrypt en production).
    
    Args:
        password: Mot de passe à hasher
        
    Returns:
        Mot de passe hashé
    """
    import hashlib
    # En production, utilisez bcrypt ou argon2
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Vérifie un mot de passe.
    
    Args:
        plain_password: Mot de passe en clair
        hashed_password: Mot de passe hashé
        
    Returns:
        True si le mot de passe correspond
    """
    return hash_password(plain_password) == hashed_password

async def authenticate_user(username: str, password: str) -> Optional[User]:
    """
    Authentifie un utilisateur.
    
    Args:
        username: Nom d'utilisateur
        password: Mot de passe
        
    Returns:
        Utilisateur si authentifié, None sinon
    """
    # Ici, vous devriez vérifier dans une base de données
    # Pour l'exemple, nous utilisons des credentials factices
    users_db = {
        "admin": {
            "username": "admin",
            "email": "admin@issalan.africa",
            "hashed_password": hash_password("admin123"),
            "permissions": ["read", "write", "execute", "admin"],
            "active": True
        },
        "user": {
            "username": "user",
            "email": "user@issalan.africa",
            "hashed_password": hash_password("user123"),
            "permissions": ["read", "write"],
            "active": True
        }
    }
    
    if username not in users_db:
        return None
    
    user_data = users_db[username]
    
    if not verify_password(password, user_data["hashed_password"]):
        return None
    
    if not user_data["active"]:
        return None
    
    return User(
        username=user_data["username"],
        email=user_data["email"],
        permissions=user_data["permissions"]
    )

# Middleware pour ajouter l'utilisateur aux requêtes
async def add_user_to_request(request, call_next):
    """
    Middleware pour ajouter l'utilisateur aux requêtes.
    """
    # Vérifier si un token est présent
    auth_header = request.headers.get("Authorization")
    
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        
        try:
            payload = verify_token(token)
            username = payload.get("sub")
            
            if username:
                # Ajouter l'utilisateur à l'état de la requête
                request.state.user = User(
                    username=username,
                    email=f"{username}@issalan.africa",
                    permissions=["read", "write"]  # Par défaut
                )
        except Exception:
            # Token invalide, continuer sans utilisateur
            pass
    
    response = await call_next(request)
    return response

# Décorateur pour les endpoints protégés
def protected_endpoint(func):
    """
    Décorateur pour protéger un endpoint.
    
    Usage:
        @app.get("/protected")
        @protected_endpoint
        async def protected_route(user: User = Depends(get_current_user)):
            return {"message": f"Hello {user.username}"}
    """
    from functools import wraps
    
    @wraps(func)
    async def wrapper(*args, **kwargs):
        # La vérification est faite par la dépendance get_current_user
        return await func(*args, **kwargs)
    
    return wrapper

# Configuration de sécurité
def get_security_config() -> Dict[str, Any]:
    """
    Retourne la configuration de sécurité.
    
    Returns:
        Configuration de sécurité
    """
    return {
        "secret_key": SECRET_KEY[:10] + "..." if len(SECRET_KEY) > 10 else "***",
        "algorithm": ALGORITHM,
        "token_expire_minutes": ACCESS_TOKEN_EXPIRE_MINUTES,
        "require_https": os.getenv("ISSALAN_REQUIRE_HTTPS", "false").lower() == "true",
        "cors_origins": os.getenv("ISSALAN_CORS_ORIGINS", "*").split(","),
        "rate_limit_per_minute": int(os.getenv("ISSALAN_RATE_LIMIT", "100"))
    }

if __name__ == "__main__":
    # Test du module
    print("🔐 Test du module d'authentification ISSALAN")
    print("=" * 50)
    
    # Créer un token
    test_data = {"sub": "testuser", "role": "admin"}
    token = create_access_token(test_data)
    print(f"✅ Token créé: {token[:50]}...")
    
    # Vérifier le token
    try:
        payload = verify_token(token)
        print(f"✅ Token vérifié: {payload}")
    except Exception as e:
        print(f"❌ Erreur: {e}")
    
    # Tester l'authentification
    user = asyncio.run(authenticate_user("admin", "admin123"))
    if user:
        print(f"✅ Utilisateur authentifié: {user.username}")
    else:
        print("❌ Authentification échouée")
    
    print("=" * 50)
    print("✅ Module d'authentification testé avec succès")