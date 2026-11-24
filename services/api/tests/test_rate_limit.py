"""Rate limiting : clé utilisateur, pas IP, et webhooks exclus."""
import uuid

from config import settings
from security import rate_limiter


def _register(client):
    email = f"rl-{uuid.uuid4().hex[:8]}@test.local"
    r = client.post("/api/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_authenticated_limits_are_per_user(client, monkeypatch):
    h1 = _register(client)
    h2 = _register(client)
    monkeypatch.setattr(settings, "rate_limit_per_minute", 2)
    monkeypatch.setattr(settings, "rate_limit_per_day", 100)
    rate_limiter.reset()

    assert client.get("/api/credits", headers=h1).status_code == 200
    assert client.get("/api/credits", headers=h1).status_code == 200
    assert client.get("/api/credits", headers=h1).status_code == 429
    # Même IP, autre utilisateur : sa fenêtre est indépendante.
    assert client.get("/api/credits", headers=h2).status_code == 200


def test_webhooks_are_excluded_from_rate_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 0)
    rate_limiter.reset()
    # Le fournisseur n'est pas configuré : la route répond 404, jamais 429.
    r = client.post("/api/payments/webhook/inconnu", content=b"{}")
    assert r.status_code != 429


def test_auth_limiter_fails_closed_when_db_is_down(monkeypatch):
    """Audit 23/11/2026 #14 : une panne du compteur ne doit pas ouvrir le brute-force."""
    import asyncio
    import db.rate_limits as rl
    from fastapi import HTTPException

    async def boom(*_a, **_k):
        raise RuntimeError("db down")

    monkeypatch.setattr(rl, "check_and_record", boom)
    for endpoint in ("auth", "otp"):
        try:
            asyncio.run(rate_limiter.check("k", endpoint=endpoint))
            raise AssertionError("aurait dû refuser")
        except HTTPException as e:
            assert e.status_code == 503
    # Les autres routes restent disponibles (fail-open).
    assert asyncio.run(rate_limiter.check("k", endpoint="api")) is True
