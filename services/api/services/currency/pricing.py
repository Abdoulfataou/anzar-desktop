"""
services/currency/pricing.py — Ce que l'utilisateur paie, dans quelle devise, pour combien de FCFA.

Règles (toutes pilotées par les tables, aucune devise codée en dur) :
  1. Devise visée = celle demandée, sinon la préférence du compte, sinon celle du
     pays (en-tête Cloudflare, sinon indice envoyé par l'app), sinon la devise de repli.
  2. Elle doit être active ET acceptée par au moins un fournisseur actif ; sinon
     repli sur `fallback_currency` (USD par défaut, via Stripe) avec la raison.
  3. Prix : la grille saisie dans l'admin pour cette devise si elle existe ;
     sinon conversion de la grille XOF (taux du jour + marge), arrondie vers le
     haut à un prix lisible. Un taux trop ancien suspend les prix calculés.
  4. Le serveur recalcule TOUJOURS le prix au moment du paiement ; l'app ne
     fournit qu'un identifiant de pack (ou un montant libre en XOF).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional

from sqlalchemy import select

from db.base import _utcnow, get_sessionmaker
from db.models import Currency, FxRate, PricingSetting, TopupPack
from services.currency.money import D, currency_for_country, fixed_parities, nice_round_up_minor, norm_code

LEDGER = "XOF"   # unité du grand livre (identique à l'ancre des parités fixes)

DEFAULTS = {"margin_pct": "3", "max_daily_change_pct": "25", "max_rate_age_days": "7",
            "fallback_currency": "USD"}


class PricingError(ValueError):
    """Requête de prix invalide ou périmée (message lisible par l'utilisateur)."""


async def get_pricing_settings() -> Dict[str, str]:
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (await session.scalars(select(PricingSetting))).all()
    out = dict(DEFAULTS)
    out.update({r.key: r.value for r in rows})
    return out


async def set_pricing_settings(values: Dict[str, str]) -> Dict[str, str]:
    allowed = set(DEFAULTS)
    for k, v in values.items():
        if k not in allowed:
            raise ValueError(f"Réglage inconnu : {k}")
        if k == "fallback_currency":
            if not norm_code(v):
                raise ValueError("Devise de repli invalide")
        else:
            n = D(v)
            if n < 0 or n > 1000:
                raise ValueError(f"Valeur hors limites pour {k}")
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            for k, v in values.items():
                v = norm_code(v) if k == "fallback_currency" else str(D(v).normalize())
                row = await session.get(PricingSetting, k)
                if row:
                    row.value = v
                else:
                    session.add(PricingSetting(key=k, value=v))
    return await get_pricing_settings()


@dataclass
class PackOffer:
    id: int
    label: str
    price_minor: int
    credit_fcfa: int
    bonus_pct: int = 0


@dataclass
class Offer:
    currency: str
    decimals: int
    symbol: str
    requested_currency: str
    fallback_reason: str            # "" | inactive | no_provider | rate_unavailable | unavailable
    pricing_source: str             # grid | computed | ""
    fcfa_per_unit: Optional[Decimal]
    rate_as_of: Optional[datetime]
    rate_source: str
    rate_fixed: bool
    packs: List[PackOffer] = field(default_factory=list)
    providers: List[dict] = field(default_factory=list)
    free_amount: bool = False       # montant libre autorisé (XOF uniquement)

    def public(self) -> dict:
        d = asdict(self)
        d["fcfa_per_unit"] = float(self.fcfa_per_unit) if self.fcfa_per_unit is not None else None
        d["rate_as_of"] = self.rate_as_of.isoformat() + "Z" if self.rate_as_of else None
        return d


@dataclass
class PriceQuote:
    currency: str
    decimals: int
    amount_minor: int
    credit_fcfa: int
    apply_bonus: bool               # montant libre XOF : paliers de bonus appliqués au crédit
    pricing_source: str
    fx_rate: Optional[Decimal]
    pack_id: Optional[int]


def _margin(cur: Currency, settings: Dict[str, str]) -> Decimal:
    m = D(cur.margin_pct) if cur.margin_pct is not None else D(settings["margin_pct"])
    return max(Decimal(0), m) / 100


def _rate_fresh(rate: Optional[FxRate], settings: Dict[str, str], now: datetime) -> bool:
    if rate is None:
        return False
    if rate.is_fixed:
        return True
    return now - rate.fetched_at <= timedelta(days=float(D(settings["max_rate_age_days"])))


def _bonus_pct(price_fcfa: Decimal, credit_fcfa: int) -> int:
    if price_fcfa <= 0:
        return 0
    pct = (D(credit_fcfa) / price_fcfa - 1) * 100
    return int(pct.to_integral_value()) if pct >= 1 else 0


async def _load(currency: str):
    Session = get_sessionmaker()
    async with Session() as session:
        cur = await session.get(Currency, currency)
        rate = await session.get(FxRate, currency)
        packs = (await session.scalars(select(TopupPack).where(
            TopupPack.currency == currency, TopupPack.active.is_(True))
            .order_by(TopupPack.sort, TopupPack.price_minor))).all()
        base = (await session.scalars(select(TopupPack).where(
            TopupPack.currency == LEDGER, TopupPack.active.is_(True))
            .order_by(TopupPack.sort, TopupPack.price_minor))).all()
    return cur, rate, list(packs), list(base)


async def _try(currency: str, country: str, settings: Dict[str, str], requested: str) -> Offer | str:
    """Construit l'offre pour `currency`, ou renvoie la raison de l'échec."""
    from config import settings as app_settings
    from services.payments.routing import providers_for

    cur, rate, packs, base = await _load(currency)
    if cur is None or not cur.active:
        return "inactive"
    providers = providers_for(currency, country)
    # Sans fournisseur automatique, le paiement manuel (validé par un admin) reste possible en XOF
    manual_ok = currency == LEDGER and bool(app_settings.manual_payments_enabled)
    if not providers and not manual_ok:
        return "no_provider"
    now = _utcnow()
    fresh = _rate_fresh(rate, settings, now)
    offer = Offer(currency=currency, decimals=cur.decimals, symbol=cur.symbol or "",
                  requested_currency=requested, fallback_reason="", pricing_source="",
                  fcfa_per_unit=D(rate.fcfa_per_unit) if rate else None,
                  rate_as_of=rate.fetched_at if rate else None, rate_source=rate.source if rate else "",
                  rate_fixed=bool(rate and rate.is_fixed),
                  providers=[p.describe(currency) for p in providers],
                  free_amount=(currency == LEDGER))
    if packs:
        offer.pricing_source = "grid"
        for p in packs:
            price_fcfa = (D(p.price_minor) / (Decimal(10) ** cur.decimals)) * D(rate.fcfa_per_unit) if rate else D(0)
            offer.packs.append(PackOffer(p.id, p.label, int(p.price_minor), int(p.credit_fcfa),
                                         _bonus_pct(price_fcfa, p.credit_fcfa) if currency == LEDGER else 0))
        return offer
    if not fresh or not base:
        return "rate_unavailable"
    offer.pricing_source = "computed"
    gran = max([p.granularity(currency) for p in providers] or [1])
    factor = 1 + _margin(cur, settings)
    for b in base:
        value = D(b.price_minor) / D(rate.fcfa_per_unit) * factor     # XOF (0 décimale) → devise
        offer.packs.append(PackOffer(b.id, b.label, nice_round_up_minor(value, cur.decimals, gran),
                                     int(b.credit_fcfa), _bonus_pct(D(b.price_minor), b.credit_fcfa)))
    return offer


async def build_offer(requested: Optional[str] = None, *, preferred: Optional[str] = None,
                      country: Optional[str] = None) -> Offer:
    settings = await get_pricing_settings()
    fallback = norm_code(settings["fallback_currency"]) or "USD"
    country = (country or "").strip().upper()[:2]
    target = norm_code(requested) or norm_code(preferred) or currency_for_country(country) or fallback
    first = await _try(target, country, settings, target)
    if isinstance(first, Offer):
        return first
    if target != fallback:
        second = await _try(fallback, country, settings, target)
        if isinstance(second, Offer):
            second.fallback_reason = first
            return second
    # Dernier recours : XOF, où le paiement manuel reste possible même sans aucune clé
    if LEDGER not in (target, fallback):
        last = await _try(LEDGER, country, settings, target)
        if isinstance(last, Offer):
            last.fallback_reason = first
            return last
    return Offer(currency=target, decimals=0, symbol="", requested_currency=target,
                 fallback_reason="unavailable", pricing_source="", fcfa_per_unit=None,
                 rate_as_of=None, rate_source="", rate_fixed=False)


async def quote_for_payment(*, currency: Optional[str], pack_id: Optional[int], amount_fcfa: Optional[float],
                            provider_id: str, country: str = "") -> PriceQuote:
    """Prix définitif d'un paiement, recalculé côté serveur. Lève PricingError."""
    from services.payments.service import MAX_FCFA, MIN_FCFA

    cur = norm_code(currency) or LEDGER
    offer = await build_offer(cur, country=country)
    if offer.currency != cur:
        raise PricingError("Cette monnaie n'est plus disponible au paiement. Rouvre la fenêtre de recharge.")
    provider = next((p for p in offer.providers if p["id"] == provider_id), None)
    if not provider:
        raise PricingError("Ce moyen de paiement n'accepte pas cette monnaie")

    if pack_id is not None:
        pack = next((p for p in offer.packs if p.id == int(pack_id)), None)
        if not pack:
            raise PricingError("Ce pack n'existe plus. Rouvre la fenêtre de recharge.")
        return PriceQuote(cur, offer.decimals, pack.price_minor, pack.credit_fcfa, False,
                          offer.pricing_source, offer.fcfa_per_unit, pack.id)

    # Montant libre : seulement dans l'unité du grand livre (le prix EST le montant en FCFA)
    if cur != LEDGER:
        raise PricingError("Choisis un pack pour payer dans cette monnaie")
    amount = int(round(float(amount_fcfa or 0)))
    if amount < MIN_FCFA or amount > MAX_FCFA:
        raise PricingError(f"Montant entre {MIN_FCFA} et {MAX_FCFA:,} FCFA".replace(",", " "))
    return PriceQuote(cur, offer.decimals, amount, amount, True, "amount", offer.fcfa_per_unit, None)


async def suggest_currency(*, preferred: Optional[str], country: Optional[str]) -> str:
    return (await build_offer(None, preferred=preferred, country=country)).currency


def ledger_anchor() -> str:
    return fixed_parities()["anchor"]
