"""
ANZAR Backend — Secure AI Proxy + Multi-Agent Pipeline + Prepaid Credits
Production-ready for Railway deployment.

All AI API keys NEVER leave the server.
Credits are managed server-side (source of truth).
"""
import logging
import time
import json
import uuid
import secrets
import asyncio
from typing import Dict, Any, Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Depends, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, PlainTextResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import httpx

from config import settings
from security import (
    rate_limiter, get_client_ip, validate_messages,
    create_token, verify_token, get_current_user,
    sanitize_error, validate_config, calculate_cost_fcfa,
)
from database import (
    init_db, get_user_by_email, create_user,
    verify_password, update_last_login,
    update_user_profile, change_user_password, deactivate_user,
    get_credits, add_credits, deduct_credits, has_credits,
    record_usage, get_usage_stats, get_usage_history, get_transactions,
    create_project, update_project, get_project, get_user_projects, delete_project,
    cleanup_rate_limits,
    create_otp, verify_otp, get_recent_otp_count, cleanup_expired_otps,
    get_rate_limit_count, record_rate_limit_hit,
    # Admin
    create_default_admin, get_admin_by_email, get_admin_by_id,
    update_admin_profile, change_admin_password, update_admin_last_login,
    list_admins,
    admin_list_all_users, admin_get_user_detail, admin_update_user,
    admin_add_credits_to_user, admin_list_all_projects,
    admin_get_global_stats, admin_get_all_transactions, admin_get_all_usage,
    admin_delete_project_any,
    # Payments (prep)
    create_payment_intent, admin_list_payment_intents, admin_mark_payment_intent_paid,
)
from agents import OrchestratorAgent, PlannerAgent, CoderAgent, TesterAgent, ExecutorAgent
from services.deepseek_client import DeepSeekClient
from services.email import send_otp_email
from services.web_search import search_web, format_search_results, WEB_SEARCH_TOOL

# ============================================================================
# SETUP
# ============================================================================

logger = logging.getLogger("anzar")
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    validate_config()
    await init_db()
    await create_default_admin()
    stop_event = asyncio.Event()

    async def _housekeeping_loop():
        # Runs forever until shutdown; lightweight periodic cleanup
        while not stop_event.is_set():
            try:
                await cleanup_expired_otps()
                await cleanup_rate_limits(max_age_seconds=86400)
            except Exception as e:
                logger.warning(f"Housekeeping error: {e}")
            # every 15 minutes
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=15 * 60)
            except asyncio.TimeoutError:
                pass

    housekeeping_task = asyncio.create_task(_housekeeping_loop())
    logger.info(f"ANZAR Backend v{settings.app_version} started on port {settings.effective_port}")
    yield
    stop_event.set()
    housekeeping_task.cancel()
    try:
        await housekeeping_task
    except Exception:
        pass
    logger.info("ANZAR Backend stopped")


app = FastAPI(
    title="ANZAR Backend",
    description="Secure AI proxy + multi-agent vibecoding pipeline",
    version=settings.app_version,
    docs_url="/docs" if settings.debug else None,
    redoc_url=None,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# ============================================================================
# PROVIDER CONFIG
# ============================================================================

PROVIDERS = {
    "deepseek": {
        "base_url": settings.deepseek_base_url,
        "api_key": settings.deepseek_api_key,
    },
    "kimi": {
        "base_url": settings.kimi_base_url,
        "api_key": settings.kimi_api_key,
    },
}


_provider_disabled_until: Dict[str, float] = {}


def _now() -> float:
    return time.time()


def _disable_provider(provider: str, seconds: int, reason: str = ""):
    until = _now() + max(0, int(seconds))
    _provider_disabled_until[provider] = max(_provider_disabled_until.get(provider, 0), until)
    if reason:
        logger.warning(f"Provider disabled: {provider} for {seconds}s — {reason}")
    else:
        logger.warning(f"Provider disabled: {provider} for {seconds}s")


def _is_provider_disabled(provider: str) -> bool:
    until = _provider_disabled_until.get(provider, 0)
    return until > _now()


def _provider_unavailable_message(provider: str) -> str:
    # Do not mention providers in user-facing messages.
    if provider == "kimi":
        return "Vision indisponible pour le moment. Réessaie sans image."
    return "Service IA indisponible pour le moment. Réessaie plus tard."


def get_provider_config(provider: str) -> dict:
    """Get provider config or raise 400."""
    if provider not in PROVIDERS:
        raise HTTPException(400, "Provider inconnu ou indisponible.")
    if _is_provider_disabled(provider):
        raise HTTPException(503, _provider_unavailable_message(provider))
    config = PROVIDERS[provider]
    if not config["api_key"]:
        raise HTTPException(503, _provider_unavailable_message(provider))
    return config


# ============================================================================
# MIDDLEWARE
# ============================================================================

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    """Rate limiting + request logging + security headers."""
    client_ip = get_client_ip(request)

    # Rate limit on API routes
    if request.url.path.startswith("/api/"):
        rate_limiter.check(client_ip)

    start = time.time()
    response = await call_next(request)
    elapsed = time.time() - start

    # Log (skip health checks to reduce noise)
    if request.url.path != "/health":
        logger.info(f"{request.method} {request.url.path} → {response.status_code} ({elapsed:.2f}s) [{client_ip}]")

    # Security headers
    response.headers["X-Process-Time"] = f"{elapsed:.3f}"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

    return response


# ============================================================================
# HEALTH
# ============================================================================

@app.get("/")
async def root():
    return {
        "service": "ANZAR Backend",
        "version": settings.app_version,
        "status": "ok",
    }


@app.get("/health")
async def health():
    """Health check — verifies DB connectivity and provider status."""
    checks = {"database": "ok", "deepseek": "configured", "kimi": "configured"}

    # DB check
    try:
        from database import db_ping
        await db_ping()
    except Exception as e:
        checks["database"] = "error"
        logger.error("Health check DB failure: %s", e)

    # Provider availability
    if not settings.deepseek_api_key:
        checks["deepseek"] = "not_configured"
    if not settings.kimi_api_key:
        checks["kimi"] = "not_configured"

    all_ok = checks["database"] == "ok"
    return {
        "status": "healthy" if all_ok else "degraded",
        "timestamp": time.time(),
        "version": settings.app_version,
        "checks": checks,
    }


# ============================================================================
# AUTH MODELS
# ============================================================================

class AuthRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)


# ============================================================================
# AUTH ROUTES
# ============================================================================

@app.post("/api/auth/register")
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

    # Get initial credit balance
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


@app.post("/api/auth/login")
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


@app.get("/api/auth/verify")
async def verify_auth(request: Request):
    """Verify that the auth token is valid."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization token")

    payload = verify_token(auth[7:])
    if not payload:
        raise HTTPException(401, "Invalid or expired token")

    return {"valid": True, "user_id": payload.get("sub")}


# ============================================================================
# AUTH OTP (passwordless login via email code)
# ============================================================================

class SendCodeRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)


class VerifyCodeRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    code: str = Field(..., min_length=6, max_length=6)


@app.post("/api/auth/send-code")
async def send_code(body: SendCodeRequest, request: Request):
    """
    Envoie un code de vérification 6 chiffres par email via Brevo.
    Crée le compte automatiquement si l'email est nouveau.
    Rate limited: max 3 codes par 5 minutes par email.
    """
    email = body.email.strip().lower()

    # Validate email format
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "Format d'email invalide")

    # Anti-spam: max 3 codes per 5 minutes
    recent_count = await get_recent_otp_count(email, window_seconds=300)
    if recent_count >= 3:
        raise HTTPException(
            429,
            "Trop de codes envoyés. Attends quelques minutes avant de réessayer."
        )

    # Generate 6-digit code
    code = f"{secrets.randbelow(1000000):06d}"

    # Store OTP in database
    await create_otp(email, code, expiry_minutes=settings.otp_expiry_minutes)

    # Get user name if exists
    user = await get_user_by_email(email)
    user_name = user.get("name", "") if user else ""

    # Send email via Brevo
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


@app.post("/api/auth/verify-code")
async def verify_code(body: VerifyCodeRequest, request: Request):
    """
    Vérifie le code OTP et connecte l'utilisateur.
    Si c'est un nouvel email, crée le compte automatiquement.
    Retourne un JWT + solde crédits.
    """
    email = body.email.strip().lower()
    code = body.code.strip()

    # Anti-brute-force: max 10 verify attempts per email per 5 minutes
    verify_key = f"otp_verify:{email}"
    recent_attempts = await get_rate_limit_count(verify_key, window_seconds=300)
    if recent_attempts >= 10:
        logger.warning(f"OTP brute-force blocked for {email} from {get_client_ip(request)}")
        raise HTTPException(429, "Trop de tentatives. Attends quelques minutes.")
    await record_rate_limit_hit(verify_key, "verify-code")

    # Verify the OTP code
    is_valid = await verify_otp(email, code, max_attempts=settings.otp_max_attempts)

    if not is_valid:
        raise HTTPException(401, "Code invalide ou expiré. Demande un nouveau code.")

    # Check if user exists
    user = await get_user_by_email(email)

    if not user:
        # Auto-create account (passwordless)
        user = await create_user(email)
        logger.info(f"New user auto-created via OTP: {email}")

    # Update last login
    await update_last_login(email)

    # Generate JWT
    token = create_token(user_id=email)

    # Get credit balance
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


# ============================================================================
# USER PROFILE
# ============================================================================

@app.get("/api/user/profile")
async def get_profile(user: dict = Depends(get_current_user)):
    """Get current user's profile with credit balance."""
    email = user["sub"]
    db_user = await get_user_by_email(email)
    if not db_user:
        raise HTTPException(404, "Utilisateur non trouvé")

    creds = await get_credits(email)

    return {
        "email": email,
        "name": db_user.get("name", email.split("@")[0]),
        "created_at": db_user.get("created_at"),
        "credits": {
            "balance_fcfa": creds.get("balance_fcfa", 0),
            "total_recharged": creds.get("total_recharged", 0),
            "total_used": creds.get("total_used", 0),
        },
    }


@app.patch("/api/user/profile")
async def patch_profile(request: Request, user: dict = Depends(get_current_user)):
    """Update user profile (name)."""
    email = user["sub"]
    body = await request.json()
    name = body.get("name", "").strip()
    if not name or len(name) > 100:
        raise HTTPException(400, "Nom invalide (1-100 caractères)")

    await update_user_profile(email, name)
    return {"status": "ok", "name": name}


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=128)


@app.post("/api/user/change-password")
async def change_password(body: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    """Change user password. Requires current password."""
    email = user["sub"]
    db_user = await get_user_by_email(email)
    if not db_user:
        raise HTTPException(404, "Utilisateur non trouvé")

    if not verify_password(body.current_password, db_user["password_hash"], db_user["salt"]):
        raise HTTPException(401, "Mot de passe actuel incorrect")

    await change_user_password(email, body.new_password)
    return {"status": "ok", "message": "Mot de passe modifié"}


@app.delete("/api/user/account")
async def delete_account(user: dict = Depends(get_current_user)):
    """Soft-delete user account."""
    email = user["sub"]
    await deactivate_user(email)
    return {"status": "ok", "message": "Compte désactivé"}


# ============================================================================
# CREDITS (prepaid balance)
# ============================================================================

@app.get("/api/credits")
async def get_user_credits(user: dict = Depends(get_current_user)):
    """Get current credit balance."""
    creds = await get_credits(user["sub"])
    return {
        "balance_fcfa": creds.get("balance_fcfa", 0),
        "total_recharged": creds.get("total_recharged", 0),
        "total_used": creds.get("total_used", 0),
    }


class RechargeRequest(BaseModel):
    amount_fcfa: float = Field(..., gt=0, le=1_000_000)
    payment_ref: str = Field(default="", max_length=255)
    payment_method: str = Field(default="manual", max_length=50)


# ============================================================================
# PAYMENTS (Wave/Orange Money) — préparation
# ============================================================================

class PaymentInitiateRequest(BaseModel):
    amount: float = Field(..., gt=0, le=1_000_000)
    currency: str = Field(default="XOF", max_length=8)
    method: str = Field(default="wave", max_length=32)  # wave | orange_money | ...


@app.post("/api/payments/initiate")
async def initiate_payment(body: PaymentInitiateRequest, user: dict = Depends(get_current_user)):
    """
    Prépare un paiement (Wave/Orange Money).

    Pour l’instant (avant intégration provider), on crée juste une "demande" en DB (payment_intents)
    afin que l’admin puisse la voir et créditer manuellement le compte après réception du paiement.
    """
    intent = await create_payment_intent(user["sub"], body.amount, currency=body.currency, method=body.method)
    return {
        "status": "pending",
        "intent_id": intent.get("id"),
        "paymentUrl": None,
        "message": "Paiement en cours d'intégration. Demande enregistrée; l'admin validera et créditera le compte.",
    }


@app.post("/api/credits/recharge")
async def recharge_credits(body: RechargeRequest, user: dict = Depends(get_current_user)):
    """
    Add credits to user balance.
    In production, this should be called AFTER payment verification
    (Wave, Orange Money, etc.) — either from a webhook or admin action.
    """
    email = user["sub"]
    description = f"Recharge {body.payment_method}"
    if body.payment_ref:
        description += f" (ref: {body.payment_ref})"

    creds = await add_credits(
        email,
        body.amount_fcfa,
        description,
        tx_type="recharge",
        external_ref=body.payment_ref,
    )

    return {
        "status": "ok",
        "balance_fcfa": creds.get("balance_fcfa", 0),
        "total_recharged": creds.get("total_recharged", 0),
        "amount_added": body.amount_fcfa,
    }


@app.get("/api/credits/transactions")
async def get_credit_transactions(
    user: dict = Depends(get_current_user),
    limit: int = 50,
    offset: int = 0,
):
    """Get transaction history (recharges + usages)."""
    txs = await get_transactions(user["sub"], limit=min(limit, 200), offset=offset)
    return {"transactions": txs, "count": len(txs)}


# ============================================================================
# USAGE TRACKING
# ============================================================================

@app.get("/api/usage")
async def get_user_usage(
    user: dict = Depends(get_current_user),
    limit: int = 50,
    offset: int = 0,
):
    """Get detailed usage history."""
    records = await get_usage_history(user["sub"], limit=min(limit, 200), offset=offset)
    return {"records": records, "count": len(records)}


@app.get("/api/usage/stats")
async def get_user_usage_stats(
    user: dict = Depends(get_current_user),
    days: int = 30,
):
    """Get aggregated usage statistics."""
    stats = await get_usage_stats(user["sub"], days=min(days, 365))
    return stats


# ============================================================================
# AI PROXY — OpenAI-compatible /chat/completions
# ============================================================================

@app.post("/api/{provider}/chat/completions")
async def proxy_chat(provider: str, request: Request, user: dict = Depends(get_current_user)):
    """
    Proxy AI chat requests to DeepSeek or Kimi.
    Checks credit balance before proxying.
    Deducts credits after successful response.
    """
    email = user["sub"]
    config = get_provider_config(provider)

    # ── Credit / Freemium check ──
    has_paid_credits = await has_credits(email)
    is_free_chat = False
    if not has_paid_credits:
        # Free daily quota (chat only)
        quota = int(getattr(settings, "free_daily_chat_requests", 0) or 0)
        if quota <= 0:
            raise HTTPException(status_code=402, detail="Solde épuisé. Rechargez pour continuer à utiliser ANZAR.")

        free_key = f"free_chat:{email}"
        used = await get_rate_limit_count(free_key, window_seconds=86400)
        if used >= quota:
            raise HTTPException(
                status_code=402,
                detail=f"Quota gratuit atteint ({quota} chats/24h). Rechargez pour continuer."
            )
        await record_rate_limit_hit(free_key, "free-chat")
        is_free_chat = True

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    if "messages" in body:
        body["messages"] = validate_messages(body["messages"])

    # Free tier guardrails: force default (cheapest) model
    if is_free_chat:
        if provider == "deepseek":
            body["model"] = settings.deepseek_model
        elif provider == "kimi":
            body["model"] = settings.kimi_model

    # Force model limits
    max_tokens = body.get("max_completion_tokens", body.get("max_tokens", 4096))
    if is_free_chat:
        # Keep free tier cheap
        if max_tokens > 512:
            body["max_completion_tokens"] = 512
    else:
        if max_tokens > 16384:
            body["max_completion_tokens"] = 16384

    is_stream = body.get("stream", False)
    if is_free_chat and is_stream:
        # To reduce abuse/cost, streaming is disabled in the free quota
        raise HTTPException(400, "Streaming indisponible en quota gratuit. Désactive stream ou recharge.")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['api_key']}",
    }

    target_url = f"{config['base_url']}/chat/completions"
    start_time = time.time()

    if is_stream:
        return await _proxy_stream_with_billing(
            target_url, headers, body, email, provider, start_time
        )
    else:
        return await _proxy_request_with_billing(
            target_url, headers, body, email, provider, start_time
        )


@app.post("/api/chat/smart")
async def smart_chat(request: Request, user: dict = Depends(get_current_user)):
    """
    Smart chat endpoint with automatic web search via tool calling.

    The backend handles the full tool-calling loop:
    1. Send user message + web_search tool definition to DeepSeek.
    2. If DeepSeek calls web_search, execute it via Serper.
    3. Feed results back, repeat up to 3 rounds.
    4. Return the final response with sources.

    This is used when the frontend detects the user might need web info,
    or can be the default chat endpoint.
    """
    email = user["sub"]

    # Credit check
    has_paid = await has_credits(email)
    if not has_paid:
        quota = int(getattr(settings, "free_daily_chat_requests", 0) or 0)
        if quota <= 0:
            raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")
        free_key = f"free_chat:{email}"
        used = await get_rate_limit_count(free_key, window_seconds=86400)
        if used >= quota:
            raise HTTPException(402, f"Quota gratuit atteint ({quota}/24h). Rechargez.")
        await record_rate_limit_hit(free_key, "free-chat")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(400, "messages is required")
    messages = validate_messages(messages)

    model = body.get("model", settings.deepseek_model)
    temperature = body.get("temperature", 0.7)
    max_tokens = body.get("max_tokens", 4096)

    # Tool executor — handles web_search calls from DeepSeek
    async def tool_executor(name: str, args: dict) -> str:
        if name == "web_search":
            query = args.get("query", "")
            num = args.get("num_results", 5)
            if not query:
                return json.dumps({"error": "query is required"})
            data = await search_web(query, num_results=num)
            return format_search_results(data)
        return json.dumps({"error": f"Unknown tool: {name}"})

    start_time = time.time()
    reasoning_content = ""

    try:
        client = DeepSeekClient()

        # Reasoner model — uses dedicated endpoint, no tools/temperature/streaming
        is_reasoner = "reasoner" in model.lower()

        if is_reasoner:
            reasoning_content, response_text = await client.chat_with_reasoning(
                messages=messages,
                model=model,
            )
        else:
            # Only inject web_search tool if Serper is configured
            tools = [WEB_SEARCH_TOOL] if settings.serper_api_key else []

            if tools:
                response_text = await client.chat_with_tools(
                    messages=messages,
                    tools=tools,
                    tool_executor=tool_executor,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            else:
                # No search configured — fallback to normal chat
                response_text = await client.chat(
                    messages=messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )

        duration_ms = int((time.time() - start_time) * 1000)

        # Approximate token counting for billing
        input_tokens = sum(len(m.get("content", "")) for m in messages) // 4
        output_tokens = len(response_text) // 4

        _cost_usd, cost_fcfa = calculate_cost_fcfa(
            "deepseek", input_tokens, output_tokens
        )

        if has_paid and cost_fcfa > 0:
            await deduct_credits(email, cost_fcfa, description=f"smart_chat:{model}")
            await record_usage(
                email, "deepseek", model,
                input_tokens, output_tokens, _cost_usd, cost_fcfa,
                duration_ms=duration_ms, task_type="smart_chat"
            )

        message_payload = {
            "role": "assistant",
            "content": response_text,
        }
        if reasoning_content:
            message_payload["reasoning_content"] = reasoning_content

        return JSONResponse({
            "choices": [{
                "message": message_payload,
                "finish_reason": "stop",
            }],
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_fcfa": round(cost_fcfa, 2),
            },
            "duration_ms": duration_ms,
        })

    except Exception as e:
        logger.error(f"Smart chat error: {e}")
        raise HTTPException(500, "Erreur interne. Réessaie plus tard.")


@app.post("/api/{provider}/beta/completions")
async def proxy_fim(provider: str, request: Request, user: dict = Depends(get_current_user)):
    """Proxy FIM (Fill-In-Middle) completions — DeepSeek beta."""
    email = user["sub"]
    config = get_provider_config(provider)

    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    if body.get("max_tokens", 0) > 2048:
        body["max_tokens"] = 2048

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['api_key']}",
    }

    target_url = f"{config['base_url']}/beta/completions"
    return await _proxy_request(target_url, headers, body)


# ============================================================================
# DEEPSEEK FILES / BATCHES (optimisation -50% coûts)
# ============================================================================

def _deepseek_v1_base() -> str:
    base = (settings.deepseek_base_url or "").rstrip("/")
    if base.endswith("/v1"):
        return base
    return f"{base}/v1"


@app.post("/api/deepseek/files")
async def deepseek_upload_file(
    user: dict = Depends(get_current_user),
    file: UploadFile = File(...),
    purpose: str = Form("batch"),
):
    """
    Upload un fichier vers DeepSeek (utilisé pour Batch API).
    Le fichier est généralement un JSONL généré par l'app (pas un fichier utilisateur).
    """
    email = user["sub"]
    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")
    if not settings.deepseek_api_key:
        raise HTTPException(503, "Service indisponible pour le moment. Réessaie plus tard.")

    content = await file.read()
    headers = {"Authorization": f"Bearer {settings.deepseek_api_key}"}
    data = {"purpose": purpose}
    files = {"file": (file.filename or "batch_requests.jsonl", content, file.content_type or "application/octet-stream")}

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{_deepseek_v1_base()}/files", headers=headers, data=data, files=files)

    if resp.status_code >= 400:
        try:
            return JSONResponse(status_code=resp.status_code, content=resp.json())
        except Exception:
            return JSONResponse(status_code=resp.status_code, content={"error": {"message": resp.text[:500]}})

    return JSONResponse(content=resp.json())


class DeepSeekBatchCreateRequest(BaseModel):
    input_file_id: str = Field(..., min_length=1, max_length=255)
    endpoint: str = Field(default="/v1/chat/completions", max_length=255)
    completion_window: str = Field(default="24h", max_length=20)


@app.post("/api/deepseek/batches")
async def deepseek_create_batch(body: DeepSeekBatchCreateRequest, user: dict = Depends(get_current_user)):
    """Crée un batch DeepSeek (asynchrone)."""
    email = user["sub"]
    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")
    if not settings.deepseek_api_key:
        raise HTTPException(503, "Service indisponible pour le moment. Réessaie plus tard.")

    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    payload = body.model_dump()

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{_deepseek_v1_base()}/batches", headers=headers, json=payload)

    if resp.status_code >= 400:
        try:
            return JSONResponse(status_code=resp.status_code, content=resp.json())
        except Exception:
            return JSONResponse(status_code=resp.status_code, content={"error": {"message": resp.text[:500]}})
    return JSONResponse(content=resp.json())


@app.get("/api/deepseek/batches/{batch_id}")
async def deepseek_get_batch(batch_id: str, user: dict = Depends(get_current_user)):
    """Récupère le statut d'un batch DeepSeek."""
    email = user["sub"]
    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")
    if not settings.deepseek_api_key:
        raise HTTPException(503, "Service indisponible pour le moment. Réessaie plus tard.")

    headers = {"Authorization": f"Bearer {settings.deepseek_api_key}"}
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(f"{_deepseek_v1_base()}/batches/{batch_id}", headers=headers)

    if resp.status_code >= 400:
        try:
            return JSONResponse(status_code=resp.status_code, content=resp.json())
        except Exception:
            return JSONResponse(status_code=resp.status_code, content={"error": {"message": resp.text[:500]}})
    return JSONResponse(content=resp.json())


@app.get("/api/deepseek/files/{file_id}/content")
async def deepseek_get_file_content(file_id: str, user: dict = Depends(get_current_user)):
    """
    Récupère le contenu d'un fichier DeepSeek (souvent output JSONL d'un batch).
    On facture ici une seule fois via external_ref=batch:{file_id} pour éviter double débit.
    """
    email = user["sub"]
    if not settings.deepseek_api_key:
        raise HTTPException(503, "Service indisponible pour le moment. Réessaie plus tard.")

    headers = {"Authorization": f"Bearer {settings.deepseek_api_key}"}
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(f"{_deepseek_v1_base()}/files/{file_id}/content", headers=headers)

    if resp.status_code >= 400:
        return PlainTextResponse(resp.text, status_code=resp.status_code)

    text = resp.text or ""

    # Facturation best-effort (ne bloque pas la récupération des résultats)
    try:
        total_in = 0
        total_out = 0
        model_name = settings.chat_model
        ok_lines = 0
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            ok_lines += 1
            try:
                obj = json.loads(line)
            except Exception:
                continue
            body = (((obj.get("response") or {}).get("body")) or {})
            usage = body.get("usage") or {}
            total_in += int(usage.get("prompt_tokens") or 0)
            total_out += int(usage.get("completion_tokens") or 0)
            if body.get("model"):
                model_name = body.get("model")

        if total_in > 0 or total_out > 0:
            cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", total_in, total_out)
            # Batch discount: -50%
            cost_usd = round(cost_usd * 0.5, 6)
            cost_fcfa = round(cost_fcfa * 0.5, 2)

            await record_usage(
                email,
                "deepseek",
                model_name,
                total_in,
                total_out,
                cost_usd,
                cost_fcfa,
                duration_ms=0,
                task_type="batch",
            )
            if cost_fcfa > 0:
                await deduct_credits(
                    email,
                    cost_fcfa,
                    f"Batch DeepSeek (-50%) ({ok_lines} req)",
                    "deepseek",
                    model_name,
                    total_in,
                    total_out,
                    external_ref=f"batch:{file_id}",
                )
    except ValueError:
        logger.warning(f"Insufficient credits for {email} during batch billing")
    except Exception as e:
        logger.error(f"Batch billing error: {e}")

    return PlainTextResponse(text, media_type="text/plain")


# ============================================================================
# PROXY HELPERS (with billing)
# ============================================================================

async def _proxy_request(url: str, headers: dict, body: dict) -> JSONResponse:
    """Forward a non-streaming request and return the response."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(url, headers=headers, json=body)
        except httpx.TimeoutException:
            raise HTTPException(504, "AI provider timeout")
        except httpx.ConnectError:
            raise HTTPException(502, "Cannot reach AI provider")

    if resp.status_code != 200:
        try:
            error_data = resp.json()
        except Exception:
            error_data = {"error": {"message": f"Provider error: {resp.status_code}"}}
        return JSONResponse(status_code=resp.status_code, content=error_data)

    return JSONResponse(content=resp.json())


async def _proxy_request_with_billing(
    url: str, headers: dict, body: dict,
    email: str, provider: str, start_time: float,
) -> JSONResponse:
    """Forward request, then bill the user based on token usage."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(url, headers=headers, json=body)
        except httpx.TimeoutException:
            if provider == "kimi":
                _disable_provider("kimi", 300, "timeout")
                raise HTTPException(503, _provider_unavailable_message("kimi"))
            raise HTTPException(504, "AI provider timeout")
        except httpx.ConnectError:
            if provider == "kimi":
                _disable_provider("kimi", 300, "connect_error")
                raise HTTPException(503, _provider_unavailable_message("kimi"))
            raise HTTPException(502, "Cannot reach AI provider")

    if resp.status_code != 200:
        # If vision provider is out of credits / invalid key / rate limited, disable it temporarily.
        if provider == "kimi" and resp.status_code in (401, 402, 403, 429):
            _disable_provider("kimi", 3600, f"provider_status={resp.status_code}")
            raise HTTPException(503, _provider_unavailable_message("kimi"))
        try:
            error_data = resp.json()
        except Exception:
            error_data = {"error": {"message": f"Provider error: {resp.status_code}"}}
        return JSONResponse(status_code=resp.status_code, content=error_data)

    data = resp.json()
    duration_ms = int((time.time() - start_time) * 1000)

    # Extract token usage from response
    usage = data.get("usage", {})
    input_tokens = usage.get("prompt_tokens", 0)
    output_tokens = usage.get("completion_tokens", 0)

    if input_tokens > 0 or output_tokens > 0:
        cost_usd, cost_fcfa = calculate_cost_fcfa(provider, input_tokens, output_tokens)

        # Record usage and deduct credits
        try:
            # If user has no paid credits, we still allow the request only if it passed the free quota check
            # (done earlier in the route). In that case we record usage but do NOT deduct credits.
            is_paid = await has_credits(email)
            await record_usage(
                email,
                provider,
                body.get("model", "unknown"),
                input_tokens,
                output_tokens,
                cost_usd,
                cost_fcfa,
                duration_ms,
                task_type="free_chat" if not is_paid else "chat",
            )
            if is_paid and cost_fcfa > 0:
                await deduct_credits(
                    email,
                    cost_fcfa,
                    f"Chat {provider}/{body.get('model', '?')}",
                    provider,
                    body.get("model", ""),
                    input_tokens,
                    output_tokens,
                )
        except ValueError:
            # Insufficient credits — don't block, response already generated
            logger.warning(f"Insufficient credits for {email} during billing")
        except Exception as e:
            logger.error(f"Billing error: {e}")

    return JSONResponse(content=data)


async def _proxy_stream_with_billing(
    url: str, headers: dict, body: dict,
    email: str, provider: str, start_time: float,
) -> StreamingResponse:
    """Forward streaming SSE request, then bill at the end."""
    client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    async def stream_generator():
        input_tokens = 0
        output_tokens = 0
        model_name = body.get("model", "unknown")

        try:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code != 200:
                    # If vision provider is out of credits / invalid key / rate limited, disable it temporarily.
                    if provider == "kimi" and resp.status_code in (401, 402, 403, 429):
                        _disable_provider("kimi", 3600, f"provider_status={resp.status_code}")
                        yield f"data: {json.dumps({'error': {'message': _provider_unavailable_message('kimi')}})}\n\n"
                        return
                    yield f"data: {json.dumps({'error': {'message': f'Provider error: {resp.status_code}'}})}\n\n"
                    return

                async for line in resp.aiter_lines():
                    if line.strip():
                        yield f"{line}\n\n"

                        # Try to extract usage from final chunk
                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                chunk = json.loads(line[6:])
                                if "usage" in chunk:
                                    input_tokens = chunk["usage"].get("prompt_tokens", 0)
                                    output_tokens = chunk["usage"].get("completion_tokens", 0)
                                if chunk.get("model"):
                                    model_name = chunk["model"]
                            except (json.JSONDecodeError, KeyError):
                                pass

        except httpx.TimeoutException:
            if provider == "kimi":
                _disable_provider("kimi", 300, "timeout_stream")
                yield f"data: {json.dumps({'error': {'message': _provider_unavailable_message('kimi')}})}\n\n"
            else:
                yield f"data: {json.dumps({'error': {'message': 'Provider timeout'}})}\n\n"
        except Exception as e:
            logger.error("Stream error: %s", e)
            yield f"data: {json.dumps({'error': {'message': 'Erreur interne. Réessaie.'}})}\n\n"
        finally:
            await client.aclose()

            # Bill after stream completes
            duration_ms = int((time.time() - start_time) * 1000)

            # If provider didn't return usage stats, estimate from message content
            if input_tokens == 0 and output_tokens == 0:
                # Rough estimation: ~4 chars per token
                input_chars = sum(
                    len(m.get("content", "")) for m in body.get("messages", []) if isinstance(m.get("content"), str)
                )
                input_tokens = max(input_chars // 4, 1)
                output_tokens = max(duration_ms // 50, 10)  # Very rough: ~20 tok/sec

            if input_tokens > 0 or output_tokens > 0:
                cost_usd, cost_fcfa = calculate_cost_fcfa(provider, input_tokens, output_tokens)
                try:
                    is_paid = await has_credits(email)
                    await record_usage(
                        email,
                        provider,
                        model_name,
                        input_tokens,
                        output_tokens,
                        cost_usd,
                        cost_fcfa,
                        duration_ms,
                        task_type="free_chat_stream" if not is_paid else "chat_stream",
                    )
                    if is_paid and cost_fcfa > 0:
                        await deduct_credits(
                            email,
                            cost_fcfa,
                            f"Stream {provider}/{model_name}",
                            provider,
                            model_name,
                            input_tokens,
                            output_tokens,
                        )
                except Exception as e:
                    logger.error(f"Stream billing error: {e}")

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ============================================================================
# PROJECT AGENTS — Multi-agent pipeline for vibecoding
# ============================================================================

# In-memory project execution state (per-process; OK for single-instance Railway)
_project_states: Dict[str, Dict[str, Any]] = {}
_MAX_PROJECT_STATES = 200  # Prevent unbounded memory growth


def _cleanup_project_states():
    """Remove completed/errored project states when dict grows too large."""
    if len(_project_states) <= _MAX_PROJECT_STATES:
        return
    # Remove completed/errored entries first (oldest first)
    removable = [
        pid for pid, state in _project_states.items()
        if state.get("status") in ("completed", "error", "cancelled")
    ]
    for pid in removable:
        del _project_states[pid]
        if len(_project_states) <= _MAX_PROJECT_STATES // 2:
            break
    # If still too large, remove oldest entries regardless of status
    if len(_project_states) > _MAX_PROJECT_STATES:
        to_remove = list(_project_states.keys())[:len(_project_states) - _MAX_PROJECT_STATES // 2]
        for pid in to_remove:
            del _project_states[pid]

# Shared DeepSeek client
_deepseek_client = DeepSeekClient()


class PlanRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=10000)
    project_name: str = Field(default="my_project", max_length=128)
    tech_stack: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)


class ExecuteRequest(BaseModel):
    plan: Dict[str, Any] = Field(...)
    base_dir: Optional[str] = None


@app.post("/api/projects/plan")
async def plan_project(body: PlanRequest, user: dict = Depends(get_current_user)):
    """Plan a project using Orchestrator + Planner agents."""
    email = user["sub"]

    # Credit check
    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")

    try:
        # Step 1: Orchestrator
        orchestrator = OrchestratorAgent(deepseek_client=_deepseek_client)
        orch_result = await orchestrator.execute({
            "description": body.description,
            "project_name": body.project_name,
            "tech_stack": body.tech_stack,
            "requirements": body.requirements,
        })

        if orch_result.get("status") == "error":
            err_detail = orch_result.get("error", "Unknown orchestration error")
            logger.error("Orchestration failed: %s", err_detail)
            raise HTTPException(500, f"Erreur orchestration: {err_detail}")

        plan = orch_result.get("plan", {})
        if not plan:
            logger.error("Orchestrator returned empty plan")
            raise HTTPException(500, "L'orchestrateur n'a pas pu générer de plan. Réessaie.")

        # Step 2: Planner
        planner = PlannerAgent(deepseek_client=_deepseek_client)
        plan_result = await planner.execute({
            "plan": plan,
            "project_name": body.project_name,
        })

        if plan_result.get("status") == "error":
            err_detail = plan_result.get("error", "Unknown planner error")
            logger.error("Planning failed: %s", err_detail)
            raise HTTPException(500, f"Erreur planification: {err_detail}")

        architecture = plan_result.get("architecture", {})

        # Build response matching frontend ProjectPlan type
        result = {
            "title": plan.get("project_name", body.project_name),
            "overview": plan.get("description", body.description),
            "files": [
                {"path": f.get("path", ""), "description": f.get("description", ""), "type": f.get("type", "")}
                for f in architecture.get("structure", {}).get("files", [])
            ],
            "phases": [
                {"name": t.get("task", ""), "description": t.get("task", ""), "duration": "", "tasks": [t.get("task", "")]}
                for t in plan.get("tasks", [])
            ],
            "complexity": "medium",
            "notes": "",
            "architecture": architecture,
            "tokens_used": orch_result.get("tokens_used", 0) + plan_result.get("tokens_used", 0),
        }

        # Save project to DB
        project_id = f"proj_{uuid.uuid4().hex[:12]}"
        await create_project(project_id, email, body.project_name, body.description)
        await update_project(project_id, status="planning", plan_json=json.dumps(result))
        result["project_id"] = project_id

        # Bill for planning tokens
        total_tokens = result["tokens_used"]
        if total_tokens > 0:
            cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", total_tokens // 2, total_tokens // 2)
            try:
                await record_usage(email, "deepseek", settings.deepseek_model, total_tokens // 2, total_tokens // 2, cost_usd, cost_fcfa, task_type="plan")
                if cost_fcfa > 0:
                    await deduct_credits(email, cost_fcfa, f"Plan: {body.project_name}", "deepseek", settings.deepseek_model)
            except Exception as e:
                logger.error(f"Plan billing error: {e}")

        return JSONResponse(content=result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Plan project error: {e}", exc_info=True)
        raise HTTPException(500, f"Erreur lors de la planification: {str(e)[:200]}")


@app.post("/api/projects/{project_id}/execute")
async def execute_project(project_id: str, body: ExecuteRequest, user: dict = Depends(get_current_user)):
    """Execute a project plan. Returns SSE stream with agent status updates."""
    email = user["sub"]
    plan = body.plan

    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")

    # Update DB status
    await update_project(project_id, status="generating")

    # Clean up old entries before adding new one
    _cleanup_project_states()

    # Initialize in-memory state
    _project_states[project_id] = {
        "status": "running",
        "agents": [
            {"name": "orchestrator", "status": "done", "progress": 100, "message": "Plan prêt"},
            {"name": "planner", "status": "done", "progress": 100, "message": "Architecture prête"},
            {"name": "coder", "status": "pending", "progress": 0},
            {"name": "tester", "status": "pending", "progress": 0},
            {"name": "executor", "status": "pending", "progress": 0},
        ],
    }

    async def execution_stream():
        state = _project_states[project_id]
        total_tokens = 0

        def update_agent(name: str, s: str, progress: int, message: str = ""):
            for a in state["agents"]:
                if a["name"] == name:
                    a["status"] = s
                    a["progress"] = progress
                    if message:
                        a["message"] = message

        def emit():
            return json.dumps({"agents": state["agents"]}) + "\n"

        try:
            # ── Coder ──
            update_agent("coder", "running", 10, "Génération du code...")
            yield emit()

            coder = CoderAgent(deepseek_client=_deepseek_client)
            architecture = plan.get("architecture", plan)
            coder_result = await coder.execute({
                "architecture": architecture,
                "plan": plan,
                "project_name": plan.get("title", project_id),
            })

            if coder_result.get("status") == "error":
                update_agent("coder", "error", 0, coder_result.get("error", "Erreur"))
                yield emit()
                await update_project(project_id, status="error")
                return

            files = coder_result.get("files", {})
            total_tokens += coder_result.get("tokens_used", 0)
            update_agent("coder", "done", 100, f"{len(files)} fichiers générés")
            yield emit()

            # ── Tester ──
            update_agent("tester", "running", 10, "Analyse qualité...")
            yield emit()

            tester = TesterAgent(deepseek_client=_deepseek_client)
            test_result = await tester.execute({"files": files, "plan": plan})
            total_tokens += test_result.get("tokens_used", 0)

            if test_result.get("status") == "error":
                update_agent("tester", "done", 100, "Test échoué (non bloquant)")
            else:
                report = test_result.get("report", {})
                quality = report.get("code_quality", "?")
                issues = len(report.get("issues", []))
                update_agent("tester", "done", 100, f"Qualité: {quality}/10 — {issues} issues")
            yield emit()

            # ── Executor ──
            update_agent("executor", "running", 10, "Écriture des fichiers...")
            yield emit()

            executor = ExecutorAgent(deepseek_client=_deepseek_client)
            exec_result = await executor.execute({
                "files": files,
                "architecture": architecture,
                "project_name": plan.get("title", project_id),
                "base_dir": body.base_dir or f"./projects/{project_id}",
            })

            if exec_result.get("status") == "error":
                update_agent("executor", "error", 0, exec_result.get("error", "Erreur"))
                await update_project(project_id, status="error")
            else:
                count = exec_result.get("file_count", 0)
                update_agent("executor", "done", 100, f"{count} fichiers écrits")
                await update_project(
                    project_id,
                    status="complete",
                    result_json=json.dumps({"files_created": exec_result.get("files_created", [])}),
                    tokens_used=total_tokens,
                )

            state["status"] = "completed"
            yield emit()

            # Bill for execution
            if total_tokens > 0:
                cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", total_tokens // 2, total_tokens // 2)
                try:
                    await record_usage(email, "deepseek", settings.deepseek_model, total_tokens // 2, total_tokens // 2, cost_usd, cost_fcfa, task_type="project_exec")
                    if cost_fcfa > 0:
                        await deduct_credits(email, cost_fcfa, f"Exec: {project_id}", "deepseek", settings.deepseek_model)
                        await update_project(project_id, cost_fcfa=cost_fcfa)
                except Exception as e:
                    logger.error(f"Exec billing error: {e}")

        except Exception as e:
            logger.error(f"Execute project error: {e}", exc_info=True)
            update_agent("executor", "error", 0, "Erreur lors de la génération.")
            state["status"] = "error"
            await update_project(project_id, status="error")
            yield emit()

    return StreamingResponse(
        execution_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/projects/{project_id}/status")
async def get_project_status(project_id: str, user: dict = Depends(get_current_user)):
    """Get agent status for a project (in-memory state or DB fallback)."""
    state = _project_states.get(project_id)

    if state:
        return JSONResponse(content={"status": state.get("status"), "agents": state.get("agents", [])})

    # Fallback: check DB
    project = await get_project(project_id)
    if project:
        return JSONResponse(content={
            "status": project.get("status", "unknown"),
            "agents": [
                {"name": "orchestrator", "status": "idle", "progress": 0},
                {"name": "planner", "status": "idle", "progress": 0},
                {"name": "coder", "status": "idle", "progress": 0},
                {"name": "tester", "status": "idle", "progress": 0},
                {"name": "executor", "status": "idle", "progress": 0},
            ],
        })

    return JSONResponse(content={"status": "unknown", "agents": []})


@app.post("/api/projects/{project_id}/cancel")
async def cancel_project(project_id: str, user: dict = Depends(get_current_user)):
    """Cancel a running project execution."""
    state = _project_states.get(project_id)
    if state:
        state["status"] = "cancelled"
        for agent in state.get("agents", []):
            if agent["status"] == "running":
                agent["status"] = "cancelled"
                agent["message"] = "Annulé par l'utilisateur"
    await update_project(project_id, status="cancelled")
    return JSONResponse(content={"status": "cancelled"})


# ============================================================================
# PROJECT CRUD
# ============================================================================

@app.get("/api/projects")
async def list_projects(user: dict = Depends(get_current_user), limit: int = 50):
    """List all projects for the current user."""
    projects = await get_user_projects(user["sub"], limit=min(limit, 200))
    return {"projects": projects, "count": len(projects)}


@app.get("/api/projects/{project_id}")
async def get_single_project(project_id: str, user: dict = Depends(get_current_user)):
    """Get a single project by ID."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(404, "Projet non trouvé")
    if project.get("user_email") != user["sub"]:
        raise HTTPException(403, "Accès non autorisé")
    return project


@app.delete("/api/projects/{project_id}")
async def remove_project(project_id: str, user: dict = Depends(get_current_user)):
    """Delete a project."""
    deleted = await delete_project(project_id, user["sub"])
    if not deleted:
        raise HTTPException(404, "Projet non trouvé ou accès non autorisé")
    # Clean in-memory state
    _project_states.pop(project_id, None)
    return {"status": "deleted"}


# ============================================================================
# ADMIN API — Separate auth, full platform management
# ============================================================================

class AdminLoginRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)


class AdminUpdateProfileRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[str] = Field(None, min_length=5, max_length=255)


class AdminChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class AdminUserPatchRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None


class AdminAddCreditsRequest(BaseModel):
    amount: float = Field(..., gt=0, le=10_000_000)
    tx_type: str = Field(default="bonus", max_length=20)  # bonus | refund | recharge
    description: str = Field(..., min_length=3, max_length=500)
    external_ref: str = Field(default="", max_length=255)  # for idempotency / payment ref


async def get_current_admin(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(
        HTTPBearer(auto_error=False)
    ),
) -> dict:
    """FastAPI dependency: verify admin JWT. Returns admin payload with 'admin_id'."""
    if not credentials:
        raise HTTPException(401, "Token admin requis")
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(401, "Token admin invalide ou expiré")
    if not payload.get("is_admin"):
        raise HTTPException(403, "Accès admin requis")
    # Verify admin still exists/active + load flags
    admin_data = await get_admin_by_id(payload.get("admin_id"))
    if not admin_data:
        raise HTTPException(401, "Compte admin introuvable ou désactivé")

    must_change = bool(admin_data.get("must_change_password"))
    payload["must_change_password"] = must_change

    # Force password reset: allow only /me and /change-password while flag is on
    if must_change:
        allowed = {"/api/admin/me", "/api/admin/change-password"}
        if request.url.path not in allowed:
            raise HTTPException(403, "Mot de passe admin à modifier avant de continuer.")

    return payload


def require_admin_role(*allowed_roles: str):
    """Factory for role-based admin guards."""
    async def checker(admin: dict = Depends(get_current_admin)):
        if admin.get("role") not in allowed_roles:
            raise HTTPException(403, f"Rôle requis: {', '.join(allowed_roles)}")
        return admin
    return checker


# ── Admin Audit Logger ──
_audit_logger = logging.getLogger("anzar.audit")


def audit_log(admin_email: str, action: str, target: str = "", details: str = ""):
    """Log an admin action for audit trail."""
    _audit_logger.info(
        f"ADMIN_AUDIT | admin={admin_email} | action={action} | target={target} | {details}"
    )


# ── Admin Auth ──

@app.post("/api/admin/login")
async def admin_login(body: AdminLoginRequest, request: Request):
    """Login as admin. Returns JWT with is_admin=True."""
    rate_limiter.check_auth(get_client_ip(request))
    email = body.email.strip().lower()
    admin = await get_admin_by_email(email)
    if not admin:
        raise HTTPException(401, "Identifiants admin incorrects")

    if not verify_password(body.password, admin["password_hash"], admin["salt"]):
        audit_log(email, "login_failed", email, "wrong password")
        raise HTTPException(401, "Identifiants admin incorrects")

    await update_admin_last_login(email)
    audit_log(email, "login_success", email)

    admin_token = create_token(
        user_id=email,
        expires_in=settings.admin_jwt_expiry_hours * 3600,
        extra_claims={
            "is_admin": True,
            "admin_id": admin["id"],
            "role": admin["role"],
            "must_change_password": bool(admin.get("must_change_password")),
        },
    )

    return {
        "token": admin_token,
        "user": {
            "email": email,
            "name": admin.get("name", "Admin"),
            "role": admin["role"],
            "admin_id": admin["id"],
            "must_change_password": bool(admin.get("must_change_password")),
        },
    }


@app.get("/api/admin/me")
async def admin_me(admin: dict = Depends(get_current_admin)):
    """Get current admin profile."""
    admin_data = await get_admin_by_id(admin["admin_id"])
    if not admin_data:
        raise HTTPException(404, "Admin introuvable")
    return {
        "id": admin_data["id"],
        "email": admin_data["email"],
        "name": admin_data["name"],
        "role": admin_data["role"],
        "created_at": admin_data["created_at"],
        "last_login": admin_data["last_login"],
        "must_change_password": bool(admin_data.get("must_change_password")),
    }


@app.patch("/api/admin/me")
async def admin_update_me(body: AdminUpdateProfileRequest, admin: dict = Depends(get_current_admin)):
    """Update current admin profile (name, email)."""
    updates = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.email is not None:
        updates["email"] = body.email.strip().lower()
    if updates:
        await update_admin_profile(admin["admin_id"], **updates)
        audit_log(admin["sub"], "update_profile", str(admin["admin_id"]), str(updates))
    admin_data = await get_admin_by_id(admin["admin_id"])
    return {
        "id": admin_data["id"],
        "email": admin_data["email"],
        "name": admin_data["name"],
        "role": admin_data["role"],
    }


@app.post("/api/admin/change-password")
async def admin_change_pwd(body: AdminChangePasswordRequest, admin: dict = Depends(get_current_admin)):
    """Change admin password."""
    admin_data = await get_admin_by_id(admin["admin_id"])
    if not admin_data:
        raise HTTPException(404, "Admin introuvable")
    if not verify_password(body.current_password, admin_data["password_hash"], admin_data["salt"]):
        raise HTTPException(401, "Mot de passe actuel incorrect")
    await change_admin_password(admin["admin_id"], body.new_password)
    audit_log(admin["sub"], "change_password", str(admin["admin_id"]))
    return {"status": "ok", "message": "Mot de passe modifié"}


# ── Admin: Dashboard stats ──

@app.get("/api/admin/stats")
async def admin_stats(admin: dict = Depends(get_current_admin)):
    """Get global platform statistics for admin dashboard."""
    return await admin_get_global_stats()


# ── Admin: Users management ──

@app.get("/api/admin/users")
async def admin_users_list(
    search: str = "",
    status: str = "all",
    limit: int = 50,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """List all users with credits and project count."""
    return await admin_list_all_users(search=search, status=status, limit=min(limit, 200), offset=offset)


@app.get("/api/admin/users/{user_email}")
async def admin_user_detail(user_email: str, admin: dict = Depends(get_current_admin)):
    """Get full user detail."""
    user = await admin_get_user_detail(user_email)
    if not user:
        raise HTTPException(404, "Utilisateur non trouvé")
    # Remove sensitive fields
    user.pop("password_hash", None)
    user.pop("salt", None)
    return user


@app.patch("/api/admin/users/{user_email}")
async def admin_user_update(
    user_email: str,
    body: AdminUserPatchRequest,
    admin: dict = Depends(require_admin_role("owner", "admin")),
):
    """Update user (name, active status). Owner/admin only."""
    updates = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if not updates:
        raise HTTPException(400, "Rien à modifier")
    await admin_update_user(user_email, **updates)
    audit_log(admin["sub"], "update_user", user_email, str(updates))
    return {"status": "ok"}


@app.post("/api/admin/users/{user_email}/credits")
async def admin_grant_credits(
    user_email: str,
    body: AdminAddCreditsRequest,
    admin: dict = Depends(require_admin_role("owner", "admin")),
):
    """Grant credits to a user. Owner/admin only."""
    tx_type = (body.tx_type or "bonus").strip().lower()
    if tx_type not in ("bonus", "refund", "recharge"):
        raise HTTPException(400, "tx_type invalide (bonus|refund|recharge)")

    result = await admin_add_credits_to_user(
        user_email,
        body.amount,
        body.description.strip(),
        tx_type=tx_type,
        external_ref=body.external_ref.strip(),
    )
    audit_log(
        admin["sub"],
        "grant_credits",
        user_email,
        f"amount={body.amount} type={tx_type} ref={body.external_ref} desc={body.description}",
    )
    return {"status": "ok", "credits": result}


# ── Admin: Projects management ──

@app.get("/api/admin/projects")
async def admin_projects_list(
    search: str = "",
    status: str = "all",
    limit: int = 50,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """List all projects from all users."""
    return await admin_list_all_projects(search=search, status=status, limit=min(limit, 200), offset=offset)


@app.get("/api/admin/projects/{project_id}")
async def admin_project_detail(project_id: str, admin: dict = Depends(get_current_admin)):
    """Get project detail (any user)."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(404, "Projet non trouvé")
    return project


@app.delete("/api/admin/projects/{project_id}")
async def admin_delete_project(
    project_id: str,
    admin: dict = Depends(require_admin_role("owner", "admin")),
):
    """Delete any project. Owner/admin only."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(404, "Projet non trouvé")
    deleted = await admin_delete_project_any(project_id)
    if not deleted:
        raise HTTPException(500, "Suppression impossible")
    _project_states.pop(project_id, None)
    audit_log(admin["sub"], "delete_project", project_id)
    return {"status": "deleted"}


# ── Admin: Transactions & Usage ──

@app.get("/api/admin/transactions")
async def admin_transactions(
    limit: int = 100,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """Get all platform transactions."""
    return {"transactions": await admin_get_all_transactions(limit=min(limit, 500), offset=offset)}


@app.get("/api/admin/usage")
async def admin_usage(
    limit: int = 100,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """Get all platform usage records."""
    return {"usage": await admin_get_all_usage(limit=min(limit, 500), offset=offset)}


# ── Admin: Payments (préparation) ──

@app.get("/api/admin/payments")
async def admin_payments_list(
    status: str = "pending",
    limit: int = 50,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """Lister les demandes de paiement (payment_intents)."""
    return await admin_list_payment_intents(status=status, limit=min(limit, 200), offset=offset)


class AdminMarkPaymentPaidRequest(BaseModel):
    provider_ref: str = Field(default="", max_length=255)
    description: str = Field(..., min_length=3, max_length=500)


@app.post("/api/admin/payments/{intent_id}/mark-paid")
async def admin_payment_mark_paid(
    intent_id: str,
    body: AdminMarkPaymentPaidRequest,
    admin: dict = Depends(require_admin_role("owner", "admin")),
):
    """Valider manuellement un paiement + créditer le compte."""
    try:
        intent = await admin_mark_payment_intent_paid(
            intent_id=intent_id,
            admin_email=admin["sub"],
            provider_ref=body.provider_ref,
            description=body.description,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    audit_log(admin["sub"], "mark_payment_paid", intent_id, f"ref={body.provider_ref} desc={body.description}")
    return {"status": "ok", "payment_intent": intent}


# ── Admin: Manage admin accounts ──

@app.get("/api/admin/admins")
async def admin_list_all(admin: dict = Depends(require_admin_role("owner"))):
    """List all admin accounts. Owner only."""
    return {"admins": await list_admins()}


# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"message": exc.detail}},
    )


@app.exception_handler(Exception)
async def general_error(request: Request, exc: Exception):
    logger.error(f"Unhandled: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": {"message": "Internal server error"}},
    )


# ============================================================================
# RUN
# ============================================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.server_host,
        port=settings.effective_port,
        reload=settings.debug,
        log_level=settings.log_level,
    )
