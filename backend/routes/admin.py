"""
ADMIN routes — /api/admin/*
Login, me, users CRUD, credits, projects, transactions, usage, payments, admins.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from config import settings
from security import (
    rate_limiter, get_client_ip,
    create_token, verify_token,
)
from database import (
    verify_password,
    get_project,
    get_admin_by_email, get_admin_by_id,
    update_admin_profile, change_admin_password, update_admin_last_login,
    list_admins,
    admin_list_all_users, admin_get_user_detail, admin_update_user,
    admin_add_credits_to_user, admin_list_all_projects,
    admin_get_global_stats, admin_get_all_transactions, admin_get_all_usage,
    admin_delete_project_any,
    admin_list_payment_intents, admin_mark_payment_intent_paid,
)
from routes._state import _project_states

logger = logging.getLogger("anzar")

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ── Models ──

class AdminLoginRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)


class AdminUpdateProfileRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[str] = Field(None, min_length=5, max_length=255)


class AdminChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class AdminUserPatchRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None


class AdminAddCreditsRequest(BaseModel):
    amount: float = Field(..., gt=0, le=10_000_000)
    tx_type: str = Field(default="bonus", max_length=20)
    description: str = Field(..., min_length=3, max_length=500)
    external_ref: str = Field(default="", max_length=255)


class AdminMarkPaymentPaidRequest(BaseModel):
    provider_ref: str = Field(default="", max_length=255)
    description: str = Field(..., min_length=3, max_length=500)


# ── Dependencies ──

async def get_current_admin(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(
        HTTPBearer(auto_error=False)
    ),
) -> dict:
    """FastAPI dependency: verify admin JWT. Returns admin payload with 'admin_id'."""
    if not credentials:
        raise HTTPException(401, "Token admin requis")
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(401, "Token admin invalide ou expiré")
    if not payload.get("is_admin"):
        raise HTTPException(403, "Accès admin requis")
    admin_data = await get_admin_by_id(payload.get("admin_id"))
    if not admin_data:
        raise HTTPException(401, "Compte admin introuvable ou désactivé")

    must_change = bool(admin_data.get("must_change_password"))
    payload["must_change_password"] = must_change

    if must_change:
        allowed = {"/api/admin/me", "/api/admin/change-password"}
        if request.url.path not in allowed:
            raise HTTPException(403, "Mot de passe admin à modifier avant de continuer.")

    return payload


def require_admin_role(*allowed_roles: str):
    """Factory for role-based admin guards."""
    async def checker(admin: dict = Depends(get_current_admin)):
        if admin.get("role") not in allowed_roles:
            raise HTTPException(403, f"Rôle requis: {', '.join(allowed_roles)}")
        return admin
    return checker


# ── Audit Logger ──

_audit_logger = logging.getLogger("anzar.audit")


def audit_log(admin_email: str, action: str, target: str = "", details: str = ""):
    _audit_logger.info(
        f"ADMIN_AUDIT | admin={admin_email} | action={action} | target={target} | {details}"
    )


# ── Auth ──

@router.post("/login")
async def admin_login(body: AdminLoginRequest, request: Request):
    """Login as admin. Returns JWT with is_admin=True."""
    rate_limiter.check_auth(get_client_ip(request))
    email = body.email.strip().lower()
    admin = await get_admin_by_email(email)
    if not admin:
        raise HTTPException(401, "Identifiants admin incorrects")

    if not verify_password(body.password, admin["password_hash"], admin["salt"]):
        audit_log(email, "login_failed", email, "wrong password")
        raise HTTPException(401, "Identifiants admin incorrects")

    await update_admin_last_login(email)
    audit_log(email, "login_success", email)

    admin_token = create_token(
        user_id=email,
        expires_in=settings.admin_jwt_expiry_hours * 3600,
        extra_claims={
            "is_admin": True,
            "admin_id": admin["id"],
            "role": admin["role"],
            "must_change_password": bool(admin.get("must_change_password")),
        },
    )

    return {
        "token": admin_token,
        "user": {
            "email": email,
            "name": admin.get("name", "Admin"),
            "role": admin["role"],
            "admin_id": admin["id"],
            "must_change_password": bool(admin.get("must_change_password")),
        },
    }


@router.get("/me")
async def admin_me(admin: dict = Depends(get_current_admin)):
    """Get current admin profile."""
    admin_data = await get_admin_by_id(admin["admin_id"])
    if not admin_data:
        raise HTTPException(404, "Admin introuvable")
    return {
        "id": admin_data["id"],
        "email": admin_data["email"],
        "name": admin_data["name"],
        "role": admin_data["role"],
        "created_at": admin_data["created_at"],
        "last_login": admin_data["last_login"],
        "must_change_password": bool(admin_data.get("must_change_password")),
    }


@router.patch("/me")
async def admin_update_me(body: AdminUpdateProfileRequest, admin: dict = Depends(get_current_admin)):
    """Update current admin profile (name, email)."""
    updates = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.email is not None:
        updates["email"] = body.email.strip().lower()
    if updates:
        await update_admin_profile(admin["admin_id"], **updates)
        audit_log(admin["sub"], "update_profile", str(admin["admin_id"]), str(updates))
    admin_data = await get_admin_by_id(admin["admin_id"])
    return {
        "id": admin_data["id"],
        "email": admin_data["email"],
        "name": admin_data["name"],
        "role": admin_data["role"],
    }


@router.post("/change-password")
async def admin_change_pwd(body: AdminChangePasswordRequest, admin: dict = Depends(get_current_admin)):
    """Change admin password."""
    admin_data = await get_admin_by_id(admin["admin_id"])
    if not admin_data:
        raise HTTPException(404, "Admin introuvable")
    if not verify_password(body.current_password, admin_data["password_hash"], admin_data["salt"]):
        raise HTTPException(401, "Mot de passe actuel incorrect")
    await change_admin_password(admin["admin_id"], body.new_password)
    audit_log(admin["sub"], "change_password", str(admin["admin_id"]))
    return {"status": "ok", "message": "Mot de passe modifié"}


# ── Dashboard stats ──

@router.get("/stats")
async def admin_stats(admin: dict = Depends(get_current_admin)):
    """Get global platform statistics for admin dashboard."""
    return await admin_get_global_stats()


# ── Users management ──

@router.get("/users")
async def admin_users_list(
    search: str = "",
    status: str = "all",
    limit: int = 50,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """List all users with credits and project count."""
    return await admin_list_all_users(search=search, status=status, limit=min(limit, 200), offset=offset)


@router.get("/users/{user_email}")
async def admin_user_detail(user_email: str, admin: dict = Depends(get_current_admin)):
    """Get full user detail."""
    user = await admin_get_user_detail(user_email)
    if not user:
        raise HTTPException(404, "Utilisateur non trouvé")
    user.pop("password_hash", None)
    user.pop("salt", None)
    return user


@router.patch("/users/{user_email}")
async def admin_user_update(
    user_email: str,
    body: AdminUserPatchRequest,
    admin: dict = Depends(require_admin_role("owner", "admin")),
):
    """Update user (name, active status). Owner/admin only."""
    updates = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if not updates:
        raise HTTPException(400, "Rien à modifier")
    await admin_update_user(user_email, **updates)
    audit_log(admin["sub"], "update_user", user_email, str(updates))
    return {"status": "ok"}


@router.post("/users/{user_email}/credits")
async def admin_grant_credits(
    user_email: str,
    body: AdminAddCreditsRequest,
    admin: dict = Depends(require_admin_role("owner", "admin")),
):
    """Grant credits to a user. Owner/admin only."""
    tx_type = (body.tx_type or "bonus").strip().lower()
    if tx_type not in ("bonus", "refund", "recharge"):
        raise HTTPException(400, "tx_type invalide (bonus|refund|recharge)")

    result = await admin_add_credits_to_user(
        user_email,
        body.amount,
        body.description.strip(),
        tx_type=tx_type,
        external_ref=body.external_ref.strip(),
    )
    audit_log(
        admin["sub"],
        "grant_credits",
        user_email,
        f"amount={body.amount} type={tx_type} ref={body.external_ref} desc={body.description}",
    )
    return {"status": "ok", "credits": result}


# ── Projects management ──

@router.get("/projects")
async def admin_projects_list(
    search: str = "",
    status: str = "all",
    limit: int = 50,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """List all projects from all users."""
    return await admin_list_all_projects(search=search, status=status, limit=min(limit, 200), offset=offset)


@router.get("/projects/{project_id}")
async def admin_project_detail(project_id: str, admin: dict = Depends(get_current_admin)):
    """Get project detail (any user)."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(404, "Projet non trouvé")
    return project


@router.delete("/projects/{project_id}")
async def admin_delete_project(
    project_id: str,
    admin: dict = Depends(require_admin_role("owner", "admin")),
):
    """Delete any project. Owner/admin only."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(404, "Projet non trouvé")
    deleted = await admin_delete_project_any(project_id)
    if not deleted:
        raise HTTPException(500, "Suppression impossible")
    _project_states.pop(project_id, None)
    audit_log(admin["sub"], "delete_project", project_id)
    return {"status": "deleted"}


# ── Transactions & Usage ──

@router.get("/transactions")
async def admin_transactions(
    limit: int = 100,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """Get all platform transactions."""
    return {"transactions": await admin_get_all_transactions(limit=min(limit, 500), offset=offset)}


@router.get("/usage")
async def admin_usage(
    limit: int = 100,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """Get all platform usage records."""
    return {"usage": await admin_get_all_usage(limit=min(limit, 500), offset=offset)}


# ── Payments ──

@router.get("/payments")
async def admin_payments_list(
    status: str = "pending",
    limit: int = 50,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """Lister les demandes de paiement (payment_intents)."""
    return await admin_list_payment_intents(status=status, limit=min(limit, 200), offset=offset)


@router.post("/payments/{intent_id}/mark-paid")
async def admin_payment_mark_paid(
    intent_id: str,
    body: AdminMarkPaymentPaidRequest,
    admin: dict = Depends(require_admin_role("owner", "admin")),
):
    """Valider manuellement un paiement + crediter le compte."""
    try:
        intent = await admin_mark_payment_intent_paid(
            intent_id=intent_id,
            admin_email=admin["sub"],
            provider_ref=body.provider_ref,
            description=body.description,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    audit_log(admin["sub"], "mark_payment_paid", intent_id, f"ref={body.provider_ref} desc={body.description}")
    return {"status": "ok", "payment_intent": intent}


# ── Admin accounts ──

@router.get("/admins")
async def admin_list_all(admin: dict = Depends(require_admin_role("owner"))):
    """List all admin accounts. Owner only."""
    return {"admins": await list_admins()}
