"""
services/payments/fedapay.py — FedaPay (mobile money + cartes, Afrique de l'Ouest).

API : POST /v1/transactions → POST /v1/transactions/{id}/token (lien de paiement) ;
GET /v1/transactions/{id} pour le statut. Webhook signé X-FEDAPAY-SIGNATURE « t=…,s=… ».
Les réponses sont enveloppées : {"v1/transaction": {...}}.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Mapping, Optional

import httpx

from config import settings
from services.payments.base import (
    Checkout, PaymentError, PaymentProvider, ProviderInfo, Quote, RefundEvent, RemoteStatus,
    SignatureError, header_get, verify_timestamped_signature,
)

logger = logging.getLogger("anzar.payments.fedapay")

PAID = {"approved", "transferred"}
REFUNDED = {"refunded", "approved_partially_refunded", "transferred_partially_refunded"}
FAILED = {"declined"}
CANCELLED = {"canceled", "cancelled", "expired"}


def _unwrap(data: Any, key: str = "transaction") -> dict:
    if isinstance(data, dict):
        for k in (f"v1/{key}", key):
            if isinstance(data.get(k), dict):
                return data[k]
        return data
    return {}


class FedaPayProvider(PaymentProvider):
    info = ProviderInfo(
        id="fedapay",
        label="Mobile money",
        kind="mobile_money",
        description="Airtel, Moov, MTN, Orange, Wave… via FedaPay",
        countries=["NE", "BJ", "CI", "SN", "TG", "ML", "GN"],
    )

    def __init__(self, client: Optional[httpx.AsyncClient] = None):
        self._client = client

    @property
    def base_url(self) -> str:
        live = (settings.fedapay_environment or "").strip().lower() == "live"
        return "https://api.fedapay.com/v1" if live else "https://sandbox-api.fedapay.com/v1"

    def enabled(self) -> bool:
        return bool(settings.fedapay_secret_key.strip())

    def webhooks_enabled(self) -> bool:
        return bool(settings.fedapay_webhook_secret.strip())

    def quote(self, amount_fcfa: float) -> Quote:
        return Quote(amount=float(int(round(amount_fcfa))), currency="xof")

    async def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        headers = {"Authorization": f"Bearer {settings.fedapay_secret_key.strip()}",
                   "Content-Type": "application/json", "Accept": "application/json"}
        client = self._client or httpx.AsyncClient(timeout=20)
        try:
            r = await client.request(method, self.base_url + path, headers=headers,
                                     content=json.dumps(body) if body is not None else None)
        except httpx.HTTPError as e:
            logger.warning("FedaPay injoignable: %s", e)
            raise PaymentError("FedaPay est injoignable pour le moment. Réessaie dans un instant.")
        finally:
            if self._client is None:
                await client.aclose()
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code >= 400:
            msg = (data.get("message") if isinstance(data, dict) else "") or r.text[:200]
            logger.warning("FedaPay %s %s → %s %s", method, path, r.status_code, msg)
            raise PaymentError(f"FedaPay a refusé la demande : {msg}")
        return data

    async def create_checkout(self, *, intent_id, amount_fcfa, quote, customer_email,
                              return_url, cancel_url) -> Checkout:
        tx = _unwrap(await self._request("POST", "/transactions", {
            "description": f"Crédits ANZAR — {int(quote.amount)} FCFA",
            "amount": int(quote.amount),
            "currency": {"iso": "XOF"},
            "callback_url": return_url,
            "customer": {"email": customer_email},
            "custom_metadata": {"intent_id": intent_id},
        }))
        tx_id = str(tx.get("id") or "")
        if not tx_id:
            raise PaymentError("Réponse FedaPay inattendue (transaction sans identifiant)")
        tok = _unwrap(await self._request("POST", f"/transactions/{tx_id}/token"), "token")
        url = str(tok.get("url") or "")
        if not url.startswith("https://"):
            raise PaymentError("Réponse FedaPay inattendue (lien de paiement absent)")
        return Checkout(tx_id=tx_id, payment_url=url)

    async def fetch_status(self, tx_id: str) -> RemoteStatus:
        tx = _unwrap(await self._request("GET", f"/transactions/{tx_id}"))
        raw = str(tx.get("status") or "").lower()
        state = ("paid" if raw in PAID else "refunded" if raw in REFUNDED
                 else "failed" if raw in FAILED else "cancelled" if raw in CANCELLED else "pending")
        return RemoteStatus(state=state, amount=float(tx.get("amount") or 0), currency="", raw_status=raw)

    def webhook_refund_event(self, raw: bytes, headers: Mapping[str, str]) -> Optional[RefundEvent]:
        verify_timestamped_signature(header_get(headers, "x-fedapay-signature"), raw,
                                     settings.fedapay_webhook_secret.strip(), scheme="s")
        try:
            event = json.loads(raw)
        except ValueError:
            raise SignatureError("corps JSON invalide")
        name = str(event.get("name") or "")
        if not name.startswith("transaction."):
            return None
        entity = event.get("entity") or event.get("object") or {}
        if not isinstance(entity, dict):
            return None
        raw_status = str(entity.get("status") or "").lower()
        if raw_status not in REFUNDED:
            return None
        return RefundEvent(
            tx_id=str(entity.get("id") or ""),
            amount=float(entity.get("amount") or 0),
            currency="xof",
            state="refunded",
            raw_status=raw_status,
        )

    def webhook_tx_id(self, raw: bytes, headers: Mapping[str, str]) -> Optional[str]:
        verify_timestamped_signature(header_get(headers, "x-fedapay-signature"), raw,
                                     settings.fedapay_webhook_secret.strip(), scheme="s")
        try:
            event = json.loads(raw)
        except ValueError:
            raise SignatureError("corps JSON invalide")
        name = str(event.get("name") or "")
        if not name.startswith("transaction."):
            return None
        entity = event.get("entity") or event.get("object") or {}
        tx_id = (entity or {}).get("id") if isinstance(entity, dict) else None
        return str(tx_id) if tx_id else None
