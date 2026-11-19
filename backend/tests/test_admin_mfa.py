"""MFA TOTP admin : enrôlement, login, révocation et restriction réseau."""
import time

from config import settings
from security import totp_now


def _new_admin_session(client, owner_headers):
    import uuid
    email = f"mfa-{uuid.uuid4().hex[:8]}@test.local"
    r = client.post("/api/admin/admins", headers=owner_headers, json={"email": email, "role": "admin"})
    assert r.status_code == 200, r.text
    temp = r.json()["temporary_password"]
    r = client.post("/api/admin/login", json={"email": email, "password": temp})
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    r = client.post("/api/admin/change-password", headers=h,
                    json={"current_password": temp, "new_password": "MfaAdminPass123"})
    assert r.status_code == 200, r.text
    r = client.post("/api/admin/login", json={"email": email, "password": "MfaAdminPass123"})
    assert r.status_code == 200, r.text
    return email, {"Authorization": f"Bearer {r.json()['token']}"}


def test_admin_mfa_enrollment_and_login(client, admin_headers):
    email, h = _new_admin_session(client, admin_headers)
    r = client.post("/api/admin/mfa/setup", headers=h)
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    assert r.json()["otpauth_uri"].startswith("otpauth://totp/")
    assert client.post("/api/admin/mfa/enable", headers=h, json={"code": totp_now(secret)}).status_code == 200
    # token_version a changé : l'ancien jeton est révoqué
    assert client.get("/api/admin/me", headers=h).status_code == 401
    # Login sans code refusé, avec code accepté
    assert client.post("/api/admin/login", json={"email": email, "password": "MfaAdminPass123"}).status_code == 401
    r = client.post("/api/admin/login", json={"email": email, "password": "MfaAdminPass123",
                                              "totp_code": totp_now(secret)})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["mfa_enabled"] is True


def test_admin_mfa_required_blocks_before_enrollment(client, admin_headers, monkeypatch):
    _, h = _new_admin_session(client, admin_headers)
    monkeypatch.setattr(settings, "admin_require_mfa", True)
    assert client.get("/api/admin/stats", headers=h).status_code == 403
    # Un mot de passe seul ne doit pas permettre d'enrôler sa propre MFA :
    # l'enrôlement doit précéder l'activation du drapeau.
    assert client.post("/api/admin/mfa/setup", headers=h).status_code == 403


def test_admin_network_restriction(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "admin_allowed_ips", "203.0.113.0/24")
    assert client.get("/api/admin/me", headers=admin_headers).status_code == 403
    assert client.post("/api/admin/login", json={"email": "admin@test.local", "password": "TestAdminPass1234x"}).status_code == 403


def test_admin_logout_revokes_current_token(client, admin_headers):
    _, h = _new_admin_session(client, admin_headers)
    assert client.post("/api/admin/logout", headers=h).status_code == 200
    assert client.get("/api/admin/me", headers=h).status_code == 401
