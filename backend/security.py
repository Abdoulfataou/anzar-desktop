"""
Security module — JWT auth, rate limiting, input validation.
Hardened for production deployment (Railway / Docker).
"""
import os
import re
import time
import secrets
import logging
import ipaddress
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
from typing import Optional

from fastapi import Request, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from config import settings

logger = logging.getLogger("anzar.security")

# ============================================================================
# STARTUP VALIDATION — fail fast if misconfigured
# ============================================================================

def validate_config():
    """Called at startup to ensure critical config is set. Fails fast if insecure in production."""
    # ── JWT Secret ──
    is_railway = bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_PROJECT_ID"))
    is_prod_env = os.environ.get("ENV", "").lower() in ("production", "prod") or is_railway

    if not settings.is_production:
        if is_prod_env:
            raise RuntimeError(
                "FATAL: JWT_SECRET is still the default value. "
                "Set JWT_SECRET env var to a secure random string (openssl rand -hex 32)."
            )
        logger.warning("⚠️  JWT_SECRET is default — OK for dev, DANGEROUS in production")
    else:
        if len(settings.jwt_secret) < 32:
            raise RuntimeError("FATAL: JWT_SECRET must be at least 32 characters long.")
        logger.info("✓ JWT_SECRET is set to a custom value")

    # ── Admin default password ──
    if settings.admin_default_password and len(settings.admin_default_password) < 12:
        if is_prod_env:
            raise RuntimeError(
                "FATAL: ADMIN_DEFAULT_PASSWORD is too weak (min 12 chars)."
            )
        else:
            logger.warning("⚠️  ADMIN_DEFAULT_PASSWORD faible (< 12 chars)")
    elif not settings.admin_default_password:
        logger.info("ADMIN_DEFAULT_PASSWORD non défini — un mot de passe aléatoire sera généré au premier démarrage")

    # ── API Keys ──
    if not settings.deepseek_api_key:
        logger.warning("⚠️  DEEPSEEK_API_KEY not set — DeepSeek provider unavailable")

    if not settings.kimi_api_key:
        logger.warning("⚠️  KIMI_API_KEY not set — Kimi provider unavailable")


# ============================================================================
# RATE LIMITER (in-memory sliding window + DB persistence)
# ============================================================================

class RateLimiter:
    """Sliding-window rate limiter keyed by user_id or IP.

    État en base (table rate_limits) → limites partagées entre tous les
    workers (l'ancienne version in-memory multipliait les limites par le
    nombre de workers Railway). Purge des entrées > 24 h par le housekeeping.
    """

    async def check(
        self,
        key: str,
        max_per_minute: Optional[int] = None,
        max_per_day: Optional[int] = None,
        endpoint: str = "api",
    ) -> bool:
        """Check rate limit. Raises HTTPException(429) if exceeded."""
        from db.rate_limits import check_and_record

        per_min = max_per_minute or settings.rate_limit_per_minute
        per_day = max_per_day or settings.rate_limit_per_day

        try:
            await check_and_record(key, endpoint, per_min, per_day)
        except ValueError as e:
            if str(e) == "day":
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Limite quotidienne atteinte.",
                )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Trop de requêtes. Réessaie dans quelques secondes.",
            )
        except Exception as e:  # fail-open : une panne DB ne doit pas 500 toute l'API
            logger.warning(f"Rate limiter DB error (fail-open): {type(e).__name__}: {e}")
            return True

        return True

    async def check_auth(self, key: str) -> bool:
        """Tighter rate limit for auth endpoints: 5/min, 30/day per IP."""
        return await self.check(f"auth:{key}", max_per_minute=5, max_per_day=30, endpoint="auth")


rate_limiter = RateLimiter()


# ============================================================================
# JWT TOKEN (pyjwt — HS256, algorithme épinglé)
# ============================================================================

# Algorithms explicitly pinned: prevents algorithm-confusion attacks
# (e.g. alg:none / HS256-vs-RS512 key confusion).
_JWT_ALGORITHM = "HS256"
_JWT_AUDIENCE = "anzar-api"


def create_token(user_id: str, expires_in: Optional[int] = None, extra_claims: Optional[dict] = None) -> str:
    """Create HS256-signed JWT with optional extra claims."""
    if expires_in is None:
        expires_in = settings.jwt_expiry_hours * 3600

    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "jti": secrets.token_hex(16),
        "aud": _JWT_AUDIENCE,
    }
    if extra_claims:
        payload.update(extra_claims)

    return pyjwt.encode(payload, settings.jwt_secret, algorithm=_JWT_ALGORITHM)


def verify_token(token: str, verify_exp: bool = True) -> Optional[dict]:
    """Verify signature + expiry (+ audience). Returns payload dict or None.

    verify_exp=False sert uniquement au refresh (fenêtre de grâce) : la
    signature reste vérifiée dans tous les cas.
    """
    try:
        if not token:
            return None
        payload = pyjwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[_JWT_ALGORITHM],
            audience=_JWT_AUDIENCE,
            options={"verify_exp": verify_exp},
        )
        if not payload.get("sub"):
            return None
        return payload
    except pyjwt.ExpiredSignatureError:
        return None
    except pyjwt.InvalidTokenError:
        return None


async def verify_token_checked(token: str) -> Optional[dict]:
    """verify_token + vérification de révocation (jti) en base.

    À utiliser dans les dépendances FastAPI ; le check DB est un simple
    index lookup unique (jti indexé).
    """
    from db import is_token_revoked

    payload = verify_token(token)
    if payload is None:
        return None
    if await is_token_revoked(payload.get("jti", "")):
        logger.warning(f"Revoked token used: jti={payload.get('jti')} sub={payload.get('sub')}")
        return None
    return payload


# ============================================================================
# AUTH DEPENDENCY
# ============================================================================

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> dict:
    """FastAPI dependency: extract and verify JWT. Returns payload dict."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token d'authentification requis",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = await verify_token_checked(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide, expiré ou révoqué",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


# ============================================================================
# IP RESOLUTION
# ============================================================================

# Railway and most PaaS set X-Forwarded-For automatically.
# On ne fait confiance à X-Forwarded-For QUE si la connexion directe vient
# d'un proxy interne (loopback/RFC1918). Sinon l'header est spoofable et
# permet de contourner le rate limiting.
TRUSTED_PROXY_NETWORKS = ("127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")


def _is_trusted_proxy(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in ipaddress.ip_network(net) for net in TRUSTED_PROXY_NETWORKS)


def get_client_ip(request: Request) -> str:
    """Get real client IP.

    Prend l'IP la plus à droite NON gérée par un proxy de confiance dans
    X-Forwarded-For (la plus à gauche est contrôlée par le client et donc
    spoofable), et seulement si la connexion directe provient d'un proxy interne.
    """
    direct = request.client.host if request.client else ""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded and _is_trusted_proxy(direct):
        # Le proxy ajoute l'IP du client à la fin ; on remonte depuis la droite
        # en ignorant les hops proxies connus.
        for ip in reversed([x.strip() for x in forwarded.split(",")]):
            if ip and not _is_trusted_proxy(ip):
                return ip
        # Chaîne XFF composée uniquement de proxies internes
        if forwarded.strip():
            return forwarded.split(",")[-1].strip()

    return direct or "unknown"


# ============================================================================
# INPUT VALIDATION
# ============================================================================

def validate_messages(messages: list) -> list:
    """Validate and sanitize chat messages."""
    if not isinstance(messages, list):
        raise HTTPException(400, "messages must be an array")

    if len(messages) > 100:
        raise HTTPException(400, "Too many messages (max 100)")

    sanitized = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue

        role = msg.get("role", "")
        if role not in ("system", "user", "assistant", "tool"):
            continue

        content = msg.get("content")
        # Ensure content is always a string (guard against None from tool-call messages)
        if content is None:
            msg = {**msg, "content": ""}
        elif isinstance(content, str) and len(content) > 200_000:
            raise HTTPException(400, "Message trop long (max 200K caractères)")

        sanitized.append(msg)

    if not sanitized:
        raise HTTPException(400, "Aucun message valide fourni")

    return sanitized


def validate_path(base_dir: str, target_path: str) -> str:
    """Validate a file path is within base_dir. Returns resolved path."""
    from pathlib import Path

    base = Path(base_dir).resolve()
    target = (base / target_path).resolve()

    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(400, "Chemin invalide — tentative de traversée détectée")

    return str(target)


def sanitize_error(error: Exception) -> str:
    """Sanitize error message to avoid leaking internal info."""
    msg = str(error)
    msg = re.sub(r'(/[a-zA-Z0-9_./-]+)+', '[path]', msg)
    msg = re.sub(r'sk-[a-zA-Z0-9]{20,}', '[redacted]', msg)
    msg = re.sub(r'Bearer\s+\S+', 'Bearer [redacted]', msg)
    return msg[:500]


# ============================================================================
# COST CALCULATION
# ============================================================================

def usage_tokens(usage: dict | None) -> tuple[int, int, int]:
    """(entrée, sortie, entrée servie par le cache) depuis le bloc `usage` du fournisseur."""
    usage = usage or {}
    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    details = usage.get("prompt_tokens_details") or {}
    cached = int(usage.get("prompt_cache_hit_tokens") or details.get("cached_tokens") or 0)
    return input_tokens, output_tokens, max(0, min(cached, input_tokens))


def calculate_cost_fcfa(
    provider: str, input_tokens: int, output_tokens: int, model: str = "", cached_input_tokens: int = 0,
) -> tuple[float, float]:
    """
    Calculate the cost of an API call in USD and FCFA.
    Returns (cost_usd, cost_fcfa).
    Uses Pro pricing when the model contains 'pro'.
    DeepSeek: the part of the input served by the provider cache is billed at a reduced ratio.
    """
    if provider == "deepseek":
        is_pro = "pro" in (model or "").lower()
        input_cost = settings.deepseek_pro_input_cost_per_million if is_pro else settings.deepseek_input_cost_per_million
        output_cost = settings.deepseek_pro_output_cost_per_million if is_pro else settings.deepseek_output_cost_per_million
        cached = max(0, min(cached_input_tokens, input_tokens))
        ratio = min(1.0, max(0.0, settings.deepseek_cache_hit_ratio))
        billed_input = (input_tokens - cached) + cached * ratio
        cost_usd = (
            (billed_input / 1_000_000) * (input_cost / settings.usd_to_fcfa)
            + (output_tokens / 1_000_000) * (output_cost / settings.usd_to_fcfa)
        )
        cost_fcfa = (
            (billed_input / 1_000_000) * input_cost
            + (output_tokens / 1_000_000) * output_cost
        )
    elif provider == "kimi":
        cost_usd = (
            (input_tokens / 1_000_000) * (settings.kimi_input_cost_per_million / settings.usd_to_fcfa)
            + (output_tokens / 1_000_000) * (settings.kimi_output_cost_per_million / settings.usd_to_fcfa)
        )
        cost_fcfa = (
            (input_tokens / 1_000_000) * settings.kimi_input_cost_per_million
            + (output_tokens / 1_000_000) * settings.kimi_output_cost_per_million
        )
    elif provider == "openrouter":
        cost_usd = (
            (input_tokens / 1_000_000) * (settings.openrouter_input_cost_per_million / settings.usd_to_fcfa)
            + (output_tokens / 1_000_000) * (settings.openrouter_output_cost_per_million / settings.usd_to_fcfa)
        )
        cost_fcfa = (
            (input_tokens / 1_000_000) * settings.openrouter_input_cost_per_million
            + (output_tokens / 1_000_000) * settings.openrouter_output_cost_per_million
        )
    else:
        cost_usd = 0.0
        cost_fcfa = 0.0

    return round(cost_usd, 6), round(cost_fcfa, 2)
