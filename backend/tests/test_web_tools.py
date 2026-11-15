"""Outils web : proxy vers DeepSeek Search/Fetch, facturation seulement si résultat."""
import httpx
from fastapi.testclient import TestClient

import routes.web_tools as wt


def _client(monkeypatch, handler, credits=True):
    from main import app
    from security import get_current_user
    real = httpx.AsyncClient
    monkeypatch.setattr(wt.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), timeout=5))
    monkeypatch.setattr(wt, "get_provider_config", lambda p: {"api_key": "k", "base_url": "x"})
    billed = []

    async def has_credits(email): return credits
    async def record_usage(*a, **kw): pass
    async def deduct_credits(email, cost, *a, **kw): billed.append(cost)
    monkeypatch.setattr(wt, "has_credits", has_credits)
    monkeypatch.setattr(wt, "record_usage", record_usage)
    monkeypatch.setattr(wt, "deduct_credits", deduct_credits)
    app.dependency_overrides[get_current_user] = lambda: {"sub": "a@b.c"}
    return TestClient(app), billed, app


def test_search_bills_only_with_results(monkeypatch):
    seen = {}

    def handler(req):
        import json
        seen["path"] = req.url.path
        seen["body"] = json.loads(req.content)
        q = seen["body"]["query"]
        results = [] if q == "rien" else [{"title": "T", "url": "https://x.dev", "content": "c" * 5000, "score": 1.7}]
        return httpx.Response(200, json={"results": results})

    client, billed, app = _client(monkeypatch, handler)
    try:
        r = client.post("/api/deepseek/tools/search", json={"query": "vite 6 config", "count": 3})
        assert r.status_code == 200
        data = r.json()
        assert seen["path"] == "/v1/tools/search" and seen["body"]["need_content"] is True and seen["body"]["count"] == 3
        assert len(data["results"][0]["content"]) == wt.MAX_RESULT_CONTENT
        assert data["anzar"]["cost_fcfa"] == wt.web_tool_cost_fcfa() and billed == [wt.web_tool_cost_fcfa()]
        r = client.post("/api/deepseek/tools/search", json={"query": "rien"})
        assert r.json()["anzar"]["cost_fcfa"] == 0 and len(billed) == 1
    finally:
        app.dependency_overrides.clear()


def test_fetch_validates_url_and_bills(monkeypatch):
    def handler(req):
        return httpx.Response(200, json={"title": "Doc", "content": "# Titre\ntexte"})

    client, billed, app = _client(monkeypatch, handler)
    try:
        assert client.post("/api/deepseek/tools/fetch", json={"url": "file:///etc/passwd"}).status_code == 422
        assert client.post("/api/deepseek/tools/fetch", json={"url": "https://u:p@x.dev/a"}).status_code == 422
        r = client.post("/api/deepseek/tools/fetch", json={"url": "https://vitejs.dev/config"})
        assert r.status_code == 200 and r.json()["title"] == "Doc" and len(billed) == 1
    finally:
        app.dependency_overrides.clear()


def test_requires_credits(monkeypatch):
    client, billed, app = _client(monkeypatch, lambda req: httpx.Response(200, json={"results": []}), credits=False)
    try:
        assert client.post("/api/deepseek/tools/search", json={"query": "x"}).status_code == 402
    finally:
        app.dependency_overrides.clear()
