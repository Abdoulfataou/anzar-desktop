"""
db/skills.py — CRUD for CommunitySkill and InstalledSkill.
"""

import uuid
import logging
from typing import Optional

from sqlalchemy import delete, func, select, update

from db.base import get_sessionmaker
from db.models import CommunitySkill, InstalledSkill

logger = logging.getLogger(__name__)


async def publish_skill(
    author_email: str,
    name: str,
    description: str,
    prompt: str,
    mode: str = "iterate",
    category: str = "custom",
    icon: str = "⭐",
) -> dict:
    """Publish a new community skill. Returns the created skill dict."""
    skill_id = uuid.uuid4().hex
    async_session = get_sessionmaker()
    async with async_session() as session:
        skill = CommunitySkill(
            id=skill_id,
            author_email=author_email,
            name=name,
            description=description,
            prompt=prompt,
            mode=mode,
            category=category,
            icon=icon,
        )
        session.add(skill)
        await session.commit()
        await session.refresh(skill)
        return _skill_to_dict(skill)


async def get_skill(skill_id: str) -> Optional[dict]:
    """Get a skill by ID."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        result = await session.execute(
            select(CommunitySkill).where(CommunitySkill.id == skill_id)
        )
        skill = result.scalar_one_or_none()
        return _skill_to_dict(skill) if skill else None


async def list_public_skills(
    category: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "downloads",  # downloads | rating | recent
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List public community skills with optional filtering."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        stmt = select(CommunitySkill).where(CommunitySkill.is_public == True)

        if category:
            stmt = stmt.where(CommunitySkill.category == category)
        if search:
            pattern = f"%{search}%"
            stmt = stmt.where(
                CommunitySkill.name.ilike(pattern)
                | CommunitySkill.description.ilike(pattern)
            )

        if sort_by == "rating":
            stmt = stmt.order_by(CommunitySkill.rating.desc())
        elif sort_by == "recent":
            stmt = stmt.order_by(CommunitySkill.created_at.desc())
        else:
            stmt = stmt.order_by(CommunitySkill.downloads.desc())

        stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        return [_skill_to_dict(s) for s in result.scalars().all()]


async def get_user_published_skills(email: str) -> list[dict]:
    """Get all skills published by a user."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        result = await session.execute(
            select(CommunitySkill)
            .where(CommunitySkill.author_email == email)
            .order_by(CommunitySkill.created_at.desc())
        )
        return [_skill_to_dict(s) for s in result.scalars().all()]


async def install_skill(email: str, skill_id: str) -> bool:
    """Install a community skill for a user. Returns True if newly installed."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        # Check not already installed
        existing = await session.execute(
            select(InstalledSkill).where(
                InstalledSkill.user_email == email,
                InstalledSkill.skill_id == skill_id,
            )
        )
        if existing.scalar_one_or_none():
            return False

        session.add(InstalledSkill(user_email=email, skill_id=skill_id))
        # Increment download count
        await session.execute(
            update(CommunitySkill)
            .where(CommunitySkill.id == skill_id)
            .values(downloads=CommunitySkill.downloads + 1)
        )
        await session.commit()
        return True


async def uninstall_skill(email: str, skill_id: str) -> bool:
    """Uninstall a community skill."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        result = await session.execute(
            delete(InstalledSkill).where(
                InstalledSkill.user_email == email,
                InstalledSkill.skill_id == skill_id,
            )
        )
        await session.commit()
        return result.rowcount > 0


async def get_installed_skills(email: str) -> list[dict]:
    """Get all skills installed by a user (with full skill data)."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        stmt = (
            select(CommunitySkill)
            .join(InstalledSkill, InstalledSkill.skill_id == CommunitySkill.id)
            .where(InstalledSkill.user_email == email)
            .order_by(InstalledSkill.installed_at.desc())
        )
        result = await session.execute(stmt)
        return [_skill_to_dict(s) for s in result.scalars().all()]


async def rate_skill(skill_id: str, rating: float) -> bool:
    """Add a rating to a skill (simple average)."""
    if not 0 <= rating <= 5:
        return False
    async_session = get_sessionmaker()
    async with async_session() as session:
        skill = await session.get(CommunitySkill, skill_id)
        if not skill:
            return False
        # Compute new average
        total = skill.rating * skill.rating_count + rating
        skill.rating_count += 1
        skill.rating = total / skill.rating_count
        await session.commit()
        return True


async def delete_skill(skill_id: str, author_email: str) -> bool:
    """Delete a skill (only by its author)."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        result = await session.execute(
            delete(CommunitySkill).where(
                CommunitySkill.id == skill_id,
                CommunitySkill.author_email == author_email,
            )
        )
        await session.commit()
        return result.rowcount > 0


def _skill_to_dict(skill: CommunitySkill) -> dict:
    return {
        "id": skill.id,
        "author_email": skill.author_email,
        "name": skill.name,
        "description": skill.description,
        "prompt": skill.prompt,
        "mode": skill.mode,
        "category": skill.category,
        "icon": skill.icon,
        "downloads": skill.downloads,
        "rating": round(skill.rating, 1),
        "rating_count": skill.rating_count,
        "is_public": skill.is_public,
        "created_at": skill.created_at.isoformat() if skill.created_at else None,
    }
