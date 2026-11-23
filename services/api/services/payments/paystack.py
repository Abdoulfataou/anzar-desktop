"""
services/payments/paystack.py — Paystack (NGN, GHS, ZAR, KES, XOF…).

API : POST /transaction/initialize → lien ; GET /transaction/verify/{reference} pour le statut.
Webhook : x-paystack-signature = HMAC-SHA512 (hex) du corps brut, avec la clé secrète.
Montants en sous-unités (×100), y compris pour XOF : voir capabilities.json.
Désactivé tant que PAYSTACK_SECRET_KEY est vide.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import Any, Mapping, Optional

import httpx

from config import settings
from services.currency.money import from_minor
from services.payments.base import (
    Checkout, PaymentError, PaymentProvider, ProviderInfo, RefundEvent, RemoteStatus,
    SignatureError, declared, header_get, iso_decimals,
)

logger = logging.getLogger("anzar.payments.paystack")

API = "https://api.paystack.co"
PAID = {"success"}
FAILED = {"failed"}
CANCELLED = {"abandoned"}
REFUNDED = {"reversed"}
_CAP = declared("paystack")


def reference(intent_id: str) -> str:
    return f"anzar_{intent_id}"


class PaystackProvider(PaymentProvider):
    info = ProviderInfo(
        id="paystack",
        label="Paystack",
        kind="mobile_money",
        description="Carte, virement, USSD, mobile money… (Nigeria, Ghana, Kenya, Afrique du Sud)",
        countries=list(_CAP.get("countries", [])),
        currencies=list(_CAP.get("currencies", [])),
        priority=int(_CAP.get("priority", 20)),
    )

    def __init__(self, client: Optional[httpx.AsyncClient] = None):
        self._client = client

    def _key(self) -> str:
        return (settings.paystack_secret_key or "").strip()

    def enabled(self) -> bool:
        return bool(self._key())

    def webhooks_enabled(self) -> bool:
        return self.enabled()   # Paystack signe avec la clé secrète elle-même

    async def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        headers = {"Authorization": f"Bearer {self._key()}", "Content-Type": "application/json"}
        client = self._client or httpx.AsyncClient(timeout=20)
        try:
            r = await client.request(method, API + path, headers=headers,
                                     content=json.dumps(body) if body is not None else None)
        except httpx.HTTPError as e:
            logger.warning("Paystack injoignable: %s", e)
            raise PaymentError("Paystack est injoignable pour le moment. Réessaie dans un instant.")
        finally:
            if self._client is None:
                await client.aclose()
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code >= 400 or not (isinstance(data, dict) and data.get("status") is True):
            msg = (data.get("message") if isinstance(data, dict) else "") or r.text[:200]
            logger.warning("Paystack %s %s → %s %s", method, path, r.status_code, msg)
            raise PaymentError(f"Paystack a refusé la demande : {msg}")
        return data.get("data") or {}

    async def create_checkout(self, *, intent_id, amount_fcfa, quote, customer_email,
                              return_url, cancel_url) -> Checkout:
        if quote.amount_minor is None:
            raise PaymentError("Montant non calculé par le serveur")
        cur = quote.currency.upper()
        ref = reference(intent_id)
        data = await self._request("POST", "/transaction/initialize", {
            "email": customer_email,
            "amount": str(self.to_provider_amount(quote.amount_minor, cur)),
            "currency": cur,
            "reference": ref,
            "callback_url": return_url,
            "metadata": {"intent_id": intent_id, "cancel_action": cancel_url,
                         "custom_fields": [{"display_name": "Crédits ANZAR", "variable_name": "credits",
                                            "value": str(int(amount_fcfa))}]},
        })
        url = str(data.get("authorization_url") or "")
        if not url.startswith("https://"):
            raise PaymentError("Réponse Paystack inattendue (lien de paiement absent)")
        return Checkout(tx_id=str(data.get("reference") or ref), payment_url=url)

    async def fetch_status(self, tx_id: str) -> RemoteStatus:
        data = await self._request("GET", f"/transaction/verify/{tx_id}")
        raw = str(data.get("status") or "").lower()
        state = ("paid" if raw in PAID else "failed" if raw in FAILED else "cancelled" if raw in CANCELLED
                 else "refunded" if raw in REFUNDED else "pending")
        cur = str(data.get("currency") or "").upper()
        minor = self.from_provider_amount(int(data.get("amount") or 0), cur) if cur else 0
        return RemoteStatus(state=state, amount=float(from_minor(minor, iso_decimals(cur))) if cur else 0.0,
                            currency=cur.lower(), raw_status=raw, amount_minor=minor,
                            provider_payment_id=str(data.get("id") or ""))

    def _verified(self, raw: bytes, headers: Mapping[str, str]) -> dict:
        sig = header_get(headers, "x-paystack-signature").strip()
        if not self._key():
            raise SignatureError("clé Paystack non configurée")
        if not sig:
            raise SignatureError("en-tête de signature absent")
        expected = hmac.new(self._key().encode(), raw, hashlib.sha512).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise SignatureError("signature invalide")
        try:
            event = json.loads(raw)
        except ValueError:
            raise SignatureError("corps JSON invalide")
        return event if isinstance(event, dict) else {}

    def webhook_tx_id(self, raw: bytes, headers: Mapping[str, str]) -> Optional[str]:
        event = self._verified(raw, headers)
        if str(event.get("event") or "") != "charge.success":
            return None
        ref = (event.get("data") or {}).get("reference")
        return str(ref) if ref else None

    def webhook_refund_event(self, raw: bytes, headers: Mapping[str, str]) -> Optional[RefundEvent]:
        event = self._verified(raw, headers)
        name = str(event.get("event") or "")
        if name not in ("refund.processed", "charge.dispute.create"):
            return None
        data = event.get("data") or {}
        tx = data.get("transaction") or {}
        ref = str(data.get("transaction_reference") or (tx.get("reference") if isinstance(tx, dict) else "") or "")
        cur = str(data.get("currency") or "").upper()
        amount = 0.0
        if cur and data.get("amount") is not None:
            amount = float(from_minor(self.from_provider_amount(int(data["amount"]), cur), iso_decimals(cur)))
        intent_id = ref[len("anzar_"):] if ref.startswith("anzar_") else ""
        return RefundEvent(intent_id=intent_id, tx_id=ref, amount=amount, currency=cur.lower(),
                           state="refunded" if name == "refund.processed" else "disputed", raw_status=name)
