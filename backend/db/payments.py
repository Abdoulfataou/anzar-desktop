"""
db/payments.py — Payment intents (Wave, Orange Money, etc.).
"""

from __future__ import annotations

import uuid as _uuid
from typing import Any, Dict, List

from sqlalchemy import func, select

from db.base import get_sessionmaker, _utcnow, _model_to_dict
from db.models import PaymentIntent
from db.credits import add_credits


async def create_payment_intent(
    user_email: str,
    amount_fcfa: float,
    currency: str = "XOF",
    method: str = "",
) -> Dict[str, Any]:
    """Create a payment intent in DB (status=pending). No external provider call yet."""
    user_email = (user_email or "").strip().lower()
    currency = (currency or "XOF").strip().upper()
    method = (method or "").strip().lower()
    amount_fcfa = float(amount_fcfa or 0)
    if amount_fcfa <= 0:
        raise ValueError("Montant invalide")

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            intent = PaymentIntent(
                id=_uuid.uuid4().hex,
                user_email=user_email,
                amount_fcfa=amount_fcfa,
                currency=currency,
                method=method,
                status="pending",
                provider_ref="",
                payment_url="",
            )
            session.add(intent)
            return _model_to_dict(intent)


async def admin_list_payment_intents(status: str = "pending", limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    status = (status or "pending").strip().lower()
    Session = get_sessionmaker()
    async with Session() as session:
        where = []
        if status != "all":
            where.append(PaymentIntent.status == status)
        total_q = await session.execute(select(func.count(PaymentIntent.id)).where(*where))
        total = int(total_q.scalar() or 0)
        rows = (
            await session.scalars(
                select(PaymentIntent).where(*where).order_by(PaymentIntent.created_at.desc()).limit(limit).offset(offset)
            )
        ).all()
        return {"payment_intents": [_model_to_dict(r) for r in rows], "total": total}


async def admin_mark_payment_intent_paid(
    intent_id: str,
    admin_email: str,
    provider_ref: str = "",
    description: str = "",
) -> Dict[str, Any]:
    """
    Mark intent as paid + credit user.
    Uses intent_id/provider_ref as external_ref to prevent double credit.
    """
    intent_id = (intent_id or "").strip()
    provider_ref = (provider_ref or "").strip()
    description = (description or "").strip()
    if len(description) < 3:
        raise ValueError("Raison obligatoire (min 3 caractères)")

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            intent = await session.scalar(select(PaymentIntent).where(PaymentIntent.id == intent_id).with_for_update())
            if not intent:
                raise ValueError("Demande introuvable")
            if intent.status == "paid":
                return _model_to_dict(intent)

            intent.status = "paid"
            intent.provider_ref = provider_ref
            intent.updated_at = _utcnow()

        # Apply bonus based on recharge amount
        from config import settings as _cfg
        bonus_pct = _cfg.get_recharge_bonus_percent(intent.amount_fcfa)
        bonus_amount = round(intent.amount_fcfa * bonus_pct / 100) if bonus_pct > 0 else 0
        total_credited = intent.amount_fcfa + bonus_amount

        external_ref = provider_ref or intent_id
        bonus_label = f" (+{bonus_pct}% bonus = {total_credited} F)" if bonus_pct > 0 else ""
        await add_credits(
            intent.user_email,
            total_credited,
            description=f"Paiement validé ({admin_email}): {description}{bonus_label}",
            tx_type="recharge",
            external_ref=external_ref,
        )

    # Reload latest
    Session = get_sessionmaker()
    async with Session() as session:
        intent = await session.scalar(select(PaymentIntent).where(PaymentIntent.id == intent_id))
        return _model_to_dict(intent) if intent else {}
