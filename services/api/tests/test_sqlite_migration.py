"""Migration SQLite : une base existante sans credits.reserved_fcfa démarre et est mise à niveau."""
import os
import pathlib
import sqlite3
import subprocess
import sys

API_DIR = pathlib.Path(__file__).resolve().parents[1]


def _run_init_db(db_path: pathlib.Path) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["DATABASE_PATH"] = str(db_path)
    env["DATABASE_URL"] = ""
    script = "import asyncio\nfrom db import init_db\nasyncio.run(init_db())\n"
    return subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(API_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def _create_ancienne_base(db_path: pathlib.Path) -> None:
    """Schéma d'avant la migration : table credits sans reserved_fcfa, avec une ligne."""
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE users (
                email VARCHAR(255) PRIMARY KEY,
                password_hash VARCHAR(128),
                salt VARCHAR(128),
                name VARCHAR(255),
                created_at DATETIME,
                last_login DATETIME,
                is_active BOOLEAN,
                token_version INTEGER
            );
            CREATE TABLE credits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email VARCHAR(255) REFERENCES users(email) ON DELETE CASCADE,
                balance_fcfa FLOAT NOT NULL DEFAULT 0,
                total_recharged FLOAT NOT NULL DEFAULT 0,
                total_used FLOAT NOT NULL DEFAULT 0,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO users (email, name, is_active, token_version)
                VALUES ('ancien@test.local', 'ancien', 1, 0);
            INSERT INTO credits (user_email, balance_fcfa, total_recharged, total_used)
                VALUES ('ancien@test.local', 1234.5, 2000.0, 765.5);
            """
        )
        conn.commit()
    finally:
        conn.close()


def test_base_sqlite_sans_reserved_fcfa_est_migree_sans_perte(tmp_path):
    db_path = tmp_path / "ancienne.db"
    _create_ancienne_base(db_path)

    proc = _run_init_db(db_path)
    assert proc.returncode == 0, proc.stderr

    conn = sqlite3.connect(db_path)
    try:
        columns = {row[1]: row for row in conn.execute("PRAGMA table_info(credits)")}
        assert "reserved_fcfa" in columns
        _, _, col_type, notnull, default, _ = columns["reserved_fcfa"]
        assert col_type.upper() == "REAL"
        assert notnull == 1
        assert str(default) in ("0", "0.0")

        row = conn.execute(
            "SELECT user_email, balance_fcfa, total_recharged, total_used, reserved_fcfa "
            "FROM credits"
        ).fetchone()
        assert row == ("ancien@test.local", 1234.5, 2000.0, 765.5, 0.0)

        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "credit_reservations" in tables
    finally:
        conn.close()

    # Deuxième démarrage : la migration est idempotente, les données restent intactes.
    proc = _run_init_db(db_path)
    assert proc.returncode == 0, proc.stderr
    conn = sqlite3.connect(db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM credits").fetchone()[0] == 1
        assert conn.execute("SELECT balance_fcfa FROM credits").fetchone()[0] == 1234.5
    finally:
        conn.close()
