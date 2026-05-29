"""
AUTH routes — /api/auth/*
Register, login, verify, refresh, OTP send-code, verify-code.
"""
import time
import secrets
import base64
import json as _json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from config import settings
from security import (
    rate_limiter, get_client_ip,
    create_token, verify_token,
)
from database import (
    get_user_by_email, create_user,
    verify_password, update_last_login,
    get_credits,
    create_otp, verify_otp, get_recent_otp_count,
    get_rate_limit_count, record_rate_limit_hit,
)
from services.email import send_otp_email

import logging

logger = logging.getLogger("anzar")

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Models ──

class AuthRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)


class SendCodeRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)


class VerifyCodeRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    code: str = Field(..., min_length=6, max_length=6)


# ── Routes ──

@router.post("/register")
async def register(body: AuthRequest, request: Request):
    """Register a new user account. Initializes credits at 0 FCFA."""
    rate_limiter.check_auth(get_client_ip(request))
    email = body.email.strip().lower()
    password = body.password

    if len(password) < 8:
        raise HTTPException(400, "Le mot de passe doit contenir au moins 8 caractères")

    existing = await get_user_by_email(email)
    if existing:
        raise HTTPException(409, "Un compte avec cet email existe déjà")

    try:
        user = await create_user(email, password)
    except Exception as e:
        logger.error(f"Failed to create user: {type(e).__name__}: {e}")
        raise HTTPException(500, "Erreur lors de la création du compte")

    token = create_token(user_id=email)
    creds = await get_credits(email)

    return {
        "token": token,
        "user": {
            "email": email,
            "name": email.split("@")[0],
        },
        "credits": {
            "balance_fcfa": creds.get("balance_fcfa", 0),
            "total_recharged": creds.get("total_recharged", 0),
            "total_used": creds.get("total_used", 0),
        },
    }


@router.post("/login")
async def login(body: AuthRequest, request: Request):
    """Login with email + password. Returns JWT + credit balance."""
    rate_limiter.check_auth(get_client_ip(request))
    email = body.email.strip().lower()
    password = body.password

    user = await get_user_by_email(email)
    if not user:
        logger.warning(f"Login failed: unknown email {email}")
        raise HTTPException(401, "Email ou mot de passe incorrect")

    if not verify_password(password, user["password_hash"], user["salt"]):
        logger.warning(f"Login failed: wrong password for {email}")
        raise HTTPException(401, "Email ou mot de passe incorrect")

    await update_last_login(email)

    token = create_token(user_id=email)
    creds = await get_credits(email)

    return {
        "token": token,
        "user": {
            "email": email,
            "name": user.get("name", email.split("@")[0]),
        },
        "credits": {
            "balance_fcfa": creds.get("balance_fcfa", 0),
            "total_recharged": creds.get("total_recharged", 0),
            "total_used": creds.get("total_used", 0),
        },
    }


@router.get("/verify")
async def verify_auth(request: Request):
    """Verify that the auth token is valid."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization token")

    payload = verify_token(auth[7:])
    if not payload:
        raise HTTPException(401, "Invalid or expired token")

    return {"valid": True, "user_id": payload.get("sub")}


@router.post("/refresh")
async def refresh_token(request: Request):
    """Issue a new JWT if the current one is still valid (or recently expired within grace window)."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization token")

    raw_token = auth[7:]
    payload = verify_token(raw_token)

    if not payload:
        try:
            payload_b64 = raw_token.split(".")[0]
            padded = payload_b64 + "=" * (-len(payload_b64) % 4)
            decoded = _json.loads(base64.urlsafe_b64decode(padded))
            exp = decoded.get("exp", 0)
            grace_seconds = 7 * 24 * 3600  # 7 days
            if int(time.time()) - exp > grace_seconds:
                raise HTTPException(401, "Token expired beyond refresh window")
            user_id = decoded.get("sub")
            if not user_id:
                raise HTTPException(401, "Invalid token payload")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(401, "Invalid token")
    else:
        user_id = payload.get("sub")

    new_token = create_token(user_id=user_id)
    return {"token": new_token, "user_id": user_id}


# ── OTP (passwordless login via email code) ──

@router.post("/send-code")
async def send_code(body: SendCodeRequest, request: Request):
    """
    Envoie un code de verification 6 chiffres par email via Brevo.
    Cree le compte automatiquement si l'email est nouveau.
    Rate limited: max 3 codes par 5 minutes par email.
    """
    email = body.email.strip().lower()

    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "Format d'email invalide")

    recent_count = await get_recent_otp_count(email, window_seconds=300)
    if recent_count >= 3:
        raise HTTPException(
            429,
            "Trop de codes envoyés. Attends quelques minutes avant de réessayer."
        )

    code = f"{secrets.randbelow(1000000):06d}"
    await create_otp(email, code, expiry_minutes=settings.otp_expiry_minutes)

    user = await get_user_by_email(email)
    user_name = user.get("name", "") if user else ""

    sent = await send_otp_email(email, code, user_name=user_name)
    if not sent:
        raise HTTPException(503, "Impossible d'envoyer l'email. Réessaie plus tard.")

    return {
        "status": "ok",
        "message": "Code envoyé par email",
        "email": email,
        "expires_in_minutes": settings.otp_expiry_minutes,
        "is_new_user": user is None,
    }


@router.post("/verify-code")
async def verify_code(body: VerifyCodeRequest, request: Request):
    """
    Verifie le code OTP et connecte l'utilisateur.
    Si c'est un nouvel email, cree le compte automatiquement.
    Retourne un JWT + solde credits.
    """
    email = body.email.strip().lower()
    code = body.code.strip()

    verify_key = f"otp_verify:{email}"
    recent_attempts = await get_rate_limit_count(verify_key, window_seconds=300)
    if recent_attempts >= 10:
        logger.warning(f"OTP brute-force blocked for {email} from {get_client_ip(request)}")
        raise HTTPException(429, "Trop de tentatives. Attends quelques minutes.")
    await record_rate_limit_hit(verify_key, "verify-code")

    is_valid = await verify_otp(email, code, max_attempts=settings.otp_max_attempts)
    if not is_valid:
        raise HTTPException(401, "Code invalide ou expiré. Demande un nouveau code.")

    user = await get_user_by_email(email)
    if not user:
        user = await create_user(email)
        logger.info(f"New user auto-created via OTP: {email}")

    await update_last_login(email)
    token = create_token(user_id=email)
    creds = await get_credits(email)

    return {
        "token": token,
        "user": {
            "email": email,
            "name": user.get("name", email.split("@")[0]),
        },
        "credits": {
            "balance_fcfa": creds.get("balance_fcfa", 0),
            "total_recharged": creds.get("total_recharged", 0),
            "total_used": creds.get("total_used", 0),
        },
        "is_new_user": user.get("last_login") is None,
    }
