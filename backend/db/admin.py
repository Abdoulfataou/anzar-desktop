"""
db/admin.py — Admin management + global admin queries.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import delete, func, select, update

from config import settings
from db.base import get_sessionmaker, _utcnow, _model_to_dict
from db.models import Admin, User, Credits, Transaction, Project, UsageRecord
from db.password import hash_password
from db.credits import add_credits

logger = logging.getLogger("anzar.database")


# ============================================================================
# ADMIN CRUD
# ============================================================================

async def create_default_admin():
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            cnt = await session.scalar(select(func.count(Admin.id)))
            if int(cnt or 0) == 0:
                pw_hash, salt = hash_password(settings.admin_default_password)
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
                .values(password_hash=pw_hash, salt=salt, must_change_password=False)
            )
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

        total_q = await session.execute(select(func.count(User.id)).where(*where))
        total = int(total_q.scalar() or 0)

        proj_cnt = (
            select(func.count(Project.id))
            .where(Project.user_email == User.email)
            .correlate(User)
            .scalar_subquery()
        )

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
                proj_cnt.label("project_count"),
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
        project_count_q = await session.execute(select(func.count(Project.id)).where(Project.user_email == email))
        project_count = int(project_count_q.scalar() or 0)

        txs = (
            await session.scalars(
                select(Transaction).where(Transaction.user_email == email).order_by(Transaction.created_at.desc()).limit(20)
            )
        ).all()

        out = _model_to_dict(user)
        out["credits"] = _model_to_dict(creds) if creds else {"balance_fcfa": 0, "total_recharged": 0, "total_used": 0}
        out["project_count"] = project_count
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


async def admin_list_all_projects(search: str = "", status: str = "all", limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    search = (search or "").strip()
    status = (status or "all").strip().lower()
    Session = get_sessionmaker()
    async with Session() as session:
        where = []
        if search:
            like = f"%{search}%"
            where.append((Project.name.ilike(like)) | (Project.user_email.ilike(like)))
        if status != "all":
            where.append(Project.status == status)

        total_q = await session.execute(select(func.count(Project.id)).where(*where))
        total = int(total_q.scalar() or 0)

        rows = await session.execute(
            select(
                Project.id,
                Project.user_email,
                Project.name,
                Project.description,
                Project.status,
                Project.plan_json,
                Project.result_json,
                Project.tokens_used,
                Project.cost_fcfa,
                Project.created_at,
                Project.updated_at,
                User.name.label("user_name"),
            )
            .select_from(Project)
            .outerjoin(User, User.email == Project.user_email)
            .where(*where)
            .order_by(Project.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        projects = [dict(r) for r in rows.mappings().all()]
        return {"projects": projects, "total": total}


async def admin_delete_project_any(project_id: str) -> bool:
    """Delete any project by id (admin action)."""
    project_id = (project_id or "").strip()
    if not project_id:
        return False
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(delete(Project).where(Project.id == project_id))
            return (res.rowcount or 0) > 0


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

        total_projects = int((await session.execute(select(func.count(Project.id)))).scalar() or 0)
        status_rows = await session.execute(select(Project.status, func.count(Project.id).label("cnt")).group_by(Project.status))
        project_status = {r["status"]: int(r["cnt"]) for r in status_rows.mappings().all()}

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
            "projects": {"total": total_projects, "by_status": project_status},
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
