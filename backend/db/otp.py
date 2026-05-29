"""
db/otp.py — OTP code creation, verification, cleanup.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from sqlalchemy import delete, func, select, update

from config import settings
from db.base import get_sessionmaker
from db.models import OtpCode


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
