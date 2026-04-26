"""
Database module — Postgres-ready via SQLAlchemy async.

Default (local): sqlite+aiosqlite file DB
Production (Railway): set DATABASE_URL (Railway Postgres) → postgresql+asyncpg

This file keeps the same public function names used by backend/main.py, but the
implementation is now database-agnostic and works with Postgres.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
    update,
    delete,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from config import settings

logger = logging.getLogger("anzar.database")


# ============================================================================
# PASSWORD HASHING (PBKDF2-SHA256)
# ============================================================================

def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    """Hash password with PBKDF2-SHA256. Returns (hash_hex, salt_hex)."""
    if salt is None:
        salt = secrets.token_hex(32)
    pw_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations=600_000,
    ).hex()
    return pw_hash, salt


def verify_password(password: str, stored_hash: str, salt: str) -> bool:
    """Verify a password against stored hash+salt."""
    computed_hash, _ = hash_password(password, salt)
    return secrets.compare_digest(computed_hash, stored_hash)


# ============================================================================
# SQLAlchemy setup
# ============================================================================

class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(128), default="")
    salt: Mapped[str] = mapped_column(String(128), default="")
    name: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class OtpCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    code: Mapped[str] = mapped_column(String(128), nullable=False)  # HMAC hash
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)  # epoch seconds
    expires_at: Mapped[float] = mapped_column(Float, nullable=False)  # epoch seconds


class Credits(Base):
    __tablename__ = "credits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    balance_fcfa: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_recharged: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_used: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    amount_fcfa: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    provider: Mapped[str] = mapped_column(String(64), default="")
    model: Mapped[str] = mapped_column(String(64), default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
    external_ref: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        CheckConstraint("type IN ('recharge', 'usage', 'bonus', 'refund')", name="ck_transactions_type"),
        UniqueConstraint("external_ref", name="uq_transactions_external_ref"),
    )


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    task_type: Mapped[str] = mapped_column(String(50), default="chat")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    cost_fcfa: Mapped[float] = mapped_column(Float, default=0.0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    was_fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False, index=True)
    plan_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    cost_fcfa: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False, index=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'planning', 'generating', 'testing', 'complete', 'error', 'cancelled')",
            name="ck_projects_status",
        ),
    )


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    salt: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(255), default="")
    role: Mapped[str] = mapped_column(String(20), default="admin", nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'support', 'readonly')", name="ck_admins_role"),
    )


class PaymentIntent(Base):
    __tablename__ = "payment_intents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # uuid4 hex
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    amount_fcfa: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="XOF", nullable=False)
    method: Mapped[str] = mapped_column(String(32), default="", nullable=False)  # wave|orange_money|...
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    provider_ref: Mapped[str] = mapped_column(String(255), default="", nullable=False)  # wave/OM ref later
    payment_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'paid', 'cancelled', 'failed')",
            name="ck_payment_intents_status",
        ),
    )


class RateLimit(Base):
    __tablename__ = "rate_limits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    endpoint: Mapped[str] = mapped_column(String(255), default="*")
    timestamp: Mapped[float] = mapped_column(Float, nullable=False, index=True)  # epoch seconds


Index("idx_rate_limits_key", RateLimit.client_key, RateLimit.timestamp)
Index("idx_otp_email", OtpCode.email, OtpCode.created_at)


_engine: Optional[AsyncEngine] = None
_sessionmaker: Optional[async_sessionmaker[AsyncSession]] = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        _engine = create_async_engine(
            settings.effective_database_url,
            pool_pre_ping=True,
            future=True,
        )
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, autoflush=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


# ============================================================================
# CONNECTION HELPERS (used by /health)
# ============================================================================

async def get_db():
    """Compatibility helper used by /health: returns an AsyncConnection."""
    engine = get_engine()
    return await engine.connect()


async def db_ping() -> None:
    """Raise if DB not reachable."""
    engine = get_engine()
    async with engine.connect() as conn:
        from sqlalchemy import text

        await conn.execute(text("SELECT 1"))


# ============================================================================
# DATABASE INITIALIZATION
# ============================================================================

async def init_db():
    """Create all tables if they don't exist."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database initialized — all tables ready")


# ============================================================================
# USER CRUD
# ============================================================================

async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        user = await session.scalar(select(User).where(User.email == email, User.is_active.is_(True)))
        return _model_to_dict(user) if user else None


async def create_user(email: str, password: str = "") -> Dict[str, Any]:
    email = email.lower().strip()
    pw_hash, salt = "", ""
    if password:
        pw_hash, salt = hash_password(password)

    welcome_bonus = float(getattr(settings, "welcome_bonus_fcfa", 0) or 0)
    welcome_bonus = max(0.0, welcome_bonus)

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            user = User(email=email, password_hash=pw_hash, salt=salt, name=email.split("@")[0])
            session.add(user)
            session.add(Credits(user_email=email, balance_fcfa=welcome_bonus, total_recharged=welcome_bonus))
            if welcome_bonus > 0:
                session.add(
                    Transaction(
                        user_email=email,
                        type="bonus",
                        amount_fcfa=welcome_bonus,
                        description="Bonus de bienvenue",
                    )
                )
        return _model_to_dict(user)


async def update_last_login(email: str):
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            await session.execute(update(User).where(User.email == email).values(last_login=func.now()))


async def change_user_password(email: str, new_password: str) -> bool:
    """Change a user's password. Generates new salt + hash."""
    email = email.lower().strip()
    new_hash, new_salt = hash_password(new_password)
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(
                update(User)
                .where(User.email == email)
                .values(password_hash=new_hash, salt=new_salt)
            )
            return (res.rowcount or 0) > 0


async def deactivate_user(email: str) -> bool:
    """Soft-delete a user account by marking it inactive."""
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(
                update(User)
                .where(User.email == email)
                .values(is_active=False)
            )
            return (res.rowcount or 0) > 0


async def update_user_profile(email: str, name: str) -> bool:
    email = email.lower().strip()
    name = (name or "").strip()
    if not name:
        return False
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(User).where(User.email == email).values(name=name))
            return (res.rowcount or 0) > 0


# ============================================================================
# CREDITS
# ============================================================================

async def get_credits(email: str) -> Dict[str, Any]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        row = await session.scalar(select(Credits).where(Credits.user_email == email))
        if not row:
            return {"user_email": email, "balance_fcfa": 0, "total_recharged": 0, "total_used": 0}
        d = _model_to_dict(row)
        d.pop("id", None)
        return d


async def add_credits(
    email: str,
    amount_fcfa: float,
    description: str = "Recharge",
    tx_type: str = "recharge",
    external_ref: str = "",
) -> Dict[str, Any]:
    """Add credits (recharge/bonus/refund). Idempotent if external_ref is provided."""
    email = email.lower().strip()
    tx_type = (tx_type or "recharge").strip().lower()
    if tx_type not in ("recharge", "bonus", "refund"):
        tx_type = "recharge"
    external_ref = (external_ref or "").strip() or None

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if external_ref:
                existing = await session.scalar(select(Transaction.id).where(Transaction.external_ref == external_ref))
                if existing:
                    return await get_credits(email)

            credits = await session.scalar(select(Credits).where(Credits.user_email == email).with_for_update())
            if not credits:
                credits = Credits(user_email=email, balance_fcfa=0, total_recharged=0, total_used=0)
                session.add(credits)
                await session.flush()

            credits.balance_fcfa = float(credits.balance_fcfa or 0) + float(amount_fcfa)
            credits.total_recharged = float(credits.total_recharged or 0) + float(amount_fcfa)
            credits.updated_at = _utcnow()

            session.add(
                Transaction(
                    user_email=email,
                    type=tx_type,
                    amount_fcfa=float(amount_fcfa),
                    description=description or "",
                    external_ref=external_ref,
                )
            )

        return await get_credits(email)


async def deduct_credits(
    email: str,
    amount_fcfa: float,
    description: str = "",
    provider: str = "",
    model: str = "",
    input_tokens: int = 0,
    output_tokens: int = 0,
    external_ref: Optional[str] = None,
) -> Dict[str, Any]:
    """Deduct credits after API usage. Returns new balance. Raises if insufficient."""
    email = email.lower().strip()
    amount_fcfa = float(amount_fcfa or 0)
    if amount_fcfa <= 0:
        return await get_credits(email)

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if external_ref:
                external_ref = (external_ref or "").strip()
                if external_ref:
                    existing = await session.scalar(select(Transaction.id).where(Transaction.external_ref == external_ref))
                    if existing:
                        return await get_credits(email)

            credits = await session.scalar(select(Credits).where(Credits.user_email == email).with_for_update())
            if not credits or float(credits.balance_fcfa or 0) < amount_fcfa:
                raise ValueError("Solde insuffisant")

            credits.balance_fcfa = float(credits.balance_fcfa or 0) - amount_fcfa
            credits.total_used = float(credits.total_used or 0) + amount_fcfa
            credits.updated_at = _utcnow()

            session.add(
                Transaction(
                    user_email=email,
                    type="usage",
                    amount_fcfa=-amount_fcfa,
                    description=description or "",
                    provider=provider or "",
                    model=model or "",
                    input_tokens=int(input_tokens or 0),
                    output_tokens=int(output_tokens or 0),
                    external_ref=(external_ref or "").strip() or None,
                )
            )

        return await get_credits(email)


async def has_credits(email: str) -> bool:
    creds = await get_credits(email)
    return float(creds.get("balance_fcfa", 0) or 0) > 0


# ============================================================================
# USAGE TRACKING
# ============================================================================

async def record_usage(
    email: str,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    cost_fcfa: float,
    duration_ms: int = 0,
    task_type: str = "chat",
    was_fallback: bool = False,
) -> int:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            rec = UsageRecord(
                user_email=email,
                provider=provider,
                model=model,
                task_type=task_type,
                input_tokens=int(input_tokens or 0),
                output_tokens=int(output_tokens or 0),
                cost_usd=float(cost_usd or 0),
                cost_fcfa=float(cost_fcfa or 0),
                duration_ms=int(duration_ms or 0),
                was_fallback=bool(was_fallback),
            )
            session.add(rec)
            await session.flush()
            return int(rec.id)


async def get_usage_history(email: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.scalars(
                select(UsageRecord)
                .where(UsageRecord.user_email == email)
                .order_by(UsageRecord.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
        return [_model_to_dict(r) for r in rows]


async def get_transactions(email: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        rows = (
            await session.scalars(
                select(Transaction)
                .where(Transaction.user_email == email)
                .order_by(Transaction.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
        return [_model_to_dict(r) for r in rows]


async def get_usage_stats(email: str, days: int = 30) -> Dict[str, Any]:
    email = email.lower().strip()
    cutoff = _utcnow() - timedelta(days=int(days or 30))

    start_today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    end_today = start_today + timedelta(days=1)

    Session = get_sessionmaker()
    async with Session() as session:
        total = await session.execute(
            select(
                func.count(UsageRecord.id).label("total_requests"),
                func.coalesce(func.sum(UsageRecord.input_tokens), 0).label("total_input_tokens"),
                func.coalesce(func.sum(UsageRecord.output_tokens), 0).label("total_output_tokens"),
                func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("total_cost_fcfa"),
                func.coalesce(func.sum(UsageRecord.cost_usd), 0).label("total_cost_usd"),
                func.coalesce(func.avg(UsageRecord.duration_ms), 0).label("avg_duration_ms"),
            ).where(UsageRecord.user_email == email, UsageRecord.created_at >= cutoff)
        )
        total_row = dict(total.mappings().first() or {})

        by_provider = await session.execute(
            select(
                UsageRecord.provider.label("provider"),
                func.count(UsageRecord.id).label("requests"),
                func.coalesce(func.sum(UsageRecord.input_tokens + UsageRecord.output_tokens), 0).label("tokens"),
                func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("cost_fcfa"),
            )
            .where(UsageRecord.user_email == email, UsageRecord.created_at >= cutoff)
            .group_by(UsageRecord.provider)
        )
        providers = {r["provider"]: dict(r) for r in by_provider.mappings().all()}

        today_q = await session.execute(
            select(
                func.count(UsageRecord.id).label("requests"),
                func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("cost_fcfa"),
            ).where(UsageRecord.user_email == email, UsageRecord.created_at >= start_today, UsageRecord.created_at < end_today)
        )
        today = dict(today_q.mappings().first() or {})

    return {"period_days": days, "total": total_row, "by_provider": providers, "today": today}


# ============================================================================
# PROJECTS
# ============================================================================

async def create_project(project_id: str, email: str, name: str, description: str = "") -> Dict[str, Any]:
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            p = Project(id=project_id, user_email=email, name=name, description=description or "")
            session.add(p)
        return {"id": project_id, "name": name, "status": "pending"}


async def update_project(project_id: str, **fields) -> bool:
    allowed = {"status", "plan_json", "result_json", "tokens_used", "cost_fcfa", "name", "description"}
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


# ============================================================================
# RATE LIMITING (persistent)
# ============================================================================

async def record_rate_limit_hit(client_key: str, endpoint: str = "*"):
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            session.add(RateLimit(client_key=client_key, endpoint=endpoint, timestamp=time.time()))


async def get_rate_limit_count(client_key: str, window_seconds: int) -> int:
    cutoff = time.time() - float(window_seconds)
    Session = get_sessionmaker()
    async with Session() as session:
        q = await session.execute(
            select(func.count(RateLimit.id)).where(RateLimit.client_key == client_key, RateLimit.timestamp > cutoff)
        )
        return int(q.scalar() or 0)


async def cleanup_rate_limits(max_age_seconds: int = 86400):
    cutoff = time.time() - float(max_age_seconds)
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            await session.execute(delete(RateLimit).where(RateLimit.timestamp < cutoff))


# ============================================================================
# OTP CODES (email verification)
# ============================================================================

def _hash_otp(email: str, code: str) -> str:
    msg = f"{email.lower().strip()}:{code.strip()}".encode("utf-8")
    key = settings.effective_otp_secret.encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


async def create_otp(email: str, code: str, expiry_minutes: int = 10) -> int:
    now = time.time()
    expires_at = now + (expiry_minutes * 60)
    email = email.lower().strip()
    code_hash = _hash_otp(email, code)

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            # Invalidate previous unused codes
            await session.execute(update(OtpCode).where(OtpCode.email == email, OtpCode.used.is_(False)).values(used=True))
            otp = OtpCode(email=email, code=code_hash, created_at=now, expires_at=expires_at)
            session.add(otp)
            await session.flush()
            return int(otp.id)


async def verify_otp(email: str, code: str, max_attempts: int = 5) -> bool:
    email = email.lower().strip()
    now = time.time()

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            otp = await session.scalar(
                select(OtpCode)
                .where(OtpCode.email == email, OtpCode.used.is_(False))
                .order_by(OtpCode.created_at.desc())
                .limit(1)
            )
            if not otp:
                return False

            if now > float(otp.expires_at):
                otp.used = True
                return False

            if int(otp.attempts or 0) >= int(max_attempts or 0):
                otp.used = True
                return False

            otp.attempts = int(otp.attempts or 0) + 1

            candidate = code.strip()
            candidate_hash = _hash_otp(email, candidate)

            stored_code = otp.code or ""
            is_plain_legacy = isinstance(stored_code, str) and stored_code.isdigit() and len(stored_code) == 6
            ok = secrets.compare_digest(candidate, stored_code) if is_plain_legacy else secrets.compare_digest(candidate_hash, stored_code)
            if ok:
                otp.used = True
                return True

            return False


async def get_recent_otp_count(email: str, window_seconds: int = 300) -> int:
    cutoff = time.time() - float(window_seconds)
    email = email.lower().strip()
    Session = get_sessionmaker()
    async with Session() as session:
        q = await session.execute(select(func.count(OtpCode.id)).where(OtpCode.email == email, OtpCode.created_at > cutoff))
        return int(q.scalar() or 0)


async def cleanup_expired_otps():
    cutoff = time.time() - 3600
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            await session.execute(delete(OtpCode).where(OtpCode.expires_at < cutoff))


# ============================================================================
# ADMIN MANAGEMENT
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
            # hide password fields
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

        # project count subquery
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
    start_today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
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


# ============================================================================
# PAYMENTS (préparation Wave/Orange Money)
# ============================================================================

async def create_payment_intent(
    user_email: str,
    amount_fcfa: float,
    currency: str = "XOF",
    method: str = "",
) -> Dict[str, Any]:
    """Create a payment intent in DB (status=pending). No external provider call yet."""
    import uuid as _uuid

    user_email = (user_email or "").strip().lower()
    currency = (currency or "XOF").strip().upper()
    method = (method or "").strip().lower()
    amount_fcfa = float(amount_fcfa or 0)
    if amount_fcfa <= 0:
        raise ValueError("Montant invalide")

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            intent = PaymentIntent(
                id=_uuid.uuid4().hex,
                user_email=user_email,
                amount_fcfa=amount_fcfa,
                currency=currency,
                method=method,
                status="pending",
                provider_ref="",
                payment_url="",
            )
            session.add(intent)
            return _model_to_dict(intent)


async def admin_list_payment_intents(status: str = "pending", limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    status = (status or "pending").strip().lower()
    Session = get_sessionmaker()
    async with Session() as session:
        where = []
        if status != "all":
            where.append(PaymentIntent.status == status)
        total_q = await session.execute(select(func.count(PaymentIntent.id)).where(*where))
        total = int(total_q.scalar() or 0)
        rows = (
            await session.scalars(
                select(PaymentIntent).where(*where).order_by(PaymentIntent.created_at.desc()).limit(limit).offset(offset)
            )
        ).all()
        return {"payment_intents": [_model_to_dict(r) for r in rows], "total": total}


async def admin_mark_payment_intent_paid(
    intent_id: str,
    admin_email: str,
    provider_ref: str = "",
    description: str = "",
) -> Dict[str, Any]:
    """
    Mark intent as paid + credit user.
    Uses intent_id/provider_ref as external_ref to prevent double credit.
    """
    intent_id = (intent_id or "").strip()
    provider_ref = (provider_ref or "").strip()
    description = (description or "").strip()
    if len(description) < 3:
        raise ValueError("Raison obligatoire (min 3 caractères)")

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            intent = await session.scalar(select(PaymentIntent).where(PaymentIntent.id == intent_id).with_for_update())
            if not intent:
                raise ValueError("Demande introuvable")
            if intent.status == "paid":
                return _model_to_dict(intent)

            intent.status = "paid"
            intent.provider_ref = provider_ref
            intent.updated_at = _utcnow()

        # Apply bonus based on recharge amount
        from config import settings as _cfg
        bonus_pct = _cfg.get_recharge_bonus_percent(intent.amount_fcfa)
        bonus_amount = round(intent.amount_fcfa * bonus_pct / 100) if bonus_pct > 0 else 0
        total_credited = intent.amount_fcfa + bonus_amount

        external_ref = provider_ref or intent_id
        bonus_label = f" (+{bonus_pct}% bonus = {total_credited} F)" if bonus_pct > 0 else ""
        await add_credits(
            intent.user_email,
            total_credited,
            description=f"Paiement validé ({admin_email}): {description}{bonus_label}",
            tx_type="recharge",
            external_ref=external_ref,
        )

    # Reload latest
    Session = get_sessionmaker()
    async with Session() as session:
        intent = await session.scalar(select(PaymentIntent).where(PaymentIntent.id == intent_id))
        return _model_to_dict(intent) if intent else {}


# ============================================================================
# Helpers
# ============================================================================

def _model_to_dict(obj: Any) -> Dict[str, Any]:
    if obj is None:
        return {}
    out: Dict[str, Any] = {}
    for k in obj.__mapper__.columns.keys():  # type: ignore[attr-defined]
        v = getattr(obj, k)
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out
