"""
ADMIN — Multidevise : devises, taux, grille de packs, réglages de prix, paiements par devise.

  GET   /api/admin/currencies                 toutes les devises ISO + taux, date, marge, packs, fournisseurs
  PATCH /api/admin/currencies/{code}          {active?, margin_pct? (null = marge globale), symbol?}
  GET   /api/admin/fx                         journal des mises à jour et réglages
  POST  /api/admin/fx/refresh                 mise à jour immédiate des taux
  PUT   /api/admin/fx/rates/{code}            {fcfa_per_unit} : taux forcé (jamais sur une parité fixe)
  GET   /api/admin/pricing/settings  ·  PUT   marge globale, seuils, devise de repli
  GET   /api/admin/pricing/preview?currency=  offre telle que l'app la verra
  GET   /api/admin/packs?currency=            grille d'une devise + écart au marché + contraintes fournisseurs
  POST  /api/admin/packs  ·  PATCH/DELETE /api/admin/packs/{id}
  GET   /api/admin/payments/by-currency?days= totaux par devise

Lecture : tout admin. Écriture : owner/admin, journalisée.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from db.base import _utcnow, get_sessionmaker
from db.models import Currency, FxFetchLog, FxRate, PaymentIntent, TopupPack
from routes.admin import audit, get_current_admin, require_admin_role
from services.currency import fx
from services.currency.money import D, from_minor, norm_code
from services.currency.pricing import build_offer, get_pricing_settings, set_pricing_settings

router = APIRouter(prefix="/api/admin", tags=["admin"])
WRITE = require_admin_role("owner", "admin")


def _iso(v):
    return v.isoformat() + "Z" if v else None


def _providers_info(code: str) -> list:
    from services.payments.service import PROVIDERS
    out = []
    for p in sorted(PROVIDERS.values(), key=lambda x: x.info.priority):
        if p.supports(code):
            out.append({"id": p.info.id, "label": p.info.label, "enabled": p.enabled(),
                        "granularity": p.granularity(code)})
    return out


# ── Devises ──

@router.get("/currencies")
async def admin_currencies(admin: dict = Depends(get_current_admin)):
    settings = await get_pricing_settings()
    max_age = timedelta(days=float(D(settings["max_rate_age_days"])))
    now = _utcnow()
    Session = get_sessionmaker()
    async with Session() as session:
        currencies = (await session.scalars(select(Currency).order_by(Currency.code))).all()
        rates = {r.currency: r for r in (await session.scalars(select(FxRate))).all()}
        packs = dict((await session.execute(select(TopupPack.currency, func.count(TopupPack.id))
                                            .where(TopupPack.active.is_(True)).group_by(TopupPack.currency))).all())
    out = []
    for c in currencies:
        r = rates.get(c.code)
        provs = _providers_info(c.code)
        out.append({
            "code": c.code, "name": c.name, "symbol": c.symbol, "decimals": c.decimals, "active": c.active,
            "margin_pct": float(c.margin_pct) if c.margin_pct is not None else None,
            "fcfa_per_unit": float(r.fcfa_per_unit) if r else None,
            "rate_source": r.source if r else "", "rate_at": _iso(r.fetched_at) if r else None,
            "rate_fixed": bool(r and r.is_fixed),
            "rate_stale": bool(r and not r.is_fixed and now - r.fetched_at > max_age) or r is None,
            "packs": int(packs.get(c.code, 0)),
            "providers": provs, "payable": any(p["enabled"] for p in provs),
        })
    return {"currencies": out, "settings": settings}


class CurrencyPatch(BaseModel):
    active: Optional[bool] = None
    margin_pct: Optional[float] = Field(default=None, ge=0, le=100)
    clear_margin: bool = False
    symbol: Optional[str] = Field(default=None, max_length=8)


@router.patch("/currencies/{code}")
async def admin_currency_patch(code: str, body: CurrencyPatch, admin: dict = Depends(WRITE)):
    code = norm_code(code)
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            c = await session.get(Currency, code)
            if not c:
                raise HTTPException(404, "Devise inconnue")
            changes = []
            if body.active is not None:
                c.active = body.active
                changes.append(f"active={body.active}")
            if body.clear_margin:
                c.margin_pct = None
                changes.append("margin=globale")
            elif body.margin_pct is not None:
                c.margin_pct = Decimal(str(body.margin_pct))
                changes.append(f"margin={body.margin_pct}")
            if body.symbol is not None:
                c.symbol = body.symbol.strip()
                changes.append(f"symbol={c.symbol}")
    await audit(admin, "currency_update", code, " ".join(changes))
    return {"status": "ok"}


# ── Taux ──

@router.get("/fx")
async def admin_fx(admin: dict = Depends(get_current_admin)):
    Session = get_sessionmaker()
    async with Session() as session:
        logs = (await session.scalars(select(FxFetchLog).order_by(FxFetchLog.id.desc()).limit(30))).all()
    last_ok = await fx.last_success_at()
    return {"last_success_at": _iso(last_ok),
            "sources": [s.id for s in fx.SOURCES],
            "log": [{"id": l.id, "at": _iso(l.created_at), "source": l.source, "ok": l.ok,
                     "updated": l.updated, "message": l.message} for l in logs]}


@router.post("/fx/refresh")
async def admin_fx_refresh(admin: dict = Depends(WRITE)):
    res = await fx.refresh_rates()
    await audit(admin, "fx_refresh", res.source or "aucune", f"ok={res.ok} updated={res.updated}")
    return {"ok": res.ok, "source": res.source, "updated": res.updated, "rejected": res.rejected,
            "errors": res.errors, "message": res.message()}


class ForceRate(BaseModel):
    fcfa_per_unit: float = Field(..., gt=0)


@router.put("/fx/rates/{code}")
async def admin_fx_force(code: str, body: ForceRate, admin: dict = Depends(WRITE)):
    code = norm_code(code)
    try:
        await fx.force_rate(code, Decimal(str(body.fcfa_per_unit)))
    except ValueError as e:
        raise HTTPException(400, str(e))
    await audit(admin, "fx_force_rate", code, f"fcfa_per_unit={body.fcfa_per_unit}")
    return {"status": "ok"}


# ── Réglages de prix ──

@router.get("/pricing/settings")
async def admin_pricing_settings(admin: dict = Depends(get_current_admin)):
    return await get_pricing_settings()


class PricingSettingsBody(BaseModel):
    margin_pct: Optional[str] = None
    max_daily_change_pct: Optional[str] = None
    max_rate_age_days: Optional[str] = None
    fallback_currency: Optional[str] = None


@router.put("/pricing/settings")
async def admin_pricing_settings_put(body: PricingSettingsBody, admin: dict = Depends(WRITE)):
    values = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        out = await set_pricing_settings(values)
    except (ValueError, InvalidOperation) as e:
        raise HTTPException(400, str(e) or "Valeur invalide")
    await audit(admin, "pricing_settings", "", " ".join(f"{k}={v}" for k, v in values.items()))
    return out


@router.get("/pricing/preview")
async def admin_pricing_preview(currency: str, country: str = "", admin: dict = Depends(get_current_admin)):
    return (await build_offer(norm_code(currency) or None, country=country)).public()


# ── Grille de packs ──

def _pack_view(p: TopupPack, cur: Currency, rate: Optional[FxRate]) -> dict:
    price = from_minor(p.price_minor, cur.decimals)
    implied = (D(p.credit_fcfa) / price) if price else None
    market = D(rate.fcfa_per_unit) if rate else None
    deviation = float((implied / market - 1) * 100) if implied and market else None
    issues = [f"{prov['label']} exige un multiple de {from_minor(prov['granularity'], cur.decimals)}"
              for prov in _providers_info(cur.code) if p.price_minor % prov["granularity"]]
    return {"id": p.id, "currency": p.currency, "label": p.label, "sort": p.sort, "active": p.active,
            "price_minor": int(p.price_minor), "price": str(price), "credit_fcfa": int(p.credit_fcfa),
            "implied_fcfa_per_unit": float(implied) if implied else None,
            "market_fcfa_per_unit": float(market) if market else None,
            "deviation_pct": round(deviation, 2) if deviation is not None else None, "issues": issues}


@router.get("/packs")
async def admin_packs(currency: str, admin: dict = Depends(get_current_admin)):
    code = norm_code(currency)
    Session = get_sessionmaker()
    async with Session() as session:
        cur = await session.get(Currency, code)
        if not cur:
            raise HTTPException(404, "Devise inconnue")
        rate = await session.get(FxRate, code)
        packs = (await session.scalars(select(TopupPack).where(TopupPack.currency == code)
                                       .order_by(TopupPack.sort, TopupPack.price_minor))).all()
    return {"currency": code, "decimals": cur.decimals, "packs": [_pack_view(p, cur, rate) for p in packs]}


def _to_minor_exact(price: str, decimals: int) -> int:
    try:
        v = Decimal(str(price).replace(",", ".").replace(" ", ""))
    except InvalidOperation:
        raise HTTPException(400, "Prix invalide")
    if v <= 0:
        raise HTTPException(400, "Le prix doit être positif")
    minor = v * (Decimal(10) ** decimals)
    if minor != minor.to_integral_value():
        raise HTTPException(400, f"Cette devise accepte au plus {decimals} décimale(s)")
    return int(minor)


class PackBody(BaseModel):
    currency: Optional[str] = Field(default=None, max_length=3)
    price: Optional[str] = Field(default=None, max_length=32)   # unités entières, ex. "5.00" ou "5000"
    credit_fcfa: Optional[int] = Field(default=None, gt=0, le=10_000_000)
    label: Optional[str] = Field(default=None, max_length=64)
    sort: Optional[int] = None
    active: Optional[bool] = None


@router.post("/packs")
async def admin_pack_create(body: PackBody, admin: dict = Depends(WRITE)):
    code = norm_code(body.currency)
    if not code or body.price is None or not body.credit_fcfa:
        raise HTTPException(400, "Devise, prix et crédits sont obligatoires")
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            cur = await session.get(Currency, code)
            if not cur:
                raise HTTPException(404, "Devise inconnue")
            minor = _to_minor_exact(body.price, cur.decimals)
            dup = await session.scalar(select(TopupPack.id).where(TopupPack.currency == code,
                                                                  TopupPack.price_minor == minor))
            if dup:
                raise HTTPException(400, "Un pack existe déjà à ce prix dans cette devise")
            p = TopupPack(currency=code, price_minor=minor, credit_fcfa=int(body.credit_fcfa),
                          label=(body.label or "").strip(), sort=body.sort or 0,
                          active=True if body.active is None else body.active)
            session.add(p)
        pid = p.id
    await audit(admin, "pack_create", f"{code}#{pid}", f"price={body.price} credit={body.credit_fcfa}")
    return {"status": "ok", "id": pid}


@router.patch("/packs/{pack_id}")
async def admin_pack_patch(pack_id: int, body: PackBody, admin: dict = Depends(WRITE)):
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            p = await session.get(TopupPack, pack_id)
            if not p:
                raise HTTPException(404, "Pack introuvable")
            cur = await session.get(Currency, p.currency)
            if body.price is not None:
                minor = _to_minor_exact(body.price, cur.decimals)
                dup = await session.scalar(select(TopupPack.id).where(
                    TopupPack.currency == p.currency, TopupPack.price_minor == minor, TopupPack.id != p.id))
                if dup:
                    raise HTTPException(400, "Un pack existe déjà à ce prix dans cette devise")
                p.price_minor = minor
            if body.credit_fcfa is not None:
                p.credit_fcfa = int(body.credit_fcfa)
            if body.label is not None:
                p.label = body.label.strip()
            if body.sort is not None:
                p.sort = body.sort
            if body.active is not None:
                p.active = body.active
    await audit(admin, "pack_update", f"#{pack_id}", body.model_dump_json(exclude_none=True))
    return {"status": "ok"}


@router.delete("/packs/{pack_id}")
async def admin_pack_delete(pack_id: int, admin: dict = Depends(WRITE)):
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            p = await session.get(TopupPack, pack_id)
            if not p:
                raise HTTPException(404, "Pack introuvable")
            desc = f"{p.currency} {p.price_minor} → {p.credit_fcfa}"
            await session.delete(p)
    await audit(admin, "pack_delete", f"#{pack_id}", desc)
    return {"status": "ok"}


# ── Paiements par devise ──

@router.get("/payments/by-currency")
async def admin_payments_by_currency(days: int = 30, admin: dict = Depends(get_current_admin)):
    since = _utcnow() - timedelta(days=max(1, min(int(days or 30), 3650)))
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (await session.execute(
            select(func.upper(PaymentIntent.charged_currency), PaymentIntent.status,
                   func.count(PaymentIntent.id),
                   func.coalesce(func.sum(PaymentIntent.charged_amount_minor), 0),
                   func.coalesce(func.sum(PaymentIntent.charged_amount), 0),
                   func.coalesce(func.sum(PaymentIntent.amount_fcfa), 0))
            .where(PaymentIntent.created_at >= since)
            .group_by(func.upper(PaymentIntent.charged_currency), PaymentIntent.status))).all()
        decs = dict((await session.execute(select(Currency.code, Currency.decimals))).all())
    out: dict = {}
    for cur, status, count, minor, major, fcfa in rows:
        cur = cur or "XOF"
        d = out.setdefault(cur, {"currency": cur, "decimals": decs.get(cur, 0), "paid_count": 0,
                                 "paid_amount": "0", "paid_credits_fcfa": 0, "pending_count": 0, "other_count": 0})
        if status == "paid":
            d["paid_count"] += int(count)
            amount = from_minor(int(minor), d["decimals"]) if minor else D(major)
            d["paid_amount"] = str(D(d["paid_amount"]) + amount)
            d["paid_credits_fcfa"] += int(fcfa)
        elif status == "pending":
            d["pending_count"] += int(count)
        else:
            d["other_count"] += int(count)
    return {"days": days, "currencies": sorted(out.values(), key=lambda x: -x["paid_credits_fcfa"])}
