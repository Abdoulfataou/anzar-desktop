"""Tests crédits — self-recharge désactivée, consultation, grant admin, rôles."""

from config import settings


def _welcome() -> float:
    return float(getattr(settings, "welcome_bonus_fcfa", 0) or 0)


def test_get_credits_new_user(client, user_and_token):
    _, _, headers = user_and_token
    res = client.get("/api/credits", headers=headers)
    assert res.status_code == 200
    # solde initial = welcome bonus (0 si non configuré)
    assert res.json()["balance_fcfa"] == _welcome()


def test_credits_require_auth(client):
    assert client.get("/api/credits").status_code == 401


def test_self_recharge_disabled(client, user_and_token):
    """Faille historique : self-crédit sur simple payment_ref → désormais 403."""
    _, _, headers = user_and_token
    res = client.post(
        "/api/credits/recharge",
        headers=headers,
        json={"amount_fcfa": 500_000, "payment_ref": "FAKE-REF-123456", "payment_method": "wave"},
    )
    assert res.status_code == 403
    # Le solde n'a pas bougé (welcome bonus éventuel, mais pas 500 000)
    assert client.get("/api/credits", headers=headers).json()["balance_fcfa"] < 500_000


def test_admin_grant_credits(client, user_and_token, admin_headers):
    email, _, headers = user_and_token
    res = client.post(
        f"/api/admin/users/{email}/credits",
        headers=admin_headers,
        json={"amount": 10_000, "tx_type": "bonus", "description": "Bonus test", "external_ref": ""},
    )
    assert res.status_code == 200, res.text
    assert client.get("/api/credits", headers=headers).json()["balance_fcfa"] == _welcome() + 10_000


def test_admin_grant_requires_admin_role(client, user_and_token):
    """Un token utilisateur lambda ne peut pas se créditer via l'API admin."""
    email, _, headers = user_and_token
    res = client.post(
        f"/api/admin/users/{email}/credits",
        headers=headers,
        json={"amount": 999_999, "tx_type": "bonus", "description": "Auto-grant frauduleux", "external_ref": ""},
    )
    assert res.status_code in (401, 403)  # token sans claim is_admin → refusé (403 via get_current_admin)


def test_transactions_after_grant(client, user_and_token, admin_headers):
    email, _, headers = user_and_token
    res = client.post(
        f"/api/admin/users/{email}/credits",
        headers=admin_headers,
        json={"amount": 5_000, "tx_type": "bonus", "description": "Bonus tx", "external_ref": ""},
    )
    assert res.status_code == 200, res.text
    res = client.get("/api/credits/transactions", headers=headers)
    assert res.status_code == 200
    txs = res.json()["transactions"]
    amounts = [t.get("amount_fcfa", t.get("amount", 0)) for t in txs]
    assert 5_000 in amounts, amounts
    if _welcome() > 0:
        assert _welcome() in amounts  # tx welcome bonus présente
