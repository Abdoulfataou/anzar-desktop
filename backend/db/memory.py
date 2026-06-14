"""
db/memory.py — CRUD for UserMemory (Hermes-inspired persistent learning).
"""

import json
import logging
from typing import Any, Optional

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from db.base import get_sessionmaker, _utcnow
from db.models import UserMemory

logger = logging.getLogger(__name__)


async def get_user_memory(email: str, category: Optional[str] = None) -> list[dict]:
    """Get all memory entries for a user, optionally filtered by category."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        stmt = select(UserMemory).where(UserMemory.user_email == email)
        if category:
            stmt = stmt.where(UserMemory.category == category)
        stmt = stmt.order_by(UserMemory.category, UserMemory.key)
        result = await session.execute(stmt)
        rows = result.scalars().all()
        return [
            {
                "id": r.id,
                "category": r.category,
                "key": r.key,
                "value": _safe_json_load(r.value),
                "confidence": r.confidence,
                "source": r.source,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]


async def get_memory_as_profile(email: str) -> dict[str, Any]:
    """Get user memory organized as a developer profile dict.

    Returns:
        {
            "stack": {"frontend": "React + TypeScript", ...},
            "conventions": {"naming": "camelCase", ...},
            "patterns": {"state": "Zustand", ...},
            "errors": {"common": ["...", ...], ...},
            "preferences": {"theme": "dark", ...},
            "style": {"comments": "french", ...},
        }
    """
    entries = await get_user_memory(email)
    profile: dict[str, dict] = {}
    for entry in entries:
        cat = entry["category"]
        if cat not in profile:
            profile[cat] = {}
        profile[cat][entry["key"]] = entry["value"]
    return profile


async def upsert_memory(
    email: str,
    category: str,
    key: str,
    value: Any,
    confidence: float = 0.5,
    source: str = "auto",
) -> int:
    """Insert or update a memory entry. Returns the row id."""
    value_json = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    async_session = get_sessionmaker()
    async with async_session() as session:
        # Check if exists
        stmt = select(UserMemory).where(
            UserMemory.user_email == email,
            UserMemory.category == category,
            UserMemory.key == key,
        )
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            # Update — manual always overrides, auto only if higher confidence
            if source == "manual" or confidence > existing.confidence:
                existing.value = value_json
                existing.confidence = min(confidence, 1.0)
                existing.source = source
                existing.updated_at = _utcnow()
                await session.commit()
            return existing.id
        else:
            entry = UserMemory(
                user_email=email,
                category=category,
                key=key,
                value=value_json,
                confidence=min(confidence, 1.0),
                source=source,
            )
            session.add(entry)
            await session.commit()
            await session.refresh(entry)
            return entry.id


async def batch_upsert_memory(
    email: str,
    entries: list[dict],
    source: str = "auto",
) -> int:
    """Batch upsert multiple memory entries. Returns count of entries processed."""
    count = 0
    for entry in entries:
        await upsert_memory(
            email=email,
            category=entry["category"],
            key=entry["key"],
            value=entry["value"],
            confidence=entry.get("confidence", 0.5),
            source=source,
        )
        count += 1
    return count


async def delete_memory(email: str, category: str, key: str) -> bool:
    """Delete a specific memory entry."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        stmt = delete(UserMemory).where(
            UserMemory.user_email == email,
            UserMemory.category == category,
            UserMemory.key == key,
        )
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0


async def clear_user_memory(email: str, category: Optional[str] = None) -> int:
    """Clear all memory for a user, optionally by category. Returns deleted count."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        stmt = delete(UserMemory).where(UserMemory.user_email == email)
        if category:
            stmt = stmt.where(UserMemory.category == category)
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount


def _safe_json_load(value: str) -> Any:
    """Try to parse JSON, return raw string if it fails."""
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value
