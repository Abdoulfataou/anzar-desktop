"""
db/credits.py — Credits management (recharge, deduct, check balance).
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy import select

from db.base import get_sessionmaker, _utcnow, _model_to_dict
from db.models import Credits, Transaction


async def get_credits(email: str) -> Dict[str, Any]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        row = await session.scalar(select(Credits).where(Credits.user_email == email))
        if not row:
            return {"user_email": email, "balance_fcfa": 0, "total_recharged": 0, "total_used": 0}
        d = _model_to_dict(row)
        d.pop("id", None)
        return d


async def add_credits(
    email: str,
    amount_fcfa: float,
    description: str = "Recharge",
    tx_type: str = "recharge",
    external_ref: str = "",
) -> Dict[str, Any]:
    """Add credits (recharge/bonus/refund). Idempotent if external_ref is provided."""
    email = email.lower().strip()
    tx_type = (tx_type or "recharge").strip().lower()
    if tx_type not in ("recharge", "bonus", "refund"):
        tx_type = "recharge"
    external_ref = (external_ref or "").strip() or None

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if external_ref:
                existing = await session.scalar(select(Transaction.id).where(Transaction.external_ref == external_ref))
                if existing:
                    return await get_credits(email)

            credits = await session.scalar(select(Credits).where(Credits.user_email == email).with_for_update())
            if not credits:
                credits = Credits(user_email=email, balance_fcfa=0, total_recharged=0, total_used=0)
                session.add(credits)
                await session.flush()

            credits.balance_fcfa = float(credits.balance_fcfa or 0) + float(amount_fcfa)
            credits.total_recharged = float(credits.total_recharged or 0) + float(amount_fcfa)
            credits.updated_at = _utcnow()

            session.add(
                Transaction(
                    user_email=email,
                    type=tx_type,
                    amount_fcfa=float(amount_fcfa),
                    description=description or "",
                    external_ref=external_ref,
                )
            )

        return await get_credits(email)


async def deduct_credits(
    email: str,
    amount_fcfa: float,
    description: str = "",
    provider: str = "",
    model: str = "",
    input_tokens: int = 0,
    output_tokens: int = 0,
    external_ref: Optional[str] = None,
) -> Dict[str, Any]:
    """Deduct credits after API usage. Returns new balance. Raises if insufficient."""
    email = email.lower().strip()
    amount_fcfa = float(amount_fcfa or 0)
    if amount_fcfa <= 0:
        return await get_credits(email)

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if external_ref:
                external_ref = (external_ref or "").strip()
                if external_ref:
                    existing = await session.scalar(select(Transaction.id).where(Transaction.external_ref == external_ref))
                    if existing:
                        return await get_credits(email)

            credits = await session.scalar(select(Credits).where(Credits.user_email == email).with_for_update())
            if not credits or float(credits.balance_fcfa or 0) < amount_fcfa:
                raise ValueError("Solde insuffisant")

            credits.balance_fcfa = float(credits.balance_fcfa or 0) - amount_fcfa
            credits.total_used = float(credits.total_used or 0) + amount_fcfa
            credits.updated_at = _utcnow()

            session.add(
                Transaction(
                    user_email=email,
                    type="usage",
                    amount_fcfa=-amount_fcfa,
                    description=description or "",
                    provider=provider or "",
                    model=model or "",
                    input_tokens=int(input_tokens or 0),
                    output_tokens=int(output_tokens or 0),
                    external_ref=(external_ref or "").strip() or None,
                )
            )

        return await get_credits(email)


async def has_credits(email: str) -> bool:
    creds = await get_credits(email)
    return float(creds.get("balance_fcfa", 0) or 0) > 0
