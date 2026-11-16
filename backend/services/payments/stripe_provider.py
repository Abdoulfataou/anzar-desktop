"""
services/payments/stripe_provider.py — Stripe Checkout (cartes du monde entier).

Appels REST directs (pas de SDK) : POST /v1/checkout/sessions, GET /v1/checkout/sessions/{id}.
Webhook signé Stripe-Signature « t=…,v1=… ».
"""
from __future__ import annotations

import json
import logging
import math
from typing import Any, Mapping, Optional

import httpx

from config import settings
from services.payments.base import (
    Checkout, PaymentError, PaymentProvider, ProviderInfo, Quote, RemoteStatus,
    SignatureError, header_get, verify_timestamped_signature,
)

logger = logging.getLogger("anzar.payments.stripe")

API = "https://api.stripe.com/v1"
ZERO_DECIMAL = {"xof", "xaf", "jpy", "krw", "gnf", "rwf", "ugx", "vnd", "clp", "djf", "kmf", "mga", "pyg", "vuv"}
EVENTS = {"checkout.session.completed", "checkout.session.async_payment_succeeded",
          "checkout.session.async_payment_failed", "checkout.session.expired"}


def _currency() -> str:
    return (settings.stripe_currency or "usd").strip().lower()


def to_minor(amount: float, currency: str) -> int:
    return int(round(amount)) if currency in ZERO_DECIMAL else int(round(amount * 100))


def from_minor(minor: int, currency: str) -> float:
    return float(minor) if currency in ZERO_DECIMAL else minor / 100.0


class StripeProvider(PaymentProvider):
    info = ProviderInfo(
        id="stripe",
        label="Carte bancaire",
        kind="card",
        description="Visa, Mastercard, Apple Pay… partout dans le monde, via Stripe",
        countries=["*"],
    )

    def __init__(self, client: Optional[httpx.AsyncClient] = None):
        self._client = client

    def enabled(self) -> bool:
        return bool(settings.stripe_secret_key.strip())

    def webhooks_enabled(self) -> bool:
        return bool(settings.stripe_webhook_secret.strip())

    def fcfa_per_unit(self) -> float:
        return settings.effective_stripe_rate

    def quote(self, amount_fcfa: float) -> Quote:
        cur = _currency()
        value = float(amount_fcfa) / settings.effective_stripe_rate
        if cur in ZERO_DECIMAL:
            value = float(math.ceil(value))
        else:
            value = math.ceil(value * 100) / 100.0   # arrondi au centime supérieur
        return Quote(amount=value, currency=cur)

    async def _request(self, method: str, path: str, form: Optional[dict] = None,
                       idempotency_key: str = "") -> Any:
        headers = {"Authorization": f"Bearer {settings.stripe_secret_key.strip()}"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        client = self._client or httpx.AsyncClient(timeout=20)
        try:
            r = await client.request(method, API + path, headers=headers, data=form)
        except httpx.HTTPError as e:
            logger.warning("Stripe injoignable: %s", e)
            raise PaymentError("Stripe est injoignable pour le moment. Réessaie dans un instant.")
        finally:
            if self._client is None:
                await client.aclose()
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code >= 400:
            msg = ((data.get("error") or {}).get("message") if isinstance(data, dict) else "") or r.text[:200]
            logger.warning("Stripe %s %s → %s %s", method, path, r.status_code, msg)
            raise PaymentError(f"Stripe a refusé la demande : {msg}")
        return data

    async def create_checkout(self, *, intent_id, amount_fcfa, quote, customer_email,
                              return_url, cancel_url) -> Checkout:
        if quote.currency not in ZERO_DECIMAL and quote.amount < 0.5:
            raise PaymentError("Montant trop faible pour un paiement par carte")
        form = {
            "mode": "payment",
            "success_url": return_url,
            "cancel_url": cancel_url,
            "client_reference_id": intent_id,
            "customer_email": customer_email,
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": quote.currency,
            "line_items[0][price_data][unit_amount]": str(to_minor(quote.amount, quote.currency)),
            "line_items[0][price_data][product_data][name]": f"Crédits ANZAR — {int(amount_fcfa)} FCFA",
            "metadata[intent_id]": intent_id,
            "payment_intent_data[metadata][intent_id]": intent_id,
        }
        s = await self._request("POST", "/checkout/sessions", form, idempotency_key=f"anzar-{intent_id}")
        tx_id, url = str(s.get("id") or ""), str(s.get("url") or "")
        if not tx_id or not url.startswith("https://"):
            raise PaymentError("Réponse Stripe inattendue (session sans lien)")
        return Checkout(tx_id=tx_id, payment_url=url)

    async def fetch_status(self, tx_id: str) -> RemoteStatus:
        s = await self._request("GET", f"/checkout/sessions/{tx_id}")
        cur = str(s.get("currency") or "").lower()
        status, pay = str(s.get("status") or ""), str(s.get("payment_status") or "")
        if pay == "paid":
            state = "paid"
        elif status == "expired":
            state = "cancelled"
        else:
            state = "pending"
        return RemoteStatus(state=state, amount=from_minor(int(s.get("amount_total") or 0), cur),
                            currency=cur, raw_status=f"{status}/{pay}")

    def webhook_tx_id(self, raw: bytes, headers: Mapping[str, str]) -> Optional[str]:
        verify_timestamped_signature(header_get(headers, "stripe-signature"), raw,
                                     settings.stripe_webhook_secret.strip(), scheme="v1")
        try:
            event = json.loads(raw)
        except ValueError:
            raise SignatureError("corps JSON invalide")
        if event.get("type") not in EVENTS:
            return None
        obj = ((event.get("data") or {}).get("object")) or {}
        return str(obj.get("id")) if obj.get("id") else None
