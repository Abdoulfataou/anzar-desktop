"""
PAYMENTS routes — moyens disponibles, suivi d'une recharge, webhooks, page de retour.
  GET  /api/payments/methods
  GET  /api/payments/return?i=<id>[&r=cancel]     (page affichée après le paiement)
  GET  /api/payments/{intent_id}                  (statut, relu chez le fournisseur si en attente)
  POST /api/payments/webhook/{provider}           (signé par le fournisseur)
(La création reste POST /api/payments/initiate, dans routes/credits.py.)
"""
import html
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from security import get_current_user
from services.payments import get_user_intent, handle_webhook, list_methods, refresh_intent
from services.payments.base import SignatureError

logger = logging.getLogger("anzar.payments.routes")
router = APIRouter(tags=["payments"])

MAX_WEBHOOK_BYTES = 256 * 1024


@router.get("/api/payments/methods")
async def payment_methods(user: dict = Depends(get_current_user)):
    return list_methods()


@router.get("/api/payments/return", response_class=HTMLResponse, include_in_schema=False)
async def payment_return(i: str = "", r: str = ""):
    """Page de fin de paiement. Elle déclenche aussi une relecture du statut (sans rien révéler)."""
    status = ""
    if i and len(i) <= 64 and i.isalnum():
        intent = await refresh_intent(i)
        status = intent.status if intent else ""
    if status == "paid":
        title, text = "Paiement confirmé", "Tes crédits sont ajoutés. Tu peux fermer cette page et revenir dans ANZAR."
    elif r == "cancel" or status in ("cancelled", "failed"):
        title, text = "Paiement non abouti", "Aucun montant n'a été crédité. Reviens dans ANZAR pour réessayer."
    else:
        title, text = "Paiement en cours de confirmation", (
            "Tu peux revenir dans ANZAR : tes crédits apparaîtront dès que le paiement sera confirmé.")
    page = f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)} — ANZAR</title>
<style>body{{font-family:system-ui,sans-serif;background:#0f1115;color:#e8e8ea;display:flex;min-height:100vh;
align-items:center;justify-content:center;margin:0}}main{{max-width:420px;padding:32px;text-align:center}}
h1{{font-size:20px}}p{{color:#a0a3ab;line-height:1.5}}</style></head>
<body><main><h1>{html.escape(title)}</h1><p>{html.escape(text)}</p></main></body></html>"""
    return HTMLResponse(page, headers={
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        "Cache-Control": "no-store"})


@router.get("/api/payments/{intent_id}")
async def payment_status(intent_id: str, user: dict = Depends(get_current_user)):
    data = await get_user_intent(intent_id, user["sub"])
    if not data:
        raise HTTPException(404, "Paiement introuvable")
    return data


@router.post("/api/payments/webhook/{provider}", include_in_schema=False)
async def payment_webhook(provider: str, request: Request):
    # Refuse avant lecture complète : un corps énorme ne doit pas être chargé en mémoire.
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > MAX_WEBHOOK_BYTES:
        raise HTTPException(413, "Trop volumineux")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_WEBHOOK_BYTES:
            raise HTTPException(413, "Trop volumineux")
        chunks.append(chunk)
    raw = b"".join(chunks)
    try:
        result = await handle_webhook(provider.strip().lower(), raw, request.headers)
    except SignatureError as e:
        logger.warning("Webhook %s rejeté : %s", provider, e)
        raise HTTPException(400, "Signature invalide")
    if result == "disabled":
        raise HTTPException(404, "Fournisseur non configuré")
    return {"received": True, "result": result}
