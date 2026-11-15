"""Flux : coût exact envoyé à l'app avant [DONE], facturation sur l'usage réel (cache compris)."""
import json
import asyncio

import httpx

import routes.chat as chat


def _fake_upstream(lines):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=("\n".join(lines) + "\n").encode(), headers={"content-type": "text/event-stream"})
    return httpx.MockTransport(handler)


def test_stream_sends_exact_cost_before_done(monkeypatch):
    usage = {"prompt_tokens": 1_000_000, "completion_tokens": 0, "prompt_cache_hit_tokens": 1_000_000}
    upstream = [
        'data: ' + json.dumps({"choices": [{"delta": {"content": "Bonjour"}}], "model": "deepseek-chat"}),
        'data: ' + json.dumps({"choices": [], "usage": usage, "model": "deepseek-chat"}),
        'data: [DONE]',
    ]
    real_client = httpx.AsyncClient
    monkeypatch.setattr(chat.httpx, "AsyncClient", lambda **kw: real_client(transport=_fake_upstream(upstream)))
    billed = {}

    async def has_credits(email): return True
    async def record_usage(*a, **kw): billed["record"] = a
    async def deduct_credits(email, cost, *a, **kw): billed["deduct"] = cost
    monkeypatch.setattr(chat, "has_credits", has_credits)
    monkeypatch.setattr(chat, "record_usage", record_usage)
    monkeypatch.setattr(chat, "deduct_credits", deduct_credits)

    async def run():
        resp = await chat._proxy_stream_with_billing("http://x/chat/completions", {}, {"model": "deepseek-chat", "messages": []}, "a@b.c", "deepseek", 0.0)
        return [chunk async for chunk in resp.body_iterator]

    chunks = asyncio.run(run())
    text = "".join(c if isinstance(c, str) else c.decode() for c in chunks)
    events = [l for l in text.split("\n") if l.startswith("data: ")]
    cost_idx = next(i for i, l in enumerate(events) if '"anzar"' in l)
    assert events[cost_idx + 1] == "data: [DONE]"
    sent = json.loads(events[cost_idx][6:])["anzar"]["cost_fcfa"]
    from config import settings
    expected = round(settings.deepseek_input_cost_per_million * settings.deepseek_cache_hit_ratio, 2)
    assert sent == expected
    assert billed["deduct"] == expected  # le montant affiché est exactement le montant débité
