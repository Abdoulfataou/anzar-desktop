"""
db/admin.py — Admin management + global admin queries.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select, update

from config import settings
from db.base import get_sessionmaker, _utcnow, _model_to_dict
from db.models import Admin, User, Credits, Transaction, UsageRecord
from db.password import hash_password
from db.credits import add_credits

logger = logging.getLogger("anzar.database")


# ============================================================================
# ADMIN CRUD
# ============================================================================

INITIAL_ADMIN_PASSWORD_FILE = "ADMIN_MOT_DE_PASSE_INITIAL.txt"


def _write_initial_admin_password(password: str) -> Optional[str]:
    """Écrit le mot de passe initial dans data/ (droits 0600). Retourne le chemin, ou None."""
    import os
    try:
        os.makedirs("data", exist_ok=True)
        path = os.path.abspath(os.path.join("data", INITIAL_ADMIN_PASSWORD_FILE))
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(f"{settings.admin_default_email}\n{password}\n")
        os.chmod(path, 0o600)
        return path
    except OSError as e:
        logger.error("Écriture du mot de passe admin initial impossible : %s", type(e).__name__)
        return None


async def create_default_admin():
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            cnt = await session.scalar(select(func.count(Admin.id)))
            if int(cnt or 0) == 0:
                # Aucun mot de passe par défaut en dur : si ADMIN_DEFAULT_PASSWORD
                # n'est pas fourni via l'env, on génère un secret aléatoire écrit dans
                # un fichier lisible par le seul propriétaire — jamais dans les logs.
                import secrets as _secrets
                pw = settings.admin_default_password or _secrets.token_urlsafe(16)
                if not settings.admin_default_password:
                    saved_to = _write_initial_admin_password(pw)
                    if not saved_to:
                        logging.getLogger("anzar").error(
                            "ADMIN_DEFAULT_PASSWORD non défini et mot de passe initial impossible à "
                            "enregistrer : compte admin NON créé. Définis ADMIN_DEFAULT_PASSWORD puis redémarre."
                        )
                        return
                    logging.getLogger("anzar").warning(
                        "ADMIN_DEFAULT_PASSWORD non défini — mot de passe admin initial enregistré dans %s "
                        "(lis-le, change-le à la première connexion, puis supprime ce fichier)", saved_to
                    )
                pw_hash, salt = hash_password(pw)
                session.add(
                    Admin(
                        email=settings.admin_default_email,
                        password_hash=pw_hash,
                        salt=salt,
                        name="Admin ANZAR",
                        role="owner",
                        must_change_password=True,
                        is_active=True,
                    )
                )
                logger.info(f"Default admin created: {settings.admin_default_email}")


async def get_admin_by_email(email: str) -> Optional[Dict[str, Any]]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        admin = await session.scalar(select(Admin).where(Admin.email == email, Admin.is_active.is_(True)))
        return _model_to_dict(admin) if admin else None


async def get_admin_by_id(admin_id: int) -> Optional[Dict[str, Any]]:
    Session = get_sessionmaker()
    async with Session() as session:
        admin = await session.scalar(select(Admin).where(Admin.id == int(admin_id), Admin.is_active.is_(True)))
        return _model_to_dict(admin) if admin else None


async def update_admin_last_login(email: str):
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            await session.execute(update(Admin).where(Admin.email == email).values(last_login=func.now()))


async def update_admin_profile(admin_id: int, **fields) -> bool:
    allowed = {"name", "role", "is_active", "must_change_password"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return False
    if updates.get("is_active") is False:
        updates["token_version"] = Admin.token_version + 1
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(Admin).where(Admin.id == int(admin_id)).values(**updates))
            return (res.rowcount or 0) > 0


async def change_admin_password(admin_id: int, new_password: str) -> bool:
    pw_hash, salt = hash_password(new_password)
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(
                update(Admin)
                .where(Admin.id == int(admin_id))
                .values(password_hash=pw_hash, salt=salt, must_change_password=False, token_version=Admin.token_version + 1)
            )
            return (res.rowcount or 0) > 0


async def set_admin_totp_secret(admin_id: int, sealed_secret: str, recovery_json: str = "[]") -> bool:
    """Enregistre un secret TOTP en attente de validation et ses codes de secours."""
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(Admin).where(Admin.id == int(admin_id))
                                        .values(totp_secret=sealed_secret, totp_enabled=False, mfa_recovery=recovery_json))
            return (res.rowcount or 0) > 0


async def update_admin_totp_secret(admin_id: int, sealed_secret: str) -> bool:
    """Ré-enregistre un secret (migration v1 → v2) sans changer l'activation."""
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(Admin).where(Admin.id == int(admin_id))
                                        .values(totp_secret=sealed_secret))
            return (res.rowcount or 0) > 0


async def set_admin_recovery_codes(admin_id: int, recovery_json: str) -> bool:
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(Admin).where(Admin.id == int(admin_id))
                                        .values(mfa_recovery=recovery_json))
            return (res.rowcount or 0) > 0


async def reset_admin_mfa(admin_id: int) -> bool:
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(Admin).where(Admin.id == int(admin_id))
                                        .values(totp_secret="", totp_enabled=False, mfa_recovery="[]",
                                                token_version=Admin.token_version + 1))
            return (res.rowcount or 0) > 0


async def enable_admin_totp(admin_id: int) -> bool:
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(Admin).where(Admin.id == int(admin_id))
                                        .values(totp_enabled=True, token_version=Admin.token_version + 1))
            return (res.rowcount or 0) > 0


async def disable_admin_totp(admin_id: int) -> bool:
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(Admin).where(Admin.id == int(admin_id))
                                        .values(totp_secret="", totp_enabled=False, mfa_recovery="[]",
                                                token_version=Admin.token_version + 1))
            return (res.rowcount or 0) > 0


async def list_admins() -> List[Dict[str, Any]]:
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (await session.scalars(select(Admin).order_by(Admin.created_at))).all()
        out: List[Dict[str, Any]] = []
        for r in rows:
            d = _model_to_dict(r)
            d.pop("password_hash", None)
            d.pop("salt", None)
            d.pop("totp_secret", None)
            d.pop("mfa_recovery", None)
            d["mfa_enabled"] = bool(d.pop("totp_enabled", False))
            out.append(d)
        return out


# ============================================================================
# ADMIN — GLOBAL QUERIES
# ============================================================================

async def admin_list_all_users(search: str = "", status: str = "all", limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    search = (search or "").strip()
    status = (status or "all").strip().lower()

    Session = get_sessionmaker()
    async with Session() as session:
        where = []
        if search:
            like = f"%{search}%"
            where.append((User.email.ilike(like)) | (User.name.ilike(like)))
        if status == "active":
            where.append(User.is_active.is_(True))
        elif status == "disabled":
            where.append(User.is_active.is_(False))
        balance = func.coalesce(Credits.balance_fcfa, 0)
        if status == "debt":
            where.append(balance < 0)
        elif status == "zero":
            where.append(balance == 0)
        elif status == "funded":
            where.append(balance > 0)

        total_q = await session.execute(
            select(func.count(User.id)).select_from(User)
            .outerjoin(Credits, Credits.user_email == User.email).where(*where)
        )
        total = int(total_q.scalar() or 0)

        rows = await session.execute(
            select(
                User.id,
                User.email,
                User.name,
                User.is_active,
                User.created_at,
                User.last_login,
                func.coalesce(Credits.balance_fcfa, 0).label("balance_fcfa"),
                func.coalesce(Credits.total_recharged, 0).label("total_recharged"),
                func.coalesce(Credits.total_used, 0).label("total_used"),
            )
            .select_from(User)
            .outerjoin(Credits, Credits.user_email == User.email)
            .where(*where)
            .order_by(User.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        users = [dict(r) for r in rows.mappings().all()]
        return {"users": users, "total": total}


async def admin_get_user_detail(user_email: str) -> Optional[Dict[str, Any]]:
    email = (user_email or "").strip().lower()
    Session = get_sessionmaker()
    async with Session() as session:
        user = await session.scalar(select(User).where(User.email == email))
        if not user:
            return None

        creds = await session.scalar(select(Credits).where(Credits.user_email == email))

        txs = (
            await session.scalars(
                select(Transaction).where(Transaction.user_email == email).order_by(Transaction.created_at.desc()).limit(20)
            )
        ).all()

        out = _model_to_dict(user)
        out["credits"] = _model_to_dict(creds) if creds else {"balance_fcfa": 0, "total_recharged": 0, "total_used": 0}
        out["recent_transactions"] = [_model_to_dict(t) for t in txs]
        return out


async def admin_update_user(user_email: str, **fields) -> bool:
    allowed = {"name", "is_active"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return False
    email = (user_email or "").strip().lower()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(User).where(User.email == email).values(**updates))
            return (res.rowcount or 0) > 0


async def admin_add_credits_to_user(
    user_email: str,
    amount: float,
    description: str,
    tx_type: str = "bonus",
    external_ref: str = "",
) -> Dict[str, Any]:
    return await add_credits(user_email, amount, description, tx_type=tx_type, external_ref=external_ref)


async def admin_get_global_stats() -> Dict[str, Any]:
    start_today = _utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    end_today = start_today + timedelta(days=1)
    cutoff_30d = _utcnow() - timedelta(days=30)
    cutoff_7d = _utcnow() - timedelta(days=7)

    Session = get_sessionmaker()
    async with Session() as session:
        active_users = int((await session.execute(select(func.count(User.id)).where(User.is_active.is_(True)))).scalar() or 0)
        total_users = int((await session.execute(select(func.count(User.id)))).scalar() or 0)
        new_users_7d = int((await session.execute(select(func.count(User.id)).where(User.created_at >= cutoff_7d))).scalar() or 0)

        credits_global_q = await session.execute(
            select(
                func.coalesce(func.sum(Credits.balance_fcfa), 0).label("total_balance"),
                func.coalesce(func.sum(Credits.total_recharged), 0).label("platform_recharged"),
                func.coalesce(func.sum(Credits.total_used), 0).label("platform_used"),
            )
        )
        credits_global = dict(credits_global_q.mappings().first() or {})

        usage_30d_q = await session.execute(
            select(
                func.count(UsageRecord.id).label("total_requests"),
                func.coalesce(func.sum(UsageRecord.input_tokens + UsageRecord.output_tokens), 0).label("total_tokens"),
                func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("total_cost_fcfa"),
            ).where(UsageRecord.created_at >= cutoff_30d)
        )
        usage_30d = dict(usage_30d_q.mappings().first() or {})

        usage_today_q = await session.execute(
            select(
                func.count(UsageRecord.id).label("requests"),
                func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("cost_fcfa"),
            ).where(UsageRecord.created_at >= start_today, UsageRecord.created_at < end_today)
        )
        usage_today = dict(usage_today_q.mappings().first() or {})

        return {
            "users": {"active": active_users, "total": total_users, "new_7d": new_users_7d},
            "credits": credits_global,
            "usage_30d": usage_30d,
            "usage_today": usage_today,
        }


async def admin_get_all_transactions(limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.scalars(select(Transaction).order_by(Transaction.created_at.desc()).limit(limit).offset(offset))
        ).all()
        return [_model_to_dict(r) for r in rows]


async def admin_get_all_usage(limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.scalars(select(UsageRecord).order_by(UsageRecord.created_at.desc()).limit(limit).offset(offset))
        ).all()
        return [_model_to_dict(r) for r in rows]
