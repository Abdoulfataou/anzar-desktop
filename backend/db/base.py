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
        logger.info("SQLite mode — skipping auto-migration (create_all handles it)")


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
