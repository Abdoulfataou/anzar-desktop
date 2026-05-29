"""
db/usage.py — Usage tracking & transaction history.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict, List

from sqlalchemy import func, select

from db.base import get_sessionmaker, _utcnow, _model_to_dict
from db.models import UsageRecord, Transaction


async def record_usage(
    email: str,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    cost_fcfa: float,
    duration_ms: int = 0,
    task_type: str = "chat",
    was_fallback: bool = False,
) -> int:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            rec = UsageRecord(
                user_email=email,
                provider=provider,
                model=model,
                task_type=task_type,
                input_tokens=int(input_tokens or 0),
                output_tokens=int(output_tokens or 0),
                cost_usd=float(cost_usd or 0),
                cost_fcfa=float(cost_fcfa or 0),
                duration_ms=int(duration_ms or 0),
                was_fallback=bool(was_fallback),
            )
            session.add(rec)
            await session.flush()
            return int(rec.id)


async def get_usage_history(email: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.scalars(
                select(UsageRecord)
                .where(UsageRecord.user_email == email)
                .order_by(UsageRecord.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
        return [_model_to_dict(r) for r in rows]


async def get_transactions(email: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.scalars(
                select(Transaction)
                .where(Transaction.user_email == email)
                .order_by(Transaction.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
        return [_model_to_dict(r) for r in rows]


async def get_usage_stats(email: str, days: int = 30) -> Dict[str, Any]:
    email = email.lower().strip()
    cutoff = _utcnow() - timedelta(days=int(days or 30))

    start_today = _utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    end_today = start_today + timedelta(days=1)

    Session = get_sessionmaker()
    async with Session() as session:
        total = await session.execute(
            select(
                func.count(UsageRecord.id).label("total_requests"),
                func.coalesce(func.sum(UsageRecord.input_tokens), 0).label("total_input_tokens"),
                func.coalesce(func.sum(UsageRecord.output_tokens), 0).label("total_output_tokens"),
                func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("total_cost_fcfa"),
                func.coalesce(func.sum(UsageRecord.cost_usd), 0).label("total_cost_usd"),
                func.coalesce(func.avg(UsageRecord.duration_ms), 0).label("avg_duration_ms"),
            ).where(UsageRecord.user_email == email, UsageRecord.created_at >= cutoff)
        )
        total_row = dict(total.mappings().first() or {})

        by_provider = await session.execute(
            select(
                UsageRecord.provider.label("provider"),
                func.count(UsageRecord.id).label("requests"),
                func.coalesce(func.sum(UsageRecord.input_tokens + UsageRecord.output_tokens), 0).label("tokens"),
                func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("cost_fcfa"),
            )
            .where(UsageRecord.user_email == email, UsageRecord.created_at >= cutoff)
            .group_by(UsageRecord.provider)
        )
        providers = {r["provider"]: dict(r) for r in by_provider.mappings().all()}

        today_q = await session.execute(
            select(
                func.count(UsageRecord.id).label("requests"),
                func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("cost_fcfa"),
            ).where(UsageRecord.user_email == email, UsageRecord.created_at >= start_today, UsageRecord.created_at < end_today)
        )
        today = dict(today_q.mappings().first() or {})

    return {"period_days": days, "total": total_row, "by_provider": providers, "today": today}
