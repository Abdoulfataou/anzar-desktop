"""Admin multidevise : devises, marge, grille de packs (prix exacts, écart au marché), taux forcés, paiements par devise."""
from tests.test_admin_panel import _admin_session


def test_currencies_list_and_patch(client, admin_headers):
    d = client.get("/api/admin/currencies", headers=admin_headers).json()
    by = {c["code"]: c for c in d["currencies"]}
    assert len(by) >= 150 and by["KWD"]["decimals"] == 3 and by["XAF"]["decimals"] == 0
    assert by["EUR"]["rate_fixed"] and by["EUR"]["fcfa_per_unit"] == 655.957
    assert any(p["id"] == "stripe" for p in by["USD"]["providers"])
    assert d["settings"]["margin_pct"] == "3"

    r = client.patch("/api/admin/currencies/bhd", headers=admin_headers, json={"active": True, "margin_pct": 5})
    assert r.status_code == 200
    bhd = next(c for c in client.get("/api/admin/currencies", headers=admin_headers).json()["currencies"] if c["code"] == "BHD")
    assert bhd["active"] and bhd["margin_pct"] == 5
    client.patch("/api/admin/currencies/BHD", headers=admin_headers, json={"active": False, "clear_margin": True})
    assert client.patch("/api/admin/currencies/ZZZ", headers=admin_headers, json={"active": True}).status_code == 404


def test_packs_crud_exact_prices_and_deviation(client, admin_headers):
    h = admin_headers
    assert client.post("/api/admin/packs", headers=h, json={"currency": "EUR", "price": "5.005", "credit_fcfa": 3000}).status_code == 400
    assert client.post("/api/admin/packs", headers=h, json={"currency": "XAF", "price": "1000.5", "credit_fcfa": 1000}).status_code == 400
    r = client.post("/api/admin/packs", headers=h, json={"currency": "EUR", "price": "5,00", "credit_fcfa": 3500, "label": "Essai"})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    assert client.post("/api/admin/packs", headers=h, json={"currency": "EUR", "price": "5", "credit_fcfa": 1}).status_code == 400
    grid = client.get("/api/admin/packs?currency=EUR", headers=h).json()
    p = next(x for x in grid["packs"] if x["id"] == pid)
    assert p["price_minor"] == 500 and p["price"] == "5.00"
    assert p["implied_fcfa_per_unit"] == 700 and round(p["deviation_pct"], 1) == round((700 / 655.957 - 1) * 100, 1)

    r = client.post("/api/admin/packs", headers=h, json={"currency": "KWD", "price": "1.235", "credit_fcfa": 2000})
    assert r.status_code == 200
    kwd = client.get("/api/admin/packs?currency=KWD", headers=h).json()["packs"][0]
    assert kwd["price_minor"] == 1235 and any("Stripe" in i or "Carte" in i for i in kwd["issues"])   # pas de 10 chez Stripe
    client.delete(f"/api/admin/packs/{kwd['id']}", headers=h)

    assert client.patch(f"/api/admin/packs/{pid}", headers=h, json={"active": False, "credit_fcfa": 3300}).status_code == 200
    assert next(x for x in client.get("/api/admin/packs?currency=EUR", headers=h).json()["packs"] if x["id"] == pid)["active"] is False
    assert client.delete(f"/api/admin/packs/{pid}", headers=h).status_code == 200
    assert client.delete(f"/api/admin/packs/{pid}", headers=h).status_code == 404


def test_settings_force_rate_preview_and_roles(client, admin_headers):
    h = admin_headers
    assert client.put("/api/admin/pricing/settings", headers=h, json={"margin_pct": "4"}).json()["margin_pct"] == "4"
    assert client.put("/api/admin/pricing/settings", headers=h, json={"margin_pct": "-1"}).status_code == 400
    assert client.put("/api/admin/pricing/settings", headers=h, json={"fallback_currency": "x"}).status_code == 400
    client.put("/api/admin/pricing/settings", headers=h, json={"margin_pct": "3"})

    assert client.put("/api/admin/fx/rates/USD", headers=h, json={"fcfa_per_unit": 601.5}).status_code == 200
    assert client.put("/api/admin/fx/rates/EUR", headers=h, json={"fcfa_per_unit": 700}).status_code == 400
    usd = next(c for c in client.get("/api/admin/currencies", headers=h).json()["currencies"] if c["code"] == "USD")
    assert usd["fcfa_per_unit"] == 601.5 and usd["rate_source"] == "manuel"
    assert "log" in client.get("/api/admin/fx", headers=h).json()
    assert client.get("/api/admin/pricing/preview?currency=XOF", headers=h).json()["currency"] in ("XOF", "USD")

    _, ro, _ = _admin_session(client, h, "readonly")
    assert client.get("/api/admin/currencies", headers=ro).status_code == 200
    assert client.patch("/api/admin/currencies/USD", headers=ro, json={"active": False}).status_code == 403
    assert client.post("/api/admin/packs", headers=ro, json={"currency": "EUR", "price": "9", "credit_fcfa": 1}).status_code == 403
    assert client.post("/api/admin/fx/refresh", headers=ro).status_code == 403
    assert client.put("/api/admin/fx/rates/USD", headers=ro, json={"fcfa_per_unit": 1}).status_code == 403


def test_payments_by_currency(client, admin_headers, user_and_token):
    _, _, uh = user_and_token
    client.post("/api/payments/initiate", headers=uh, json={"amount": 1500, "currency": "XOF", "method": "wave"})
    d = client.get("/api/admin/payments/by-currency?days=30", headers=admin_headers).json()
    assert isinstance(d["currencies"], list)
    lst = client.get("/api/admin/payments?status=all&currency=XOF", headers=admin_headers).json()
    assert lst["total"] >= 1
    assert all((p["charged_currency"] or p["currency"]).upper() == "XOF" for p in lst["payment_intents"])
    assert client.get("/api/admin/payments?status=all&currency=JPY", headers=admin_headers).json()["total"] == 0
    xof = next(c for c in d["currencies"] if c["currency"] == "XOF")
    assert xof["pending_count"] >= 1
