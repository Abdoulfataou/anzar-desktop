"""
db/users.py — User CRUD operations.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy import func, select, update

from config import settings
from db.base import get_sessionmaker, _model_to_dict
from db.models import User, Credits, Transaction
from db.password import hash_password


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
            await session.flush()  # User row must exist before FK references
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
