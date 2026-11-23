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
    Checkout, PaymentError, PaymentProvider, ProviderInfo, Quote, RefundEvent, RemoteStatus, SignatureError,
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
    info = ProviderInfo(id="fake", label="Test", kind="card", description="", countries=["*"],
                        currencies=["XOF", "USD", "EUR", "KWD"], priority=1)

    def __init__(self):
        self.remote = RemoteStatus("pending", 0, "xof", "open")
        self.created = 0
        self.fail_create = False
        self.last_quote = None

    def enabled(self):
        return True

    def webhooks_enabled(self):
        return True

    async def create_checkout(self, **kw):
        self.last_quote = kw["quote"]
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

    def webhook_refund_event(self, raw, headers):
        verify_timestamped_signature(header_get(headers, "x-sig"), raw, SECRET, "v1")
        body = json.loads(raw)
        r = body.get("refund")
        if not r:
            return None
        return RefundEvent(intent_id=r.get("intent_id", ""), tx_id=r.get("tx", ""),
                           amount=float(r.get("amount") or 0), currency="usd",
                           state=r.get("state", "refunded"), raw_status="refund")


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


def paid(amount_minor, currency="xof", decimals=0):
    return RemoteStatus("paid", amount_minor / (10 ** decimals), currency, "complete/paid",
                        amount_minor=amount_minor)


def test_full_flow_webhook_credits_once(client, user_and_token, fake):
    _, _, h = user_and_token
    # Ancien format de l'app (montant libre, sans devise) : traité comme XOF
    r = client.post("/api/payments/initiate", headers=h, json={"amount": 6000, "provider": "fake"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["paymentUrl"] == "https://pay.example/x" and d["status"] == "pending"
    assert d["charged_currency"] == "xof" and d["charged_amount_minor"] == 6000
    iid = d["intent_id"]
    assert balance(client, h) == 0

    # Encore en attente chez le fournisseur : rien n'est crédité
    assert client.get(f"/api/payments/{iid}", headers=h).json()["status"] == "pending"

    # Payé chez le fournisseur → webhook signé
    fake.remote = paid(6000)
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


def test_refund_debits_and_blocks_account(client, user_and_token, fake):
    email, _, h = user_and_token
    iid = client.post("/api/payments/initiate", headers=h, json={"amount": 6000, "provider": "fake"}).json()["intent_id"]
    fake.remote = paid(6000)
    body = json.dumps({"tx": f"tx_{iid[:8]}"}).encode()
    assert client.post("/api/payments/webhook/fake", content=body, headers={"x-sig": sign(body)}).status_code == 200
    assert balance(client, h) == 6900

    refund_body = json.dumps({"refund": {
        "intent_id": iid, "amount": 6000, "state": "refunded"}}).encode()
    headers = {"x-sig": sign(refund_body)}
    assert client.post("/api/payments/webhook/fake", content=refund_body, headers=headers).status_code == 200

    from db import get_credits
    assert client.portal.call(get_credits, email)['balance_fcfa'] == 0
    # Le changement de statut + le blocage sont terminaux et idempotents.
    assert client.post("/api/payments/webhook/fake", content=refund_body, headers=headers).status_code == 200
    assert client.portal.call(get_credits, email)['balance_fcfa'] == 0
    assert client.get("/api/auth/verify", headers=h).status_code == 401
    assert client.get(f"/api/payments/{iid}", headers=h).status_code == 401
    # La demande n'est plus accessible avec un jeton utilisateur, mais l'admin la voit.
    # (Le compte est désactivé : on vérifie directement en base via le statut public/admin.)


def test_concurrent_settlement_credits_once(client, user_and_token, fake):
    email, _, h = user_and_token
    iid = client.post("/api/payments/initiate", headers=h, json={"amount": 1200, "provider": "fake"}).json()["intent_id"]
    fake.remote = paid(1200)

    async def race():
        await asyncio.gather(*[svc.refresh_intent(iid) for _ in range(5)])

    # Le TestClient possède la boucle d'event : on passe par un portail
    client.portal.call(race)
    assert balance(client, h) == 1200


def test_amount_mismatch_is_never_credited(client, user_and_token, fake):
    _, _, h = user_and_token
    iid = client.post("/api/payments/initiate", headers=h, json={"amount": 3000, "provider": "fake"}).json()["intent_id"]
    fake.remote = paid(2999)                                             # 1 F de moins
    d = client.get(f"/api/payments/{iid}", headers=h).json()
    assert d["status"] == "pending" and "différent" in d["failure_reason"]
    fake.remote = paid(3000, "eur")                                      # bon montant, mauvaise devise
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
    q = p.quote(5000, "XOF")
    assert (q.amount, q.currency, q.amount_minor) == (5000, "xof", 5000)
    with pytest.raises(PaymentError):
        p.quote(500, "EUR")                    # FedaPay ne déclare que XOF
    co = run(p.create_checkout(intent_id="abc", amount_fcfa=5000, quote=q, customer_email="a@b.c",
                               return_url="https://r/ok", cancel_url="https://r/no"))
    assert co.tx_id == "4242" and co.payment_url.startswith("https://sandbox-process")
    assert seen[0][0:3] == ("POST", "/v1/transactions", "Bearer sk_sandbox_x")
    assert seen[0][3]["amount"] == 5000 and seen[0][3]["currency"] == {"iso": "XOF"}
    assert seen[0][3]["callback_url"] == "https://r/ok"
    st = run(p.fetch_status("4242"))
    assert (st.state, st.amount, st.amount_minor) == ("paid", 5000, 5000)

    body = json.dumps({"name": "transaction.approved", "entity": {"id": 4242}}).encode()
    assert p.webhook_tx_id(body, {"X-FEDAPAY-SIGNATURE": sign(body, scheme="s")}) == "4242"
    with pytest.raises(SignatureError):
        p.webhook_tx_id(body, {"X-FEDAPAY-SIGNATURE": sign(body, scheme="v1")})
    ev = json.dumps({"name": "customer.created", "entity": {"id": 1}}).encode()
    assert p.webhook_tx_id(ev, {"x-fedapay-signature": sign(ev, scheme="s")}) is None


def test_stripe_adapter(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(settings, "stripe_webhook_secret", SECRET)
    seen = {}

    def handler(req: httpx.Request):
        if req.method == "POST":
            seen["form"] = dict(httpx.QueryParams(req.content.decode()))
            seen["idem"] = req.headers.get("idempotency-key")
            return httpx.Response(200, json={"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"})
        return httpx.Response(200, json={"id": "cs_test_1", "status": "complete", "payment_status": "paid",
                                         "amount_total": 834, "currency": "usd"})

    p = StripeProvider(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    q = p.quote(834, "USD")
    assert (q.amount, q.currency, q.amount_minor) == (8.34, "usd", 834)
    co = run(p.create_checkout(intent_id="iid1", amount_fcfa=5000, quote=q, customer_email="a@b.c",
                               return_url="https://r/ok", cancel_url="https://r/no"))
    assert co.tx_id == "cs_test_1"
    f = seen["form"]
    assert f["line_items[0][price_data][unit_amount]"] == "834" and f["mode"] == "payment"
    assert f["client_reference_id"] == "iid1" and seen["idem"] == "anzar-iid1"
    st = run(p.fetch_status("cs_test_1"))
    assert (st.state, st.amount, st.currency, st.amount_minor) == ("paid", 8.34, "usd", 834)

    body = json.dumps({"type": "checkout.session.completed", "data": {"object": {"id": "cs_test_1"}}}).encode()
    assert p.webhook_tx_id(body, {"Stripe-Signature": sign(body)}) == "cs_test_1"
    other = json.dumps({"type": "charge.refunded", "data": {"object": {"id": "ch_1"}}}).encode()
    assert p.webhook_tx_id(other, {"stripe-signature": sign(other)}) is None
    refund_body = json.dumps({"type": "charge.refunded", "data": {"object": {
        "id": "ch_1", "payment_intent": "pi_1", "amount_refunded": 834,
        "currency": "usd", "metadata": {"intent_id": "iid1"}}}}).encode()
    re = p.webhook_refund_event(refund_body, {"stripe-signature": sign(refund_body)})
    assert (re.intent_id, re.payment_id, re.state, re.amount) == ("iid1", "pi_1", "refunded", 8.34)

    # Unités Stripe ≠ ISO : XOF tel quel, ISK/UGX ×100, MGA ÷100, KWD par pas de 10
    assert p.to_provider_amount(5000, "XOF") == 5000
    assert p.to_provider_amount(5, "ISK") == 500 and p.from_provider_amount(500, "ISK") == 5
    assert p.to_provider_amount(500000, "UGX") == 50000000
    assert p.to_provider_amount(1250000, "MGA") == 12500 and p.granularity("MGA") == 100
    assert p.to_provider_amount(750, "KWD") == 750 and p.granularity("KWD") == 10
    with pytest.raises(PaymentError):
        p.quote(735, "KWD")                    # 0,735 KWD : dernier chiffre ≠ 0 refusé par Stripe
    with pytest.raises(PaymentError):
        p.to_provider_amount(1250050, "MGA")   # fraction d'ariary impossible
