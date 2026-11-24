"""
db/models.py — All SQLAlchemy ORM models for ANZAR.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
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
    # Monnaie d'affichage et de paiement choisie dans les Réglages (ISO 4217).
    # NULL = automatique (suggestion d'après le pays).
    preferred_currency: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)


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
    # Montant actuellement engagé par des réservations (admission atomique).
    # Source de vérité partagée entre tous les workers : disponibilité = balance - reserved.
    reserved_fcfa: Mapped[float] = mapped_column(
        Float, default=0.0, server_default=text("0"), nullable=False
    )
    total_recharged: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_used: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


# ============================================================================
# CREDIT RESERVATIONS (identité et expiration de chaque réservation)
# ============================================================================

class CreditReservation(Base):
    """Une ligne par réservation active.

    La colonne agrégée `credits.reserved_fcfa` est la source de vérité de l'admission
    (un seul UPDATE conditionnel atomique). Cette table porte l'identité et la date de
    chaque réservation : sans elle, une colonne agrégée ne permettrait pas de purger
    une réservation orpheline sans risquer de libérer aussi la réservation d'un autre
    appel en cours. Les deux écritures sont faites dans la même transaction.
    """

    __tablename__ = "credit_reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(
        String(255), ForeignKey("users.email", ondelete="CASCADE"), nullable=False
    )
    amount_fcfa: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_credit_reservations_email_created", "user_email", "created_at"),
        # SQLite réutilise sinon le rowid supprimé : un vieux Reservation (annulation
        # après purge TTL) pourrait libérer la réservation d'un appel plus récent.
        # AUTOINCREMENT garantit des ids jamais réutilisés ; Postgres a déjà ses
        # séquences monotones.
        {"sqlite_autoincrement": True},
    )


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
    # Secret TOTP (base32) et activation. Le secret n'est jamais renvoyé après l'enrôlement.
    totp_secret: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Codes de secours à usage unique, stockés hachés (JSON).
    mfa_recovery: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
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
    # Identifiant du paiement chez le fournisseur (Stripe PaymentIntent), distinct
    # de la session Checkout : nécessaire pour rapprocher les remboursements/litiges.
    provider_payment_id: Mapped[str] = mapped_column(String(255), default="", nullable=False, index=True)
    charged_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    charged_currency: Mapped[str] = mapped_column(String(8), default="", nullable=False)
    remote_status: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    failure_reason: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    # ── Multidevise ── montant exact facturé, en unités mineures ISO de charged_currency
    # (ex. 500 pour 5,00 €, 5000 pour 5 000 F, 750 pour 0,750 KWD). Le webhook est
    # comparé à cette valeur entière, jamais à un flottant.
    charged_amount_minor: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    fx_rate_used: Mapped[Optional[Decimal]] = mapped_column(Numeric(24, 10), nullable=True)  # FCFA pour 1 unité
    pack_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    pricing_source: Mapped[str] = mapped_column(String(16), default="", nullable=False)  # grid|computed|amount
    customer_country: Mapped[str] = mapped_column(String(2), default="", nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'paid', 'cancelled', 'failed', 'refunded', 'disputed')",
            name="ck_payment_intents_status",
        ),
    )


# ============================================================================
# MULTIDEVISE — devises, taux d'affichage, grille de packs, réglages de prix
# Le FCFA (XOF) reste l'unité du grand livre : ces tables ne servent qu'à
# l'affichage des prix et à l'encaissement.
# ============================================================================

class Currency(Base):
    __tablename__ = "currencies"

    code: Mapped[str] = mapped_column(String(3), primary_key=True)          # ISO 4217
    name: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    symbol: Mapped[str] = mapped_column(String(8), default="", nullable=False)
    decimals: Mapped[int] = mapped_column(Integer, nullable=False)          # 0, 2 ou 3 (ISO)
    active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    margin_pct: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 3), nullable=True)  # NULL = marge globale
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("decimals >= 0 AND decimals <= 4", name="ck_currencies_decimals"),
    )


class FxRate(Base):
    """Dernier taux connu : combien de FCFA vaut 1 unité de la devise."""
    __tablename__ = "fx_rates"

    currency: Mapped[str] = mapped_column(String(3), ForeignKey("currencies.code", ondelete="CASCADE"), primary_key=True)
    fcfa_per_unit: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # parité légale, jamais téléchargée

    __table_args__ = (
        CheckConstraint("fcfa_per_unit > 0", name="ck_fx_rates_positive"),
    )


class FxFetchLog(Base):
    """Journal des mises à jour de taux (succès, panne, variations rejetées)."""
    __tablename__ = "fx_fetch_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    ok: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)


class TopupPack(Base):
    """Pack de recharge à prix rond dans une devise ; crédite un montant fixe en FCFA (bonus inclus)."""
    __tablename__ = "topup_packs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    currency: Mapped[str] = mapped_column(String(3), ForeignKey("currencies.code", ondelete="CASCADE"), index=True, nullable=False)
    price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)    # unités mineures ISO
    credit_fcfa: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    sort: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("currency", "price_minor", name="uq_topup_packs_currency_price"),
        CheckConstraint("price_minor > 0", name="ck_topup_packs_price"),
        CheckConstraint("credit_fcfa > 0", name="ck_topup_packs_credit"),
    )


class PricingSetting(Base):
    """Réglages de prix modifiables dans l'admin (marge, seuils…), en clé/valeur texte."""
    __tablename__ = "pricing_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class SchemaMigration(Base):
    """Migrations versionnées appliquées (db/migrations)."""
    __tablename__ = "schema_migrations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    applied_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


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


# ============================================================================
# RAPPORTS D'ERREURS (envoyés par l'app, regroupés par empreinte)
# ============================================================================

class ErrorGroup(Base):
    """Une erreur distincte vue chez les utilisateurs (même empreinte = même problème)."""
    __tablename__ = "error_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fingerprint: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # Dernier exemple reçu, nettoyé (chemins, clés) côté app ET côté serveur.
    sample: Mapped[str] = mapped_column(Text, default="", nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    users: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_version: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    last_os: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    # new → analysed (diagnostic de l'agent) → fixed / ignored. Revient à new si l'erreur
    # réapparaît dans une version plus récente que celle marquée corrigée.
    status: Mapped[str] = mapped_column(String(16), default="new", nullable=False, index=True)
    analysis: Mapped[str] = mapped_column(Text, default="", nullable=False)
    issue_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    fixed_in: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    first_seen: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)

    __table_args__ = (
        CheckConstraint("kind IN ('command', 'update', 'tool', 'crash')", name="ck_error_groups_kind"),
        CheckConstraint("status IN ('new', 'analysed', 'fixed', 'ignored')", name="ck_error_groups_status"),
    )


class ErrorGroupUser(Base):
    """Utilisateurs touchés par un problème (empreinte du compte, jamais l'e-mail)."""
    __tablename__ = "error_group_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(Integer, ForeignKey("error_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    user_hash: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (UniqueConstraint("group_id", "user_hash", name="uq_error_group_users"),)
