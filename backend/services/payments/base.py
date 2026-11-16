"""
services/payments/base.py — Contrat commun des fournisseurs de paiement.

Chaque fournisseur (FedaPay, Stripe, puis iPay Money, Flutterwave…) implémente :
  - quote()            : combien facturer, et dans quelle devise, pour N FCFA de crédits ;
  - create_checkout()  : crée le paiement chez lui et renvoie le lien de paiement ;
  - fetch_status()     : relit le statut CHEZ LUI (source de vérité, jamais le corps du webhook) ;
  - webhook_tx_id()    : vérifie la signature d'un webhook et renvoie l'id de transaction concerné.

Le crédit n'est accordé qu'après fetch_status() = payé ET montant identique à celui facturé.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass
from typing import Dict, List, Mapping, Optional


class PaymentError(Exception):
    """Erreur côté fournisseur, message lisible par l'utilisateur."""


class SignatureError(Exception):
    """Webhook dont la signature est absente, fausse ou trop ancienne."""


@dataclass
class Quote:
    amount: float      # montant facturé, dans l'unité affichée (ex. 8.34 USD, 5000 XOF)
    currency: str      # iso minuscule : xof, usd, eur…


@dataclass
class Checkout:
    tx_id: str
    payment_url: str


@dataclass
class RemoteStatus:
    state: str          # paid | pending | failed | cancelled
    amount: float       # montant payé chez le fournisseur, même unité que Quote.amount
    currency: str       # iso minuscule, "" si le fournisseur ne la renvoie pas
    raw_status: str     # statut brut du fournisseur (affiché dans l'admin)


@dataclass
class ProviderInfo:
    id: str
    label: str
    kind: str                 # mobile_money | card
    description: str
    countries: List[str]


class PaymentProvider:
    info: ProviderInfo

    def enabled(self) -> bool:
        raise NotImplementedError

    def webhooks_enabled(self) -> bool:
        raise NotImplementedError

    def quote(self, amount_fcfa: float) -> Quote:
        raise NotImplementedError

    def fcfa_per_unit(self) -> float:
        """FCFA pour 1 unité de la devise facturée (affichage de l'équivalent dans l'app)."""
        return 1.0

    async def create_checkout(self, *, intent_id: str, amount_fcfa: float, quote: Quote,
                              customer_email: str, return_url: str, cancel_url: str) -> Checkout:
        raise NotImplementedError

    async def fetch_status(self, tx_id: str) -> RemoteStatus:
        raise NotImplementedError

    def webhook_tx_id(self, raw: bytes, headers: Mapping[str, str]) -> Optional[str]:
        raise NotImplementedError


def verify_timestamped_signature(header: str, payload: bytes, secret: str, scheme: str,
                                 tolerance: int = 300, now: Optional[float] = None) -> None:
    """Format « t=<unix>,<scheme>=<hex>[,<scheme>=<hex>…] », HMAC-SHA256 de « <t>.<corps brut> ».

    Utilisé par Stripe (scheme v1) et FedaPay (scheme s). Lève SignatureError.
    """
    if not secret:
        raise SignatureError("secret de webhook non configuré")
    if not header:
        raise SignatureError("en-tête de signature absent")
    ts: Optional[int] = None
    sigs: List[str] = []
    for part in header.split(","):
        k, _, v = part.strip().partition("=")
        if k == "t":
            try:
                ts = int(v)
            except ValueError:
                raise SignatureError("horodatage invalide")
        elif k == scheme and v:
            sigs.append(v.strip())
    if ts is None or not sigs:
        raise SignatureError("en-tête de signature mal formé")
    signed = str(ts).encode() + b"." + payload
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, s) for s in sigs):
        raise SignatureError("signature invalide")
    age = (now if now is not None else time.time()) - ts
    if tolerance and abs(age) > tolerance:
        raise SignatureError("signature trop ancienne")


def header_get(headers: Mapping[str, str], name: str) -> str:
    """Accès insensible à la casse (Starlette l'est déjà, un dict de test non)."""
    v = headers.get(name)
    if v is None:
        low = name.lower()
        for k, val in headers.items():
            if k.lower() == low:
                return val
        return ""
    return v


def amounts_match(a: float, b: float) -> bool:
    return abs(float(a) - float(b)) < 0.005


def describe(providers: Dict[str, PaymentProvider]) -> List[dict]:
    out = []
    for p in providers.values():
        if not p.enabled():
            continue
        q = p.quote(1000)
        out.append({
            "id": p.info.id, "label": p.info.label, "kind": p.info.kind,
            "description": p.info.description, "countries": p.info.countries,
            "currency": q.currency,
            "fcfa_per_unit": p.fcfa_per_unit(),
        })
    return out
