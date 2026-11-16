"""Paiements automatiques : couche multi-fournisseurs (voir base.py et service.py)."""
from services.payments.service import (  # noqa: F401
    PROVIDERS, get_provider, list_methods, start_payment, refresh_intent, get_user_intent,
    handle_webhook, reconcile_pending,
)
