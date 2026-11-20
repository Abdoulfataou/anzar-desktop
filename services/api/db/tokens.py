"""
db/tokens.py — Révocation de JWT par identifiant (jti).

Un token révoqué reste refusé jusqu'à son expiration naturelle (exp),
après quoi la ligne est purgée par le housekeeping.
"""

from __future__ import annotations

import time

from sqlalchemy import delete, select

from config import settings
from db.base import get_sessionmaker
from db.models import RevokedToken


async def revoke_token_jti(jti: str, expires_at: float):
    """Marque un jti comme révoqué jusqu'à son exp (idempotent)."""
    if not jti:
        return
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            existing = await session.execute(
                select(RevokedToken.id).where(RevokedToken.jti == jti)
            )
            if existing.scalar() is not None:
                return
            # Conserver la révocation pendant toute la fenêtre de refresh (exp + grâce),
            # sinon un jeton révoqué redeviendrait rafraîchissable après la purge.
            retention = max(time.time(), float(expires_at or 0)) + settings.refresh_grace_days * 86400
            session.add(RevokedToken(jti=jti, revoked_at=time.time(), expires_at=retention))


async def is_token_revoked(jti: str) -> bool:
    if not jti:
        return False
    Session = get_sessionmaker()
    async with Session() as session:
        q = await session.execute(select(RevokedToken.id).where(RevokedToken.jti == jti))
        return q.scalar() is not None


async def cleanup_revoked_tokens():
    """Purge les jti expirés (le token correspondant n'est plus valide de toute façon)."""
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            await session.execute(delete(RevokedToken).where(RevokedToken.expires_at < time.time()))
