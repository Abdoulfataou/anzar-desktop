"""
Security module — JWT auth, rate limiting, input validation.
Hardened for production deployment (Railway / Docker).
"""
import os
import re
import time
import secrets
import base64
import hashlib
import hmac
import struct
from urllib.parse import quote
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

    # ── MFA / surface admin ──
    if settings.admin_mfa_key and len(settings.admin_mfa_key) < 32:
        logger.warning("⚠️  ADMIN_MFA_KEY fait moins de 32 caractères ; utilise `openssl rand -hex 32`.")
    if settings.is_production:
        if not settings.admin_mfa_key:
            logger.warning("⚠️  ADMIN_MFA_KEY absent : les secrets TOTP utilisent JWT_SECRET comme clé de secours. "
                           "Configure une clé dédiée pour pouvoir faire tourner JWT_SECRET.")
        if not settings.admin_allowed_ips:
            logger.warning("⚠️  ADMIN_ALLOWED_IPS vide : /api/admin reste joignable depuis Internet. "
                           "Configure un CIDR ou une règle Caddy.")
        if not settings.admin_require_mfa:
            logger.warning("⚠️  ADMIN_REQUIRE_MFA=false : la MFA admin n'est pas obligatoire.")

    # ── API Keys ──
    if not settings.deepseek_api_key:
        logger.warning("⚠️  DEEPSEEK_API_KEY not set — DeepSeek provider unavailable")



# ============================================================================
# RATE LIMITER (in-memory sliding window + DB persistence)
# ============================================================================

class RateLimiter:
    """Sliding-window rate limiter keyed by user_id or IP.

    État en base (table rate_limits) → limites partagées entre tous les
    workers (l'ancienne version in-memory multipliait les limites par le
    nombre de workers Railway). Purge des entrées > 24 h par le housekeeping.
    """

    FAIL_CLOSED_ENDPOINTS = frozenset({"auth", "otp"})

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
        except Exception as e:
            # Connexion et codes OTP : fail-closed. Sans compteur, le brute-force serait libre ;
            # et sans base, la connexion échouerait de toute façon.
            if endpoint in self.FAIL_CLOSED_ENDPOINTS:
                logger.error(f"Rate limiter DB error (fail-closed, {endpoint}): {type(e).__name__}: {e}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Service momentanément indisponible. Réessaie dans un instant.",
                )
            # Autres routes : fail-open, une panne DB ne doit pas 500 toute l'API.
            logger.warning(f"Rate limiter DB error (fail-open): {type(e).__name__}: {e}")
            return True

        return True

    async def check_auth(self, key: str) -> bool:
        """Tighter rate limit for auth endpoints: 5/min, 30/day per IP."""
        return await self.check(f"auth:{key}", max_per_minute=5, max_per_day=30, endpoint="auth")

    # Compteur mémoire pour les routes /api authentifiées. Un seul processus
    # uvicorn : pas besoin d'une écriture DB par requête. Les routes auth/OTP
    # gardent le compteur DB (volume faible, partagé entre workers).
    _hits: dict[str, list[float]] = {}

    async def check_http(self, request: Request) -> bool:
        """Limite les routes /api par utilisateur, ou par IP si anonyme.

        Les webhooks fournisseurs sont exclus : leur signature est la barrière,
        et un pic de webhooks ne doit pas être refusé par le limiteur.
        """
        path = request.url.path
        if path.startswith("/api/payments/webhook/"):
            return True

        key = self._identity(request)
        now = time.time()
        bucket = [t for t in self._hits.get(key, []) if t > now - 86400]
        if sum(1 for t in bucket if t > now - 60) >= settings.rate_limit_per_minute:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                                "Trop de requêtes. Réessaie dans quelques secondes.")
        if len(bucket) >= settings.rate_limit_per_day:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                                "Limite quotidienne atteinte.")
        bucket.append(now)
        self._hits[key] = bucket
        if len(self._hits) > 50_000:
            self._hits = {k: v for k, v in self._hits.items() if v and v[-1] > now - 86400}
        return True

    def _identity(self, request: Request) -> str:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            payload = verify_token(auth[7:])
            if payload and payload.get("sub"):
                prefix = "admin:" if payload.get("is_admin") else "user:"
                return prefix + str(payload["sub"])
        return "ip:" + get_client_ip(request)

    def reset(self) -> None:
        """Vide le compteur mémoire (tests / redémarrage)."""
        self._hits.clear()


rate_limiter = RateLimiter()


# ============================================================================
# JWT TOKEN (pyjwt — HS256, algorithme épinglé)
# ============================================================================

# ── TOTP admin (RFC 6238) ──
# Secret TOTP chiffré au repos avec une clé dérivée de JWT_SECRET : une fuite
# de la seule table admins ne suffit pas à contourner le second facteur.

def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _totp_key(secret: str) -> bytes:
    s = (secret or "").strip().upper()
    s += "=" * ((8 - len(s) % 8) % 8)
    return base64.b32decode(s)


def _totp_code(secret: str, counter: int, digits: int = 6) -> str:
    digest = hmac.new(_totp_key(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** digits)).zfill(digits)


def totp_now(secret: str, at: Optional[float] = None) -> str:
    return _totp_code(secret, int((at if at is not None else time.time()) // 30))


def verify_totp(secret: str, code: str, window: int = 1, at: Optional[float] = None) -> bool:
    """Vérifie un code TOTP à ±window périodes de 30 s."""
    code = str(code or "").strip().replace(" ", "")
    if not secret or len(code) != 6 or not code.isdigit():
        return False
    counter = int((at if at is not None else time.time()) // 30)
    return any(hmac.compare_digest(_totp_code(secret, counter + delta), code)
               for delta in range(-window, window + 1))


def _mfa_key_material() -> bytes:
    """Clé dédiée à la MFA, indépendante de JWT_SECRET quand elle est fournie."""
    return (settings.admin_mfa_key or settings.jwt_secret or "anzar-mfa").encode()


def _mfa_key() -> bytes:
    return hashlib.sha256(_mfa_key_material()).digest()


def _seal_with_key(value: str, key: bytes) -> str:
    nonce = secrets.token_bytes(16)
    plain = (value or "").encode("ascii")
    stream = b""
    counter = 0
    while len(stream) < len(plain):
        stream += hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    sealed = bytes(a ^ b for a, b in zip(plain, stream))
    return base64.urlsafe_b64encode(nonce + sealed).decode("ascii")


def _open_with_key(value: str, key: bytes) -> str:
    raw = base64.urlsafe_b64decode(value.encode("ascii"))
    nonce, sealed = raw[:16], raw[16:]
    stream = b""
    counter = 0
    while len(stream) < len(sealed):
        stream += hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(a ^ b for a, b in zip(sealed, stream)).decode("ascii")


def seal_totp_secret(secret: str) -> str:
    """Chiffre le secret TOTP.

    v2 = clé ADMIN_MFA_KEY dédiée (recommandé).
    v1 = ancienne dérivation depuis JWT_SECRET, conservée pour la migration.
    """
    if settings.admin_mfa_key:
        return "v2:" + _seal_with_key(secret, _mfa_key())
    return "v1:" + _seal_with_key(secret, hashlib.sha256(settings.jwt_secret.encode()).digest())


def open_totp_secret(value: str) -> str:
    if not value:
        return ""
    try:
        if value.startswith("v2:"):
            return _open_with_key(value[3:], _mfa_key())
        if value.startswith("v1:"):
            legacy = hashlib.sha256(settings.jwt_secret.encode()).digest()
            return _open_with_key(value[3:], legacy)
    except Exception:
        return ""
    return ""


def needs_mfa_reencrypt(value: str) -> bool:
    """Un secret v1 doit être ré-enregistré dès qu'une clé dédiée est configurée."""
    return bool(settings.admin_mfa_key and value.startswith("v1:"))


def generate_recovery_codes(count: int = 8) -> list[str]:
    return [secrets.token_hex(5).upper() for _ in range(count)]


def hash_recovery_code(code: str) -> str:
    normalized = "".join(ch for ch in str(code or "").upper() if ch.isalnum())
    return hmac.new(_mfa_key(), normalized.encode("ascii"), hashlib.sha256).hexdigest()


def totp_uri(email: str, secret: str) -> str:
    label = quote(f"ANZAR Admin:{email}", safe="")
    return f"otpauth://totp/{label}?secret={secret}&issuer=ANZAR&algorithm=SHA1&digits=6&period=30"


# Algorithms explicitly pinned: prevents algorithm-confusion attacks
# (e.g. alg:none / HS256-vs-RS512 key confusion).
_JWT_ALGORITHM = "HS256"
_JWT_AUDIENCE = "anzar-api"


def create_token(
    user_id: str,
    expires_in: Optional[int] = None,
    extra_claims: Optional[dict] = None,
    token_version: int = 0,
    auth_time: Optional[float] = None,
) -> str:
    """Create HS256-signed JWT with optional extra claims.

    `token_version` est comparé au compteur en base à chaque requête.
    `auth_time` est l'instant de la connexion initiale : il ne doit jamais être
    réinitialisé par un refresh, sinon la session pourrait vivre indéfiniment.
    """
    if expires_in is None:
        expires_in = settings.jwt_expiry_hours * 3600

    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "jti": secrets.token_hex(16),
        "aud": _JWT_AUDIENCE,
        "token_version": int(token_version or 0),
        "auth_time": float(auth_time or now_ts),
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

    # Les jetons admin ne donnent pas accès aux routes utilisateur (et inversement).
    if payload.get("is_admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Jeton admin non valable pour l'application")

    # Compte supprimé ou désactivé par l'admin : le jeton déjà émis cesse de marcher tout de suite.
    user = await ensure_user_active(payload.get("sub") or "")
    if int(payload.get("token_version") or 0) != int(user.get("token_version") or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session révoquée. Reconnecte-toi.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


async def ensure_user_active(email: str) -> dict:
    """401 si le compte n'existe plus, 403 s'il est désactivé. Retourne l'utilisateur."""
    from db import get_user_by_email  # import local : db importe security
    user = await get_user_by_email(email) if email else None
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Compte introuvable. Reconnecte-toi.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.get("is_active", True):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Compte désactivé. Contacte le support.")
    return user


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

    # Une tâche d'agent (40 étapes × appels d'outils) dépasse vite 100 messages
    if len(messages) > 2000:
        raise HTTPException(400, "Too many messages (max 2000)")
    image_bytes = 0

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
        elif isinstance(content, list):
            # Contenu mixte (texte + images) : seuls ces deux types de blocs passent
            images = 0
            for part in content:
                if not isinstance(part, dict) or part.get("type") not in ("text", "image_url"):
                    raise HTTPException(400, "Bloc de message non pris en charge")
                if part["type"] == "text" and len(str(part.get("text", ""))) > 200_000:
                    raise HTTPException(400, "Message trop long (max 200K caractères)")
                if part["type"] == "image_url":
                    images += 1
                    url = str((part.get("image_url") or {}).get("url", ""))
                    if not (url.startswith("data:image/") or url.startswith("https://")):
                        raise HTTPException(400, "Image invalide")
                    image_bytes += len(url)
            if images > 8:
                raise HTTPException(400, "8 images au maximum par message")
            if image_bytes > 30 * 1024 * 1024:
                raise HTTPException(400, "Images trop lourdes (30 Mo au maximum par requête)")

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


def deepseek_is_peak(at=None) -> bool:
    """Heures pleines DeepSeek : en semaine (UTC), dans les plages de deepseek_peak_windows_utc."""
    from datetime import datetime, timezone
    now = at or datetime.now(timezone.utc)
    if now.weekday() >= 5:  # samedi, dimanche
        return False
    for window in (settings.deepseek_peak_windows_utc or "").split(","):
        try:
            start, end = (int(x) for x in window.split("-"))
        except ValueError:
            continue
        if start <= now.hour < end:
            return True
    return False


def calculate_cost_fcfa(
    provider: str, input_tokens: int, output_tokens: int, model: str = "", cached_input_tokens: int = 0, at=None,
) -> tuple[float, float]:
    """
    Calculate the cost of an API call in USD and FCFA (prix de vente).
    Returns (cost_usd, cost_fcfa).
    DeepSeek : barème réel (cache / hors cache / sortie, heures pleines ou creuses) × marge.
    """
    # ANZAR est 100 % DeepSeek : tout appel est facturé au barème DeepSeek (jamais gratuit).
    is_pro = "pro" in (model or "").lower()
    hit, miss, out = (
        (settings.deepseek_pro_hit_usd, settings.deepseek_pro_miss_usd, settings.deepseek_pro_output_usd)
        if is_pro else
        (settings.deepseek_flash_hit_usd, settings.deepseek_flash_miss_usd, settings.deepseek_flash_output_usd)
    )
    factor = 1.0 if deepseek_is_peak(at) else settings.deepseek_offpeak_factor
    cached = max(0, min(cached_input_tokens, input_tokens))
    real_usd = factor * (
        cached * hit + (input_tokens - cached) * miss + output_tokens * out
    ) / 1_000_000
    cost_fcfa = real_usd * settings.usd_to_fcfa * settings.deepseek_margin
    cost_usd = cost_fcfa / settings.usd_to_fcfa

    return round(cost_usd, 6), round(cost_fcfa, 2)
