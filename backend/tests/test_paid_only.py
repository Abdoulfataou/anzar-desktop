"""Accès payant uniquement : aucun appel IA sans solde, coût réel toujours débité, comptes bloquables."""
import json

import httpx
import pytest

import routes.chat as chat
from config import settings


def _grant(client, admin_headers, email, amount):
    r = client.post(f"/api/admin/users/{email}/credits", headers=admin_headers,
                    json={"amount": amount, "description": "test", "tx_type": "recharge"})
    assert r.status_code == 200, r.text


def _balance(client, headers):
    return client.get("/api/credits", headers=headers).json()["balance_fcfa"]


@pytest.fixture()
def upstream(monkeypatch):
    """Faux DeepSeek : enregistre les requêtes reçues, renvoie l'usage demandé."""
    state = {"calls": [], "usage": {"prompt_tokens": 100, "completion_tokens": 50}}
    real = httpx.AsyncClient

    def handler(req):
        body = json.loads(req.content)
        state["calls"].append(body)
        return httpx.Response(200, json={"model": body["model"], "usage": state["usage"],
                                         "choices": [{"message": {"role": "assistant", "content": "ok"}}]})

    monkeypatch.setattr(chat.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(chat, "get_provider_config", lambda p: {"api_key": "k", "base_url": "http://x"})
    return state


MSG = {"messages": [{"role": "user", "content": "bonjour"}]}


def test_new_account_has_no_free_credit(client, user_and_token):
    _, _, headers = user_and_token
    assert settings.welcome_bonus_fcfa == 0
    assert _balance(client, headers) == 0


def test_no_credit_no_ai_call(client, user_and_token, upstream):
    _, _, headers = user_and_token
    r = client.post("/api/deepseek/chat/completions", headers=headers, json=MSG)
    assert r.status_code == 402
    assert upstream["calls"] == []  # DeepSeek n'a jamais été appelé


def test_real_cost_is_debited_even_beyond_balance(client, user_and_token, admin_headers, upstream):
    email, _, headers = user_and_token
    _grant(client, admin_headers, email, 50)
    # Réponse servie bien plus chère que prévu (réflexion très longue) → dette, pas cadeau
    upstream["usage"] = {"prompt_tokens": 100, "completion_tokens": 200_000}
    r = client.post("/api/deepseek/chat/completions", headers=headers, json=MSG)
    assert r.status_code == 200, r.text
    assert upstream["calls"][0]["max_tokens"] <= 16384
    assert _balance(client, headers) < 0
    # Solde négatif : plus aucun appel jusqu'à la recharge
    assert client.post("/api/deepseek/chat/completions", headers=headers, json=MSG).status_code == 402
    assert len(upstream["calls"]) == 1


def test_max_tokens_capped_to_balance(client, user_and_token, admin_headers, upstream):
    email, _, headers = user_and_token
    _grant(client, admin_headers, email, 2)  # ~ quelques milliers de jetons de sortie
    r = client.post("/api/deepseek/chat/completions", headers=headers,
                    json={**MSG, "max_completion_tokens": 16384, "n": 5,
                          "unknown_billed": True, "logit_bias": {"1": 2}})
    assert r.status_code == 200, r.text
    sent = upstream["calls"][0]
    assert sent["max_tokens"] < 16384 and "max_completion_tokens" not in sent and "n" not in sent
    assert "unknown_billed" not in sent and "logit_bias" not in sent
    assert r.json()["anzar"]["cost_fcfa"] > 0


def test_parallel_requests_cannot_spend_same_balance(user_and_token):
    """Deux réservations simultanées ne peuvent pas couvrir plus que le solde."""
    import asyncio
    from fastapi import HTTPException
    from services import billing

    async def run():
        async def bal(email): return 10.0
        orig = billing._balance
        billing._balance = bal
        try:
            first = await billing.reserve("p@x.y", 8.0)
            with pytest.raises(HTTPException) as e:
                await billing.reserve("p@x.y", 8.0)
            assert e.value.status_code == 402
            billing.release_now(first)
            second = await billing.reserve("p@x.y", 8.0)  # libéré → de nouveau possible
            billing.release_now(second)
        finally:
            billing._balance = orig

    asyncio.run(run())


def test_provider_error_is_not_billed(client, user_and_token, admin_headers, monkeypatch):
    email, _, headers = user_and_token
    _grant(client, admin_headers, email, 100)
    real = httpx.AsyncClient
    monkeypatch.setattr(chat.httpx, "AsyncClient", lambda **kw: real(
        transport=httpx.MockTransport(lambda req: httpx.Response(400, json={"error": {"message": "bad"}}))))
    monkeypatch.setattr(chat, "get_provider_config", lambda p: {"api_key": "k", "base_url": "http://x"})
    assert client.post("/api/deepseek/chat/completions", headers=headers, json=MSG).status_code == 400
    assert client.post("/api/deepseek/chat/completions", headers=headers, json={**MSG, "stream": True}).status_code == 200
    assert _balance(client, headers) == 100


def test_disabled_account_is_blocked_immediately(client, user_and_token, admin_headers):
    email, _, headers = user_and_token
    assert client.get("/api/credits", headers=headers).status_code == 200
    r = client.patch(f"/api/admin/users/{email}", headers=admin_headers, json={"is_active": False})
    assert r.status_code == 200, r.text
    blocked = (401, 403)
    assert client.get("/api/credits", headers=headers).status_code in blocked
    assert client.post("/api/auth/refresh", headers=headers).status_code in blocked
    assert client.post("/api/auth/login", json={"email": email, "password": "password123"}).status_code in blocked
    r = client.patch(f"/api/admin/users/{email}", headers=admin_headers, json={"is_active": True})
    assert client.get("/api/credits", headers=headers).status_code == 200  # réactivé


def test_admin_token_rejected_on_user_routes(client, admin_headers):
    assert client.get("/api/credits", headers=admin_headers).status_code == 403


def test_legacy_ai_routes_are_disabled(client, user_and_token):
    _, _, headers = user_and_token
    assert client.post("/api/chat/smart", headers=headers, json=MSG).status_code == 404
    assert client.post("/api/deepseek/beta/completions", headers=headers, json={"prompt": "x"}).status_code == 404
    assert client.post("/api/deepseek/batches", headers=headers, json={"input_file_id": "f"}).status_code == 404
    assert client.get("/api/deepseek/files/f/content", headers=headers).status_code == 404
    assert client.post("/api/projects/plan", headers=headers, json={}).status_code == 404
