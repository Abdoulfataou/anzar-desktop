"""
PRICING routes — monnaies, prix des recharges, monnaie préférée.
  GET /api/currencies                 devises actives (code, symbole, décimales)
  GET /api/pricing?currency=&country= offre de recharge : devise retenue (ou repli),
                                      packs, moyens de paiement, taux et sa date
  PUT /api/user/currency              {"currency": "NGN"} ou {"currency": null} (= automatique)
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from db.base import get_sessionmaker
from db.models import Currency, User
from security import get_current_user
from services.currency.money import norm_code
from services.currency.pricing import build_offer

router = APIRouter(tags=["pricing"])

FALLBACK_MESSAGES = {
    "inactive": "Cette monnaie n'est pas encore proposée au paiement.",
    "no_provider": "Aucun moyen de paiement n'accepte encore cette monnaie.",
    "rate_unavailable": "Le taux de cette monnaie n'est pas à jour pour le moment.",
    "unavailable": "Aucun moyen de paiement n'est disponible pour le moment.",
}


def request_country(request: Request, hint: str = "") -> str:
    """Pays de l'utilisateur : en-tête Cloudflare s'il est fiable, sinon l'indice de l'app.

    Il ne sert qu'à SUGGÉRER une monnaie et à ordonner les moyens de paiement :
    le falsifier ne change aucun prix.
    """
    cf = (request.headers.get("cf-ipcountry") or "").strip().upper()
    if len(cf) == 2 and cf.isalpha() and cf not in ("XX", "T1"):
        return cf
    h = (hint or "").strip().upper()
    return h if len(h) == 2 and h.isalpha() else ""


async def _preferred(email: str) -> Optional[str]:
    Session = get_sessionmaker()
    async with Session() as session:
        return await session.scalar(select(User.preferred_currency).where(User.email == email))


@router.get("/api/currencies")
async def list_currencies(user: dict = Depends(get_current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (await session.scalars(select(Currency).where(Currency.active.is_(True))
                                      .order_by(Currency.code))).all()
    return {"currencies": [{"code": c.code, "name": c.name, "symbol": c.symbol, "decimals": c.decimals}
                           for c in rows]}


@router.get("/api/pricing")
async def pricing(request: Request, currency: str = "", country: str = "",
                  user: dict = Depends(get_current_user)):
    preferred = await _preferred(user["sub"])
    ctry = request_country(request, country)
    offer = await build_offer(norm_code(currency) or None, preferred=preferred, country=ctry)
    data = offer.public()
    data["preferred_currency"] = preferred
    data["country"] = ctry
    data["message"] = FALLBACK_MESSAGES.get(offer.fallback_reason, "")
    if offer.fallback_reason and offer.fallback_reason != "unavailable":
        data["message"] += f" Paiement proposé en {offer.currency}."
    data["rates_attribution"] = {"label": "Taux par Exchange Rate API",
                                 "url": "https://www.exchangerate-api.com"}
    # Montant libre (XOF) : bornes, paliers de bonus et paiement manuel, pour que l'app
    # affiche exactement ce que le serveur appliquera (aucune règle en dur côté app).
    from config import settings
    from services.payments.service import MAX_FCFA, MIN_FCFA
    data["min_fcfa"], data["max_fcfa"] = MIN_FCFA, MAX_FCFA
    data["manual"] = bool(settings.manual_payments_enabled) and offer.free_amount
    data["bonus_tiers"] = _bonus_tiers(settings.recharge_bonus_tiers) if offer.free_amount else []
    return data


def _bonus_tiers(raw: str) -> list:
    out = []
    for part in (raw or "").split(","):
        lo, _, pct = part.strip().partition(":")
        try:
            out.append([int(float(lo)), int(float(pct))])
        except ValueError:
            continue
    return sorted(out)


class CurrencyChoice(BaseModel):
    currency: Optional[str] = Field(default=None, max_length=3)


@router.put("/api/user/currency")
async def set_currency(body: CurrencyChoice, user: dict = Depends(get_current_user)):
    code = norm_code(body.currency) if body.currency else None
    if body.currency and not code:
        raise HTTPException(400, "Code de monnaie invalide")
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if code:
                cur = await session.get(Currency, code)
                if not cur or not cur.active:
                    raise HTTPException(400, "Cette monnaie n'est pas proposée")
            u = await session.scalar(select(User).where(User.email == user["sub"]).with_for_update())
            if not u:
                raise HTTPException(404, "Compte introuvable")
            u.preferred_currency = code
    return {"preferred_currency": code}
