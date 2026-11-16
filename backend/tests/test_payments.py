"""
Paiements automatiques : signatures, règlement unique, montant incorrect, accès aux demandes
d'un autre compte, et adaptateurs FedaPay / Stripe contre des réponses simulées.
"""
import asyncio
import hashlib
import hmac
import json
import time

import httpx
import pytest

from config import settings
from services.payments import service as svc
from services.payments.base import (
    Checkout, PaymentProvider, ProviderInfo, Quote, RemoteStatus, SignatureError,
    header_get, verify_timestamped_signature,
)
from services.payments.fedapay import FedaPayProvider
from services.payments.stripe_provider import StripeProvider

SECRET = "whsec_test_secret"


def sign(payload: bytes, secret: str = SECRET, scheme: str = "v1", ts: int | None = None) -> str:
    ts = int(time.time()) if ts is None else ts
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={ts},{scheme}={sig}"


# ── Signature ──

def test_signature_ok_and_rejections():
    body = b'{"a":1}'
    verify_timestamped_signature(sign(body), body, SECRET, "v1")
    with pytest.raises(SignatureError):
        verify_timestamped_signature(sign(body, "autre"), body, SECRET, "v1")
    with pytest.raises(SignatureError):
        verify_timestamped_signature(sign(body), b'{"a":2}', SECRET, "v1")
    with pytest.raises(SignatureError):
        verify_timestamped_signature(sign(body, ts=int(time.time()) - 3600), body, SECRET, "v1")
    with pytest.raises(SignatureError):
        verify_timestamped_signature(sign(body, scheme="s"), body, SECRET, "v1")
    with pytest.raises(SignatureError):
        verify_timestamped_signature("", body, SECRET, "v1")
    with pytest.raises(SignatureError):
        verify_timestamped_signature(sign(body), body, "", "v1")


# ── Fournisseur factice branché dans le registre ──

class FakeProvider(PaymentProvider):
    info = ProviderInfo(id="fake", label="Test", kind="card", description="", countries=["*"])

    def __init__(self):
        self.remote = RemoteStatus("pending", 0, "usd", "open")
        self.created = 0
        self.fail_create = False

    def enabled(self):
        return True

    def webhooks_enabled(self):
        return True

    def fcfa_per_unit(self):
        return 600.0

    def quote(self, amount_fcfa):
        return Quote(amount=round(amount_fcfa / 600, 2), currency="usd")

    async def create_checkout(self, **kw):
        if self.fail_create:
            from services.payments.base import PaymentError
            raise PaymentError("refusé")
        self.created += 1
        return Checkout(tx_id=f"tx_{kw['intent_id'][:8]}", payment_url="https://pay.example/x")

    async def fetch_status(self, tx_id):
        return self.remote

    def webhook_tx_id(self, raw, headers):
        verify_timestamped_signature(header_get(headers, "x-sig"), raw, SECRET, "v1")
        return json.loads(raw).get("tx")


@pytest.fixture()
def fake():
    p = FakeProvider()
    svc.PROVIDERS["fake"] = p
    yield p
    svc.PROVIDERS.pop("fake", None)


def balance(client, headers):
    return client.get("/api/credits", headers=headers).json()["balance_fcfa"]


def test_methods_lists_enabled_providers(client, user_and_token, fake):
    _, _, h = user_and_token
    data = client.get("/api/payments/methods", headers=h).json()
    ids = [p["id"] for p in data["providers"]]
    assert "fake" in ids
    if not settings.fedapay_secret_key:
        assert "fedapay" not in ids   # non configuré → invisible
    assert data["min_fcfa"] == 500


def test_full_flow_webhook_credits_once(client, user_and_token, fake):
    _, _, h = user_and_token
    r = client.post("/api/payments/initiate", headers=h, json={"amount": 6000, "provider": "fake"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["paymentUrl"] == "https://pay.example/x" and d["status"] == "pending"
    assert d["charged_currency"] == "usd" and d["charged_amount"] == 10.0
    iid = d["intent_id"]
    assert balance(client, h) == 0

    # Encore en attente chez le fournisseur : rien n'est crédité
    assert client.get(f"/api/payments/{iid}", headers=h).json()["status"] == "pending"

    # Payé chez le fournisseur → webhook signé
    fake.remote = RemoteStatus("paid", 10.0, "usd", "complete/paid")
    body = json.dumps({"tx": f"tx_{iid[:8]}"}).encode()
    bad = client.post("/api/payments/webhook/fake", content=body, headers={"x-sig": sign(body, "faux")})
    assert bad.status_code == 400
    assert balance(client, h) == 0
    ok = client.post("/api/payments/webhook/fake", content=body, headers={"x-sig": sign(body)})
    assert ok.status_code == 200 and ok.json()["result"] == "ok"
    # 6000 F + bonus 15 % (palier 5000)
    assert balance(client, h) == 6900

    # Rejeu du webhook + sondage de l'app + page de retour : toujours un seul crédit
    client.post("/api/payments/webhook/fake", content=body, headers={"x-sig": sign(body)})
    assert client.get(f"/api/payments/{iid}", headers=h).json()["status"] == "paid"
    assert client.get(f"/api/payments/return?i={iid}").status_code == 200
    assert balance(client, h) == 6900


def test_concurrent_settlement_credits_once(client, user_and_token, fake):
    email, _, h = user_and_token
    iid = client.post("/api/payments/initiate", headers=h, json={"amount": 1200, "provider": "fake"}).json()["intent_id"]
    fake.remote = RemoteStatus("paid", 2.0, "usd", "complete/paid")

    async def race():
        await asyncio.gather(*[svc.refresh_intent(iid) for _ in range(5)])

    # Le TestClient possède la boucle d'event : on passe par un portail
    client.portal.call(race)
    assert balance(client, h) == 1200


def test_amount_mismatch_is_never_credited(client, user_and_token, fake):
    _, _, h = user_and_token
    iid = client.post("/api/payments/initiate", headers=h, json={"amount": 3000, "provider": "fake"}).json()["intent_id"]
    fake.remote = RemoteStatus("paid", 0.5, "usd", "complete/paid")
    d = client.get(f"/api/payments/{iid}", headers=h).json()
    assert d["status"] == "pending" and "différent" in d["failure_reason"]
    fake.remote = RemoteStatus("paid", 5.0, "eur", "complete/paid")   # bonne valeur, mauvaise devise
    client.get(f"/api/payments/{iid}", headers=h)
    assert balance(client, h) == 0


def test_cancelled_and_other_users_intent(client, user_and_token, fake):
    _, _, h = user_and_token
    iid = client.post("/api/payments/initiate", headers=h, json={"amount": 1000, "provider": "fake"}).json()["intent_id"]
    other = client.post("/api/auth/register", json={"email": f"o-{iid[:6]}@test.local", "password": "password123"})
    oh = {"Authorization": f"Bearer {other.json()['token']}"}
    assert client.get(f"/api/payments/{iid}", headers=oh).status_code == 404
    assert client.get(f"/api/payments/{iid}").status_code in (401, 403)
    fake.remote = RemoteStatus("cancelled", 0, "", "expired/unpaid")
    assert client.get(f"/api/payments/{iid}", headers=h).json()["status"] == "cancelled"


def test_initiate_validation_and_provider_failure(client, user_and_token, fake):
    _, _, h = user_and_token
    assert client.post("/api/payments/initiate", headers=h, json={"amount": 100, "provider": "fake"}).status_code == 400
    assert client.post("/api/payments/initiate", headers=h, json={"amount": 1000, "provider": "inconnu"}).status_code == 400
    fake.fail_create = True
    r = client.post("/api/payments/initiate", headers=h, json={"amount": 1000, "provider": "fake"})
    assert r.status_code == 502
    # Sans fournisseur : demande manuelle, comme avant
    r = client.post("/api/payments/initiate", headers=h, json={"amount": 1000, "method": "wave"})
    assert r.status_code == 200 and r.json()["paymentUrl"] is None


def test_webhook_unknown_provider_and_unknown_tx(client, fake):
    assert client.post("/api/payments/webhook/nope", content=b"{}").status_code == 404
    body = json.dumps({"tx": "tx_inexistant"}).encode()
    r = client.post("/api/payments/webhook/fake", content=body, headers={"x-sig": sign(body)})
    assert r.status_code == 200 and r.json()["result"] == "ignored"


# ── Adaptateurs réels contre des réponses simulées ──

def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_fedapay_adapter(monkeypatch):
    monkeypatch.setattr(settings, "fedapay_secret_key", "sk_sandbox_x")
    monkeypatch.setattr(settings, "fedapay_webhook_secret", SECRET)
    seen = []

    def handler(req: httpx.Request):
        seen.append((req.method, req.url.path, req.headers.get("authorization"),
                     json.loads(req.content) if req.content else None))
        if req.url.path == "/v1/transactions" and req.method == "POST":
            return httpx.Response(200, json={"v1/transaction": {"id": 4242, "status": "pending"}})
        if req.url.path == "/v1/transactions/4242/token":
            return httpx.Response(200, json={"token": "tok", "url": "https://sandbox-process.fedapay.com/tok"})
        if req.url.path == "/v1/transactions/4242":
            return httpx.Response(200, json={"v1/transaction": {"id": 4242, "status": "approved", "amount": 5000}})
        return httpx.Response(404, json={"message": "x"})

    p = FedaPayProvider(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    q = p.quote(5000)
    assert (q.amount, q.currency) == (5000, "xof")
    co = run(p.create_checkout(intent_id="abc", amount_fcfa=5000, quote=q, customer_email="a@b.c",
                               return_url="https://r/ok", cancel_url="https://r/no"))
    assert co.tx_id == "4242" and co.payment_url.startswith("https://sandbox-process")
    assert seen[0][0:3] == ("POST", "/v1/transactions", "Bearer sk_sandbox_x")
    assert seen[0][3]["amount"] == 5000 and seen[0][3]["currency"] == {"iso": "XOF"}
    assert seen[0][3]["callback_url"] == "https://r/ok"
    st = run(p.fetch_status("4242"))
    assert (st.state, st.amount) == ("paid", 5000)

    body = json.dumps({"name": "transaction.approved", "entity": {"id": 4242}}).encode()
    assert p.webhook_tx_id(body, {"X-FEDAPAY-SIGNATURE": sign(body, scheme="s")}) == "4242"
    with pytest.raises(SignatureError):
        p.webhook_tx_id(body, {"X-FEDAPAY-SIGNATURE": sign(body, scheme="v1")})
    ev = json.dumps({"name": "customer.created", "entity": {"id": 1}}).encode()
    assert p.webhook_tx_id(ev, {"x-fedapay-signature": sign(ev, scheme="s")}) is None


def test_stripe_adapter(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(settings, "stripe_webhook_secret", SECRET)
    monkeypatch.setattr(settings, "stripe_currency", "usd")
    monkeypatch.setattr(settings, "stripe_fcfa_per_unit", 600.0)
    seen = {}

    def handler(req: httpx.Request):
        if req.method == "POST":
            seen["form"] = dict(httpx.QueryParams(req.content.decode()))
            seen["idem"] = req.headers.get("idempotency-key")
            return httpx.Response(200, json={"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"})
        return httpx.Response(200, json={"id": "cs_test_1", "status": "complete", "payment_status": "paid",
                                         "amount_total": 834, "currency": "usd"})

    p = StripeProvider(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    q = p.quote(5000)
    assert (q.amount, q.currency) == (8.34, "usd")       # 8,333… arrondi au centime supérieur
    co = run(p.create_checkout(intent_id="iid1", amount_fcfa=5000, quote=q, customer_email="a@b.c",
                               return_url="https://r/ok", cancel_url="https://r/no"))
    assert co.tx_id == "cs_test_1"
    f = seen["form"]
    assert f["line_items[0][price_data][unit_amount]"] == "834" and f["mode"] == "payment"
    assert f["client_reference_id"] == "iid1" and seen["idem"] == "anzar-iid1"
    st = run(p.fetch_status("cs_test_1"))
    assert (st.state, st.amount, st.currency) == ("paid", 8.34, "usd")

    body = json.dumps({"type": "checkout.session.completed", "data": {"object": {"id": "cs_test_1"}}}).encode()
    assert p.webhook_tx_id(body, {"Stripe-Signature": sign(body)}) == "cs_test_1"
    other = json.dumps({"type": "charge.refunded", "data": {"object": {"id": "ch_1"}}}).encode()
    assert p.webhook_tx_id(other, {"stripe-signature": sign(other)}) is None

    monkeypatch.setattr(settings, "stripe_currency", "xof")
    monkeypatch.setattr(settings, "stripe_fcfa_per_unit", 0.0)
    assert p.quote(5000).amount == 5000
