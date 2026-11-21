"""
CHAT / AI PROXY route — /api/{provider}/chat/completions (DeepSeek, facturé)
"""
import json
import time
import logging

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import StreamingResponse, JSONResponse
import httpx

from config import settings
from security import get_current_user, validate_messages, calculate_cost_fcfa, usage_tokens
from services import billing
from body_limit import MAX_REQUEST_BYTES
from routes._state import (
    get_provider_config,
)

logger = logging.getLogger("anzar")

router = APIRouter(tags=["chat"])

# Champs explicitement transmis à DeepSeek. Tout champ inconnu est supprimé :
# un nouveau paramètre facturé côté fournisseur ne doit pas être consommé sans
# réservation ni facturation ANZAR.
CHAT_BODY_FIELDS = frozenset({
    "messages", "model", "frequency_penalty", "max_tokens", "max_completion_tokens",
    "presence_penalty", "response_format", "stop", "stream", "stream_options",
    "temperature", "top_p", "tools", "tool_choice", "parallel_tool_calls",
    "logprobs", "top_logprobs", "seed", "thinking", "reasoning_effort",
})


# ── Helpers ──

async def _proxy_request(url: str, headers: dict, body: dict) -> JSONResponse:
    """Forward a non-streaming request and return the response."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(url, headers=headers, json=body)
        except httpx.TimeoutException:
            raise HTTPException(504, "AI provider timeout")
        except httpx.ConnectError:
            raise HTTPException(502, "Cannot reach AI provider")

    if resp.status_code != 200:
        try:
            error_data = resp.json()
        except Exception:
            error_data = {"error": {"message": f"Provider error: {resp.status_code}"}}
        return JSONResponse(status_code=resp.status_code, content=error_data)

    return JSONResponse(content=resp.json())


async def _proxy_request_with_billing(
    url: str, headers: dict, body: dict,
    email: str, provider: str, start_time: float,
    reservation: billing.Reservation,
) -> JSONResponse:
    """Forward request, then bill the user on real token usage (réservation libérée dans tous les cas)."""
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                resp = await client.post(url, headers=headers, json=body)
            except httpx.TimeoutException:
                raise HTTPException(504, "AI provider timeout")
            except httpx.ConnectError:
                raise HTTPException(502, "Cannot reach AI provider")
    except BaseException:
        billing.release_now(reservation)
        raise

    if resp.status_code != 200:
        billing.release_now(reservation)  # requête refusée par le fournisseur : rien n'est facturé
        try:
            error_data = resp.json()
        except Exception:
            error_data = {"error": {"message": f"Provider error: {resp.status_code}"}}
        return JSONResponse(status_code=resp.status_code, content=error_data)

    try:
        data = resp.json()
    except Exception:
        data = {}
    duration_ms = int((time.time() - start_time) * 1000)
    model_name = data.get("model") or body.get("model", "unknown")
    input_tokens, output_tokens, cached_tokens = usage_tokens(data.get("usage"))
    task_type = "chat"
    if input_tokens == 0 and output_tokens == 0:
        # Réponse servie sans usage : facturée sur estimation, jamais offerte
        task_type = "chat_estimated"
        input_tokens = billing.estimate_input_tokens(body)
        text = json.dumps(data.get("choices") or [], ensure_ascii=False)
        output_tokens = max(len(text) // 4, 1)
    cost_usd, cost_fcfa = calculate_cost_fcfa(
        provider, input_tokens, output_tokens, model=model_name, cached_input_tokens=cached_tokens,
    )
    await billing.settle(
        reservation, cost_fcfa, cost_usd, f"Chat {provider}/{model_name}", provider, model_name,
        input_tokens, output_tokens, duration_ms, task_type, cached_input_tokens=cached_tokens,
    )
    if isinstance(data, dict):
        data["anzar"] = {"cost_fcfa": cost_fcfa}
    return JSONResponse(content=data)


async def _proxy_stream_with_billing(
    url: str, headers: dict, body: dict,
    email: str, provider: str, start_time: float,
    reservation: billing.Reservation,
) -> StreamingResponse:
    """Forward streaming SSE request, then bill at the end (même si le client coupe le flux)."""

    async def stream_generator():
        input_tokens = 0
        output_tokens = 0
        cached_tokens = 0
        output_chars = 0  # repli si le fournisseur ne renvoie pas l'usage
        upstream_ok = False  # faux : le fournisseur a refusé la requête → rien n'est facturé
        priced = None     # (cost_usd, cost_fcfa) calculé une seule fois : affiché = débité
        model_name = body.get("model", "unknown")
        client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

        try:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code != 200:
                    yield f"data: {json.dumps({'error': {'message': f'Provider error: {resp.status_code}'}})}\n\n"
                    return
                upstream_ok = True

                async for line in resp.aiter_lines():
                    if line.strip():
                        if line.strip() == "data: [DONE]" and (input_tokens or output_tokens):
                            # Coût exact de cet appel, envoyé à l'app avant la fin du flux :
                            # l'app additionne ces montants au lieu de comparer le solde
                            # (faux si une autre session consomme en même temps).
                            priced = calculate_cost_fcfa(
                                provider, input_tokens, output_tokens, model=model_name, cached_input_tokens=cached_tokens,
                            )
                            yield f"data: {json.dumps({'anzar': {'cost_fcfa': priced[1]}})}\n\n"
                        yield f"{line}\n\n"

                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                chunk = json.loads(line[6:])
                                if chunk.get("usage"):
                                    input_tokens, output_tokens, cached_tokens = usage_tokens(chunk["usage"])
                                for choice in chunk.get("choices") or []:
                                    delta = choice.get("delta") or {}
                                    output_chars += len(delta.get("content") or "") + len(delta.get("reasoning_content") or "")
                                    for tc in delta.get("tool_calls") or []:
                                        output_chars += len(((tc or {}).get("function") or {}).get("arguments") or "")
                                if chunk.get("model"):
                                    model_name = chunk["model"]
                            except (json.JSONDecodeError, KeyError, AttributeError, TypeError):
                                pass

        except httpx.TimeoutException:
            yield f"data: {json.dumps({'error': {'message': 'Provider timeout'}})}\n\n"
        except Exception as e:
            logger.error("Stream error: %s", e)
            yield f"data: {json.dumps({'error': {'message': 'Erreur interne. Réessaie.'}})}\n\n"
        finally:
            try:
                # Débit d'abord : si le client a coupé, la requête est en cours d'annulation et
                # chaque « await » peut s'interrompre. settle() lance le débit dans une tâche protégée.
                duration_ms = int((time.time() - start_time) * 1000)
                if not upstream_ok:
                    billing.release_now(reservation)
                else:
                    task_type = "chat_stream"
                    if input_tokens == 0 and output_tokens == 0:
                        # Usage absent (coupure, client déconnecté) : estimation sur ce qui a été échangé
                        task_type = "chat_stream_estimated"
                        input_tokens = billing.estimate_input_tokens(body)
                        output_tokens = max(output_chars // 4, 1)
                        logger.warning("USAGE_MISSING: user=%s provider=%s model=%s — coût estimé", email, provider, model_name)
                    cost_usd, cost_fcfa = priced or calculate_cost_fcfa(
                        provider, input_tokens, output_tokens, model=model_name, cached_input_tokens=cached_tokens,
                    )
                    await billing.settle(
                        reservation, cost_fcfa, cost_usd, f"Stream {provider}/{model_name}", provider, model_name,
                        input_tokens, output_tokens, duration_ms, task_type, cached_input_tokens=cached_tokens,
                    )
            finally:
                await client.aclose()

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Routes ──

def has_images(messages: list) -> bool:
    return any(isinstance(m, dict) and isinstance(m.get("content"), list)
               and any(isinstance(p, dict) and p.get("type") == "image_url" for p in m["content"])
               for m in messages)


@router.post("/api/{provider}/chat/completions")
async def proxy_chat(provider: str, request: Request, user: dict = Depends(get_current_user)):
    """
    Proxy des requêtes chat vers DeepSeek (seul fournisseur d'ANZAR).
    Le coût maximal est réservé sur le solde AVANT l'appel ; le coût réel est débité après.
    Aucun quota gratuit : sans solde suffisant, 402.
    """
    email = user["sub"]
    config = get_provider_config(provider)

    raw = await request.body()
    if len(raw) > MAX_REQUEST_BYTES:
        # Filet de sécurité : le middleware refuse déjà d'après Content-Length.
        raise HTTPException(413, "Requête trop volumineuse.")
    try:
        body = json.loads(raw)
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    if not isinstance(body, dict):
        raise HTTPException(400, "Invalid JSON body")

    body = {k: v for k, v in body.items() if k in CHAT_BODY_FIELDS}
    body["messages"] = validate_messages(body.get("messages") or [])

    # Modèle verrouillé côté serveur (le prix en dépend) : seuls les identifiants connus passent.
    allowed = {settings.deepseek_model, settings.deepseek_pro_model}
    if body.get("model") not in allowed:
        body["model"] = settings.deepseek_model
    # Images (pièces jointes, captures d'écran de l'agent) : seul Flash les accepte
    if body["model"] != settings.deepseek_model and has_images(body["messages"]):
        body["model"] = settings.deepseek_model

    # Une seule réponse par requête (n>1 multiplierait le coût de sortie réservé)
    body.pop("n", None)

    is_stream = bool(body.get("stream", False))
    if is_stream:
        # Sans cette option, le flux ne contient pas la consommation réelle : on facturerait une estimation.
        body["stream_options"] = {**(body.get("stream_options") or {}), "include_usage": True}

    # Réserve le coût maximal et plafonne max_tokens à ce que le solde peut payer (402 sinon)
    reservation = await billing.reserve_for_chat(email, provider, body["model"], body)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['api_key']}",
    }

    target_url = f"{config['base_url']}/chat/completions"
    start_time = time.time()

    if is_stream:
        return await _proxy_stream_with_billing(
            target_url, headers, body, email, provider, start_time, reservation
        )
    return await _proxy_request_with_billing(
        target_url, headers, body, email, provider, start_time, reservation
    )
