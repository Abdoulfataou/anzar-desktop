"""
Shared mutable state and provider helpers used across route modules.
Imported by chat.py, web_tools.py, admin.py, etc.
"""
import logging
import time
from typing import Dict

from fastapi import HTTPException

from config import settings

logger = logging.getLogger("anzar")

# ============================================================================
# PROVIDER CONFIG
# ============================================================================

PROVIDERS: Dict[str, Dict[str, str]] = {
    "deepseek": {
        "base_url": settings.deepseek_base_url,
        "api_key": settings.deepseek_api_key,
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
