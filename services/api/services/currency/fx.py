"""
services/currency/fx.py — Taux d'affichage, mis à jour une fois par jour.

Sources gratuites, sans clé, interrogées dans l'ordre :
  1. ExchangeRate-API, accès libre  — https://open.er-api.com/v6/latest/EUR (≈166 devises, attribution demandée)
  2. Frankfurter v2                  — https://api.frankfurter.dev/v2/rates?base=EUR (banques centrales)

Les deux donnent « unités de la devise pour 1 EUR ». On en déduit
    FCFA pour 1 unité = (XOF pour 1 EUR, parité légale 655,957) / (devise pour 1 EUR)
c.-à-d. que tout est ancré sur la parité fixe, jamais sur un cours XOF publié.

Pannes : si une source échoue ou paraît fausse (son cours XOF s'écarte de la
parité), on passe à la suivante ; si toutes échouent, on garde le dernier taux
connu avec sa date. Une variation journalière trop forte n'est pas appliquée
(l'admin la voit dans le journal et peut forcer le taux).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Awaitable, Callable, Dict, List, Optional

import httpx
from sqlalchemy import select

from db.base import _utcnow, get_sessionmaker
from db.models import Currency, FxFetchLog, FxRate
from services.currency.money import D, fixed_parities, iso_table

logger = logging.getLogger("anzar.fx")

Q = Decimal("1e-10")
ANCHOR_TOLERANCE = Decimal("0.02")   # une source dont le XOF/EUR s'écarte de > 2 % de la parité est rejetée


class SourceError(Exception):
    pass


@dataclass
class Source:
    id: str
    fetch: Callable[[httpx.AsyncClient], Awaitable[Dict[str, Decimal]]]


async def _er_api(client: httpx.AsyncClient) -> Dict[str, Decimal]:
    r = await client.get("https://open.er-api.com/v6/latest/EUR")
    r.raise_for_status()
    data = r.json()
    if data.get("result") != "success" or not isinstance(data.get("rates"), dict):
        raise SourceError(f"réponse inattendue : {str(data)[:120]}")
    return {k.upper(): D(v) for k, v in data["rates"].items() if isinstance(v, (int, float, str))}


async def _frankfurter(client: httpx.AsyncClient) -> Dict[str, Decimal]:
    r = await client.get("https://api.frankfurter.dev/v2/rates", params={"base": "EUR"})
    r.raise_for_status()
    rows = r.json()
    if not isinstance(rows, list):
        raise SourceError(f"réponse inattendue : {str(rows)[:120]}")
    out = {"EUR": Decimal(1)}
    for row in rows:
        if isinstance(row, dict) and row.get("quote") and row.get("rate") is not None:
            out[str(row["quote"]).upper()] = D(row["rate"])
    return out


SOURCES: List[Source] = [Source("er-api", _er_api), Source("frankfurter", _frankfurter)]


def anchor_per_eur() -> Decimal:
    fp = fixed_parities()
    return D(fp["per_eur"][fp["anchor"]])


def fcfa_per_unit_from_per_eur(per_eur: Decimal) -> Decimal:
    return (anchor_per_eur() / D(per_eur)).quantize(Q)


def _clean(raw: Dict[str, Decimal]) -> Dict[str, Decimal]:
    """Garde les seuls codes ISO 4217 connus, avec un taux > 0 (élimine les cryptos)."""
    iso = iso_table()
    return {k: v for k, v in raw.items() if k in iso and v > 0}


def _check_anchor(rates: Dict[str, Decimal]) -> None:
    xof = rates.get(fixed_parities()["anchor"])
    if xof is not None and abs(xof / anchor_per_eur() - 1) > ANCHOR_TOLERANCE:
        raise SourceError(f"cours XOF/EUR incohérent ({xof})")
    if "USD" not in rates:
        raise SourceError("USD absent")


@dataclass
class RefreshResult:
    ok: bool
    source: str = ""
    updated: int = 0
    rejected: Dict[str, str] = field(default_factory=dict)
    errors: Dict[str, str] = field(default_factory=dict)

    def message(self) -> str:
        parts = []
        if self.errors:
            parts.append("Sources en échec : " + "; ".join(f"{k}: {v}" for k, v in self.errors.items()))
        if self.rejected:
            parts.append("Variations non appliquées : " + ", ".join(f"{k} ({v})" for k, v in self.rejected.items()))
        return " | ".join(parts)


async def refresh_rates(client: Optional[httpx.AsyncClient] = None,
                        sources: Optional[List[Source]] = None) -> RefreshResult:
    from services.currency.pricing import get_pricing_settings

    own = client is None
    client = client or httpx.AsyncClient(timeout=20, headers={"User-Agent": "ANZAR/1 (taux d'affichage)"})
    res = RefreshResult(ok=False)
    rates: Dict[str, Decimal] = {}
    try:
        for src in sources or SOURCES:
            try:
                rates = _clean(await src.fetch(client))
                _check_anchor(rates)
                res.source = src.id
                break
            except Exception as e:   # réseau, HTTP, JSON, cohérence : on passe à la suivante
                res.errors[src.id] = str(e)[:200] or e.__class__.__name__
                rates = {}
    finally:
        if own:
            await client.aclose()

    max_change = D((await get_pricing_settings())["max_daily_change_pct"]) / 100
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if rates:
                res.ok = True
                codes = set((await session.scalars(select(Currency.code))).all())
                existing = {r.currency: r for r in (await session.scalars(select(FxRate))).all()}
                now = _utcnow()
                for code, per_eur in rates.items():
                    if code not in codes:
                        continue
                    old = existing.get(code)
                    if old and old.is_fixed:
                        continue
                    new = fcfa_per_unit_from_per_eur(per_eur)
                    if old is not None and max_change > 0:
                        change = abs(new / D(old.fcfa_per_unit) - 1)
                        if change > max_change:
                            res.rejected[code] = f"{change * 100:.1f} %"
                            continue
                    if old is None:
                        session.add(FxRate(currency=code, fcfa_per_unit=new, source=res.source,
                                           fetched_at=now, is_fixed=False))
                    else:
                        old.fcfa_per_unit, old.source, old.fetched_at = new, res.source, now
                    res.updated += 1
            session.add(FxFetchLog(source=res.source or "aucune", ok=res.ok, updated=res.updated,
                                   message=res.message()[:4000]))
    if res.ok:
        logger.info("Taux mis à jour depuis %s : %d devises%s", res.source, res.updated,
                    f", {len(res.rejected)} variations rejetées" if res.rejected else "")
    else:
        logger.warning("Mise à jour des taux impossible, derniers taux conservés : %s", res.message())
    return res


async def force_rate(code: str, fcfa_per_unit: Decimal) -> None:
    """Taux saisi par un admin (ex. variation légitime rejetée). Interdit sur une parité fixe."""
    value = D(fcfa_per_unit).quantize(Q)
    if value <= 0:
        raise ValueError("Le taux doit être positif")
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if not await session.get(Currency, code):
                raise ValueError("Devise inconnue")
            row = await session.get(FxRate, code)
            if row and row.is_fixed:
                raise ValueError("Parité fixe : ce taux ne se modifie pas")
            if row is None:
                session.add(FxRate(currency=code, fcfa_per_unit=value, source="manuel", fetched_at=_utcnow()))
            else:
                row.fcfa_per_unit, row.source, row.fetched_at = value, "manuel", _utcnow()


async def last_success_at() -> Optional[datetime]:
    Session = get_sessionmaker()
    async with Session() as session:
        return await session.scalar(select(FxFetchLog.created_at).where(FxFetchLog.ok.is_(True))
                                    .order_by(FxFetchLog.created_at.desc()).limit(1))


async def refresh_if_due(max_age: timedelta = timedelta(hours=23)) -> Optional[RefreshResult]:
    last = await last_success_at()
    if last and _utcnow() - last < max_age:
        return None
    return await refresh_rates()
