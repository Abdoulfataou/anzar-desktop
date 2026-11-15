"""
Outils web DeepSeek pour l'agent : recherche (Search) et lecture de page (Fetch).
POST /api/deepseek/tools/search et /api/deepseek/tools/fetch → api.deepseek.com/v1/tools/*

DeepSeek ne facture un appel que s'il produit un résultat (Search : liste non vide,
Fetch : contenu de page). On suit exactement la même règle, au prix réel × marge.
"""
import time
import logging
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from config import settings
from security import get_current_user
from services import billing
from routes._state import get_provider_config

logger = logging.getLogger("anzar")
router = APIRouter(tags=["web-tools"])

MAX_FETCH_CHARS = 60_000      # page renvoyée à l'app (l'agent la tronque encore)
MAX_RESULT_CONTENT = 1_200    # extrait par résultat de recherche


def web_tool_cost_fcfa() -> float:
    """Prix de vente d'un appel Search ou Fetch réussi (FCFA)."""
    return round(settings.deepseek_web_tool_usd_per_call * settings.usd_to_fcfa * settings.deepseek_margin, 2)


class SearchBody(BaseModel):
    query: str = Field(..., min_length=1, max_length=128)
    count: int = Field(5, ge=1, le=10)
    ori_question: str | None = Field(None, max_length=128)


class FetchBody(BaseModel):
    url: str = Field(..., min_length=8, max_length=8192)


def _tools_base() -> str:
    base = (settings.deepseek_base_url or "https://api.deepseek.com").rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return f"{base}/v1/tools"


async def _call(path: str, payload: dict) -> dict:
    config = get_provider_config("deepseek")
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                f"{_tools_base()}/{path}",
                headers={"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.TimeoutException:
        raise HTTPException(504, "Le service de recherche met trop de temps à répondre.")
    except httpx.HTTPError:
        raise HTTPException(502, "Service de recherche injoignable.")
    if resp.status_code == 429:
        raise HTTPException(429, "Trop de recherches en même temps. Réessaie dans quelques secondes.")
    if resp.status_code >= 400:
        try:
            msg = resp.json().get("error", {}).get("message") or resp.text
        except Exception:
            msg = resp.text
        # 4xx de DeepSeek : requête refusée (URL bloquée, page inaccessible…) — non facturée
        raise HTTPException(422 if resp.status_code < 500 else 502, (msg or "Erreur du service de recherche")[:300])
    return resp.json()


async def _bill(res: billing.Reservation, kind: str, start: float) -> float:
    """Débite l'appel réussi (le solde peut devenir négatif : jamais offert)."""
    cost = web_tool_cost_fcfa()
    await billing.settle(res, cost, round(cost / settings.usd_to_fcfa, 6), f"Web {kind}", "deepseek",
                         f"web-{kind}", 0, 0, int((time.time() - start) * 1000), f"web_{kind}")
    return cost


async def _reserve(email: str) -> billing.Reservation:
    try:
        return await billing.reserve(email, web_tool_cost_fcfa())
    except HTTPException as e:
        if e.status_code == 402:
            raise HTTPException(402, "Solde épuisé : recharge pour utiliser la recherche web.")
        raise


@router.post("/api/deepseek/tools/search")
async def web_search(body: SearchBody, user: dict = Depends(get_current_user)):
    email = user["sub"]
    res = await _reserve(email)
    start = time.time()
    try:
        data = await _call("search", {
            "query": body.query.strip(),
            "count": body.count,
            "need_content": True,
            **({"ori_question": body.ori_question.strip()} if body.ori_question and body.ori_question.strip() else {}),
        })
    except BaseException:
        billing.release_now(res)
        raise
    results = []
    for r in (data.get("results") or [])[: body.count]:
        if not isinstance(r, dict) or not r.get("url"):
            continue
        results.append({
            "title": (r.get("title") or "")[:300],
            "url": r.get("url"),
            "content": (r.get("content") or r.get("snippet") or "")[:MAX_RESULT_CONTENT],
            "score": r.get("score"),
        })
    if not results:
        billing.release_now(res)
    cost = await _bill(res, "search", start) if results else 0.0
    return {"results": results, "anzar": {"cost_fcfa": cost}}


@router.post("/api/deepseek/tools/fetch")
async def web_fetch(body: FetchBody, user: dict = Depends(get_current_user)):
    email = user["sub"]
    parsed = urlparse(body.url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(422, "Adresse invalide : seules les URL http(s) sans identifiants sont acceptées.")
    res = await _reserve(email)
    start = time.time()
    try:
        data = await _call("fetch", {"url": body.url.strip()})
    except BaseException:
        billing.release_now(res)
        raise
    content = data.get("content") or ""
    if not content.strip():
        billing.release_now(res)
    cost = await _bill(res, "fetch", start) if content.strip() else 0.0
    return {
        "title": (data.get("title") or "")[:300],
        "content": content[:MAX_FETCH_CHARS],
        "truncated": len(content) > MAX_FETCH_CHARS,
        "anzar": {"cost_fcfa": cost},
    }
