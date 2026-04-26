"""
Database module — User management, credits, usage tracking, projects.
Uses aiosqlite for async SQLite access + hashlib for password hashing.
Production-ready for Railway deployment.
"""
import hashlib
import secrets
import logging
import time
import hmac
from typing import Optional, Dict, Any, List

import aiosqlite

from config import settings

logger = logging.getLogger("anzar.database")


# ============================================================================
# PASSWORD HASHING (PBKDF2-SHA256, no external deps)
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
# DATABASE CONNECTION HELPER
# ============================================================================

async def get_db() -> aiosqlite.Connection:
    """Get a database connection with WAL mode and row_factory."""
    db = await aiosqlite.connect(settings.database_path)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


# ============================================================================
# DATABASE INITIALIZATION
# ============================================================================

async def init_db():
    """Create all tables if they don't exist."""
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        # ── Users ──
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT DEFAULT '',
                salt TEXT DEFAULT '',
                name TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        """)

        # ── OTP codes (email verification) ──
        await db.execute("""
            CREATE TABLE IF NOT EXISTS otp_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                code TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                used BOOLEAN DEFAULT 0,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL
            )
        """)

        # ── Credits (prepaid balance per user) ──
        await db.execute("""
            CREATE TABLE IF NOT EXISTS credits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email TEXT NOT NULL,
                balance_fcfa REAL DEFAULT 0,
                total_recharged REAL DEFAULT 0,
                total_used REAL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
            )
        """)

        # ── Transactions (recharge / usage) ──
        await db.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('recharge', 'usage', 'bonus', 'refund')),
                amount_fcfa REAL NOT NULL,
                description TEXT DEFAULT '',
                provider TEXT DEFAULT '',
                model TEXT DEFAULT '',
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
            )
        """)

        # ── Usage records (detailed API call tracking) ──
        await db.execute("""
            CREATE TABLE IF NOT EXISTS usage_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                task_type TEXT DEFAULT 'chat',
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cost_usd REAL DEFAULT 0,
                cost_fcfa REAL DEFAULT 0,
                duration_ms INTEGER DEFAULT 0,
                was_fallback BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
            )
        """)

        # ── Projects ──
        await db.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                user_email TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'planning', 'generating', 'testing', 'complete', 'error', 'cancelled')),
                plan_json TEXT DEFAULT '{}',
                result_json TEXT DEFAULT '{}',
                tokens_used INTEGER DEFAULT 0,
                cost_fcfa REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
            )
        """)

        # ── Admins (separate from users — admin panel access) ──
        await db.execute("""
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                name TEXT DEFAULT '',
                role TEXT DEFAULT 'admin' CHECK(role IN ('owner', 'admin', 'support', 'readonly')),
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP
            )
        """)

        # ── Rate limits (persistent across restarts) ──
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rate_limits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_key TEXT NOT NULL,
                endpoint TEXT DEFAULT '*',
                timestamp REAL NOT NULL
            )
        """)

        # ── Indexes ──
        await db.execute("CREATE INDEX IF NOT EXISTS idx_credits_user ON credits(user_email)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_email)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_email)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_records(created_at)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_email)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(client_key, timestamp)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, created_at)")

        await db.commit()

    logger.info("Database initialized — all tables ready")


# ============================================================================
# USER CRUD
# ============================================================================

async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Get user by email. Returns dict or None."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM users WHERE email = ? AND is_active = 1",
            (email.lower().strip(),)
        )
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None


async def create_user(email: str, password: str = "") -> Dict[str, Any]:
    """Create a new user + initialize credits. Password optional (OTP flow)."""
    email = email.lower().strip()
    pw_hash, salt = "", ""
    if password:
        pw_hash, salt = hash_password(password)

    async with aiosqlite.connect(settings.database_path) as db:
        cursor = await db.execute(
            "INSERT INTO users (email, password_hash, salt, name) VALUES (?, ?, ?, ?)",
            (email, pw_hash, salt, email.split("@")[0])
        )
        # Initialize credit record
        await db.execute(
            "INSERT INTO credits (user_email, balance_fcfa) VALUES (?, 0)",
            (email,)
        )
        await db.commit()
        user_id = cursor.lastrowid

    logger.info(f"User created: {email}")
    return {"id": user_id, "email": email}


async def update_last_login(email: str):
    """Update user's last login timestamp."""
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(
            "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE email = ?",
            (email.lower().strip(),)
        )
        await db.commit()


async def update_user_profile(email: str, name: str) -> bool:
    """Update user profile name."""
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(
            "UPDATE users SET name = ? WHERE email = ?",
            (name.strip(), email.lower().strip())
        )
        await db.commit()
    return True


async def change_user_password(email: str, new_password: str) -> bool:
    """Change user password."""
    pw_hash, salt = hash_password(new_password)
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE email = ?",
            (pw_hash, salt, email.lower().strip())
        )
        await db.commit()
    return True


async def deactivate_user(email: str) -> bool:
    """Soft-delete a user account."""
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(
            "UPDATE users SET is_active = 0 WHERE email = ?",
            (email.lower().strip(),)
        )
        await db.commit()
    logger.info(f"User deactivated: {email}")
    return True


# ============================================================================
# CREDITS
# ============================================================================

async def get_credits(email: str) -> Dict[str, Any]:
    """Get user's credit balance."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM credits WHERE user_email = ?",
            (email.lower().strip(),)
        )
        row = await cursor.fetchone()
        if row:
            return dict(row)
        # Auto-create if missing (migration safety)
        await db.execute(
            "INSERT INTO credits (user_email, balance_fcfa) VALUES (?, 0)",
            (email.lower().strip(),)
        )
        await db.commit()
        return {"user_email": email, "balance_fcfa": 0, "total_recharged": 0, "total_used": 0}


async def add_credits(email: str, amount_fcfa: float, description: str = "Recharge") -> Dict[str, Any]:
    """Add credits (recharge). Returns new balance."""
    email = email.lower().strip()

    async with aiosqlite.connect(settings.database_path) as db:
        # Update balance
        await db.execute("""
            UPDATE credits
            SET balance_fcfa = balance_fcfa + ?,
                total_recharged = total_recharged + ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_email = ?
        """, (amount_fcfa, amount_fcfa, email))

        # Record transaction
        await db.execute("""
            INSERT INTO transactions (user_email, type, amount_fcfa, description)
            VALUES (?, 'recharge', ?, ?)
        """, (email, amount_fcfa, description))

        await db.commit()

        # Return updated balance
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM credits WHERE user_email = ?", (email,))
        row = await cursor.fetchone()

    logger.info(f"Credits added: {email} +{amount_fcfa} FCFA")
    return dict(row) if row else {}


async def deduct_credits(
    email: str,
    amount_fcfa: float,
    description: str = "",
    provider: str = "",
    model: str = "",
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> Dict[str, Any]:
    """Deduct credits after API usage. Returns new balance. Raises if insufficient."""
    email = email.lower().strip()

    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row

        # Check balance
        cursor = await db.execute("SELECT balance_fcfa FROM credits WHERE user_email = ?", (email,))
        row = await cursor.fetchone()
        if not row or row["balance_fcfa"] < amount_fcfa:
            raise ValueError("Solde insuffisant")

        # Deduct
        await db.execute("""
            UPDATE credits
            SET balance_fcfa = balance_fcfa - ?,
                total_used = total_used + ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_email = ?
        """, (amount_fcfa, amount_fcfa, email))

        # Record transaction
        await db.execute("""
            INSERT INTO transactions (user_email, type, amount_fcfa, description, provider, model, input_tokens, output_tokens)
            VALUES (?, 'usage', ?, ?, ?, ?, ?, ?)
        """, (email, -amount_fcfa, description, provider, model, input_tokens, output_tokens))

        await db.commit()

        cursor = await db.execute("SELECT * FROM credits WHERE user_email = ?", (email,))
        row = await cursor.fetchone()

    return dict(row) if row else {}


async def has_credits(email: str) -> bool:
    """Check if user has any credits remaining."""
    creds = await get_credits(email)
    return creds.get("balance_fcfa", 0) > 0


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
    """Record an API usage event. Returns record ID."""
    async with aiosqlite.connect(settings.database_path) as db:
        cursor = await db.execute("""
            INSERT INTO usage_records
            (user_email, provider, model, task_type, input_tokens, output_tokens,
             cost_usd, cost_fcfa, duration_ms, was_fallback)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (email.lower().strip(), provider, model, task_type,
              input_tokens, output_tokens, cost_usd, cost_fcfa,
              duration_ms, was_fallback))
        await db.commit()
        return cursor.lastrowid


async def get_usage_stats(email: str, days: int = 30) -> Dict[str, Any]:
    """Get usage statistics for a user over the last N days."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row

        # Total stats
        cursor = await db.execute("""
            SELECT
                COUNT(*) as total_requests,
                COALESCE(SUM(input_tokens), 0) as total_input_tokens,
                COALESCE(SUM(output_tokens), 0) as total_output_tokens,
                COALESCE(SUM(cost_fcfa), 0) as total_cost_fcfa,
                COALESCE(SUM(cost_usd), 0) as total_cost_usd,
                COALESCE(AVG(duration_ms), 0) as avg_duration_ms
            FROM usage_records
            WHERE user_email = ?
            AND created_at >= datetime('now', ?)
        """, (email.lower().strip(), f"-{days} days"))
        total = dict(await cursor.fetchone())

        # Per-provider breakdown
        cursor = await db.execute("""
            SELECT
                provider,
                COUNT(*) as requests,
                COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
                COALESCE(SUM(cost_fcfa), 0) as cost_fcfa
            FROM usage_records
            WHERE user_email = ?
            AND created_at >= datetime('now', ?)
            GROUP BY provider
        """, (email.lower().strip(), f"-{days} days"))
        providers = {row["provider"]: dict(row) for row in await cursor.fetchall()}

        # Today's usage
        cursor = await db.execute("""
            SELECT
                COUNT(*) as requests,
                COALESCE(SUM(cost_fcfa), 0) as cost_fcfa
            FROM usage_records
            WHERE user_email = ?
            AND date(created_at) = date('now')
        """, (email.lower().strip(),))
        today = dict(await cursor.fetchone())

    return {
        "period_days": days,
        "total": total,
        "by_provider": providers,
        "today": today,
    }


async def get_usage_history(email: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Get recent usage records for a user."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT * FROM usage_records
            WHERE user_email = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """, (email.lower().strip(), limit, offset))
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def get_transactions(email: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Get transaction history for a user."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT * FROM transactions
            WHERE user_email = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """, (email.lower().strip(), limit, offset))
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]


# ============================================================================
# PROJECTS
# ============================================================================

async def create_project(
    project_id: str, email: str, name: str, description: str = ""
) -> Dict[str, Any]:
    """Create a project record."""
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute("""
            INSERT INTO projects (id, user_email, name, description)
            VALUES (?, ?, ?, ?)
        """, (project_id, email.lower().strip(), name, description))
        await db.commit()
    return {"id": project_id, "name": name, "status": "pending"}


async def update_project(project_id: str, **fields) -> bool:
    """Update project fields (status, plan_json, result_json, etc)."""
    allowed = {"status", "plan_json", "result_json", "tokens_used", "cost_fcfa", "name", "description"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return False

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values())
    values.append(project_id)

    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(
            f"UPDATE projects SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            values
        )
        await db.commit()
    return True


async def get_project(project_id: str) -> Optional[Dict[str, Any]]:
    """Get a single project by ID."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = await cursor.fetchone()
    return dict(row) if row else None


async def get_user_projects(email: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Get all projects for a user, newest first."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT * FROM projects
            WHERE user_email = ?
            ORDER BY updated_at DESC
            LIMIT ?
        """, (email.lower().strip(), limit))
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def delete_project(project_id: str, email: str) -> bool:
    """Delete a project (owner check)."""
    async with aiosqlite.connect(settings.database_path) as db:
        cursor = await db.execute(
            "DELETE FROM projects WHERE id = ? AND user_email = ?",
            (project_id, email.lower().strip())
        )
        await db.commit()
    return cursor.rowcount > 0


# ============================================================================
# RATE LIMITING (persistent)
# ============================================================================

async def record_rate_limit_hit(client_key: str, endpoint: str = "*"):
    """Record a rate limit hit."""
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(
            "INSERT INTO rate_limits (client_key, endpoint, timestamp) VALUES (?, ?, ?)",
            (client_key, endpoint, time.time())
        )
        await db.commit()


async def get_rate_limit_count(client_key: str, window_seconds: int) -> int:
    """Count hits in the given window."""
    cutoff = time.time() - window_seconds
    async with aiosqlite.connect(settings.database_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM rate_limits WHERE client_key = ? AND timestamp > ?",
            (client_key, cutoff)
        )
        row = await cursor.fetchone()
    return row[0] if row else 0


async def cleanup_rate_limits(max_age_seconds: int = 86400):
    """Delete old rate limit entries (run periodically)."""
    cutoff = time.time() - max_age_seconds
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute("DELETE FROM rate_limits WHERE timestamp < ?", (cutoff,))
        await db.commit()


# ============================================================================
# OTP CODES (email verification)
# ============================================================================

def _hash_otp(email: str, code: str) -> str:
    """
    Hash an OTP code for storage-at-rest (HMAC-SHA256).
    We never store the OTP in plaintext in DB.
    """
    msg = f"{email.lower().strip()}:{code.strip()}".encode("utf-8")
    key = settings.effective_otp_secret.encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


async def create_otp(email: str, code: str, expiry_minutes: int = 10) -> int:
    """Store an OTP code for an email. Returns record ID."""
    now = time.time()
    expires_at = now + (expiry_minutes * 60)
    email = email.lower().strip()
    code_hash = _hash_otp(email, code)

    async with aiosqlite.connect(settings.database_path) as db:
        # Invalidate any previous unused codes for this email
        await db.execute(
            "UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0",
            (email,)
        )
        # Insert new code
        cursor = await db.execute(
            "INSERT INTO otp_codes (email, code, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (email, code_hash, now, expires_at)
        )
        await db.commit()
        return cursor.lastrowid


async def verify_otp(email: str, code: str, max_attempts: int = 5) -> bool:
    """
    Verify an OTP code. Returns True if valid.
    Increments attempt counter. Marks as used on success.
    Returns False if expired, wrong code, or too many attempts.
    """
    email = email.lower().strip()
    now = time.time()

    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row

        # Get the most recent unused code for this email
        cursor = await db.execute("""
            SELECT id, code, attempts, expires_at
            FROM otp_codes
            WHERE email = ? AND used = 0
            ORDER BY created_at DESC
            LIMIT 1
        """, (email,))
        row = await cursor.fetchone()

        if not row:
            return False

        otp_id = row["id"]
        stored_code = row["code"]
        attempts = row["attempts"]
        expires_at = row["expires_at"]

        # Check expiry
        if now > expires_at:
            await db.execute("UPDATE otp_codes SET used = 1 WHERE id = ?", (otp_id,))
            await db.commit()
            return False

        # Check too many attempts
        if attempts >= max_attempts:
            await db.execute("UPDATE otp_codes SET used = 1 WHERE id = ?", (otp_id,))
            await db.commit()
            return False

        # Increment attempt counter
        await db.execute(
            "UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?",
            (otp_id,)
        )

        # Check code (constant-time comparison)
        import secrets as _secrets
        candidate = code.strip()
        candidate_hash = _hash_otp(email, candidate)

        # Backward compatibility: accept legacy plaintext codes once.
        is_plain_legacy = isinstance(stored_code, str) and stored_code.isdigit() and len(stored_code) == 6
        ok = _secrets.compare_digest(candidate, stored_code) if is_plain_legacy else _secrets.compare_digest(candidate_hash, stored_code)
        if ok:
            # Mark as used
            await db.execute("UPDATE otp_codes SET used = 1 WHERE id = ?", (otp_id,))
            await db.commit()
            return True

        await db.commit()
        return False


async def get_recent_otp_count(email: str, window_seconds: int = 300) -> int:
    """Count OTP codes sent to this email in the last N seconds (anti-spam)."""
    cutoff = time.time() - window_seconds
    email = email.lower().strip()
    async with aiosqlite.connect(settings.database_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM otp_codes WHERE email = ? AND created_at > ?",
            (email, cutoff)
        )
        row = await cursor.fetchone()
    return row[0] if row else 0


async def cleanup_expired_otps():
    """Delete expired OTP codes (housekeeping)."""
    # Remove OTPs that expired more than 1 hour ago
    cutoff = time.time() - 3600
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute("DELETE FROM otp_codes WHERE expires_at < ?", (cutoff,))
        await db.commit()


# ============================================================================
# ADMIN MANAGEMENT
# ============================================================================

async def create_default_admin():
    """Create a default admin account if none exists. Called at startup."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM admins")
        row = await cursor.fetchone()
        if row["cnt"] == 0:
            pw_hash, salt = hash_password(settings.admin_default_password)
            await db.execute(
                "INSERT INTO admins (email, password_hash, salt, name, role) VALUES (?, ?, ?, ?, ?)",
                (settings.admin_default_email, pw_hash, salt, "Admin ANZAR", "owner")
            )
            await db.commit()
            logger.info(f"Default admin created: {settings.admin_default_email}")


async def get_admin_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Get admin by email."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM admins WHERE email = ? AND is_active = 1",
            (email.lower().strip(),)
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


async def get_admin_by_id(admin_id: int) -> Optional[Dict[str, Any]]:
    """Get admin by ID."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM admins WHERE id = ? AND is_active = 1",
            (admin_id,)
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


async def update_admin_profile(admin_id: int, **fields) -> bool:
    """Update admin profile fields (name, email, role)."""
    allowed = {"name", "email", "role"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return False
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [admin_id]
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(f"UPDATE admins SET {set_clause} WHERE id = ?", values)
        await db.commit()
    return True


async def change_admin_password(admin_id: int, new_password: str) -> bool:
    """Change admin password."""
    pw_hash, salt = hash_password(new_password)
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(
            "UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?",
            (pw_hash, salt, admin_id)
        )
        await db.commit()
    return True


async def update_admin_last_login(email: str):
    """Update admin last login timestamp."""
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(
            "UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE email = ?",
            (email.lower().strip(),)
        )
        await db.commit()


async def list_admins() -> List[Dict[str, Any]]:
    """List all admin accounts."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, email, name, role, is_active, created_at, last_login FROM admins ORDER BY created_at"
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


# ============================================================================
# ADMIN — GLOBAL QUERIES (cross-user data for admin panel)
# ============================================================================

async def admin_list_all_users(search: str = "", status: str = "all",
                                limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    """List all users with credits info. For admin panel."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row

        where_clauses = []
        params: list = []

        if search:
            where_clauses.append("(u.email LIKE ? OR u.name LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])

        if status == "active":
            where_clauses.append("u.is_active = 1")
        elif status == "disabled":
            where_clauses.append("u.is_active = 0")

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        # Count total
        cursor = await db.execute(
            f"SELECT COUNT(*) as cnt FROM users u {where_sql}", params
        )
        total = (await cursor.fetchone())["cnt"]

        # Fetch users with credits
        cursor = await db.execute(f"""
            SELECT u.id, u.email, u.name, u.is_active, u.created_at, u.last_login,
                   COALESCE(c.balance_fcfa, 0) as balance_fcfa,
                   COALESCE(c.total_recharged, 0) as total_recharged,
                   COALESCE(c.total_used, 0) as total_used,
                   (SELECT COUNT(*) FROM projects p WHERE p.user_email = u.email) as project_count
            FROM users u
            LEFT JOIN credits c ON c.user_email = u.email
            {where_sql}
            ORDER BY u.created_at DESC
            LIMIT ? OFFSET ?
        """, params + [limit, offset])
        users = [dict(r) for r in await cursor.fetchall()]

    return {"users": users, "total": total}


async def admin_get_user_detail(user_email: str) -> Optional[Dict[str, Any]]:
    """Get full user detail for admin panel."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute("SELECT * FROM users WHERE email = ?", (user_email,))
        user = await cursor.fetchone()
        if not user:
            return None
        user = dict(user)

        # Credits
        cursor = await db.execute("SELECT * FROM credits WHERE user_email = ?", (user_email,))
        creds = await cursor.fetchone()
        user["credits"] = dict(creds) if creds else {"balance_fcfa": 0, "total_recharged": 0, "total_used": 0}

        # Projects count
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM projects WHERE user_email = ?", (user_email,))
        user["project_count"] = (await cursor.fetchone())["cnt"]

        # Recent transactions
        cursor = await db.execute("""
            SELECT * FROM transactions WHERE user_email = ? ORDER BY created_at DESC LIMIT 20
        """, (user_email,))
        user["recent_transactions"] = [dict(r) for r in await cursor.fetchall()]

    return user


async def admin_update_user(user_email: str, **fields) -> bool:
    """Admin update user fields (name, is_active)."""
    allowed = {"name", "is_active"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return False
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [user_email]
    async with aiosqlite.connect(settings.database_path) as db:
        await db.execute(f"UPDATE users SET {set_clause} WHERE email = ?", values)
        await db.commit()
    return True


async def admin_add_credits_to_user(user_email: str, amount: float, description: str = "Bonus admin") -> Dict[str, Any]:
    """Admin grants credits to a user."""
    return await add_credits(user_email, amount, description)


async def admin_list_all_projects(search: str = "", status: str = "all",
                                   limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    """List all projects from all users. For admin panel."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row

        where_clauses = []
        params: list = []

        if search:
            where_clauses.append("(p.name LIKE ? OR p.user_email LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])

        if status != "all":
            where_clauses.append("p.status = ?")
            params.append(status)

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        cursor = await db.execute(f"SELECT COUNT(*) as cnt FROM projects p {where_sql}", params)
        total = (await cursor.fetchone())["cnt"]

        cursor = await db.execute(f"""
            SELECT p.*, u.name as user_name
            FROM projects p
            LEFT JOIN users u ON u.email = p.user_email
            {where_sql}
            ORDER BY p.updated_at DESC
            LIMIT ? OFFSET ?
        """, params + [limit, offset])
        projects = [dict(r) for r in await cursor.fetchall()]

    return {"projects": projects, "total": total}


async def admin_get_global_stats() -> Dict[str, Any]:
    """Get platform-wide statistics for admin dashboard."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row

        # Users
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM users WHERE is_active = 1")
        active_users = (await cursor.fetchone())["cnt"]
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM users")
        total_users = (await cursor.fetchone())["cnt"]

        # Projects
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM projects")
        total_projects = (await cursor.fetchone())["cnt"]
        cursor = await db.execute("SELECT status, COUNT(*) as cnt FROM projects GROUP BY status")
        project_status = {r["status"]: r["cnt"] for r in await cursor.fetchall()}

        # Credits platform-wide
        cursor = await db.execute("""
            SELECT COALESCE(SUM(balance_fcfa), 0) as total_balance,
                   COALESCE(SUM(total_recharged), 0) as platform_recharged,
                   COALESCE(SUM(total_used), 0) as platform_used
            FROM credits
        """)
        credits_global = dict(await cursor.fetchone())

        # Usage last 30 days
        cursor = await db.execute("""
            SELECT COUNT(*) as total_requests,
                   COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
                   COALESCE(SUM(cost_fcfa), 0) as total_cost_fcfa
            FROM usage_records
            WHERE created_at >= datetime('now', '-30 days')
        """)
        usage_30d = dict(await cursor.fetchone())

        # Usage today
        cursor = await db.execute("""
            SELECT COUNT(*) as requests,
                   COALESCE(SUM(cost_fcfa), 0) as cost_fcfa
            FROM usage_records
            WHERE date(created_at) = date('now')
        """)
        usage_today = dict(await cursor.fetchone())

        # Recent signups (last 7 days)
        cursor = await db.execute("""
            SELECT COUNT(*) as cnt FROM users
            WHERE created_at >= datetime('now', '-7 days')
        """)
        new_users_7d = (await cursor.fetchone())["cnt"]

    return {
        "users": {"active": active_users, "total": total_users, "new_7d": new_users_7d},
        "projects": {"total": total_projects, "by_status": project_status},
        "credits": credits_global,
        "usage_30d": usage_30d,
        "usage_today": usage_today,
    }


async def admin_get_all_transactions(limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    """Get all transactions platform-wide for admin."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT * FROM transactions ORDER BY created_at DESC LIMIT ? OFFSET ?
        """, (limit, offset))
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def admin_get_all_usage(limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    """Get all usage records platform-wide for admin."""
    async with aiosqlite.connect(settings.database_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT * FROM usage_records ORDER BY created_at DESC LIMIT ? OFFSET ?
        """, (limit, offset))
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]
