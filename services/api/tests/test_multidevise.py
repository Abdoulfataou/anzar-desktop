"""
Multidevise : arrondis et unités mineures (0, 2, 3 décimales), migration réversible,
taux (sources en panne, parité fixe, variation rejetée), tarification (grille, calcul,
repli USD), choix du fournisseur, recalcul serveur, montant modifié refusé,
adaptateurs Paystack / Flutterwave simulés.
"""
import asyncio
import hashlib
import hmac
import json
from datetime import timedelta
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import create_engine, inspect, select, text, update

from config import settings
from db.base import _utcnow, get_sessionmaker
from db.models import Currency, FxFetchLog, FxRate, TopupPack
from services.currency import fx, pricing
from services.currency.money import from_minor, nice_round_up_minor, to_minor
from services.payments import service as svc
from services.payments.base import (
    Checkout, PaymentError, PaymentProvider, ProviderInfo, RemoteStatus, SignatureError,
    header_get, verify_timestamped_signature,
)
from services.payments.flutterwave import FlutterwaveProvider
from services.payments.paystack import PaystackProvider
from services.payments.routing import providers_for

SECRET = "whsec_test_secret"


# ═══════════════════════ Calcul pur ═══════════════════════

def test_minor_units_by_decimals():
    assert to_minor("5000", 0) == 5000 and from_minor(5000, 0) == Decimal("5000")      # XOF, JPY
    assert to_minor("8.345", 2) == 835 and from_minor(835, 2) == Decimal("8.35")       # EUR
    assert to_minor("0.7505", 3) == 751 and from_minor(750, 3) == Decimal("0.750")     # KWD
    assert str(from_minor(1234, 3)) == "1.234"


@pytest.mark.parametrize("value,dec,gran,expected", [
    ("8.333", 2, 1, 840),          # 8,33 $ → 8,40 $
    ("16.67", 2, 1, 1700),         # 16,67 $ → 17,00 $
    ("12345", 2, 1, 1250000),      # 12 345 ₦ → 12 500 ₦
    ("1253", 0, 1, 1300),          # 1 253 ¥ → 1 300 ¥ (0 décimale)
    ("7621.4", 0, 1, 7800),        # XAF/KRW : jamais de décimale
    ("0.734", 3, 10, 740),         # 0,734 KWD → 0,740 (dernier chiffre 0 pour Stripe)
    ("0.0231", 3, 10, 30),         # très petit montant à 3 décimales
    ("12502", 2, 100, 1300000),    # MGA chez Stripe : unités entières seulement
])
def test_nice_round_up(value, dec, gran, expected):
    got = nice_round_up_minor(value, dec, gran)
    assert got == expected
    assert got % gran == 0
    assert Decimal(got) / (10 ** dec) >= Decimal(value)                 # jamais sous le coût
    assert Decimal(got) / (10 ** dec) <= Decimal(value) * Decimal("1.06") or Decimal(value) < 1


def test_nice_round_up_rejects_zero():
    with pytest.raises(ValueError):
        nice_round_up_minor(0, 2)


# ═══════════════════════ Migration réversible ═══════════════════════

def test_migration_up_down_up(tmp_path):
    from db import migrations as M
    from db.base import Base
    from db import models  # noqa: F401

    eng = create_engine(f"sqlite:///{tmp_path / 'm.db'}")
    old = [t for name, t in Base.metadata.tables.items()
           if name not in ("currencies", "fx_rates", "fx_fetch_log", "topup_packs", "pricing_settings")]
    with eng.begin() as c:
        Base.metadata.create_all(c, tables=old)
        c.execute(text("ALTER TABLE users DROP COLUMN preferred_currency"))
        for col in ("charged_amount_minor", "fx_rate_used", "pack_id", "pricing_source", "customer_country"):
            c.execute(text(f"ALTER TABLE payment_intents DROP COLUMN {col}"))
        c.execute(text("INSERT INTO users (email, password_hash, salt, name, is_active, token_version)"
                       " VALUES ('a@b.c', '', '', '', 1, 0)"))
    with eng.begin() as c:
        assert M.upgrade(c) == ["0001_multidevise", "0002_packs_prix_ronds"]
        assert M.upgrade(c) == []                                             # idempotent
        eur = c.execute(text("SELECT price_minor, credit_fcfa FROM topup_packs WHERE currency='EUR'"
                             " ORDER BY price_minor")).all()
        assert [p[0] for p in eur] == [100, 300, 800, 2500, 8000]            # 1 €, 3 €, 8 €, 25 €, 80 €
        xaf = c.execute(text("SELECT price_minor FROM topup_packs WHERE currency='XAF' ORDER BY price_minor")).all()
        assert [p[0] for p in xaf] == [500, 2000, 5000, 15000, 50000]       # 0 décimale
        assert c.execute(text("SELECT decimals FROM currencies WHERE code='KWD'")).scalar() == 3
        assert c.execute(text("SELECT decimals FROM currencies WHERE code='XAF'")).scalar() == 0
        eur = c.execute(text("SELECT fcfa_per_unit, is_fixed FROM fx_rates WHERE currency='EUR'")).one()
        assert Decimal(str(eur[0])) == Decimal("655.957") and eur[1]
        packs = c.execute(text("SELECT price_minor, credit_fcfa FROM topup_packs WHERE currency='XOF'"
                               " ORDER BY price_minor")).all()
        assert (5000, 5750) in [tuple(p) for p in packs]                     # bonus 15 % inclus
        assert "preferred_currency" in {x["name"] for x in inspect(c).get_columns("users")}
    with eng.begin() as c:
        try:
            M.downgrade(c, "0001_multidevise")                               # refusé : 0002 d'abord
            raise AssertionError("ordre de retour arrière non vérifié")
        except ValueError:
            pass
        M.downgrade(c, "0002_packs_prix_ronds")
        assert c.execute(text("SELECT count(*) FROM topup_packs WHERE currency='EUR'")).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM topup_packs WHERE currency='XOF'")).scalar() == 5
        M.downgrade(c, "0001_multidevise")
        tables = set(inspect(c).get_table_names())
        assert not tables & {"currencies", "fx_rates", "topup_packs", "pricing_settings", "fx_fetch_log"}
        assert "preferred_currency" not in {x["name"] for x in inspect(c).get_columns("users")}
        assert "charged_amount_minor" not in {x["name"] for x in inspect(c).get_columns("payment_intents")}
        assert c.execute(text("SELECT count(*) FROM users")).scalar() == 1  # données existantes intactes
    with eng.begin() as c:
        assert M.upgrade(c) == ["0001_multidevise", "0002_packs_prix_ronds"]


# ═══════════════════════ Aides base de test ═══════════════════════

def call(_tc, fn, *a, **kw):
    async def run():
        return await fn(*a, **kw)
    return _tc.portal.call(run)


async def _set_currency(code, active=True, margin=None):
    Session = get_sessionmaker()
    async with Session() as s:
        async with s.begin():
            c = await s.get(Currency, code)
            c.active, c.margin_pct = active, margin


async def _set_rate(code, value, age_days=0, fixed=False):
    Session = get_sessionmaker()
    async with Session() as s:
        async with s.begin():
            r = await s.get(FxRate, code)
            when = _utcnow() - timedelta(days=age_days)
            if r is None:
                s.add(FxRate(currency=code, fcfa_per_unit=Decimal(str(value)), source="test",
                             fetched_at=when, is_fixed=fixed))
            else:
                r.fcfa_per_unit, r.fetched_at, r.source = Decimal(str(value)), when, "test"


async def _get_rate(code):
    Session = get_sessionmaker()
    async with Session() as s:
        return await s.get(FxRate, code)


async def _add_pack(currency, price_minor, credit):
    Session = get_sessionmaker()
    async with Session() as s:
        async with s.begin():
            p = TopupPack(currency=currency, price_minor=price_minor, credit_fcfa=credit, label="T")
            s.add(p)
        return p.id


async def _delete_packs(currency):
    Session = get_sessionmaker()
    async with Session() as s:
        async with s.begin():
            for p in (await s.scalars(select(TopupPack).where(TopupPack.currency == currency))).all():
                await s.delete(p)


async def _xof_base():
    Session = get_sessionmaker()
    async with Session() as s:
        return list((await s.scalars(select(TopupPack).where(TopupPack.currency == "XOF")
                                     .order_by(TopupPack.price_minor))).all())


class MultiFake(PaymentProvider):
    info = ProviderInfo(id="multi", label="Multi", kind="card", description="", countries=["*"],
                        currencies=["XOF", "USD", "EUR", "CHF", "KWD", "JPY"], priority=5)

    def __init__(self):
        self.remote = RemoteStatus("pending", 0, "", "open")

    def enabled(self):
        return True

    def webhooks_enabled(self):
        return True

    def granularity(self, currency):
        return 10 if currency.upper() == "KWD" else 1

    async def create_checkout(self, **kw):
        return Checkout(tx_id=f"m_{kw['intent_id'][:10]}", payment_url="https://pay.example/m")

    async def fetch_status(self, tx_id):
        return self.remote

    def webhook_tx_id(self, raw, headers):
        verify_timestamped_signature(header_get(headers, "x-sig"), raw, SECRET, "v1")
        return json.loads(raw).get("tx")


@pytest.fixture()
def multi(client):
    p = MultiFake()
    svc.PROVIDERS["multi"] = p
    for code in ("EUR", "USD", "CHF", "KWD", "JPY", "GHS"):
        call(client, _set_currency, code, True)
    call(client, _set_rate, "USD", "600")
    call(client, _set_rate, "CHF", "700")
    call(client, _set_rate, "KWD", "1950")
    call(client, _set_rate, "JPY", "4.1")
    yield p
    svc.PROVIDERS.pop("multi", None)
    for code in ("CHF", "KWD", "JPY"):
        call(client, _delete_packs, code)


# ═══════════════════════ Tarification ═══════════════════════

def test_offer_computed_from_xof_grid_with_margin(client, multi):
    offer = call(client, pricing.build_offer, "CHF")                      # pas de grille de départ
    assert offer.currency == "CHF" and offer.pricing_source == "computed" and not offer.fallback_reason
    assert float(offer.fcfa_per_unit) == 700
    base = {b.id: b for b in call(client, _xof_base)}
    for p in offer.packs:
        exact = Decimal(base[p.id].price_minor) / Decimal("700") * Decimal("1.03")
        assert p.price_minor == nice_round_up_minor(exact, 2)
        assert p.credit_fcfa == base[p.id].credit_fcfa                      # crédit fixe en FCFA


def test_offer_zero_and_three_decimals(client, multi):
    jpy = call(client, pricing.build_offer, "JPY")
    assert jpy.decimals == 0 and all(isinstance(p.price_minor, int) for p in jpy.packs)
    kwd = call(client, pricing.build_offer, "KWD")
    assert kwd.decimals == 3 and all(p.price_minor % 10 == 0 for p in kwd.packs)


def test_seeded_round_grids(client, multi):
    eur = call(client, pricing.build_offer, "EUR")
    assert eur.pricing_source == "grid" and [p.price_minor for p in eur.packs] == [100, 300, 800, 2500, 8000]
    assert all(p.credit_fcfa > 0 for p in eur.packs)


def test_grid_beats_computation(client, multi):
    pid = call(client, _add_pack, "CHF", 500, 3500)
    offer = call(client, pricing.build_offer, "CHF")
    assert offer.pricing_source == "grid"
    assert [(p.id, p.price_minor, p.credit_fcfa) for p in offer.packs] == [(pid, 500, 3500)]


def test_currency_margin_override(client, multi):
    call(client, _set_currency, "CHF", True, Decimal("10"))
    try:
        offer = call(client, pricing.build_offer, "CHF")
        p = offer.packs[0]
        exact = Decimal(500) / Decimal(700) * Decimal("1.10")
        assert p.price_minor == nice_round_up_minor(exact, 2)
    finally:
        call(client, _set_currency, "CHF", True, None)


def test_fallback_usd_when_no_provider(client, multi):
    offer = call(client, pricing.build_offer, "GHS")                       # aucun fournisseur actif
    assert offer.currency == "USD" and offer.fallback_reason == "no_provider"
    assert offer.requested_currency == "GHS"


def test_fallback_when_rate_stale_or_missing(client, multi):
    call(client, _set_rate, "JPY", "4.1", age_days=30)
    try:
        offer = call(client, pricing.build_offer, "JPY")
        assert offer.currency == "USD" and offer.fallback_reason == "rate_unavailable"
    finally:
        call(client, _set_rate, "JPY", "4.1")


def test_inactive_currency_falls_back(client, multi):
    call(client, _set_currency, "KWD", False)
    try:
        assert call(client, pricing.build_offer, "KWD").fallback_reason == "inactive"
    finally:
        call(client, _set_currency, "KWD", True)


# ═══════════════════════ Choix du fournisseur ═══════════════════════

def test_provider_routing_by_currency_and_country(monkeypatch):
    monkeypatch.setattr(settings, "fedapay_secret_key", "sk_x")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_x")
    monkeypatch.setattr(settings, "paystack_secret_key", "")
    assert [p.info.id for p in providers_for("XOF", "NE")] == ["fedapay", "stripe"]
    assert [p.info.id for p in providers_for("XOF", "US")] == ["stripe", "fedapay"]   # diaspora : les deux
    assert [p.info.id for p in providers_for("EUR", "FR")] == ["stripe"]
    assert providers_for("GHS", "GH") == []                                # Stripe n'accepte pas GHS
    monkeypatch.setattr(settings, "paystack_secret_key", "sk_x")
    assert [p.info.id for p in providers_for("NGN", "NG")] == ["paystack", "stripe"]
    assert [p.info.id for p in providers_for("GHS", "GH")] == ["paystack"]


def test_fallback_usd_via_stripe_message(client, user_and_token, monkeypatch):
    _, _, h = user_and_token
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_x")
    call(client, _set_currency, "GHS", True)
    call(client, _set_rate, "USD", "600")
    d = client.get("/api/pricing?currency=GHS", headers=h).json()
    assert d["currency"] == "USD" and d["fallback_reason"] == "no_provider"
    assert "USD" in d["message"] and [p["id"] for p in d["providers"]] == ["stripe"]


# ═══════════════════════ API, préférence, pays ═══════════════════════

def test_preference_and_country_suggestion(client, user_and_token, multi):
    _, _, h = user_and_token
    d = client.get("/api/pricing", headers={**h, "CF-IPCountry": "NE"}).json()
    assert d["currency"] == "XOF" and d["country"] == "NE" and d["free_amount"] is True
    assert d["bonus_tiers"] == [[5000, 15], [15000, 25], [50000, 35]] and d["min_fcfa"] == 500
    d = client.get("/api/pricing?country=FR", headers=h).json()           # indice de l'app
    assert d["currency"] == "EUR" and d["bonus_tiers"] == [] and d["manual"] is False
    assert client.put("/api/user/currency", headers=h, json={"currency": "jpy"}).json() == {"preferred_currency": "JPY"}
    d = client.get("/api/pricing", headers={**h, "CF-IPCountry": "NE"}).json()
    assert d["currency"] == "JPY" and d["preferred_currency"] == "JPY"   # le choix du compte l'emporte
    assert client.put("/api/user/currency", headers=h, json={"currency": "ZZZ"}).status_code == 400
    assert client.put("/api/user/currency", headers=h, json={"currency": None}).json()["preferred_currency"] is None
    cur = client.get("/api/currencies", headers=h).json()["currencies"]
    assert {"code": "KWD", "decimals": 3} .items() <= next(c for c in cur if c["code"] == "KWD").items()


# ═══════════════════════ Paiement : recalcul serveur et contrôle du webhook ═══════════════════════

def sign(payload: bytes, secret: str = SECRET) -> str:
    import time
    ts = int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def balance(client, h):
    return client.get("/api/credits", headers=h).json()["balance_fcfa"]


def test_pack_payment_recomputed_and_credited_once(client, user_and_token, multi):
    _, _, h = user_and_token
    offer = client.get("/api/pricing?currency=EUR", headers=h).json()
    pack = next(p for p in offer["packs"] if p["price_minor"] == 800)       # 8 € (grille ronde)
    # L'app tente d'imposer un prix : ignoré, le serveur recalcule
    r = client.post("/api/payments/initiate", headers=h, json={
        "provider": "multi", "currency": "EUR", "pack_id": pack["id"], "amount": 1,
        "charged_amount": 0.01})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["charged_currency"] == "eur" and d["charged_amount_minor"] == 800
    assert d["amount_fcfa"] == pack["credit_fcfa"]
    iid = d["intent_id"]
    body = json.dumps({"tx": f"m_{iid[:10]}"}).encode()

    # Montant modifié (1 centime de moins) → jamais crédité
    multi.remote = RemoteStatus("paid", 0, "eur", "paid", amount_minor=pack["price_minor"] - 1)
    client.post("/api/payments/webhook/multi", content=body, headers={"x-sig": sign(body)})
    assert balance(client, h) == 0
    assert "différent" in client.get(f"/api/payments/{iid}", headers=h).json()["failure_reason"]
    # Bon montant, mauvaise devise → refusé
    multi.remote = RemoteStatus("paid", 0, "usd", "paid", amount_minor=pack["price_minor"])
    client.post("/api/payments/webhook/multi", content=body, headers={"x-sig": sign(body)})
    assert balance(client, h) == 0
    # Montant et devise exacts → crédit du pack, SANS second bonus, une seule fois
    multi.remote = RemoteStatus("paid", 0, "eur", "paid", amount_minor=pack["price_minor"])
    for _ in range(3):
        client.post("/api/payments/webhook/multi", content=body, headers={"x-sig": sign(body)})
    assert balance(client, h) == pack["credit_fcfa"]

    tx = client.get("/api/credits/transactions", headers=h).json()["transactions"]
    rec = next(t for t in tx if t["type"] == "recharge")
    assert rec["paid_currency"] == "EUR" and rec["paid_amount_minor"] == pack["price_minor"]


def test_three_decimal_payment_exact(client, user_and_token, multi):
    _, _, h = user_and_token
    offer = client.get("/api/pricing?currency=KWD", headers=h).json()
    pack = offer["packs"][0]
    d = client.post("/api/payments/initiate", headers=h, json={
        "provider": "multi", "currency": "KWD", "pack_id": pack["id"]}).json()
    assert d["charged_amount_minor"] == pack["price_minor"] and d["charged_amount_minor"] % 10 == 0
    body = json.dumps({"tx": f"m_{d['intent_id'][:10]}"}).encode()
    multi.remote = RemoteStatus("paid", 0, "kwd", "paid", amount_minor=pack["price_minor"])
    client.post("/api/payments/webhook/multi", content=body, headers={"x-sig": sign(body)})
    assert balance(client, h) == pack["credit_fcfa"]


def test_initiate_rejects_tampering(client, user_and_token, multi):
    _, _, h = user_and_token
    eur_pack = call(client, _add_pack, "CHF", 900, 6000)
    jpy = client.get("/api/pricing?currency=JPY", headers=h).json()
    # pack d'une autre devise
    assert client.post("/api/payments/initiate", headers=h, json={
        "provider": "multi", "currency": "JPY", "pack_id": eur_pack}).status_code == 400
    # montant libre hors XOF
    assert client.post("/api/payments/initiate", headers=h, json={
        "provider": "multi", "currency": "EUR", "amount": 5000}).status_code == 400
    # devise inconnue / non acceptée par ce fournisseur
    assert client.post("/api/payments/initiate", headers=h, json={
        "provider": "multi", "currency": "GHS", "pack_id": jpy["packs"][0]["id"]}).status_code == 400
    # montant libre XOF : bonus des paliers conservé
    r = client.post("/api/payments/initiate", headers=h, json={
        "provider": "multi", "currency": "XOF", "amount": 6000})
    assert r.status_code == 200 and r.json()["charged_amount_minor"] == 6000


# ═══════════════════════ Taux : sources, panne, parité fixe ═══════════════════════

def _src(id_, fn):
    return fx.Source(id_, fn)


def test_fx_first_source_down_second_used(client, multi):
    async def broken(c):
        raise httpx.ConnectError("down")

    async def good(c):
        return {"EUR": Decimal(1), "USD": Decimal("1.10"), "XOF": Decimal("655.96"),
                "NGN": Decimal("1500"), "ADA": Decimal("7.6")}            # ADA (crypto) ignoré

    res = call(client, fx.refresh_rates, client=httpx.AsyncClient(), sources=[_src("a", broken), _src("b", good)])
    assert res.ok and res.source == "b" and "a" in res.errors
    usd = call(client, _get_rate, "USD")
    assert usd.source == "b" and round(float(usd.fcfa_per_unit), 3) == round(655.957 / 1.10, 3)
    eur = call(client, _get_rate, "EUR")
    assert eur.is_fixed and float(eur.fcfa_per_unit) == 655.957               # jamais téléchargé
    assert call(client, _get_rate, "ADA") is None


def test_fx_all_sources_down_keeps_last_rate(client, multi):
    before = call(client, _get_rate, "USD")

    async def broken(c):
        raise httpx.ReadTimeout("timeout")

    async def wrong_anchor(c):      # source incohérente : XOF/EUR loin de la parité
        return {"EUR": Decimal(1), "USD": Decimal("1.1"), "XOF": Decimal("700")}

    res = call(client, fx.refresh_rates, client=httpx.AsyncClient(),
               sources=[_src("a", broken), _src("b", wrong_anchor)])
    assert not res.ok and set(res.errors) == {"a", "b"}
    after = call(client, _get_rate, "USD")
    assert after.fcfa_per_unit == before.fcfa_per_unit and after.fetched_at == before.fetched_at

    async def last_log():
        Session = get_sessionmaker()
        async with Session() as s:
            return await s.scalar(select(FxFetchLog).order_by(FxFetchLog.id.desc()).limit(1))
    log = call(client, last_log)
    assert not log.ok and "a:" in log.message
    # Prix toujours affichables avec le dernier taux connu
    assert call(client, pricing.build_offer, "USD").currency == "USD"


def test_fx_big_jump_rejected_then_forced(client, multi):
    call(client, _set_rate, "USD", "600")

    async def jump(c):
        return {"EUR": Decimal(1), "USD": Decimal("0.5"), "XOF": Decimal("655.957")}   # ×2,2

    res = call(client, fx.refresh_rates, client=httpx.AsyncClient(), sources=[_src("j", jump)])
    assert res.ok and "USD" in res.rejected
    assert float(call(client, _get_rate, "USD").fcfa_per_unit) == 600
    call(client, fx.force_rate, "USD", Decimal("1311.914"))
    assert call(client, _get_rate, "USD").source == "manuel"
    with pytest.raises(ValueError):
        call(client, fx.force_rate, "EUR", Decimal("700"))                     # parité fixe protégée
    call(client, _set_rate, "USD", "600")


def test_fx_real_source_parsers():
    def handler(req: httpx.Request):
        if req.url.host == "open.er-api.com":
            return httpx.Response(200, json={"result": "success", "rates": {"EUR": 1, "USD": 1.0977, "XOF": 655.957}})
        return httpx.Response(200, json=[{"date": "2026-11-23", "base": "EUR", "quote": "NGN", "rate": 1521.75},
                                         {"date": "2026-11-23", "base": "EUR", "quote": "USD", "rate": 1.0977}])

    c = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    loop = asyncio.new_event_loop()
    a = loop.run_until_complete(fx._er_api(c))
    b = loop.run_until_complete(fx._frankfurter(c))
    assert a["USD"] == Decimal("1.0977") and b["NGN"] == Decimal("1521.75") and b["EUR"] == 1


# ═══════════════════════ Adaptateurs Paystack / Flutterwave (simulés) ═══════════════════════

def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_paystack_adapter(monkeypatch):
    monkeypatch.setattr(settings, "paystack_secret_key", "")
    assert not PaystackProvider().enabled()                                   # sans clé : désactivé
    monkeypatch.setattr(settings, "paystack_secret_key", "sk_test_ps")
    seen = {}

    def handler(req: httpx.Request):
        if req.method == "POST":
            seen["body"] = json.loads(req.content)
            seen["auth"] = req.headers["authorization"]
            return httpx.Response(200, json={"status": True, "data": {
                "authorization_url": "https://checkout.paystack.com/abc", "reference": "anzar_iid1"}})
        return httpx.Response(200, json={"status": True, "data": {
            "status": "success", "amount": 750000, "currency": "NGN", "id": 99}})

    p = PaystackProvider(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    q = p.quote(750000, "NGN")                                                # 7 500,00 ₦
    co = run(p.create_checkout(intent_id="iid1", amount_fcfa=5750, quote=q, customer_email="a@b.c",
                               return_url="https://r/ok", cancel_url="https://r/no"))
    assert co.tx_id == "anzar_iid1" and co.payment_url.startswith("https://checkout.paystack.com")
    assert seen["body"]["amount"] == "750000" and seen["body"]["currency"] == "NGN"
    assert seen["auth"] == "Bearer sk_test_ps"
    assert p.to_provider_amount(5000, "XOF") == 500000                       # XOF ×100 chez Paystack
    st = run(p.fetch_status("anzar_iid1"))
    assert (st.state, st.amount_minor, st.currency) == ("paid", 750000, "ngn")

    body = json.dumps({"event": "charge.success", "data": {"reference": "anzar_iid1"}}).encode()
    good = hmac.new(b"sk_test_ps", body, hashlib.sha512).hexdigest()
    assert p.webhook_tx_id(body, {"x-paystack-signature": good}) == "anzar_iid1"
    with pytest.raises(SignatureError):
        p.webhook_tx_id(body, {"x-paystack-signature": "0" * 128})
    with pytest.raises(SignatureError):
        p.webhook_tx_id(body + b" ", {"x-paystack-signature": good})
    ref = json.dumps({"event": "refund.processed", "data": {
        "transaction_reference": "anzar_iid1", "amount": 750000, "currency": "NGN"}}).encode()
    ev = p.webhook_refund_event(ref, {"x-paystack-signature": hmac.new(b"sk_test_ps", ref, hashlib.sha512).hexdigest()})
    assert (ev.intent_id, ev.state, ev.amount) == ("iid1", "refunded", 7500.0)


def test_flutterwave_adapter(monkeypatch):
    monkeypatch.setattr(settings, "flutterwave_secret_key", "")
    assert not FlutterwaveProvider().enabled()
    monkeypatch.setattr(settings, "flutterwave_secret_key", "FLWSECK_TEST-x")
    monkeypatch.setattr(settings, "flutterwave_webhook_hash", "hash-123")
    seen = {}

    def handler(req: httpx.Request):
        if req.method == "POST":
            seen["body"] = json.loads(req.content)
            return httpx.Response(200, json={"status": "success", "data": {"link": "https://checkout.flutterwave.com/x"}})
        seen["params"] = dict(req.url.params)
        return httpx.Response(200, json={"status": "success", "data": {
            "status": "successful", "amount": 15000, "currency": "UGX", "id": 7}})

    p = FlutterwaveProvider(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    q = p.quote(15000, "UGX")                                                 # UGX : 0 décimale
    co = run(p.create_checkout(intent_id="iid2", amount_fcfa=2300, quote=q, customer_email="a@b.c",
                               return_url="https://r/ok", cancel_url="https://r/no"))
    assert co.tx_id == "anzar_iid2" and seen["body"]["amount"] == "15000" and seen["body"]["currency"] == "UGX"
    assert p.to_provider_amount(750, "EUR") == "7.50"
    st = run(p.fetch_status("anzar_iid2"))
    assert seen["params"] == {"tx_ref": "anzar_iid2"}
    assert (st.state, st.amount_minor) == ("paid", 15000)

    body = json.dumps({"event": "charge.completed", "data": {"tx_ref": "anzar_iid2"}}).encode()
    assert p.webhook_tx_id(body, {"verif-hash": "hash-123"}) == "anzar_iid2"
    with pytest.raises(SignatureError):
        p.webhook_tx_id(body, {"verif-hash": "faux"})
    with pytest.raises(PaymentError):
        p.quote(15000, "EUR")                                                 # non déclaré
