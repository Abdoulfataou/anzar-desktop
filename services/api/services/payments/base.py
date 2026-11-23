"""
services/payments/base.py — Contrat commun des fournisseurs de paiement.

Chaque fournisseur (FedaPay, Stripe, puis iPay Money, Flutterwave…) implémente :
  - quote()            : combien facturer, et dans quelle devise, pour N FCFA de crédits ;
  - create_checkout()  : crée le paiement chez lui et renvoie le lien de paiement ;
  - fetch_status()     : relit le statut CHEZ LUI (source de vérité, jamais le corps du webhook) ;
  - webhook_tx_id()    : vérifie la signature d'un webhook et renvoie l'id de transaction concerné.

Le crédit n'est accordé qu'après fetch_status() = payé ET montant identique à celui facturé.

Multidevise : chaque fournisseur déclare ses devises et pays (capabilities.json)
et sait convertir un montant ISO (unités mineures entières) dans l'unité de son API.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Mapping, Optional, Union

from services.currency.money import from_minor, iso_table


class PaymentError(Exception):
    """Erreur côté fournisseur, message lisible par l'utilisateur."""


class SignatureError(Exception):
    """Webhook dont la signature est absente, fausse ou trop ancienne."""


@dataclass
class Quote:
    amount: float      # montant facturé, dans l'unité affichée (ex. 8.34 USD, 5000 XOF)
    currency: str      # iso minuscule : xof, usd, eur…
    amount_minor: Optional[int] = None   # montant exact en unités mineures ISO (source de vérité)
    decimals: int = 0


@dataclass
class Checkout:
    tx_id: str
    payment_url: str


@dataclass
class RemoteStatus:
    state: str          # paid | pending | failed | cancelled | refunded | disputed
    amount: float       # montant payé chez le fournisseur, même unité que Quote.amount
    currency: str       # iso minuscule, "" si le fournisseur ne la renvoie pas
    raw_status: str     # statut brut du fournisseur (affiché dans l'admin)
    provider_payment_id: str = ""  # Stripe PaymentIntent (utile pour les litiges)
    amount_minor: Optional[int] = None  # montant payé en unités mineures ISO, si le fournisseur le permet


@dataclass
class RefundEvent:
    """Événement de remboursement ou litige, après vérification de signature."""
    intent_id: str = ""
    payment_id: str = ""
    tx_id: str = ""
    amount: float = 0
    currency: str = ""
    state: str = "refunded"
    raw_status: str = ""


@dataclass
class ProviderInfo:
    id: str
    label: str
    kind: str                 # mobile_money | card
    description: str
    countries: List[str]
    currencies: List[str] = field(default_factory=list)   # ISO majuscules
    priority: int = 100


CAPABILITIES = Path(__file__).resolve().parent / "capabilities.json"


@lru_cache(maxsize=1)
def capabilities() -> Dict[str, dict]:
    data = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


def declared(provider_id: str) -> dict:
    return capabilities().get(provider_id, {})


def iso_decimals(currency: str) -> int:
    row = iso_table().get((currency or "").upper())
    if row is None:
        raise PaymentError(f"Devise inconnue : {currency}")
    return int(row["decimals"])


class PaymentProvider:
    info: ProviderInfo

    def enabled(self) -> bool:
        raise NotImplementedError

    def webhooks_enabled(self) -> bool:
        raise NotImplementedError

    # ── Capacités ──

    def supports(self, currency: str) -> bool:
        return (currency or "").upper() in self.info.currencies

    def country_rank(self, country: str) -> int:
        """0 = proposé en priorité dans ce pays, 1 = partout, 2 = hors de ses pays déclarés."""
        if country and country in self.info.countries:
            return 0
        return 1 if "*" in self.info.countries else 2

    def _minor_rule(self, currency: str) -> dict:
        rules = declared(self.info.id).get("minor") or {}
        cur = (currency or "").upper()
        for name, rule in rules.items():
            if name != "default" and cur in rule.get("codes", []):
                return rule
        return rules.get("default") or {"exponent": "iso"}

    def granularity(self, currency: str) -> int:
        """Pas minimal du montant, en unités mineures ISO (ex. 10 pour 0,010 KWD chez Stripe)."""
        rule, dec = self._minor_rule(currency), iso_decimals(currency)
        g = int(rule.get("granularity", 1))
        exp = rule.get("exponent", "iso")
        if rule.get("whole_units") or exp == 0:
            g = max(g, 10 ** dec)          # pas de fraction d'unité possible
        return g

    def to_provider_amount(self, amount_minor: int, currency: str) -> Union[int, str]:
        """Unités mineures ISO → valeur attendue par l'API du fournisseur."""
        rule, dec = self._minor_rule(currency), iso_decimals(currency)
        exp = rule.get("exponent", "iso")
        if exp == "major":
            return str(from_minor(amount_minor, dec))
        if exp == "iso":
            return int(amount_minor)
        if amount_minor % self.granularity(currency):
            raise PaymentError(f"Montant non accepté par {self.info.label} dans cette devise")
        shift = int(exp) - dec
        return int(amount_minor) * (10 ** shift) if shift >= 0 else int(amount_minor) // (10 ** -shift)

    def from_provider_amount(self, value, currency: str) -> int:
        """Valeur renvoyée par l'API du fournisseur → unités mineures ISO (exactes)."""
        rule, dec = self._minor_rule(currency), iso_decimals(currency)
        exp = rule.get("exponent", "iso")
        if exp == "major":
            return int((Decimal(str(value)) * (Decimal(10) ** dec)).to_integral_value())
        if exp == "iso":
            return int(value)
        shift = int(exp) - dec
        v = int(value)
        return v // (10 ** shift) if shift >= 0 else v * (10 ** -shift)

    def quote(self, amount_minor: int, currency: str) -> Quote:
        """Valide qu'on peut facturer ce montant ISO dans cette devise et renvoie le Quote."""
        cur = (currency or "").upper()
        if not self.supports(cur):
            raise PaymentError(f"{self.info.label} n'accepte pas {cur}")
        dec = iso_decimals(cur)
        if int(amount_minor) <= 0 or int(amount_minor) % self.granularity(cur):
            raise PaymentError(f"Montant non accepté par {self.info.label} dans cette devise")
        return Quote(amount=float(from_minor(amount_minor, dec)), currency=cur.lower(),
                     amount_minor=int(amount_minor), decimals=dec)

    def describe(self, currency: str = "") -> dict:
        return {"id": self.info.id, "label": self.info.label, "kind": self.info.kind,
                "description": self.info.description, "countries": self.info.countries,
                "currency": (currency or "").lower()}

    async def create_checkout(self, *, intent_id: str, amount_fcfa: float, quote: Quote,
                              customer_email: str, return_url: str, cancel_url: str) -> Checkout:
        raise NotImplementedError

    async def fetch_status(self, tx_id: str) -> RemoteStatus:
        raise NotImplementedError

    def webhook_tx_id(self, raw: bytes, headers: Mapping[str, str]) -> Optional[str]:
        raise NotImplementedError

    def webhook_refund_event(self, raw: bytes, headers: Mapping[str, str]) -> Optional[RefundEvent]:
        """Remboursement/litige signé, ou None. Les fournisseurs concernés l'implémentent."""
        return None


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
    """Moyens de paiement actifs et devises acceptées (GET /api/payments/methods)."""
    out = []
    for p in sorted(providers.values(), key=lambda x: x.info.priority):
        if not p.enabled():
            continue
        d = p.describe()
        d["currencies"] = list(p.info.currencies)
        out.append(d)
    return out
