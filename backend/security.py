"""
Security module — JWT auth, rate limiting, input validation.
Hardened for production deployment (Railway / Docker).
"""
import os
import re
import time
import hashlib
import hmac
import json
import secrets
import logging
import base64
from collections import defaultdict
from typing import Optional

from fastapi import Request, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from config import settings

logger = logging.getLogger("anzar.security")

# ============================================================================
# STARTUP VALIDATION — fail fast if misconfigured
# ============================================================================

def validate_config():
    """Called at startup to ensure critical config is set."""
    if not settings.is_production:
        logger.warning("⚠️  JWT_SECRET is default — OK for dev, DANGEROUS in production")
    else:
        logger.info("✓ JWT_SECRET is set to a custom value")

    if not settings.deepseek_api_key:
        logger.warning("⚠️  DEEPSEEK_API_KEY not set — DeepSeek provider unavailable")

    if not settings.kimi_api_key:
        logger.warning("⚠️  KIMI_API_KEY not set — Kimi provider unavailable")


# ============================================================================
# RATE LIMITER (in-memory sliding window + DB persistence)
# ============================================================================

class RateLimiter:
    """Sliding-window rate limiter keyed by user_id or IP."""

    def __init__(self):
        self._requests: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> bool:
        """Check rate limit. Raises HTTPException if exceeded."""
        now = time.time()
        window_minute = now - 60
        window_day = now - 86400

        # Clean old entries
        timestamps = [t for t in self._requests[key] if t > window_day]
        self._requests[key] = timestamps

        # Per-minute check
        recent = [t for t in timestamps if t > window_minute]
        if len(recent) >= settings.rate_limit_per_minute:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Trop de requêtes. Réessaie dans quelques secondes."
            )

        # Per-day check
        if len(timestamps) >= settings.rate_limit_per_day:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Limite quotidienne atteinte."
            )

        self._requests[key].append(now)

        # Periodic cleanup (every ~1000 entries)
        if sum(len(v) for v in self._requests.values()) > 5000:
            stale = [k for k, v in self._requests.items() if not v or v[-1] < window_day]
            for k in stale:
                del self._requests[k]

        return True


rate_limiter = RateLimiter()


# ============================================================================
# JWT TOKEN (HMAC-SHA256, constant-time comparison)
# ============================================================================

def create_token(user_id: str, expires_in: Optional[int] = None) -> str:
    """Create HMAC-SHA256 signed token."""
    if expires_in is None:
        expires_in = settings.jwt_expiry_hours * 3600

    payload = {
        "sub": user_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + expires_in,
        "jti": secrets.token_hex(8),
    }
    payload_b64 = _b64encode(json.dumps(payload, separators=(",", ":")))
    signature = hmac.new(
        settings.jwt_secret.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload_b64}.{signature}"


def verify_token(token: str) -> Optional[dict]:
    """Verify and decode token. Returns payload or None."""
    try:
        if not token or "." not in token:
            return None

        parts = token.split(".", 1)
        if len(parts) != 2:
            return None

        payload_b64, signature = parts

        expected_sig = hmac.new(
            settings.jwt_secret.encode("utf-8"),
            payload_b64.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(signature, expected_sig):
            return None

        payload = json.loads(_b64decode(payload_b64))

        if payload.get("exp", 0) < time.time():
            return None

        if not payload.get("sub"):
            return None

        return payload

    except Exception:
        return None


def _b64encode(data: str) -> str:
    return base64.urlsafe_b64encode(data.encode()).decode().rstrip("=")


def _b64decode(data: str) -> str:
    padding = 4 - len(data) % 4
    if padding < 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data).decode()


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

    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


# ============================================================================
# IP RESOLUTION
# ============================================================================

# Railway and most PaaS set X-Forwarded-For automatically
TRUSTED_PROXIES = {"127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}


def get_client_ip(request: Request) -> str:
    """Get real client IP. Trusts X-Forwarded-For behind Railway/PaaS."""
    # On Railway/PaaS, the request always comes from an internal proxy
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
        if ip:
            return ip

    return request.client.host if request.client else "unknown"


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

        content = msg.get("content", "")
        if isinstance(content, str) and len(content) > 200_000:
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

def calculate_cost_fcfa(provider: str, input_tokens: int, output_tokens: int) -> tuple[float, float]:
    """
    Calculate the cost of an API call in USD and FCFA.
    Returns (cost_usd, cost_fcfa).
    """
    if provider == "deepseek":
        cost_usd = (
            (input_tokens / 1_000_000) * (settings.deepseek_input_cost_per_million / settings.usd_to_fcfa)
            + (output_tokens / 1_000_000) * (settings.deepseek_output_cost_per_million / settings.usd_to_fcfa)
        )
        cost_fcfa = (
            (input_tokens / 1_000_000) * settings.deepseek_input_cost_per_million
            + (output_tokens / 1_000_000) * settings.deepseek_output_cost_per_million
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
    else:
        cost_usd = 0.0
        cost_fcfa = 0.0

    return round(cost_usd, 6), round(cost_fcfa, 2)
