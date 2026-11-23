"""
services/payments/flutterwave.py — Flutterwave v3 (NGN, GHS, KES, UGX, TZS, RWF, XAF, XOF…).

API : POST /payments → lien hébergé ; GET /transactions/verify_by_reference?tx_ref=… pour le statut.
Webhook : en-tête « verif-hash » égal au secret saisi dans le tableau de bord Flutterwave
(FLUTTERWAVE_WEBHOOK_HASH). Montants en unités entières (« major »), voir capabilities.json.
Désactivé tant que FLUTTERWAVE_SECRET_KEY est vide.
"""
from __future__ import annotations

import hmac
import json
import logging
from typing import Any, Mapping, Optional

import httpx

from config import settings
from services.currency.money import from_minor
from services.payments.base import (
    Checkout, PaymentError, PaymentProvider, ProviderInfo, RemoteStatus, SignatureError,
    declared, header_get, iso_decimals,
)

logger = logging.getLogger("anzar.payments.flutterwave")

API = "https://api.flutterwave.com/v3"
PAID = {"successful"}
FAILED = {"failed"}
CANCELLED = {"cancelled"}
_CAP = declared("flutterwave")


def reference(intent_id: str) -> str:
    return f"anzar_{intent_id}"


class FlutterwaveProvider(PaymentProvider):
    info = ProviderInfo(
        id="flutterwave",
        label="Flutterwave",
        kind="mobile_money",
        description="Mobile money, carte, virement… (Afrique de l'Est, de l'Ouest et centrale)",
        countries=list(_CAP.get("countries", [])),
        currencies=list(_CAP.get("currencies", [])),
        priority=int(_CAP.get("priority", 30)),
    )

    def __init__(self, client: Optional[httpx.AsyncClient] = None):
        self._client = client

    def _key(self) -> str:
        return (settings.flutterwave_secret_key or "").strip()

    def enabled(self) -> bool:
        return bool(self._key())

    def webhooks_enabled(self) -> bool:
        return bool((settings.flutterwave_webhook_hash or "").strip())

    async def _request(self, method: str, path: str, body: Optional[dict] = None,
                       params: Optional[dict] = None) -> Any:
        headers = {"Authorization": f"Bearer {self._key()}", "Content-Type": "application/json"}
        client = self._client or httpx.AsyncClient(timeout=20)
        try:
            r = await client.request(method, API + path, headers=headers, params=params,
                                     content=json.dumps(body) if body is not None else None)
        except httpx.HTTPError as e:
            logger.warning("Flutterwave injoignable: %s", e)
            raise PaymentError("Flutterwave est injoignable pour le moment. Réessaie dans un instant.")
        finally:
            if self._client is None:
                await client.aclose()
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code >= 400 or not (isinstance(data, dict) and data.get("status") == "success"):
            msg = (data.get("message") if isinstance(data, dict) else "") or r.text[:200]
            logger.warning("Flutterwave %s %s → %s %s", method, path, r.status_code, msg)
            raise PaymentError(f"Flutterwave a refusé la demande : {msg}")
        return data.get("data") or {}

    async def create_checkout(self, *, intent_id, amount_fcfa, quote, customer_email,
                              return_url, cancel_url) -> Checkout:
        if quote.amount_minor is None:
            raise PaymentError("Montant non calculé par le serveur")
        cur = quote.currency.upper()
        ref = reference(intent_id)
        data = await self._request("POST", "/payments", {
            "tx_ref": ref,
            "amount": self.to_provider_amount(quote.amount_minor, cur),
            "currency": cur,
            "redirect_url": return_url,
            "customer": {"email": customer_email},
            "customizations": {"title": "ANZAR",
                               "description": f"{int(amount_fcfa):,} crédits".replace(",", " ")},
            "meta": {"intent_id": intent_id},
        })
        url = str(data.get("link") or "")
        if not url.startswith("https://"):
            raise PaymentError("Réponse Flutterwave inattendue (lien de paiement absent)")
        return Checkout(tx_id=ref, payment_url=url)

    async def fetch_status(self, tx_id: str) -> RemoteStatus:
        data = await self._request("GET", "/transactions/verify_by_reference", params={"tx_ref": tx_id})
        raw = str(data.get("status") or "").lower()
        state = "paid" if raw in PAID else "failed" if raw in FAILED else "cancelled" if raw in CANCELLED else "pending"
        cur = str(data.get("currency") or "").upper()
        minor = self.from_provider_amount(data.get("amount") or 0, cur) if cur else 0
        return RemoteStatus(state=state, amount=float(from_minor(minor, iso_decimals(cur))) if cur else 0.0,
                            currency=cur.lower(), raw_status=raw, amount_minor=minor,
                            provider_payment_id=str(data.get("id") or ""))

    def webhook_tx_id(self, raw: bytes, headers: Mapping[str, str]) -> Optional[str]:
        secret = (settings.flutterwave_webhook_hash or "").strip()
        if not secret:
            raise SignatureError("secret de webhook non configuré")
        got = header_get(headers, "verif-hash").strip()
        if not got:
            raise SignatureError("en-tête de signature absent")
        if not hmac.compare_digest(secret, got):
            raise SignatureError("signature invalide")
        try:
            event = json.loads(raw)
        except ValueError:
            raise SignatureError("corps JSON invalide")
        if not isinstance(event, dict) or str(event.get("event") or "") != "charge.completed":
            return None
        ref = (event.get("data") or {}).get("tx_ref")
        return str(ref) if ref else None
