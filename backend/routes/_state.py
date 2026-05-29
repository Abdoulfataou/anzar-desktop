"""
Shared mutable state and provider helpers used across route modules.
Imported by chat.py, projects.py, admin.py, etc.
"""
import logging
import time
from typing import Dict, Any

from fastapi import HTTPException

from config import settings
from services.deepseek_client import DeepSeekClient

logger = logging.getLogger("anzar")

# ============================================================================
# PROVIDER CONFIG
# ============================================================================

PROVIDERS: Dict[str, Dict[str, str]] = {
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
# PROJECT STATES (in-memory, per-process)
# ============================================================================

_project_states: Dict[str, Dict[str, Any]] = {}
_MAX_PROJECT_STATES = 200


def _cleanup_project_states():
    """Remove completed/errored project states when dict grows too large."""
    if len(_project_states) <= _MAX_PROJECT_STATES:
        return
    removable = [
        pid for pid, state in _project_states.items()
        if state.get("status") in ("completed", "error", "cancelled")
    ]
    for pid in removable:
        del _project_states[pid]
        if len(_project_states) <= _MAX_PROJECT_STATES // 2:
            break
    if len(_project_states) > _MAX_PROJECT_STATES:
        to_remove = list(_project_states.keys())[:len(_project_states) - _MAX_PROJECT_STATES // 2]
        for pid in to_remove:
            del _project_states[pid]


# ============================================================================
# SHARED DEEPSEEK CLIENT
# ============================================================================

_deepseek_client = DeepSeekClient()
