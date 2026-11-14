"""
CREDITS + PAYMENTS + USAGE routes — /api/credits/*, /api/payments/*, /api/usage/*
"""
from fastapi import APIRouter, HTTPException, Depends
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
    amount: float = Field(..., gt=0, le=1_000_000)
    currency: str = Field(default="XOF", max_length=8)
    method: str = Field(default="wave", max_length=32)


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
async def initiate_payment(body: PaymentInitiateRequest, user: dict = Depends(get_current_user)):
    """
    Prepare un paiement (Wave/Orange Money).
    Pour l'instant, on cree juste une demande en DB (payment_intents).
    """
    intent = await create_payment_intent(user["sub"], body.amount, currency=body.currency, method=body.method)
    return {
        "status": "pending",
        "intent_id": intent.get("id"),
        "paymentUrl": None,
        "message": "Paiement en cours d'intégration. Demande enregistrée; l'admin validera et créditera le compte.",
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
