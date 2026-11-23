"""
db/base.py — SQLAlchemy engine, session factory, init_db, helpers.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import settings

logger = logging.getLogger("anzar.database")


# ============================================================================
# DECLARATIVE BASE
# ============================================================================

class Base(DeclarativeBase):
    pass


# ============================================================================
# ENGINE & SESSION
# ============================================================================

_engine: Optional[AsyncEngine] = None
_sessionmaker: Optional[async_sessionmaker[AsyncSession]] = None

# `DELETE ... RETURNING` exige SQLite >= 3.35 (2021-03). Sur une base système plus
# ancienne (Debian 11 = 3.34), chaque libération de réservation échouerait : on
# détecte la version au démarrage et on bascule sur un repli SELECT + DELETE.
_returning_ok = True


def sqlite_supports_returning(version: Optional[tuple]) -> bool:
    """Version SQLite -> support de `DELETE ... RETURNING`. None = non SQLite (OK)."""
    if version is None:
        return True
    try:
        parts = tuple(int(x) for x in list(version)[:3])
    except (TypeError, ValueError):
        return False
    while len(parts) < 3:
        parts += (0,)
    return parts >= (3, 35, 0)


def supports_returning() -> bool:
    """Le moteur courant accepte-t-il `DELETE ... RETURNING` ?"""
    return _returning_ok


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        db_url = settings.effective_database_url
        is_postgres = "postgresql" in db_url or "asyncpg" in db_url

        # asyncpg keeps a per-connection prepared-statement cache.
        # After schema changes (new tables via create_all) stale cached
        # statements cause ProgrammingError.  Disable the cache to fix.
        extra_kwargs: Dict[str, Any] = {}
        if is_postgres:
            extra_kwargs["connect_args"] = {"statement_cache_size": 0}

        _engine = create_async_engine(
            db_url,
            pool_pre_ping=True,
            pool_size=10 if is_postgres else 5,
            max_overflow=20 if is_postgres else 0,
            pool_recycle=3600,
            future=True,
            **extra_kwargs,
        )
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, autoflush=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


# ============================================================================
# CONNECTION HELPERS
# ============================================================================

async def get_db():
    """Compatibility helper used by /health: returns an AsyncConnection."""
    engine = get_engine()
    return await engine.connect()


async def db_ping() -> None:
    """Raise if DB not reachable."""
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))


# ============================================================================
# DATABASE INITIALIZATION
# ============================================================================

async def _migrate_sqlite_columns(conn) -> None:
    """Ajoute les colonnes manquantes aux tables SQLite existantes.

    `create_all` crée les tables absentes mais ne modifie jamais une table déjà
    présente. Sans cette migration, une base créée avant l'ajout de
    `credits.reserved_fcfa` lèverait « no such column » au premier UPDATE de
    réservation, c'est-à-dire au démarrage en production. On reste volontairement
    ciblé sur cette colonne : SQLite ne sait pas ajouter une colonne NOT NULL sans
    valeur par défaut, et les nouvelles tables (credit_reservations) sont créées
    par `create_all`. Le chemin Postgres dispose déjà de sa migration générique.
    """
    result = await conn.execute(text("PRAGMA table_info(credits)"))
    columns = {row[1] for row in result}
    if not columns:
        return
    if "reserved_fcfa" not in columns:
        await conn.execute(text(
            "ALTER TABLE credits ADD COLUMN reserved_fcfa REAL NOT NULL DEFAULT 0"
        ))
        logger.info("Migration SQLite : colonne credits.reserved_fcfa ajoutée")


async def init_db():
    """Create all tables if they don't exist, then add any missing columns."""
    from sqlalchemy import CheckConstraint

    # Force model registration by importing models module
    from db import models as _models  # noqa: F401

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified")

    # -- Auto-migration: add missing columns to existing tables --
    db_url = settings.effective_database_url
    is_postgres = "postgresql" in db_url or "asyncpg" in db_url

    if is_postgres:
        async with engine.begin() as conn:
            for table in Base.metadata.sorted_tables:
                for col in table.columns:
                    col_name = col.name
                    table_name = table.name

                    try:
                        col_type = col.type.compile(dialect=engine.dialect)
                    except Exception:
                        col_type = "TEXT"

                    default_clause = ""
                    if col.default is not None:
                        dv = col.default.arg
                        if isinstance(dv, bool):
                            default_clause = f" DEFAULT {'TRUE' if dv else 'FALSE'}"
                        elif isinstance(dv, (int, float)):
                            default_clause = f" DEFAULT {dv}"
                        elif isinstance(dv, str):
                            safe = dv.replace("'", "''")
                            default_clause = f" DEFAULT '{safe}'"

                    sql = (
                        f"ALTER TABLE {table_name} "
                        f"ADD COLUMN IF NOT EXISTS {col_name} {col_type}{default_clause}"
                    )
                    try:
                        await conn.execute(text(sql))
                    except Exception as e:
                        logger.debug(f"Auto-migrate skip {table_name}.{col_name}: {e}")

            # -- Refresh CHECK constraints (drop old + re-create) --
            for table in Base.metadata.sorted_tables:
                for constraint in table.constraints:
                    if isinstance(constraint, CheckConstraint) and constraint.name:
                        try:
                            await conn.execute(text(
                                f"ALTER TABLE {table.name} DROP CONSTRAINT IF EXISTS {constraint.name}"
                            ))
                            sql_check = constraint.sqltext.compile(dialect=engine.dialect)
                            await conn.execute(text(
                                f"ALTER TABLE {table.name} ADD CONSTRAINT {constraint.name} CHECK ({sql_check})"
                            ))
                        except Exception as e:
                            logger.debug(f"Auto-migrate constraint {constraint.name}: {e}")

        logger.info("Auto-migration complete — all columns and constraints verified")
    else:
        # SQLite : create_all crée les nouvelles tables, mais pas les nouvelles
        # colonnes d'une table existante. Migration ciblée explicite.
        global _returning_ok
        async with engine.begin() as conn:
            await _migrate_sqlite_columns(conn)
            version_row = await conn.execute(text("SELECT sqlite_version()"))
            version_text = str(version_row.scalar_one_or_none() or "")
            try:
                version = tuple(int(x) for x in version_text.split(".")[:3])
            except ValueError:
                version = None
            _returning_ok = sqlite_supports_returning(version)
            if not _returning_ok:
                logger.warning(
                    "SQLite %s < 3.35 : repli sans DELETE ... RETURNING pour les "
                    "réservations (SELECT + DELETE dans la même transaction).",
                    version_text or "inconnu",
                )
        logger.info("SQLite migration complete — reservation columns verified")

    # -- Migrations versionnées (db/migrations), réversibles --
    from db import migrations as _versioned
    async with engine.begin() as conn:
        ran = await conn.run_sync(_versioned.upgrade)
    if ran:
        logger.info("Migrations appliquées : %s", ", ".join(ran))


# ============================================================================
# HELPER
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
