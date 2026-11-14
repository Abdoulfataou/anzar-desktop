"""Tests /api/auth/* — register, login, verify, refresh, révocation jti."""
import time

import jwt as pyjwt


def test_register_ok(client):
    res = client.post("/api/auth/register", json={"email": "a@test.local", "password": "password123"})
    assert res.status_code == 200
    body = res.json()
    assert body["token"]
    assert body["user"]["email"] == "a@test.local"
    from config import settings as _s
    assert body["credits"]["balance_fcfa"] == float(getattr(_s, "welcome_bonus_fcfa", 0) or 0)


def test_register_duplicate_409(client):
    payload = {"email": "dup@test.local", "password": "password123"}
    assert client.post("/api/auth/register", json=payload).status_code == 200
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_register_weak_password_400(client):
    res = client.post("/api/auth/register", json={"email": "b@test.local", "password": "short"})
    assert res.status_code == 400


def test_login_ok_and_wrong_password(client):
    client.post("/api/auth/register", json={"email": "c@test.local", "password": "password123"})
    ok = client.post("/api/auth/login", json={"email": "c@test.local", "password": "password123"})
    assert ok.status_code == 200
    bad = client.post("/api/auth/login", json={"email": "c@test.local", "password": "WRONGpass99"})
    assert bad.status_code == 401


def test_verify(client, user_and_token):
    email, token, headers = user_and_token
    res = client.get("/api/auth/verify", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"valid": True, "user_id": email}


def test_verify_no_token_401(client):
    assert client.get("/api/auth/verify").status_code == 401


def test_refresh_roundtrip(client, user_and_token):
    _, token, headers = user_and_token
    res = client.post("/api/auth/refresh", headers=headers)
    assert res.status_code == 200
    new_token = res.json()["token"]
    assert new_token and new_token != token
    # Le nouveau token est valide
    assert client.get("/api/auth/verify", headers={"Authorization": f"Bearer {new_token}"}).status_code == 200


def test_refresh_rejects_forged_signature(client):
    headers = {"Authorization": "Bearer " + pyjwt.encode(
        {"sub": "attacker@test.local", "exp": time.time() + 3600, "aud": "anzar-api"},
        "wrong-secret", algorithm="HS256",
    )}
    assert client.post("/api/auth/refresh", headers=headers).status_code == 401


def test_revoked_token_rejected(client, user_and_token):
    """Un jti révoqué → 401 sur /verify ET sur /refresh (pas de renouvellement)."""
    _, token, headers = user_and_token
    payload = pyjwt.decode(token, options={"verify_signature": False})
    _revoke(payload["jti"], payload["exp"])
    assert client.get("/api/auth/verify", headers=headers).status_code == 401
    assert client.post("/api/auth/refresh", headers=headers).status_code == 401


def _revoke(jti: str, exp: float):
    """Insère directement le jti en base (évite tout souci de boucle d'event)."""
    import os
    import sqlite3

    conn = sqlite3.connect(os.environ["DATABASE_PATH"])
    try:
        conn.execute(
            "INSERT OR IGNORE INTO revoked_tokens (jti, revoked_at, expires_at) VALUES (?, ?, ?)",
            (jti, time.time(), exp),
        )
        conn.commit()
    finally:
        conn.close()
