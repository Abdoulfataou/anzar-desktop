"""
CREDITS + PAYMENTS + USAGE routes — /api/credits/*, /api/payments/*, /api/usage/*
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field

from security import get_current_user
from db import (
    get_credits, get_transactions,
    get_usage_history, get_usage_stats,
    create_payment_intent,
)

router = APIRouter(tags=["credits"])


# ── Models ──

class PaymentInitiateRequest(BaseModel):
    # Montant libre en FCFA (XOF uniquement). Ignoré si pack_id est fourni.
    amount: Optional[float] = Field(default=None, gt=0, le=1_000_000)
    # Devise de paiement choisie (ISO 4217). Le PRIX n'est jamais accepté depuis l'app :
    # le serveur le recalcule à partir de (currency, pack_id).
    currency: str = Field(default="XOF", max_length=8)
    pack_id: Optional[int] = Field(default=None, ge=1)
    country: str = Field(default="", max_length=2)   # indice de l'app (langue/fuseau), si pas d'en-tête pays
    method: str = Field(default="wave", max_length=32)
    # Fournisseur automatique (fedapay, stripe…). Vide = demande manuelle validée par un admin.
    provider: str = Field(default="", max_length=32)


# ── Credits ──

@router.get("/api/credits")
async def get_user_credits(user: dict = Depends(get_current_user)):
    """Get current credit balance."""
    creds = await get_credits(user["sub"])
    return {
        "balance_fcfa": creds.get("balance_fcfa", 0),
        "total_recharged": creds.get("total_recharged", 0),
        "total_used": creds.get("total_used", 0),
    }


@router.post("/api/credits/recharge", include_in_schema=False)
async def recharge_credits():
    """
    Endpoint désactivé (faille financière : self-crédit sur simple référence non vérifiée).
    Les crédits sont ajoutés UNIQUEMENT via :
      - POST /api/admin/users/{email}/credits       (admin, rôle owner/admin)
      - POST /api/admin/payments/{intent_id}/mark-paid (validation d'un paiement)
      - un futur webhook signé du provider Mobile Money
    """
    raise HTTPException(
        403,
        "Recharge directe désactivée. Utilisez le flux de paiement (Wave, Orange Money, etc.) ; "
        "la validation est faite par un admin ou le webhook du provider.",
    )


@router.get("/api/credits/transactions")
async def get_credit_transactions(
    user: dict = Depends(get_current_user),
    limit: int = 50,
    offset: int = 0,
):
    """Get transaction history (recharges + usages)."""
    txs = await get_transactions(user["sub"], limit=min(limit, 200), offset=offset)
    return {"transactions": txs, "count": len(txs)}


# ── Payments ──

@router.post("/api/payments/initiate")
async def initiate_payment(body: PaymentInitiateRequest, request: Request, user: dict = Depends(get_current_user)):
    """
    Démarre une recharge.
      - provider renseigné : paiement automatique, renvoie paymentUrl ; le compte est crédité
        par le webhook signé (ou le sondage de l'app, ou le rattrapage périodique).
      - provider vide : demande manuelle (Wave, Orange Money…), validée par un admin.
    """
    from config import settings
    from services.payments import start_payment
    from services.payments.base import PaymentError

    from routes.pricing import request_country

    if body.provider:
        try:
            return await start_payment(user["sub"], body.provider, currency=body.currency,
                                       pack_id=body.pack_id, amount_fcfa=body.amount,
                                       country=request_country(request, body.country))
        except ValueError as e:
            raise HTTPException(400, str(e))
        except PaymentError as e:
            raise HTTPException(502, str(e))

    if not settings.manual_payments_enabled:
        raise HTTPException(400, "Choisis un moyen de paiement")
    if not body.amount:
        raise HTTPException(400, "Montant requis pour une demande manuelle")
    intent = await create_payment_intent(user["sub"], body.amount, currency=body.currency, method=body.method)
    return {
        "status": "pending",
        "intent_id": intent.get("id"),
        "paymentUrl": None,
        "message": "Demande enregistrée. Envoie le paiement : un admin vérifie la réception et crédite ton compte.",
    }


# ── Usage ──

@router.get("/api/usage")
async def get_user_usage(
    user: dict = Depends(get_current_user),
    limit: int = 50,
    offset: int = 0,
):
    """Get detailed usage history."""
    records = await get_usage_history(user["sub"], limit=min(limit, 200), offset=offset)
    return {"records": records, "count": len(records)}


@router.get("/api/usage/stats")
async def get_user_usage_stats(
    user: dict = Depends(get_current_user),
    days: int = 30,
):
    """Get aggregated usage statistics."""
    stats = await get_usage_stats(user["sub"], days=min(days, 365))
    return stats
