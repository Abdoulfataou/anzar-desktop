"""Outils web : proxy vers DeepSeek Search/Fetch, facturation seulement si résultat."""
import uuid

import httpx

import routes.web_tools as wt


def _client(monkeypatch, handler, client, credits=True):
    """Monte la route sur le client de session et crédite un compte réel.

    L'ancienne doublure `billing._balance` ne suffit plus : l'admission est un UPDATE
    conditionnel en base, il faut donc un compte et un solde réels. `a@b.c` n'existait
    que dans la doublure ; on utilise un email unique pour isoler chaque test.
    """
    from main import app
    from security import get_current_user

    real = httpx.AsyncClient
    monkeypatch.setattr(wt.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), timeout=5))
    monkeypatch.setattr(wt, "get_provider_config", lambda p: {"api_key": "k", "base_url": "x"})
    billed = []

    import db

    email = f"web-{uuid.uuid4().hex[:8]}@test.local"

    async def seed():
        await db.create_user(email, "password123")
        if credits:
            await db.add_credits(email, 100, description="test outils web")

    client.portal.call(seed)

    async def record_usage(*a, **kw):
        pass

    async def deduct_credits(email, cost, *a, **kw):
        billed.append(cost)
        # Le vrai débit libère la réservation dans la même transaction ; pour ce test
        # on veut seulement vérifier le montant facturé, sans toucher au solde.
        rid = kw.get("reservation_id")
        if rid is not None:
            await db.release_reservation(email, rid)

    monkeypatch.setattr(db, "record_usage", record_usage)
    monkeypatch.setattr(db, "deduct_credits", deduct_credits)
    app.dependency_overrides[get_current_user] = lambda: {"sub": email}
    return client, billed, app


def test_search_bills_only_with_results(client, monkeypatch):
    seen = {}

    def handler(req):
        import json
        seen["path"] = req.url.path
        seen["body"] = json.loads(req.content)
        q = seen["body"]["query"]
        results = [] if q == "rien" else [{"title": "T", "url": "https://x.dev", "content": "c" * 5000, "score": 1.7}]
        return httpx.Response(200, json={"results": results})

    c, billed, app = _client(monkeypatch, handler, client)
    try:
        r = c.post("/api/deepseek/tools/search", json={"query": "vite 6 config", "count": 3})
        assert r.status_code == 200
        data = r.json()
        assert seen["path"] == "/v1/tools/search" and seen["body"]["need_content"] is True and seen["body"]["count"] == 3
        assert len(data["results"][0]["content"]) == wt.MAX_RESULT_CONTENT
        assert data["anzar"]["cost_fcfa"] == wt.web_tool_cost_fcfa() and billed == [wt.web_tool_cost_fcfa()]
        r = c.post("/api/deepseek/tools/search", json={"query": "rien"})
        assert r.json()["anzar"]["cost_fcfa"] == 0 and len(billed) == 1
    finally:
        app.dependency_overrides.clear()


def test_fetch_validates_url_and_bills(client, monkeypatch):
    def handler(req):
        return httpx.Response(200, json={"title": "Doc", "content": "# Titre\ntexte"})

    c, billed, app = _client(monkeypatch, handler, client)
    try:
        assert c.post("/api/deepseek/tools/fetch", json={"url": "file:///etc/passwd"}).status_code == 422
        assert c.post("/api/deepseek/tools/fetch", json={"url": "https://u:p@x.dev/a"}).status_code == 422
        r = c.post("/api/deepseek/tools/fetch", json={"url": "https://vitejs.dev/config"})
        assert r.status_code == 200 and r.json()["title"] == "Doc" and len(billed) == 1
    finally:
        app.dependency_overrides.clear()


def test_requires_credits(client, monkeypatch):
    c, billed, app = _client(monkeypatch, lambda req: httpx.Response(200, json={"results": []}), client, credits=False)
    try:
        assert c.post("/api/deepseek/tools/search", json={"query": "x"}).status_code == 402
    finally:
        app.dependency_overrides.clear()
