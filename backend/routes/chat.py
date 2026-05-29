"""
CHAT / AI PROXY routes — /api/{provider}/chat/completions, /api/chat/smart,
/api/{provider}/beta/completions, /api/deepseek/files, /api/deepseek/batches
"""
import json
import time
import logging

from fastapi import APIRouter, HTTPException, Request, Depends, UploadFile, File, Form
from fastapi.responses import StreamingResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
import httpx

from config import settings
from security import get_current_user, validate_messages, calculate_cost_fcfa
from database import (
    has_credits, deduct_credits, record_usage,
    get_rate_limit_count, record_rate_limit_hit,
)
from services.deepseek_client import DeepSeekClient
from services.web_search import search_web, format_search_results, WEB_SEARCH_TOOL
from routes._state import (
    get_provider_config, _disable_provider, _provider_unavailable_message,
)

logger = logging.getLogger("anzar")

router = APIRouter(tags=["chat"])


# ── Helpers ──

def _deepseek_v1_base() -> str:
    base = (settings.deepseek_base_url or "").rstrip("/")
    if base.endswith("/v1"):
        return base
    return f"{base}/v1"


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
) -> JSONResponse:
    """Forward request, then bill the user based on token usage."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(url, headers=headers, json=body)
        except httpx.TimeoutException:
            if provider == "kimi":
                _disable_provider("kimi", 300, "timeout")
                raise HTTPException(503, _provider_unavailable_message("kimi"))
            raise HTTPException(504, "AI provider timeout")
        except httpx.ConnectError:
            if provider == "kimi":
                _disable_provider("kimi", 300, "connect_error")
                raise HTTPException(503, _provider_unavailable_message("kimi"))
            raise HTTPException(502, "Cannot reach AI provider")

    if resp.status_code != 200:
        if provider == "kimi" and resp.status_code in (401, 402, 403, 429):
            _disable_provider("kimi", 3600, f"provider_status={resp.status_code}")
            raise HTTPException(503, _provider_unavailable_message("kimi"))
        try:
            error_data = resp.json()
        except Exception:
            error_data = {"error": {"message": f"Provider error: {resp.status_code}"}}
        return JSONResponse(status_code=resp.status_code, content=error_data)

    data = resp.json()
    duration_ms = int((time.time() - start_time) * 1000)

    usage = data.get("usage", {})
    input_tokens = usage.get("prompt_tokens", 0)
    output_tokens = usage.get("completion_tokens", 0)

    if input_tokens > 0 or output_tokens > 0:
        cost_usd, cost_fcfa = calculate_cost_fcfa(provider, input_tokens, output_tokens)

        try:
            is_paid = await has_credits(email)
            await record_usage(
                email,
                provider,
                body.get("model", "unknown"),
                input_tokens,
                output_tokens,
                cost_usd,
                cost_fcfa,
                duration_ms,
                task_type="free_chat" if not is_paid else "chat",
            )
            if is_paid and cost_fcfa > 0:
                await deduct_credits(
                    email,
                    cost_fcfa,
                    f"Chat {provider}/{body.get('model', '?')}",
                    provider,
                    body.get("model", ""),
                    input_tokens,
                    output_tokens,
                )
        except ValueError:
            logger.warning(f"Insufficient credits for {email} during billing")
        except Exception as e:
            logger.error(f"Billing error: {e}")

    return JSONResponse(content=data)


async def _proxy_stream_with_billing(
    url: str, headers: dict, body: dict,
    email: str, provider: str, start_time: float,
) -> StreamingResponse:
    """Forward streaming SSE request, then bill at the end."""

    async def stream_generator():
        input_tokens = 0
        output_tokens = 0
        model_name = body.get("model", "unknown")
        client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

        try:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code != 200:
                    if provider == "kimi" and resp.status_code in (401, 402, 403, 429):
                        _disable_provider("kimi", 3600, f"provider_status={resp.status_code}")
                        yield f"data: {json.dumps({'error': {'message': _provider_unavailable_message('kimi')}})}\n\n"
                        return
                    yield f"data: {json.dumps({'error': {'message': f'Provider error: {resp.status_code}'}})}\n\n"
                    return

                async for line in resp.aiter_lines():
                    if line.strip():
                        yield f"{line}\n\n"

                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                chunk = json.loads(line[6:])
                                if "usage" in chunk:
                                    input_tokens = chunk["usage"].get("prompt_tokens", 0)
                                    output_tokens = chunk["usage"].get("completion_tokens", 0)
                                if chunk.get("model"):
                                    model_name = chunk["model"]
                            except (json.JSONDecodeError, KeyError):
                                pass

        except httpx.TimeoutException:
            if provider == "kimi":
                _disable_provider("kimi", 300, "timeout_stream")
                yield f"data: {json.dumps({'error': {'message': _provider_unavailable_message('kimi')}})}\n\n"
            else:
                yield f"data: {json.dumps({'error': {'message': 'Provider timeout'}})}\n\n"
        except Exception as e:
            logger.error("Stream error: %s", e)
            yield f"data: {json.dumps({'error': {'message': 'Erreur interne. Réessaie.'}})}\n\n"
        finally:
            await client.aclose()

            duration_ms = int((time.time() - start_time) * 1000)

            if input_tokens == 0 and output_tokens == 0:
                input_chars = sum(
                    len(m.get("content", "")) for m in body.get("messages", []) if isinstance(m.get("content"), str)
                )
                input_tokens = max(input_chars // 4, 1)
                output_tokens = max(duration_ms // 50, 10)

            if input_tokens > 0 or output_tokens > 0:
                cost_usd, cost_fcfa = calculate_cost_fcfa(provider, input_tokens, output_tokens)
                try:
                    is_paid = await has_credits(email)
                    await record_usage(
                        email,
                        provider,
                        model_name,
                        input_tokens,
                        output_tokens,
                        cost_usd,
                        cost_fcfa,
                        duration_ms,
                        task_type="free_chat_stream" if not is_paid else "chat_stream",
                    )
                    if is_paid and cost_fcfa > 0:
                        await deduct_credits(
                            email,
                            cost_fcfa,
                            f"Stream {provider}/{model_name}",
                            provider,
                            model_name,
                            input_tokens,
                            output_tokens,
                        )
                except Exception as e:
                    logger.error(f"BILLING_FAILED: user={email} provider={provider} model={model_name} "
                                 f"tokens_in={input_tokens} tokens_out={output_tokens} "
                                 f"cost_fcfa={cost_fcfa} error={e}")
                    try:
                        await record_usage(
                            email, provider, model_name,
                            input_tokens, output_tokens, cost_usd, cost_fcfa,
                            duration_ms, task_type="billing_failed",
                        )
                    except Exception:
                        pass

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Routes ──

@router.post("/api/{provider}/chat/completions")
async def proxy_chat(provider: str, request: Request, user: dict = Depends(get_current_user)):
    """
    Proxy AI chat requests to DeepSeek or Kimi.
    Checks credit balance before proxying.
    Deducts credits after successful response.
    """
    email = user["sub"]
    config = get_provider_config(provider)

    has_paid_credits = await has_credits(email)
    is_free_chat = False
    if not has_paid_credits:
        quota = int(getattr(settings, "free_daily_chat_requests", 0) or 0)
        if quota <= 0:
            raise HTTPException(status_code=402, detail="Solde épuisé. Rechargez pour continuer à utiliser ANZAR.")

        free_key = f"free_chat:{email}"
        used = await get_rate_limit_count(free_key, window_seconds=86400)
        if used >= quota:
            raise HTTPException(
                status_code=402,
                detail=f"Quota gratuit atteint ({quota} chats/24h). Rechargez pour continuer."
            )
        await record_rate_limit_hit(free_key, "free-chat")
        is_free_chat = True

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    if "messages" in body:
        body["messages"] = validate_messages(body["messages"])

    if is_free_chat:
        if provider == "deepseek":
            body["model"] = settings.deepseek_model
        elif provider == "kimi":
            body["model"] = settings.kimi_model

    max_tokens = body.get("max_completion_tokens", body.get("max_tokens", 4096))
    if is_free_chat:
        if max_tokens > 512:
            body["max_completion_tokens"] = 512
    else:
        if max_tokens > 16384:
            body["max_completion_tokens"] = 16384

    is_stream = body.get("stream", False)
    if is_free_chat and is_stream:
        raise HTTPException(400, "Streaming indisponible en quota gratuit. Désactive stream ou recharge.")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['api_key']}",
    }

    target_url = f"{config['base_url']}/chat/completions"
    start_time = time.time()

    if is_stream:
        return await _proxy_stream_with_billing(
            target_url, headers, body, email, provider, start_time
        )
    else:
        return await _proxy_request_with_billing(
            target_url, headers, body, email, provider, start_time
        )


@router.post("/api/chat/smart")
async def smart_chat(request: Request, user: dict = Depends(get_current_user)):
    """
    Smart chat endpoint with automatic web search via tool calling.
    """
    email = user["sub"]

    has_paid = await has_credits(email)
    if not has_paid:
        quota = int(getattr(settings, "free_daily_chat_requests", 0) or 0)
        if quota <= 0:
            raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")
        free_key = f"free_chat:{email}"
        used = await get_rate_limit_count(free_key, window_seconds=86400)
        if used >= quota:
            raise HTTPException(402, f"Quota gratuit atteint ({quota}/24h). Rechargez.")
        await record_rate_limit_hit(free_key, "free-chat")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(400, "messages is required")
    messages = validate_messages(messages)

    model = body.get("model", settings.deepseek_model)
    temperature = body.get("temperature", 0.7)
    max_tokens = body.get("max_tokens", 4096)

    async def tool_executor(name: str, args: dict) -> str:
        if name == "web_search":
            query = args.get("query", "")
            num = args.get("num_results", 5)
            if not query:
                return json.dumps({"error": "query is required"})
            data = await search_web(query, num_results=num)
            return format_search_results(data)
        return json.dumps({"error": f"Unknown tool: {name}"})

    start_time = time.time()
    reasoning_content = ""

    try:
        client = DeepSeekClient()

        is_reasoner = "reasoner" in model.lower()

        if is_reasoner:
            reasoning_content, response_text = await client.chat_with_reasoning(
                messages=messages,
                model=model,
            )
        else:
            tools = [WEB_SEARCH_TOOL] if settings.serper_api_key else []

            if tools:
                try:
                    response_text = await client.chat_with_tools(
                        messages=messages,
                        tools=tools,
                        tool_executor=tool_executor,
                        model=model,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
                except Exception as tool_err:
                    logger.warning(f"chat_with_tools failed ({tool_err}), falling back to plain chat")
                    response_text = await client.chat(
                        messages=messages,
                        model=model,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
            else:
                response_text = await client.chat(
                    messages=messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )

        duration_ms = int((time.time() - start_time) * 1000)

        input_tokens = sum(len(m.get("content") or "") for m in messages) // 4
        output_tokens = len(response_text or "") // 4

        _cost_usd, cost_fcfa = calculate_cost_fcfa(
            "deepseek", input_tokens, output_tokens
        )

        if has_paid and cost_fcfa > 0:
            await deduct_credits(email, cost_fcfa, description=f"smart_chat:{model}")
            await record_usage(
                email, "deepseek", model,
                input_tokens, output_tokens, _cost_usd, cost_fcfa,
                duration_ms=duration_ms, task_type="smart_chat"
            )

        message_payload = {
            "role": "assistant",
            "content": response_text or "",
        }
        if reasoning_content:
            message_payload["reasoning_content"] = reasoning_content

        return JSONResponse({
            "choices": [{
                "message": message_payload,
                "finish_reason": "stop",
            }],
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_fcfa": round(cost_fcfa, 2),
            },
            "duration_ms": duration_ms,
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Smart chat error: {type(e).__name__}: {e}", exc_info=True)
        err_str = str(e)
        if "api_key" in err_str.lower() or "bearer" in err_str.lower():
            err_str = "Erreur de configuration du service IA"
        elif "timeout" in err_str.lower():
            err_str = "Le service IA met trop de temps a repondre"
        elif "connection" in err_str.lower() or "connect" in err_str.lower():
            err_str = "Impossible de joindre le service IA"
        elif "400" in err_str:
            err_str = "Requete invalide — le message est peut-etre trop long"
        elif "401" in err_str or "403" in err_str:
            err_str = "Erreur d'authentification avec le service IA"
        elif "429" in err_str:
            err_str = "Trop de requetes — reessaie dans quelques secondes"
        else:
            err_str = "Erreur interne du service IA"
        raise HTTPException(500, err_str)


@router.post("/api/{provider}/beta/completions")
async def proxy_fim(provider: str, request: Request, user: dict = Depends(get_current_user)):
    """Proxy FIM (Fill-In-Middle) completions — DeepSeek beta."""
    email = user["sub"]
    config = get_provider_config(provider)

    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    if body.get("max_tokens", 0) > 2048:
        body["max_tokens"] = 2048

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['api_key']}",
    }

    target_url = f"{config['base_url']}/beta/completions"
    return await _proxy_request(target_url, headers, body)


# ── DeepSeek Files / Batches ──

@router.post("/api/deepseek/files")
async def deepseek_upload_file(
    user: dict = Depends(get_current_user),
    file: UploadFile = File(...),
    purpose: str = Form("batch"),
):
    """Upload un fichier vers DeepSeek (utilise pour Batch API)."""
    email = user["sub"]
    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")
    if not settings.deepseek_api_key:
        raise HTTPException(503, "Service indisponible pour le moment. Réessaie plus tard.")

    content = await file.read()
    headers = {"Authorization": f"Bearer {settings.deepseek_api_key}"}
    data = {"purpose": purpose}
    files = {"file": (file.filename or "batch_requests.jsonl", content, file.content_type or "application/octet-stream")}

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{_deepseek_v1_base()}/files", headers=headers, data=data, files=files)

    if resp.status_code >= 400:
        return JSONResponse(status_code=resp.status_code, content={"error": {"message": f"Erreur service IA (HTTP {resp.status_code})"}})

    return JSONResponse(content=resp.json())


class DeepSeekBatchCreateRequest(BaseModel):
    input_file_id: str = Field(..., min_length=1, max_length=255)
    endpoint: str = Field(default="/v1/chat/completions", max_length=255)
    completion_window: str = Field(default="24h", max_length=20)


@router.post("/api/deepseek/batches")
async def deepseek_create_batch(body: DeepSeekBatchCreateRequest, user: dict = Depends(get_current_user)):
    """Cree un batch DeepSeek (asynchrone)."""
    email = user["sub"]
    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")
    if not settings.deepseek_api_key:
        raise HTTPException(503, "Service indisponible pour le moment. Réessaie plus tard.")

    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    payload = body.model_dump()

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{_deepseek_v1_base()}/batches", headers=headers, json=payload)

    if resp.status_code >= 400:
        return JSONResponse(status_code=resp.status_code, content={"error": {"message": f"Erreur service IA (HTTP {resp.status_code})"}})
    return JSONResponse(content=resp.json())


@router.get("/api/deepseek/batches/{batch_id}")
async def deepseek_get_batch(batch_id: str, user: dict = Depends(get_current_user)):
    """Recupere le statut d'un batch DeepSeek."""
    email = user["sub"]
    if not await has_credits(email):
        raise HTTPException(402, "Solde épuisé. Rechargez pour continuer.")
    if not settings.deepseek_api_key:
        raise HTTPException(503, "Service indisponible pour le moment. Réessaie plus tard.")

    headers = {"Authorization": f"Bearer {settings.deepseek_api_key}"}
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(f"{_deepseek_v1_base()}/batches/{batch_id}", headers=headers)

    if resp.status_code >= 400:
        return JSONResponse(status_code=resp.status_code, content={"error": {"message": f"Erreur service IA (HTTP {resp.status_code})"}})
    return JSONResponse(content=resp.json())


@router.get("/api/deepseek/files/{file_id}/content")
async def deepseek_get_file_content(file_id: str, user: dict = Depends(get_current_user)):
    """Recupere le contenu d'un fichier DeepSeek (souvent output JSONL d'un batch)."""
    email = user["sub"]
    if not settings.deepseek_api_key:
        raise HTTPException(503, "Service indisponible pour le moment. Réessaie plus tard.")

    headers = {"Authorization": f"Bearer {settings.deepseek_api_key}"}
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(f"{_deepseek_v1_base()}/files/{file_id}/content", headers=headers)

    if resp.status_code >= 400:
        return PlainTextResponse(f"Erreur service IA (HTTP {resp.status_code})", status_code=resp.status_code)

    text = resp.text or ""

    # Billing best-effort
    try:
        total_in = 0
        total_out = 0
        model_name = settings.chat_model
        ok_lines = 0
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            ok_lines += 1
            try:
                obj = json.loads(line)
            except Exception:
                continue
            body_data = (((obj.get("response") or {}).get("body")) or {})
            usage = body_data.get("usage") or {}
            total_in += int(usage.get("prompt_tokens") or 0)
            total_out += int(usage.get("completion_tokens") or 0)
            if body_data.get("model"):
                model_name = body_data.get("model")

        if total_in > 0 or total_out > 0:
            cost_usd, cost_fcfa = calculate_cost_fcfa("deepseek", total_in, total_out)
            cost_usd = round(cost_usd * 0.5, 6)
            cost_fcfa = round(cost_fcfa * 0.5, 2)

            await record_usage(
                email, "deepseek", model_name,
                total_in, total_out, cost_usd, cost_fcfa,
                duration_ms=0, task_type="batch",
            )
            if cost_fcfa > 0:
                await deduct_credits(
                    email, cost_fcfa,
                    f"Batch DeepSeek (-50%) ({ok_lines} req)",
                    "deepseek", model_name,
                    total_in, total_out,
                    external_ref=f"batch:{file_id}",
                )
    except ValueError:
        logger.warning(f"Insufficient credits for {email} during batch billing")
    except Exception as e:
        logger.error(f"Batch billing error: {e}")

    return PlainTextResponse(text, media_type="text/plain")
