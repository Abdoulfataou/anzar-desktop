"""
db/migrations — Migrations versionnées, sûres et réversibles.

Le schéma de base reste créé par `create_all` (comportement historique) ; chaque
migration ici ajoute ce que `create_all` ne sait pas faire (colonnes sur une
table existante, données de départ) et sait se défaire (`down`).

Usage (dans le conteneur API) :
    python -m db.migrations status
    python -m db.migrations up
    python -m db.migrations down 0001_multidevise   # avant de redéployer l'ancienne version
"""
from __future__ import annotations

import importlib
import logging
from typing import Callable, List, Tuple

from sqlalchemy import text
from sqlalchemy.engine import Connection

logger = logging.getLogger("anzar.migrations")

# Ordre d'application. Chaque module expose up(conn) et down(conn) (connexion synchrone).
MIGRATIONS: List[str] = [
    "0001_multidevise",
]


def _module(mid: str):
    return importlib.import_module(f"db.migrations.m{mid}")


def _ensure_table(conn: Connection) -> None:
    conn.execute(text(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " id VARCHAR(64) PRIMARY KEY,"
        " applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"))


def applied(conn: Connection) -> List[str]:
    _ensure_table(conn)
    return [r[0] for r in conn.execute(text("SELECT id FROM schema_migrations ORDER BY id"))]


def upgrade(conn: Connection) -> List[str]:
    """Applique les migrations manquantes, dans l'ordre. Idempotent."""
    done = set(applied(conn))
    ran = []
    for mid in MIGRATIONS:
        if mid in done:
            continue
        logger.info("Migration %s : up", mid)
        _module(mid).up(conn)
        conn.execute(text("INSERT INTO schema_migrations (id) VALUES (:i)"), {"i": mid})
        ran.append(mid)
    return ran


def downgrade(conn: Connection, mid: str) -> None:
    """Défait UNE migration (la plus récente d'abord, sinon refus)."""
    done = applied(conn)
    if mid not in done:
        raise ValueError(f"{mid} n'est pas appliquée")
    later = [m for m in MIGRATIONS if m in done and MIGRATIONS.index(m) > MIGRATIONS.index(mid)]
    if later:
        raise ValueError(f"Défais d'abord : {', '.join(reversed(later))}")
    logger.warning("Migration %s : down", mid)
    _module(mid).down(conn)
    conn.execute(text("DELETE FROM schema_migrations WHERE id = :i"), {"i": mid})


def status(conn: Connection) -> List[Tuple[str, bool]]:
    done = set(applied(conn))
    return [(m, m in done) for m in MIGRATIONS]
