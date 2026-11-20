"""Panneau admin : statistiques, filtres, corrections de solde, paiements, audit, comptes admin, rôles."""
import uuid


def _user(client):
    email = f"u-{uuid.uuid4().hex[:8]}@test.local"
    r = client.post("/api/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return email, {"Authorization": f"Bearer {r.json()['token']}"}


def _admin_session(client, owner_headers, role):
    """Crée un admin du rôle demandé, change son mot de passe provisoire, renvoie ses en-têtes."""
    email = f"{role}-{uuid.uuid4().hex[:6]}@test.local"
    r = client.post("/api/admin/admins", headers=owner_headers, json={"email": email, "role": role})
    assert r.status_code == 200, r.text
    temp = r.json()["temporary_password"]
    r = client.post("/api/admin/login", json={"email": email, "password": temp})
    assert r.status_code == 200 and r.json()["user"]["must_change_password"] is True
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/api/admin/stats", headers=h).status_code == 403  # bloqué tant que pas changé
    r = client.post("/api/admin/change-password", headers=h,
                    json={"current_password": temp, "new_password": "NouveauMotDePasse42"})
    assert r.status_code == 200, r.text
    # token_version a changé : l'ancien jeton est révoqué.
    r = client.post("/api/admin/login", json={"email": email, "password": "NouveauMotDePasse42"})
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    return r, h, email


def test_dashboard_stats_and_series(client, admin_headers):
    s = client.get("/api/admin/stats", headers=admin_headers).json()
    for key in ("users", "credits", "usage_30d", "payments_pending", "debts", "recharged_30d", "billing_anomalies_30d", "cache_rate_30d"):
        assert key in s
    days = client.get("/api/admin/stats/daily?days=14", headers=admin_headers).json()["days"]
    assert len(days) == 14 and {"day", "requests", "cost_fcfa", "recharged_fcfa", "new_users"} <= set(days[0])
    b = client.get("/api/admin/stats/breakdown?days=30", headers=admin_headers).json()
    assert {"by_model", "by_task_type", "top_users"} <= set(b)


def test_credit_debit_filters_and_ledger(client, admin_headers):
    email, headers = _user(client)
    r = client.post(f"/api/admin/users/{email}/credits", headers=admin_headers,
                    json={"amount": 500, "tx_type": "recharge", "description": "Orange Money"})
    assert r.status_code == 200
    funded = client.get(f"/api/admin/users?status=funded&search={email}", headers=admin_headers).json()
    assert funded["total"] == 1
    r = client.post(f"/api/admin/users/{email}/debit", headers=admin_headers,
                    json={"amount": 800, "description": "Erreur de saisie"})
    assert r.status_code == 200 and r.json()["credits"]["balance_fcfa"] == -300
    debt = client.get(f"/api/admin/users?status=debt&search={email}", headers=admin_headers).json()
    assert debt["total"] == 1 and debt["users"][0]["balance_fcfa"] == -300
    ledger = client.get(f"/api/admin/transactions?email={email}", headers=admin_headers).json()
    assert ledger["total"] == 2 and ledger["sum_credited"] == 500 and ledger["sum_debited"] == -800
    only = client.get(f"/api/admin/transactions?email={email}&type=recharge", headers=admin_headers).json()
    assert only["total"] == 1
    assert client.post("/api/admin/users/inconnu@x.y/debit", headers=admin_headers,
                       json={"amount": 1, "description": "test"}).status_code == 404


def test_payment_flow_is_idempotent(client, admin_headers):
    email, headers = _user(client)
    ids = []
    for amount in (1000, 2000, 3000):
        r = client.post("/api/payments/initiate", headers=headers, json={"amount": amount, "method": "orange_money"})
        ids.append(r.json()["intent_id"])
    a, b, c = ids
    body = {"description": "Reçu OM", "provider_ref": f"OM-{uuid.uuid4().hex[:6]}"}
    assert client.post(f"/api/admin/payments/{a}/mark-paid", headers=admin_headers, json=body).status_code == 200
    assert client.post(f"/api/admin/payments/{a}/mark-paid", headers=admin_headers, json=body).status_code == 200
    # même référence Mobile Money pour une autre demande : refusée
    assert client.post(f"/api/admin/payments/{b}/mark-paid", headers=admin_headers, json=body).status_code == 400
    assert client.get("/api/credits", headers=headers).json()["balance_fcfa"] == 1000  # crédité une seule fois
    assert client.post(f"/api/admin/payments/{c}/cancel", headers=admin_headers, json={"reason": "doublon"}).status_code == 200
    assert client.post(f"/api/admin/payments/{c}/mark-paid", headers=admin_headers,
                       json={"description": "x" * 5}).status_code == 400  # annulée : non validable
    lst = client.get(f"/api/admin/payments?status=all&email={email}", headers=admin_headers).json()
    assert lst["total"] == 3 and {p["status"] for p in lst["payment_intents"]} == {"paid", "pending", "cancelled"}


def test_audit_log_records_actions(client, admin_headers):
    email, _ = _user(client)
    client.post(f"/api/admin/users/{email}/credits", headers=admin_headers,
                json={"amount": 100, "tx_type": "bonus", "description": "geste commercial"})
    log = client.get(f"/api/admin/audit?target={email}", headers=admin_headers).json()
    assert log["total"] >= 1 and log["entries"][0]["action"] == "grant_credits"
    assert client.get("/api/admin/audit?action=login_success", headers=admin_headers).json()["total"] >= 1


def test_roles_are_enforced(client, admin_headers):
    email, _ = _user(client)
    _, readonly, _ = _admin_session(client, admin_headers, "readonly")
    assert client.get("/api/admin/users", headers=readonly).status_code == 200
    assert client.post(f"/api/admin/users/{email}/credits", headers=readonly,
                       json={"amount": 100, "description": "abus"}).status_code == 403
    assert client.patch(f"/api/admin/users/{email}", headers=readonly, json={"is_active": False}).status_code == 403
    assert client.get("/api/admin/admins", headers=readonly).status_code == 403

    _, support, _ = _admin_session(client, admin_headers, "support")
    assert client.patch(f"/api/admin/users/{email}", headers=support, json={"is_active": False}).status_code == 200
    assert client.patch(f"/api/admin/users/{email}", headers=support, json={"name": "x"}).status_code == 403
    assert client.post(f"/api/admin/users/{email}/credits", headers=support,
                       json={"amount": 100, "description": "abus"}).status_code == 403


def test_admin_accounts_management(client, admin_headers):
    _, h, email = _admin_session(client, admin_headers, "admin")
    admins = client.get("/api/admin/admins", headers=admin_headers).json()["admins"]
    target = next(a for a in admins if a["email"] == email)
    # rôle retiré : effet immédiat, même avec un jeton déjà émis
    r = client.patch(f"/api/admin/admins/{target['id']}", headers=admin_headers, json={"role": "readonly"})
    assert r.status_code == 200
    assert client.post("/api/admin/users/x@y.z/credits", headers=h,
                       json={"amount": 1, "description": "test"}).status_code == 403
    # compte désactivé : plus aucun accès
    client.patch(f"/api/admin/admins/{target['id']}", headers=admin_headers, json={"is_active": False})
    assert client.get("/api/admin/stats", headers=h).status_code == 401
    # le propriétaire ne peut pas se rétrograder lui-même
    me = client.get("/api/admin/me", headers=admin_headers).json()
    assert client.patch(f"/api/admin/admins/{me['id']}", headers=admin_headers,
                        json={"role": "admin"}).status_code == 400
    r = client.post(f"/api/admin/admins/{target['id']}/reset-password", headers=admin_headers)
    assert r.status_code == 200 and len(r.json()["temporary_password"]) >= 12


def test_settings_expose_no_secret(client, admin_headers):
    s = client.get("/api/admin/settings", headers=admin_headers).json()
    assert s["welcome_bonus_fcfa"] == 0 and "margin" in s
    text = str(s).lower()
    assert "secret" not in text and "sk-" not in text and isinstance(s["providers"]["deepseek"], bool)
