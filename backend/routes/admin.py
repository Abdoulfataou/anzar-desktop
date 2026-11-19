"""
ADMIN routes — /api/admin/*

Rôles :
  owner    : tout, y compris les comptes admin
  admin    : gestion des utilisateurs, crédits, paiements
  support  : lecture + désactivation / réactivation de comptes
  readonly : lecture seule

Chaque action qui modifie quelque chose est inscrite au journal d'audit (table admin_audit).
"""
import ipaddress
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from config import settings
from security import (
    rate_limiter, get_client_ip, create_token, verify_token_checked,
    generate_totp_secret, verify_totp, seal_totp_secret, open_totp_secret, totp_uri,
)
from db import (
    verify_password,
    get_project,
    get_admin_by_email, get_admin_by_id,
    update_admin_profile, change_admin_password, update_admin_last_login,
    list_admins,
    admin_list_all_users, admin_get_user_detail, admin_update_user,
    admin_add_credits_to_user, admin_list_all_projects,
    admin_get_global_stats,
    admin_delete_project_any,
    admin_mark_payment_intent_paid,
    deduct_credits,
    set_admin_totp_secret, enable_admin_totp, disable_admin_totp,
    revoke_token_jti,
)
from db import admin_extra as extra
from routes._state import _project_states

logger = logging.getLogger("anzar")

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ── Models ──

class AdminLoginRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)
    totp_code: str = Field(default="", max_length=6)


class MfaCodeRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6)


class MfaDisableRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)
    code: str = Field(..., min_length=6, max_length=6)


class AdminUpdateProfileRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[str] = Field(None, min_length=5, max_length=255)


class AdminChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=12, max_length=128)


class AdminUserPatchRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None


class AdminAddCreditsRequest(BaseModel):
    amount: float = Field(..., gt=0, le=10_000_000)
    tx_type: str = Field(default="bonus", max_length=20)
    description: str = Field(..., min_length=3, max_length=500)
    external_ref: str = Field(default="", max_length=255)


class AdminDebitRequest(BaseModel):
    amount: float = Field(..., gt=0, le=10_000_000)
    description: str = Field(..., min_length=3, max_length=500)


class AdminMarkPaymentPaidRequest(BaseModel):
    provider_ref: str = Field(default="", max_length=255)
    description: str = Field(..., min_length=3, max_length=500)


class AdminCancelPaymentRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class AdminCreateRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    name: str = Field(default="", max_length=100)
    role: str = Field(default="support", max_length=20)


class AdminPatchRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    role: Optional[str] = Field(None, max_length=20)
    is_active: Optional[bool] = None


# ── Auth admin ──

def _admin_ip_allowed(request: Request) -> None:
    """Restriction réseau optionnelle de /api/admin (Caddy + défense en profondeur)."""
    allowed = (settings.admin_allowed_ips or "").strip()
    if not allowed:
        return
    ip = get_client_ip(request)
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        raise HTTPException(403, "Accès admin refusé")
    for part in allowed.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            if addr in ipaddress.ip_network(part, strict=False):
                return
        except ValueError:
            continue
    raise HTTPException(403, "Accès admin refusé depuis ce réseau")


async def get_current_admin(
    request: Request,

    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
) -> dict:
    """Vérifie le jeton admin et l'état ACTUEL du compte (rôle, actif) en base."""
    _admin_ip_allowed(request)
    if not credentials:
        raise HTTPException(401, "Token admin requis")
    payload = await verify_token_checked(credentials.credentials)
    if not payload:
        raise HTTPException(401, "Token admin invalide ou expiré")
    if not payload.get("is_admin"):
        raise HTTPException(403, "Accès admin requis")
    admin_data = await get_admin_by_id(payload.get("admin_id"))
    if not admin_data:
        raise HTTPException(401, "Compte admin introuvable ou désactivé")
    if int(payload.get("token_version") or 0) != int(admin_data.get("token_version") or 0):
        raise HTTPException(401, "Session admin révoquée. Reconnecte-toi.")

    # Le rôle vient de la base, pas du jeton : un rôle retiré prend effet immédiatement.
    payload["role"] = admin_data.get("role")
    payload["sub"] = admin_data.get("email")
    must_change = bool(admin_data.get("must_change_password"))
    payload["must_change_password"] = must_change
    if must_change and request.url.path not in {"/api/admin/me", "/api/admin/change-password"}:
        raise HTTPException(403, "Mot de passe admin à modifier avant de continuer.")
    if (settings.admin_require_mfa and not admin_data.get("totp_enabled")
            and request.url.path not in {"/api/admin/me", "/api/admin/change-password"}):
        # Ne pas laisser un simple mot de passe enrôler lui-même une MFA alors
        # que la MFA est obligatoire : les comptes doivent être enrôlés avant
        # l'activation du drapeau (ou par une procédure owner dédiée).
        raise HTTPException(403, "MFA obligatoire : fais enrôler ce compte avant d'activer ADMIN_REQUIRE_MFA.")
    payload["_ip"] = get_client_ip(request)
    return payload


def require_admin_role(*allowed_roles: str):
    async def checker(admin: dict = Depends(get_current_admin)):
        if admin.get("role") not in allowed_roles:
            raise HTTPException(403, f"Rôle requis : {', '.join(allowed_roles)}")
        return admin
    return checker


_audit_logger = logging.getLogger("anzar.audit")


async def audit(admin: dict | str, action: str, target: str = "", details: str = "", ip: str = "") -> None:
    email = admin if isinstance(admin, str) else admin.get("sub", "")
    if not isinstance(admin, str):
        ip = ip or admin.get("_ip", "")
    _audit_logger.info(f"ADMIN_AUDIT | admin={email} | action={action} | target={target} | {details}")
    try:
        await extra.record_audit(email, action, target, details, ip)
    except Exception as e:  # le journal ne doit jamais bloquer l'action elle-même
        logger.error("AUDIT_WRITE_FAILED action=%s error=%s", action, e)


def _clamp(limit: int, maximum: int = 200) -> int:
    return max(1, min(int(limit or 50), maximum))


# ── Connexion et profil ──

@router.post("/login")
async def admin_login(body: AdminLoginRequest, request: Request):
    _admin_ip_allowed(request)
    ip = get_client_ip(request)
    await rate_limiter.check_auth(ip)
    email = body.email.strip().lower()
    admin = await get_admin_by_email(email)
    if not admin or not verify_password(body.password, admin["password_hash"], admin["salt"]):
        await audit(email, "login_failed", email, "identifiants incorrects", ip)
        raise HTTPException(401, "Identifiants admin incorrects")

    if admin.get("totp_enabled"):
        secret = open_totp_secret(admin.get("totp_secret") or "")
        if not verify_totp(secret, body.totp_code):
            await audit(email, "login_mfa_failed", email, "code TOTP absent ou invalide", ip)
            raise HTTPException(401, "Code de double authentification requis ou invalide")

    await update_admin_last_login(email)
    await audit(email, "login_success", email, "", ip)
    token = create_token(
        user_id=email,
        expires_in=settings.admin_jwt_expiry_hours * 3600,
        token_version=admin.get("token_version", 0),
        extra_claims={"is_admin": True, "admin_id": admin["id"], "role": admin["role"],
                      "must_change_password": bool(admin.get("must_change_password"))},
    )
    return {
        "token": token,
        "user": {"email": email, "name": admin.get("name", "Admin"), "role": admin["role"],
                 "admin_id": admin["id"], "must_change_password": bool(admin.get("must_change_password")),
                 "mfa_enabled": bool(admin.get("totp_enabled"))},
    }


@router.post("/logout")
async def admin_logout(admin: dict = Depends(get_current_admin)):
    """Révoque le jeton admin courant côté serveur."""
    await revoke_token_jti(admin.get("jti", ""), float(admin.get("exp") or time.time()))
    return {"status": "ok"}


def _profile(a: dict) -> dict:
    return {"id": a["id"], "email": a["email"], "name": a["name"], "role": a["role"],
            "created_at": a.get("created_at"), "last_login": a.get("last_login"),
            "must_change_password": bool(a.get("must_change_password")),
            "mfa_enabled": bool(a.get("totp_enabled"))}


@router.get("/me")
async def admin_me(admin: dict = Depends(get_current_admin)):
    data = await get_admin_by_id(admin["admin_id"])
    if not data:
        raise HTTPException(404, "Admin introuvable")
    return _profile(data)


@router.patch("/me")
async def admin_update_me(body: AdminUpdateProfileRequest, admin: dict = Depends(get_current_admin)):
    if body.name is not None:
        await update_admin_profile(admin["admin_id"], name=body.name.strip())
    if body.email is not None and body.email.strip().lower() != admin["sub"]:
        try:
            await extra.change_admin_email(admin["admin_id"], body.email)
        except ValueError as e:
            raise HTTPException(400, str(e))
    await audit(admin, "update_profile", str(admin["admin_id"]),
                f"name={body.name!r} email={body.email!r}")
    return _profile(await get_admin_by_id(admin["admin_id"]))


@router.post("/change-password")
async def admin_change_pwd(body: AdminChangePasswordRequest, admin: dict = Depends(get_current_admin)):
    data = await get_admin_by_id(admin["admin_id"])
    if not data:
        raise HTTPException(404, "Admin introuvable")
    if not verify_password(body.current_password, data["password_hash"], data["salt"]):
        raise HTTPException(401, "Mot de passe actuel incorrect")
    if body.current_password == body.new_password:
        raise HTTPException(400, "Le nouveau mot de passe doit être différent de l'actuel")
    await change_admin_password(admin["admin_id"], body.new_password)
    await audit(admin, "change_password", str(admin["admin_id"]))
    return {"status": "ok", "message": "Mot de passe modifié"}


# ── Double authentification (TOTP) ──

@router.post("/mfa/setup")
async def admin_mfa_setup(admin: dict = Depends(get_current_admin)):
    data = await get_admin_by_id(admin["admin_id"])
    if not data:
        raise HTTPException(404, "Admin introuvable")
    if data.get("totp_enabled"):
        raise HTTPException(400, "La double authentification est déjà active")
    secret = generate_totp_secret()
    await set_admin_totp_secret(admin["admin_id"], seal_totp_secret(secret))
    await audit(admin, "mfa_setup", str(admin["admin_id"]), "secret généré, en attente de code")
    return {"secret": secret, "otpauth_uri": totp_uri(data["email"], secret)}


@router.post("/mfa/enable")
async def admin_mfa_enable(body: MfaCodeRequest, admin: dict = Depends(get_current_admin)):
    data = await get_admin_by_id(admin["admin_id"])
    if not data:
        raise HTTPException(404, "Admin introuvable")
    secret = open_totp_secret(data.get("totp_secret") or "")
    if not secret:
        raise HTTPException(400, "Génère d'abord un secret MFA")
    if not verify_totp(secret, body.code):
        raise HTTPException(400, "Code MFA invalide")
    await enable_admin_totp(admin["admin_id"])
    await audit(admin, "mfa_enabled", str(admin["admin_id"]), "TOTP activé")
    return {"status": "ok", "mfa_enabled": True}


@router.post("/mfa/disable")
async def admin_mfa_disable(body: MfaDisableRequest, admin: dict = Depends(get_current_admin)):
    data = await get_admin_by_id(admin["admin_id"])
    if not data:
        raise HTTPException(404, "Admin introuvable")
    if not data.get("totp_enabled"):
        raise HTTPException(400, "La double authentification n'est pas active")
    if not verify_password(body.password, data["password_hash"], data["salt"]):
        raise HTTPException(401, "Mot de passe incorrect")
    secret = open_totp_secret(data.get("totp_secret") or "")
    if not verify_totp(secret, body.code):
        raise HTTPException(400, "Code MFA invalide")
    await disable_admin_totp(admin["admin_id"])
    await audit(admin, "mfa_disabled", str(admin["admin_id"]), "TOTP désactivé")
    return {"status": "ok", "mfa_enabled": False}


# ── Tableau de bord ──

@router.get("/stats")
async def admin_stats(admin: dict = Depends(get_current_admin)):
    stats = await admin_get_global_stats()
    stats.update(await extra.extra_stats())
    return stats


@router.get("/stats/daily")
async def admin_stats_daily(days: int = 30, admin: dict = Depends(get_current_admin)):
    return {"days": await extra.daily_series(days)}


@router.get("/stats/breakdown")
async def admin_stats_breakdown(days: int = 30, admin: dict = Depends(get_current_admin)):
    return await extra.usage_breakdown(days)


# ── Utilisateurs ──

@router.get("/users")
async def admin_users_list(search: str = "", status: str = "all", limit: int = 50, offset: int = 0,
                           admin: dict = Depends(get_current_admin)):
    return await admin_list_all_users(search=search, status=status, limit=_clamp(limit), offset=max(0, offset))


@router.get("/users/{user_email}")
async def admin_user_detail(user_email: str, admin: dict = Depends(get_current_admin)):
    user = await admin_get_user_detail(user_email)
    if not user:
        raise HTTPException(404, "Utilisateur non trouvé")
    user.pop("password_hash", None)
    user.pop("salt", None)
    return user


@router.patch("/users/{user_email}")
async def admin_user_update(user_email: str, body: AdminUserPatchRequest,
                            admin: dict = Depends(require_admin_role("owner", "admin", "support"))):
    """Renommer (owner/admin) ou désactiver / réactiver (owner/admin/support) un compte."""
    if body.name is not None and admin.get("role") == "support":
        raise HTTPException(403, "Le rôle support ne peut que désactiver ou réactiver un compte")
    updates = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if not updates:
        raise HTTPException(400, "Rien à modifier")
    if not await admin_update_user(user_email, **updates):
        raise HTTPException(404, "Utilisateur non trouvé")
    action = "update_user"
    if body.is_active is False:
        action = "disable_user"
    elif body.is_active is True:
        action = "enable_user"
    await audit(admin, action, user_email.strip().lower(), str(updates))
    return {"status": "ok"}


async def _require_user(email: str) -> None:
    if not await admin_get_user_detail(email):
        raise HTTPException(404, "Utilisateur non trouvé")


@router.post("/users/{user_email}/credits")
async def admin_grant_credits(user_email: str, body: AdminAddCreditsRequest,
                              admin: dict = Depends(require_admin_role("owner", "admin"))):
    tx_type = (body.tx_type or "bonus").strip().lower()
    if tx_type not in ("bonus", "refund", "recharge"):
        raise HTTPException(400, "tx_type invalide (bonus|refund|recharge)")
    await _require_user(user_email)
    result = await admin_add_credits_to_user(user_email, body.amount, body.description.strip(),
                                             tx_type=tx_type, external_ref=body.external_ref.strip())
    await audit(admin, "grant_credits", user_email.strip().lower(),
                f"amount={body.amount} type={tx_type} ref={body.external_ref} desc={body.description}")
    return {"status": "ok", "credits": result}


@router.post("/users/{user_email}/debit")
async def admin_debit_credits(user_email: str, body: AdminDebitRequest,
                              admin: dict = Depends(require_admin_role("owner", "admin"))):
    """Retirer du crédit (correction d'une erreur). Le solde peut devenir négatif."""
    await _require_user(user_email)
    result = await deduct_credits(user_email, body.amount, f"Correction admin : {body.description.strip()}",
                                  "admin", "", allow_negative=True)
    await audit(admin, "debit_credits", user_email.strip().lower(),
                f"amount={body.amount} desc={body.description}")
    return {"status": "ok", "credits": result}


# ── Grand livre, consommation ──

@router.get("/transactions")
async def admin_transactions(limit: int = 100, offset: int = 0, email: str = "", type: str = "",
                             admin: dict = Depends(get_current_admin)):
    return await extra.list_transactions(_clamp(limit, 500), max(0, offset), email=email, tx_type=type)


@router.get("/usage")
async def admin_usage(limit: int = 100, offset: int = 0, email: str = "", model: str = "", task_type: str = "",
                      admin: dict = Depends(get_current_admin)):
    return await extra.list_usage(_clamp(limit, 500), max(0, offset), email=email, model=model, task_type=task_type)


# ── Paiements ──

@router.get("/payments")
async def admin_payments_list(status: str = "pending", email: str = "", limit: int = 50, offset: int = 0,
                              admin: dict = Depends(get_current_admin)):
    return await extra.list_payments(status=status, email=email, limit=_clamp(limit), offset=max(0, offset))


@router.post("/payments/{intent_id}/mark-paid")
async def admin_payment_mark_paid(intent_id: str, body: AdminMarkPaymentPaidRequest,
                                  admin: dict = Depends(require_admin_role("owner", "admin"))):
    try:
        intent = await admin_mark_payment_intent_paid(intent_id=intent_id, admin_email=admin["sub"],
                                                      provider_ref=body.provider_ref, description=body.description)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await audit(admin, "mark_payment_paid", intent_id, f"ref={body.provider_ref} desc={body.description}")
    return {"status": "ok", "payment_intent": intent}


@router.post("/payments/{intent_id}/cancel")
async def admin_payment_cancel(intent_id: str, body: AdminCancelPaymentRequest,
                               admin: dict = Depends(require_admin_role("owner", "admin"))):
    try:
        intent = await extra.cancel_payment_intent(intent_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await audit(admin, "cancel_payment", intent_id, f"reason={body.reason}")
    return {"status": "ok", "payment_intent": intent}


@router.post("/payments/{intent_id}/refresh")
async def admin_payment_refresh(intent_id: str, admin: dict = Depends(require_admin_role("owner", "admin"))):
    """Relit le statut chez le fournisseur (paiement automatique) et crédite s'il est payé."""
    from services.payments import refresh_intent
    from db.base import _model_to_dict
    intent = await refresh_intent(intent_id)
    if not intent:
        raise HTTPException(404, "Demande introuvable")
    if not intent.provider:
        raise HTTPException(400, "Demande manuelle : rien à vérifier chez un fournisseur")
    await audit(admin, "refresh_payment", intent_id, f"status={intent.status}")
    return {"status": "ok", "payment_intent": _model_to_dict(intent)}


# ── Journal d'audit ──

@router.get("/audit")
async def admin_audit_list(limit: int = 100, offset: int = 0, admin_email: str = "", action: str = "",
                           target: str = "", admin: dict = Depends(require_admin_role("owner", "admin"))):
    return await extra.list_audit(_clamp(limit, 500), max(0, offset), admin_email=admin_email,
                                  action=action, target=target)


# ── Comptes admin (owner) ──

@router.get("/admins")
async def admin_list_all(admin: dict = Depends(require_admin_role("owner"))):
    return {"admins": await list_admins()}


@router.post("/admins")
async def admin_create(body: AdminCreateRequest, admin: dict = Depends(require_admin_role("owner"))):
    temp = extra.generate_temp_password()
    try:
        created = await extra.create_admin(body.email, body.name, body.role, temp)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await audit(admin, "create_admin", created["email"], f"role={body.role}")
    # Mot de passe provisoire affiché une seule fois : à changer à la première connexion
    return {"status": "ok", "admin": created, "temporary_password": temp}


@router.patch("/admins/{admin_id}")
async def admin_update(admin_id: int, body: AdminPatchRequest, admin: dict = Depends(require_admin_role("owner"))):
    if admin_id == admin["admin_id"] and (body.is_active is False or (body.role and body.role != "owner")):
        raise HTTPException(400, "Tu ne peux pas te retirer toi-même le rôle owner ni désactiver ton propre compte")
    try:
        updated = await extra.update_admin(admin_id, name=body.name, role=body.role, is_active=body.is_active)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    await audit(admin, "update_admin", updated["email"], body.model_dump_json(exclude_none=True))
    return {"status": "ok", "admin": updated}


@router.post("/admins/{admin_id}/reset-password")
async def admin_reset_password(admin_id: int, admin: dict = Depends(require_admin_role("owner"))):
    if admin_id == admin["admin_id"]:
        raise HTTPException(400, "Utilise « Changer mon mot de passe » pour ton propre compte")
    try:
        temp = await extra.reset_admin_password(admin_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    await audit(admin, "reset_admin_password", str(admin_id))
    return {"status": "ok", "temporary_password": temp}


# ── Paramètres de la plateforme (lecture seule, aucun secret) ──

@router.get("/settings")
async def admin_platform_settings(admin: dict = Depends(get_current_admin)):
    from routes.web_tools import web_tool_cost_fcfa
    s = settings
    return {
        "version": s.app_version,
        "models": {"default": s.deepseek_model, "pro": s.deepseek_pro_model},
        "pricing_usd_per_million": {
            "flash": {"cache_hit": s.deepseek_flash_hit_usd, "cache_miss": s.deepseek_flash_miss_usd,
                      "output": s.deepseek_flash_output_usd},
            "pro": {"cache_hit": s.deepseek_pro_hit_usd, "cache_miss": s.deepseek_pro_miss_usd,
                    "output": s.deepseek_pro_output_usd},
        },
        "margin": s.deepseek_margin,
        "usd_to_fcfa": s.usd_to_fcfa,
        "offpeak_factor": s.deepseek_offpeak_factor,
        "peak_windows_utc": s.deepseek_peak_windows_utc,
        "web_tool_cost_fcfa": web_tool_cost_fcfa(),
        "recharge_bonus_tiers": s.recharge_bonus_tiers,
        "welcome_bonus_fcfa": s.welcome_bonus_fcfa,
        "max_concurrent_ai_per_user": s.max_concurrent_ai_per_user,
        "rate_limit": {"per_minute": s.rate_limit_per_minute, "per_day": s.rate_limit_per_day},
        "jwt_expiry_hours": s.jwt_expiry_hours,
        "admin_jwt_expiry_hours": s.admin_jwt_expiry_hours,
        "providers": {"deepseek": bool(s.deepseek_api_key),
                      "email": bool(getattr(s, "brevo_api_key", ""))},
        "legacy_ai_routes": s.legacy_ai_routes,
    }


# ── Projets serveur (ancienne génération côté serveur, conservée en lecture) ──

@router.get("/projects")
async def admin_projects_list(search: str = "", status: str = "all", limit: int = 50, offset: int = 0,
                              admin: dict = Depends(get_current_admin)):
    return await admin_list_all_projects(search=search, status=status, limit=_clamp(limit), offset=max(0, offset))


@router.get("/projects/{project_id}")
async def admin_project_detail(project_id: str, admin: dict = Depends(get_current_admin)):
    project = await get_project(project_id)
    if not project:
        raise HTTPException(404, "Projet non trouvé")
    return project


@router.delete("/projects/{project_id}")
async def admin_delete_project(project_id: str, admin: dict = Depends(require_admin_role("owner", "admin"))):
    if not await get_project(project_id):
        raise HTTPException(404, "Projet non trouvé")
    if not await admin_delete_project_any(project_id):
        raise HTTPException(500, "Suppression impossible")
    _project_states.pop(project_id, None)
    await audit(admin, "delete_project", project_id)
    return {"status": "deleted"}
