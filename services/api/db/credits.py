"""
db/credits.py — Credits management (recharge, deduct, check balance, reservations).

Les réservations de facturation vivent en base :
- `credits.reserved_fcfa` est la source de vérité de l'admission (UPDATE conditionnel) ;
- `credit_reservations` porte l'identité et l'âge de chaque réservation, pour une
  libération idempotente et une purge TTL exacte (on ne libère jamais le hold d'un
  autre appel en cours).
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, Optional

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError

from db.base import get_sessionmaker, _utcnow, _model_to_dict
from db.models import Credits, CreditReservation, Transaction

logger = logging.getLogger("anzar.credits")


def _normalize_email(email: str) -> str:
    return (email or "").lower().strip()


async def get_credits(email: str) -> Dict[str, Any]:
    email = _normalize_email(email)
    Session = get_sessionmaker()
    async with Session() as session:
        row = await session.scalar(select(Credits).where(Credits.user_email == email))
        if not row:
            return {
                "user_email": email,
                "balance_fcfa": 0,
                "reserved_fcfa": 0,
                "total_recharged": 0,
                "total_used": 0,
            }
        d = _model_to_dict(row)
        d.pop("id", None)
        return d


# ============================================================================
# RÉSERVATIONS (contrôle d'admission, pas encaissement)
# ============================================================================

async def reserve_credits(email: str, amount_fcfa: float) -> Optional[int]:
    """Réserve `amount_fcfa` si le disponible le permet. Rend l'id de réservation.

    L'admission est un seul UPDATE conditionnel, sans SELECT préalable dans la même
    transaction : sur Postgres le verrou de ligne est pris par l'UPDATE et la condition
    est réévaluée après l'attente ; sur SQLite l'écrivain unique sérialise les UPDATE.
    Deux workers ne peuvent donc pas engager deux fois le même solde. Un rowcount de 0
    signifie « solde insuffisant ou compte inconnu », jamais « je réessaie ».
    """
    email = _normalize_email(email)
    try:
        amount = float(amount_fcfa)
    except (TypeError, ValueError):
        return None
    if amount <= 0:
        return None

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            result = await session.execute(
                update(Credits)
                .where(
                    Credits.user_email == email,
                    func.coalesce(Credits.balance_fcfa, 0.0)
                    - func.coalesce(Credits.reserved_fcfa, 0.0) >= amount,
                )
                .values(
                    reserved_fcfa=func.coalesce(Credits.reserved_fcfa, 0.0) + amount,
                    updated_at=_utcnow(),
                )
                .execution_options(synchronize_session=False)
            )
            if result.rowcount != 1:
                # rowcount != 1 : soit aucune ligne (compte inconnu), soit la condition
                # a échoué (disponible insuffisant). Les doublons de credits (schéma
                # historique sans UNIQUE(user_email)) échouent volontairement en fermé.
                return None

            reservation = CreditReservation(
                user_email=email,
                amount_fcfa=amount,
                created_at=_utcnow(),
            )
            session.add(reservation)
            await session.flush()
            return int(reservation.id)


async def _take_reservation(session, email: str, reservation_id: Optional[int]) -> float:
    """Supprime une réservation et rend son montant (0 si elle n'existe plus).

    DELETE ... RETURNING est atomique : deux libérations concurrentes ( règlement,
    purge TTL, release_now) ne peuvent pas décrémenter deux fois le même hold.
    """
    if reservation_id is None:
        return 0.0
    try:
        rid = int(reservation_id)
    except (TypeError, ValueError):
        return 0.0

    deleted = await session.execute(
        delete(CreditReservation)
        .where(
            CreditReservation.id == rid,
            CreditReservation.user_email == email,
        )
        .returning(CreditReservation.amount_fcfa)
        .execution_options(synchronize_session=False)
    )
    amount = deleted.scalar_one_or_none()
    return float(amount) if amount is not None else 0.0


def _release_values(amount: float):
    """Expression SQL qui décrémente le réservé sans jamais passer sous zéro."""
    reserved = func.coalesce(Credits.reserved_fcfa, 0.0)
    return {
        "reserved_fcfa": case((reserved >= amount, reserved - amount), else_=0.0),
        "updated_at": _utcnow(),
    }


async def release_reservation(email: str, reservation_id: Optional[int]) -> float:
    """Libère une réservation précise (idempotent). Rend le montant libéré."""
    email = _normalize_email(email)
    if reservation_id is None:
        return 0.0

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            amount = await _take_reservation(session, email, reservation_id)
            if amount <= 0:
                logger.debug("Réservation déjà absente/expirée: user=%s id=%s", email, reservation_id)
                return 0.0
            await session.execute(
                update(Credits)
                .where(Credits.user_email == email)
                .values(**_release_values(amount))
                .execution_options(synchronize_session=False)
            )
            return amount


async def purge_expired_reservations(
    ttl_seconds: float,
    email: Optional[str] = None,
) -> float:
    """Supprime les réservations plus vieilles que le TTL et rend le montant libéré.

    Appelée à l'admission : une réservation orpheline (process tué, client disparu)
    ne bloque pas le solde indéfiniment. Le DELETE ... RETURNING donne exactement les
    lignes expirées ; on ne touche jamais aux réservations récentes du même compte.
    """
    try:
        ttl = max(0.0, float(ttl_seconds))
    except (TypeError, ValueError):
        ttl = 0.0
    cutoff = _utcnow() - timedelta(seconds=ttl)
    email = _normalize_email(email) if email else None

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            stmt = delete(CreditReservation).where(CreditReservation.created_at < cutoff)
            if email:
                stmt = stmt.where(CreditReservation.user_email == email)
            rows = (
                await session.execute(
                    stmt.returning(
                        CreditReservation.user_email,
                        CreditReservation.amount_fcfa,
                    ).execution_options(synchronize_session=False)
                )
            ).all()

            totals: Dict[str, float] = {}
            for user_email, amount in rows:
                totals[user_email] = totals.get(user_email, 0.0) + float(amount or 0)

            for user_email, amount in totals.items():
                if amount <= 0:
                    continue
                await session.execute(
                    update(Credits)
                    .where(Credits.user_email == user_email)
                    .values(**_release_values(amount))
                    .execution_options(synchronize_session=False)
                )

            total = float(sum(totals.values()))
            if total > 0:
                logger.info(
                    "Réservations expirées libérées: n=%s total_fcfa=%.2f%s",
                    len(rows), total, f" user={email}" if email else "",
                )
            return total


# ============================================================================
# RECHARGE / DÉBIT
# ============================================================================

async def add_credits(
    email: str,
    amount_fcfa: float,
    description: str = "Recharge",
    tx_type: str = "recharge",
    external_ref: str = "",
) -> Dict[str, Any]:
    """Add credits (recharge/bonus/refund). Idempotent if external_ref is provided."""
    email = _normalize_email(email)
    tx_type = (tx_type or "recharge").strip().lower()
    if tx_type not in ("recharge", "bonus", "refund"):
        tx_type = "recharge"
    external_ref = (external_ref or "").strip() or None

    try:
        return await _add_credits_once(email, amount_fcfa, description, tx_type, external_ref)
    except IntegrityError:
        # Deux règlements simultanés (webhook + sondage de l'app) : la contrainte unique sur
        # external_ref a refusé le second, rien n'a été crédité deux fois.
        if external_ref:
            return await get_credits(email)
        raise


async def _add_credits_once(email, amount_fcfa, description, tx_type, external_ref):
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if external_ref:
                existing = await session.scalar(select(Transaction.id).where(Transaction.external_ref == external_ref))
                if existing:
                    return await get_credits(email)

            credits = await session.scalar(select(Credits).where(Credits.user_email == email).with_for_update())
            if not credits:
                credits = Credits(user_email=email, balance_fcfa=0, total_recharged=0, total_used=0)
                session.add(credits)
                await session.flush()

            credits.balance_fcfa = float(credits.balance_fcfa or 0) + float(amount_fcfa)
            credits.total_recharged = float(credits.total_recharged or 0) + float(amount_fcfa)
            credits.updated_at = _utcnow()

            session.add(
                Transaction(
                    user_email=email,
                    type=tx_type,
                    amount_fcfa=float(amount_fcfa),
                    description=description or "",
                    external_ref=external_ref,
                )
            )

        return await get_credits(email)


async def deduct_credits(
    email: str,
    amount_fcfa: float,
    description: str = "",
    provider: str = "",
    model: str = "",
    input_tokens: int = 0,
    output_tokens: int = 0,
    external_ref: Optional[str] = None,
    allow_negative: bool = False,
    tx_type: str = "usage",
    count_as_usage: bool = True,
    reservation_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Deduct credits after API usage, or debit a refund/dispute. Returns new balance.

    Raises if insufficient, sauf allow_negative=True : le coût réel d'un appel déjà servi est
    toujours débité (le solde devient une dette, et l'accès est bloqué jusqu'à la recharge).

    Si `reservation_id` est fourni, la réservation est libérée **dans la même
    transaction** que le débit : même en cas de dette (ou si la purge TTL est déjà
    passée), il ne reste pas de montant engagé. La suppression est idempotente.
    """
    email = _normalize_email(email)
    amount_fcfa = float(amount_fcfa or 0)
    tx_type = tx_type if tx_type in ("usage", "refund") else "usage"
    if amount_fcfa <= 0:
        # Coût nul (ou crédit nul) : pas de débit, mais la réservation doit tout de
        # même être libérée si le règlement en fournit une.
        if reservation_id is not None:
            await release_reservation(email, reservation_id)
        return await get_credits(email)

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if external_ref:
                external_ref = (external_ref or "").strip()
                if external_ref:
                    existing = await session.scalar(select(Transaction.id).where(Transaction.external_ref == external_ref))
                    if existing:
                        return await get_credits(email)

            # Libération d'abord : le DELETE ... RETURNING nous dit si cette
            # réservation existait encore (sinon purge TTL / autre libération).
            released_fcfa = 0.0
            if reservation_id is not None:
                released_fcfa = await _take_reservation(session, email, reservation_id)
                if released_fcfa <= 0:
                    logger.warning(
                        "Réservation absente au règlement: user=%s id=%s — déjà libérée/expirée, "
                        "le débit réel est appliqué quand même",
                        email, reservation_id,
                    )

            credits = await session.scalar(select(Credits).where(Credits.user_email == email).with_for_update())
            if not credits:
                if not allow_negative:
                    raise ValueError("Solde insuffisant")
                credits = Credits(user_email=email, balance_fcfa=0, total_recharged=0, total_used=0)
                session.add(credits)
                await session.flush()
            elif not allow_negative and float(credits.balance_fcfa or 0) < amount_fcfa:
                raise ValueError("Solde insuffisant")

            credits.balance_fcfa = float(credits.balance_fcfa or 0) - amount_fcfa
            if released_fcfa > 0:
                credits.reserved_fcfa = max(
                    0.0, float(credits.reserved_fcfa or 0) - released_fcfa
                )
            if count_as_usage:
                credits.total_used = float(credits.total_used or 0) + amount_fcfa
            credits.updated_at = _utcnow()

            session.add(
                Transaction(
                    user_email=email,
                    type=tx_type,
                    amount_fcfa=-amount_fcfa,
                    description=description or "",
                    provider=provider or "",
                    model=model or "",
                    input_tokens=int(input_tokens or 0),
                    output_tokens=int(output_tokens or 0),
                    external_ref=(external_ref or "").strip() or None,
                )
            )

        return await get_credits(email)


async def has_credits(email: str) -> bool:
    creds = await get_credits(email)
    return float(creds.get("balance_fcfa", 0) or 0) > 0
