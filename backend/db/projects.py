"""
db/projects.py — Project CRUD + cleanup.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import delete, select, update

from db.base import get_sessionmaker, _utcnow, _model_to_dict
from db.models import Project

logger = logging.getLogger("anzar.database")


async def create_project(project_id: str, email: str, name: str, description: str = "") -> Dict[str, Any]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            p = Project(id=project_id, user_email=email, name=name, description=description or "")
            session.add(p)
        return {"id": project_id, "name": name, "status": "pending"}


async def update_project(project_id: str, **fields) -> bool:
    allowed = {"status", "plan_json", "result_json", "tokens_used", "cost_fcfa", "name", "description", "agent_states"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return False
    updates["updated_at"] = _utcnow()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(Project).where(Project.id == project_id).values(**updates))
            return (res.rowcount or 0) > 0


async def get_project(project_id: str) -> Optional[Dict[str, Any]]:
    Session = get_sessionmaker()
    async with Session() as session:
        p = await session.scalar(select(Project).where(Project.id == project_id))
        return _model_to_dict(p) if p else None


async def get_user_projects(email: str, limit: int = 50) -> List[Dict[str, Any]]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.scalars(
                select(Project).where(Project.user_email == email).order_by(Project.updated_at.desc()).limit(limit)
            )
        ).all()
        return [_model_to_dict(r) for r in rows]


async def delete_project(project_id: str, email: str) -> bool:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(delete(Project).where(Project.id == project_id, Project.user_email == email))
            return (res.rowcount or 0) > 0


async def cleanup_old_projects(max_age_days: int = 90) -> int:
    """Delete projects older than max_age_days that are in terminal state (complete/error/cancelled).
    Returns number of deleted rows."""
    cutoff = _utcnow() - timedelta(days=max_age_days)
    terminal_statuses = ("complete", "error", "cancelled")
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(
                delete(Project).where(
                    Project.updated_at < cutoff,
                    Project.status.in_(terminal_statuses),
                )
            )
            deleted = res.rowcount or 0
            if deleted > 0:
                logger.info(f"cleanup_old_projects: removed {deleted} projects older than {max_age_days} days")
            return deleted
