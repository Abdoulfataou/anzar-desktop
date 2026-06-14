"""
SKILLS HUB routes — /api/skills/*
Community skills: publish, browse, install, rate.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional

from security import get_current_user
from database import (
    publish_skill, get_skill, list_public_skills,
    get_user_published_skills, install_skill, uninstall_skill,
    get_installed_skills, rate_skill, delete_skill,
)

router = APIRouter(prefix="/api/skills", tags=["skills"])


# ── Models ──

class PublishSkillRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    description: str = Field(default="", max_length=1000)
    prompt: str = Field(..., min_length=10, max_length=5000)
    mode: str = Field(default="iterate", pattern="^(iterate|refactor|patch|debug|test|review)$")
    category: str = Field(default="custom", pattern="^(ui|perf|quality|feature|fix|test|custom)$")
    icon: str = Field(default="⭐", max_length=10)


class RateSkillRequest(BaseModel):
    rating: float = Field(..., ge=0, le=5)


# ── Routes ──

@router.get("/hub")
async def browse_hub(
    category: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = "downloads",
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    """Browse the community skills hub."""
    skills = await list_public_skills(
        category=category,
        search=search,
        sort_by=sort,
        limit=min(limit, 100),
        offset=offset,
    )
    return {"skills": skills, "count": len(skills)}


@router.get("/installed")
async def my_installed_skills(user: dict = Depends(get_current_user)):
    """Get all skills I've installed."""
    email = user["sub"]
    skills = await get_installed_skills(email)
    return {"skills": skills, "count": len(skills)}


@router.get("/published")
async def my_published_skills(user: dict = Depends(get_current_user)):
    """Get all skills I've published."""
    email = user["sub"]
    skills = await get_user_published_skills(email)
    return {"skills": skills, "count": len(skills)}


@router.post("/publish")
async def publish_new_skill(
    body: PublishSkillRequest,
    user: dict = Depends(get_current_user),
):
    """Publish a new community skill."""
    email = user["sub"]
    skill = await publish_skill(
        author_email=email,
        name=body.name,
        description=body.description,
        prompt=body.prompt,
        mode=body.mode,
        category=body.category,
        icon=body.icon,
    )
    return {"status": "ok", "skill": skill}


@router.post("/{skill_id}/install")
async def install_community_skill(skill_id: str, user: dict = Depends(get_current_user)):
    """Install a community skill."""
    # Verify skill exists
    skill = await get_skill(skill_id)
    if not skill:
        raise HTTPException(404, "Skill non trouvé")
    email = user["sub"]
    newly_installed = await install_skill(email, skill_id)
    return {"status": "ok", "newly_installed": newly_installed}


@router.delete("/{skill_id}/uninstall")
async def uninstall_community_skill(skill_id: str, user: dict = Depends(get_current_user)):
    """Uninstall a community skill."""
    email = user["sub"]
    removed = await uninstall_skill(email, skill_id)
    if not removed:
        raise HTTPException(404, "Skill non installé")
    return {"status": "ok"}


@router.post("/{skill_id}/rate")
async def rate_community_skill(
    skill_id: str,
    body: RateSkillRequest,
    user: dict = Depends(get_current_user),
):
    """Rate a community skill (0-5)."""
    success = await rate_skill(skill_id, body.rating)
    if not success:
        raise HTTPException(404, "Skill non trouvé")
    return {"status": "ok"}


@router.delete("/{skill_id}")
async def delete_my_skill(skill_id: str, user: dict = Depends(get_current_user)):
    """Delete a skill I published."""
    email = user["sub"]
    deleted = await delete_skill(skill_id, email)
    if not deleted:
        raise HTTPException(404, "Skill non trouvé ou non autorisé")
    return {"status": "ok"}
