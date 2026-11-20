"""
ANZAR Backend — Secure AI Proxy + Multi-Agent Pipeline + Prepaid Credits
Production-ready for Railway deployment.

All AI API keys NEVER leave the server.
Credits are managed server-side (source of truth).
"""
import logging
import time
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from security import rate_limiter, get_client_ip, validate_config
from db import (
    init_db, create_default_admin,
    cleanup_rate_limits, cleanup_expired_otps, cleanup_revoked_tokens,
)
from routes import include_routers

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
        while not stop_event.is_set():
            try:
                await cleanup_expired_otps()
                await cleanup_rate_limits(max_age_seconds=86400)
                await cleanup_revoked_tokens()
            except Exception as e:
                logger.warning(f"Housekeeping error: {e}")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=15 * 60)
            except asyncio.TimeoutError:
                pass

    async def _payments_loop():
        # Rattrapage des paiements dont le webhook n'est pas arrivé (toutes les 5 minutes)
        from services.payments import reconcile_pending
        while not stop_event.is_set():
            try:
                await reconcile_pending()
            except Exception as e:
                logger.warning(f"Payments reconcile error: {e}")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=5 * 60)
            except asyncio.TimeoutError:
                pass

    housekeeping_task = asyncio.create_task(_housekeeping_loop())
    payments_task = asyncio.create_task(_payments_loop())
    logger.info(f"ANZAR Backend v{settings.app_version} started on port {settings.effective_port}")
    yield
    stop_event.set()
    housekeeping_task.cancel()
    payments_task.cancel()
    try:
        await housekeeping_task
        await payments_task
    except (asyncio.CancelledError, Exception):
        # CancelledError hérite de BaseException (py>=3.8) : il faut l'attraper
        # explicitement, sinon il remonte dans le shutdown de l'app.
        pass
    logger.info("ANZAR Backend stopped")


app = FastAPI(
    title="ANZAR Backend",
    description="Secure AI proxy + multi-agent vibecoding pipeline",
    version=settings.app_version,
    docs_url="/docs" if settings.debug else None,
    redoc_url=None,
    # En production, la liste des routes n'est pas publiée (moins d'indices pour un attaquant)
    openapi_url="/openapi.json" if settings.debug else None,
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
# MIDDLEWARE
# ============================================================================

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    """Rate limiting + request logging + security headers."""
    client_ip = get_client_ip(request)

    if request.url.path.startswith("/api/"):
        try:
            await rate_limiter.check_http(request)
        except HTTPException as exc:
            # Une exception levée dans un middleware contourne les handlers
            # FastAPI : on renvoie explicitement le 429.
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail},
                                headers=exc.headers)

    start = time.time()
    response = await call_next(request)
    elapsed = time.time() - start

    if request.url.path != "/health":
        logger.info(f"{request.method} {request.url.path} → {response.status_code} ({elapsed:.2f}s) [{client_ip}]")

    response.headers["X-Process-Time"] = f"{elapsed:.3f}"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    # Une page peut fixer sa propre politique (page de retour après paiement)
    if "content-security-policy" not in response.headers:
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
    checks = {"database": "ok", "deepseek": "configured"}

    try:
        from db import db_ping
        await db_ping()
    except Exception as e:
        checks["database"] = "error"
        logger.error("Health check DB failure: %s", e)

    if not settings.deepseek_api_key:
        checks["deepseek"] = "not_configured"

    all_ok = checks["database"] == "ok"
    return {
        "status": "healthy" if all_ok else "degraded",
        "timestamp": time.time(),
        "version": settings.app_version,
        "checks": checks,
    }


# ============================================================================
# INCLUDE ALL ROUTERS
# ============================================================================

include_routers(app)


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
