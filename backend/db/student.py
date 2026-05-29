"""
db/student.py — Student project CRUD.
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import delete, select

from db.base import get_sessionmaker, _utcnow
from db.models import StudentProject


async def create_student_project(
    user_email: str,
    project_id: str,
    project_type: str,
    title: str = "",
    subject: str = "",
    level: str = "",
) -> dict:
    """Create a new student project."""
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            proj = StudentProject(
                id=project_id,
                user_email=user_email,
                project_type=project_type,
                title=title,
                subject=subject,
                level=level,
                status="draft",
            )
            session.add(proj)
        return {
            "id": proj.id,
            "project_type": proj.project_type,
            "title": proj.title,
            "status": proj.status,
        }


async def get_student_project(project_id: str) -> Optional[dict]:
    """Get a student project by ID."""
    Session = get_sessionmaker()
    async with Session() as session:
        proj = await session.scalar(select(StudentProject).where(StudentProject.id == project_id))
        if not proj:
            return None
        return {
            "id": proj.id,
            "user_email": proj.user_email,
            "project_type": proj.project_type,
            "title": proj.title,
            "subject": proj.subject,
            "level": proj.level,
            "status": proj.status,
            "outline": json.loads(proj.outline_json) if proj.outline_json else {},
            "sections": json.loads(proj.sections_json) if proj.sections_json else [],
            "content": proj.content,
            "metadata": json.loads(proj.metadata_json) if proj.metadata_json else {},
            "tokens_used": proj.tokens_used,
            "created_at": proj.created_at.isoformat() if proj.created_at else None,
            "updated_at": proj.updated_at.isoformat() if proj.updated_at else None,
        }


async def get_user_student_projects(user_email: str, limit: int = 50) -> list:
    """Get all student projects for a user, ordered by most recent."""
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.scalars(
                select(StudentProject)
                .where(StudentProject.user_email == user_email)
                .order_by(StudentProject.updated_at.desc())
                .limit(limit)
            )
        ).all()
        return [
            {
                "id": p.id,
                "project_type": p.project_type,
                "title": p.title,
                "subject": p.subject,
                "level": p.level,
                "status": p.status,
                "tokens_used": p.tokens_used,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
            for p in rows
        ]


async def update_student_project(
    project_id: str,
    **kwargs,
) -> bool:
    """Update a student project. Accepts any column as kwarg.
    Special handling for outline, sections, metadata (auto JSON serialize)."""
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            proj = await session.scalar(
                select(StudentProject).where(StudentProject.id == project_id)
            )
            if not proj:
                return False

            for key, value in kwargs.items():
                if key == "outline" and isinstance(value, (dict, list)):
                    proj.outline_json = json.dumps(value, ensure_ascii=False)
                elif key == "sections" and isinstance(value, (dict, list)):
                    proj.sections_json = json.dumps(value, ensure_ascii=False)
                elif key == "metadata" and isinstance(value, (dict, list)):
                    proj.metadata_json = json.dumps(value, ensure_ascii=False)
                elif hasattr(proj, key):
                    setattr(proj, key, value)

            proj.updated_at = _utcnow()
        return True


async def delete_student_project(project_id: str) -> bool:
    """Delete a student project."""
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(
                delete(StudentProject).where(StudentProject.id == project_id)
            )
            return (res.rowcount or 0) > 0
