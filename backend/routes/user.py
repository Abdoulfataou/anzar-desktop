"""
USER PROFILE routes — /api/user/*
Profile get/patch, change-password, delete account.
"""
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field

from security import get_current_user
from database import (
    get_user_by_email, verify_password,
    update_user_profile, change_user_password, deactivate_user,
    get_credits,
)

router = APIRouter(prefix="/api/user", tags=["user"])


# ── Models ──

class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=128)


# ── Routes ──

@router.get("/profile")
async def get_profile(user: dict = Depends(get_current_user)):
    """Get current user's profile with credit balance."""
    email = user["sub"]
    db_user = await get_user_by_email(email)
    if not db_user:
        raise HTTPException(404, "Utilisateur non trouvé")

    creds = await get_credits(email)

    return {
        "email": email,
        "name": db_user.get("name", email.split("@")[0]),
        "created_at": db_user.get("created_at"),
        "credits": {
            "balance_fcfa": creds.get("balance_fcfa", 0),
            "total_recharged": creds.get("total_recharged", 0),
            "total_used": creds.get("total_used", 0),
        },
    }


@router.patch("/profile")
async def patch_profile(request: Request, user: dict = Depends(get_current_user)):
    """Update user profile (name)."""
    email = user["sub"]
    body = await request.json()
    name = body.get("name", "").strip()
    if not name or len(name) > 100:
        raise HTTPException(400, "Nom invalide (1-100 caractères)")

    await update_user_profile(email, name)
    return {"status": "ok", "name": name}


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    """Change user password. Requires current password."""
    email = user["sub"]
    db_user = await get_user_by_email(email)
    if not db_user:
        raise HTTPException(404, "Utilisateur non trouvé")

    if not verify_password(body.current_password, db_user["password_hash"], db_user["salt"]):
        raise HTTPException(401, "Mot de passe actuel incorrect")

    await change_user_password(email, body.new_password)
    return {"status": "ok", "message": "Mot de passe modifié"}


@router.delete("/account")
async def delete_account(user: dict = Depends(get_current_user)):
    """Soft-delete user account."""
    email = user["sub"]
    await deactivate_user(email)
    return {"status": "ok", "message": "Compte désactivé"}
