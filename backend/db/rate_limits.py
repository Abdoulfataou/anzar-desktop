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
