"""
MEMORY routes — /api/user/memory/*
Hermes-inspired persistent developer memory.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional

from security import get_current_user
from database import (
    get_user_memory, get_memory_as_profile,
    upsert_memory, batch_upsert_memory,
    delete_memory, clear_user_memory,
)

router = APIRouter(prefix="/api/user/memory", tags=["memory"])


# ── Models ──

class MemoryEntry(BaseModel):
    category: str = Field(..., pattern="^(stack|conventions|patterns|errors|preferences|style)$")
    key: str = Field(..., min_length=1, max_length=255)
    value: str | dict | list | int | float | bool
    confidence: float = Field(default=1.0, ge=0, le=1)


class BatchMemoryRequest(BaseModel):
    entries: list[MemoryEntry] = Field(..., min_length=1, max_length=50)


class DeleteMemoryRequest(BaseModel):
    category: str = Field(..., pattern="^(stack|conventions|patterns|errors|preferences|style)$")
    key: str = Field(..., min_length=1, max_length=255)


# ── Routes ──

@router.get("")
async def get_memory(
    category: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Get user's developer memory (all or filtered by category)."""
    email = user["sub"]
    entries = await get_user_memory(email, category)
    return {"entries": entries, "count": len(entries)}


@router.get("/profile")
async def get_profile_memory(user: dict = Depends(get_current_user)):
    """Get user memory organized as a developer profile."""
    email = user["sub"]
    profile = await get_memory_as_profile(email)
    return {"profile": profile}


@router.patch("")
async def update_memory(
    body: MemoryEntry,
    user: dict = Depends(get_current_user),
):
    """Manually set/update a memory entry."""
    email = user["sub"]
    row_id = await upsert_memory(
        email=email,
        category=body.category,
        key=body.key,
        value=body.value,
        confidence=body.confidence,
        source="manual",
    )
    return {"status": "ok", "id": row_id}


@router.post("/batch")
async def batch_update_memory(
    body: BatchMemoryRequest,
    user: dict = Depends(get_current_user),
):
    """Batch upsert multiple memory entries (manual)."""
    email = user["sub"]
    count = await batch_upsert_memory(
        email=email,
        entries=[e.model_dump() for e in body.entries],
        source="manual",
    )
    return {"status": "ok", "count": count}


@router.post("/learn")
async def learn_memory(
    body: BatchMemoryRequest,
    user: dict = Depends(get_current_user),
):
    """Auto-learn memory entries (from AI analysis). Lower default confidence."""
    email = user["sub"]
    entries_raw = []
    for e in body.entries:
        d = e.model_dump()
        d["confidence"] = min(d.get("confidence", 0.5), 0.8)  # Auto-learned capped at 0.8
        entries_raw.append(d)
    count = await batch_upsert_memory(email=email, entries=entries_raw, source="auto")
    return {"status": "ok", "count": count}


@router.delete("")
async def remove_memory(
    body: DeleteMemoryRequest,
    user: dict = Depends(get_current_user),
):
    """Delete a specific memory entry."""
    email = user["sub"]
    deleted = await delete_memory(email, body.category, body.key)
    if not deleted:
        raise HTTPException(404, "Entrée non trouvée")
    return {"status": "ok"}


@router.delete("/all")
async def clear_all_memory(
    category: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Clear all memory (or by category)."""
    email = user["sub"]
    count = await clear_user_memory(email, category)
    return {"status": "ok", "deleted": count}
