"""
db/models.py — All SQLAlchemy ORM models for ANZAR.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

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
)
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


# ============================================================================
# USER
# ============================================================================

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
    # Incrémenté à chaque changement de mot de passe / déconnexion globale :
    # les jetons qui portent une ancienne valeur sont refusés immédiatement.
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


# ============================================================================
# OTP CODES
# ============================================================================

class OtpCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    code: Mapped[str] = mapped_column(String(128), nullable=False)  # HMAC hash
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)  # epoch seconds
    expires_at: Mapped[float] = mapped_column(Float, nullable=False)  # epoch seconds


# ============================================================================
# CREDITS
# ============================================================================

class Credits(Base):
    __tablename__ = "credits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    balance_fcfa: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_recharged: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_used: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


# ============================================================================
# TRANSACTION
# ============================================================================

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


# ============================================================================
# USAGE RECORD
# ============================================================================

class UsageRecord(Base):
    __tablename__ = "usage_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    task_type: Mapped[str] = mapped_column(String(50), default="chat")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    # Part de l'entrée servie par le cache DeepSeek (≈ 2 % du prix) : mesure l'efficacité du préfixe stable
    cached_input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    cost_fcfa: Mapped[float] = mapped_column(Float, default=0.0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    was_fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)


# ============================================================================
# PROJECT
# ============================================================================

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
    agent_states: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False, index=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'planning', 'generating', 'testing', 'complete', 'error', 'cancelled')",
            name="ck_projects_status",
        ),
    )


# ============================================================================
# ADMIN
# ============================================================================

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
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'support', 'readonly')", name="ck_admins_role"),
    )


class AdminAudit(Base):
    """Journal des actions des admins (connexions, crédits, paiements, comptes)."""
    __tablename__ = "admin_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target: Mapped[str] = mapped_column(String(255), default="")
    details: Mapped[str] = mapped_column(Text, default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)


# ============================================================================
# PAYMENT INTENT
# ============================================================================

class PaymentIntent(Base):
    __tablename__ = "payment_intents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # uuid4 hex
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    amount_fcfa: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="XOF", nullable=False)
    method: Mapped[str] = mapped_column(String(32), default="", nullable=False)  # wave|orange_money|...
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    provider_ref: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    payment_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # Paiement automatique : fournisseur (fedapay|stripe|…, vide = demande manuelle),
    # identifiant de la transaction chez lui, montant réellement facturé et devise.
    provider: Mapped[str] = mapped_column(String(32), default="", nullable=False, index=True)
    provider_tx_id: Mapped[str] = mapped_column(String(255), default="", nullable=False, index=True)
    charged_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    charged_currency: Mapped[str] = mapped_column(String(8), default="", nullable=False)
    remote_status: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    failure_reason: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'paid', 'cancelled', 'failed')",
            name="ck_payment_intents_status",
        ),
    )


# ============================================================================
# USER MEMORY (Hermes-inspired persistent learning)
# ============================================================================

class UserMemory(Base):
    """Persistent developer memory — learns preferences, conventions, patterns."""
    __tablename__ = "user_memory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)  # JSON string
    confidence: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)  # 0-1, auto-learned vs manual
    source: Mapped[str] = mapped_column(String(10), default="auto", nullable=False)  # auto | manual
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_email", "category", "key", name="uq_user_memory_entry"),
        CheckConstraint(
            "category IN ('stack', 'conventions', 'patterns', 'errors', 'preferences', 'style')",
            name="ck_user_memory_category",
        ),
        CheckConstraint("source IN ('auto', 'manual')", name="ck_user_memory_source"),
    )


# ============================================================================
# COMMUNITY SKILLS (Hermes-inspired skill hub)
# ============================================================================

class CommunitySkill(Base):
    """Shareable skills that users can publish and install."""
    __tablename__ = "community_skills"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # uuid4 hex
    author_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(String(30), default="iterate", nullable=False)
    category: Mapped[str] = mapped_column(String(30), default="custom", nullable=False)
    icon: Mapped[str] = mapped_column(String(10), default="⭐", nullable=False)
    downloads: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rating: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    rating_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


# ============================================================================
# INSTALLED SKILLS (user's installed community skills)
# ============================================================================

class InstalledSkill(Base):
    """Tracks which community skills a user has installed."""
    __tablename__ = "installed_skills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(String(255), ForeignKey("users.email", ondelete="CASCADE"), index=True)
    skill_id: Mapped[str] = mapped_column(String(64), ForeignKey("community_skills.id", ondelete="CASCADE"))
    installed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_email", "skill_id", name="uq_installed_skill"),
    )


# ============================================================================
# RATE LIMIT
# ============================================================================

class RateLimit(Base):
    __tablename__ = "rate_limits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    endpoint: Mapped[str] = mapped_column(String(255), default="*")
    timestamp: Mapped[float] = mapped_column(Float, nullable=False, index=True)  # epoch seconds


# ============================================================================
# REVOKED TOKENS (logout / compromission — révocation par jti)
# ============================================================================

class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    jti: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    revoked_at: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # epoch seconds
    expires_at: Mapped[float] = mapped_column(Float, nullable=False, index=True)  # epoch seconds — pour le purge


# ============================================================================
# COMPOSITE INDEXES
# ============================================================================

Index("idx_rate_limits_key", RateLimit.client_key, RateLimit.timestamp)
Index("idx_otp_email", OtpCode.email, OtpCode.created_at)
