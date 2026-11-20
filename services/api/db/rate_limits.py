"""
db/rate_limits.py — Persistent rate limiting.
"""

from __future__ import annotations

import time

from sqlalchemy import delete, func, select

from db.base import get_sessionmaker
from db.models import RateLimit


async def record_rate_limit_hit(client_key: str, endpoint: str = "*"):
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            session.add(RateLimit(client_key=client_key, endpoint=endpoint, timestamp=time.time()))


async def get_rate_limit_count(client_key: str, window_seconds: int) -> int:
    cutoff = time.time() - float(window_seconds)
    Session = get_sessionmaker()
    async with Session() as session:
        q = await session.execute(
            select(func.count(RateLimit.id)).where(RateLimit.client_key == client_key, RateLimit.timestamp > cutoff)
        )
        return int(q.scalar() or 0)


async def cleanup_rate_limits(max_age_seconds: int = 86400):
    cutoff = time.time() - float(max_age_seconds)
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            await session.execute(delete(RateLimit).where(RateLimit.timestamp < cutoff))


async def check_and_record(
    client_key: str,
    endpoint: str,
    per_minute: int,
    per_day: int,
) -> None:
    """Rate limit autoritaire, partagé entre workers (état en base).

    Lève ValueError("minute"|"day") si une limite est atteinte ; enregistre
    le hit sinon. Clé = client_key:endpoint pour cloisonner les fenêtres.
    """
    key = f"{client_key}:{endpoint}"
    now = time.time()

    Session = get_sessionmaker()
    async with Session() as session:
        minute_count = await session.scalar(
            select(func.count(RateLimit.id)).where(
                RateLimit.client_key == key,
                RateLimit.timestamp > now - 60,
            )
        )
        if int(minute_count or 0) >= per_minute:
            raise ValueError("minute")

        day_count = await session.scalar(
            select(func.count(RateLimit.id)).where(
                RateLimit.client_key == key,
                RateLimit.timestamp > now - 86400,
            )
        )
        if int(day_count or 0) >= per_day:
            raise ValueError("day")

        session.add(RateLimit(client_key=key, endpoint=endpoint, timestamp=now))
        await session.commit()
