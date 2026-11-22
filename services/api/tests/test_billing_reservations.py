"""Réservations de facturation persistées : admission atomique, TTL, règlement, redémarrage.

Les tests qui touchent la base passent par `client.portal.call` : le TestClient de
session possède l'unique boucle d'event à laquelle l'engine SQLAlchemy est rattaché
(voir conftest.py). Un `asyncio.run()` créerait une seconde boucle et casserait le pool.
"""
import asyncio
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update

import db
from db.base import _utcnow, get_sessionmaker
from db.models import CreditReservation
from services import billing


async def _seed(balance: float = 100.0, prefix: str = "res") -> str:
    """Crée un compte réel (l'admission ne lit plus de doublure en mémoire)."""
    email = f"{prefix}-{uuid.uuid4().hex[:8]}@test.local"
    await db.create_user(email)
    if balance:
        await db.add_credits(email, balance, description="test réservation")
    return email


def _run(client, scenario):
    return client.portal.call(scenario)


def test_deux_reservations_simultanees_une_seule_passe(client):
    """Deux sessions DB concurrentes : l'UPDATE conditionnel tranche, pas le _lock local."""
    async def scenario():
        email = await _seed(100.0)
        results = await asyncio.gather(
            db.reserve_credits(email, 80.0),
            db.reserve_credits(email, 80.0),
            return_exceptions=True,
        )
        assert not any(isinstance(r, Exception) for r in results), results
        gagnantes = [r for r in results if isinstance(r, int)]
        assert len(gagnantes) == 1, results
        assert results.count(None) == 1, results

        creds = await db.get_credits(email)
        assert creds["reserved_fcfa"] == 80.0
        assert creds["balance_fcfa"] == 100.0

        await db.release_reservation(email, gagnantes[0])
        creds = await db.get_credits(email)
        assert creds["reserved_fcfa"] == 0.0
        assert creds["balance_fcfa"] == 100.0

    _run(client, scenario)


def test_admission_publique_refuse_apres_redemarrage(client):
    """Nouveau process (_holds vide) : la réservation en base est toujours comptée."""
    async def scenario():
        email = await _seed(100.0)
        first = await billing.reserve(email, 80.0)

        billing._holds.clear()  # simule un redémarrage : plus aucun compteur local
        with pytest.raises(HTTPException) as exc:
            await billing.reserve(email, 80.0)
        assert exc.value.status_code == 402

        creds = await db.get_credits(email)
        assert creds["reserved_fcfa"] == 80.0
        assert creds["balance_fcfa"] == 100.0

        await billing.release(first)
        assert (await db.get_credits(email))["reserved_fcfa"] == 0.0
        assert (await db.get_credits(email))["balance_fcfa"] == 100.0

    _run(client, scenario)


def test_release_now_planifie_la_liberation_db(client):
    """release_now reste synchrone (chemins d'annulation) mais libère bien la base."""
    async def scenario():
        email = await _seed(100.0)
        res = await billing.reserve(email, 80.0)

        billing.release_now(res)  # aucun await : la libération DB est planifiée
        tasks = [t for t in billing._pending if not t.done()]
        assert tasks, "release_now doit planifier la libération en base"
        await asyncio.gather(*tasks, return_exceptions=True)

        assert res.db_released is True
        creds = await db.get_credits(email)
        assert creds["reserved_fcfa"] == 0.0
        assert creds["balance_fcfa"] == 100.0
        assert billing._active_holds(email) == 0

    _run(client, scenario)


def test_reservation_expiree_est_purgee_a_l_admission(client):
    """Une réservation orpheline de plus de RESERVATION_TTL ne bloque plus le solde."""
    async def scenario():
        email = await _seed(100.0)
        ancienne = await billing.reserve(email, 80.0)

        # Vieillit la ligne pour simuler un process tué il y a plus de 15 minutes.
        Session = get_sessionmaker()
        async with Session() as session:
            async with session.begin():
                await session.execute(
                    update(CreditReservation)
                    .where(CreditReservation.id == ancienne.reservation_id)
                    .values(created_at=_utcnow() - timedelta(seconds=billing.RESERVATION_TTL + 1))
                )

        # L'admission purge l'orpheline avant de calculer le disponible.
        nouvelle = await billing.reserve(email, 80.0)
        creds = await db.get_credits(email)
        assert creds["reserved_fcfa"] == 80.0
        assert creds["balance_fcfa"] == 100.0

        # Libérer une réservation déjà purgée est idempotent : on ne retire pas le
        # hold de la nouvelle réservation.
        await billing.release(ancienne)
        assert (await db.get_credits(email))["reserved_fcfa"] == 80.0

        await billing.release(nouvelle)
        creds = await db.get_credits(email)
        assert creds["reserved_fcfa"] == 0.0
        assert creds["balance_fcfa"] == 100.0

    _run(client, scenario)


def test_reglement_debite_et_libere_meme_en_dette(client):
    """Le débit réel et la libération sont atomiques ; le solde peut devenir négatif."""
    async def scenario():
        email = await _seed(50.0)
        res = await billing.reserve(email, 50.0)

        await billing.settle(
            res, 200.0, 0.0, "test règlement", "deepseek", "deepseek-flash",
            input_tokens=1000, output_tokens=2000, duration_ms=5, task_type="test",
        )

        creds = await db.get_credits(email)
        assert creds["reserved_fcfa"] == 0.0
        assert creds["balance_fcfa"] == pytest.approx(-150.0)
        assert creds["total_used"] == pytest.approx(200.0)
        assert billing._active_holds(email) == 0  # slot local rendu

        # Dette : plus aucune admission tant que le solde n'est pas reconstitué.
        with pytest.raises(HTTPException) as exc:
            await billing.reserve(email, 1.0)
        assert exc.value.status_code == 402

    _run(client, scenario)


def test_compteur_de_concurrence_reste_local(client, monkeypatch):
    """Ce qui reste en RAM est le plafond de concurrence, pas la comptabilité d'argent."""
    from config import settings
    monkeypatch.setattr(settings, "max_concurrent_ai_per_user", 1)

    async def scenario():
        email = await _seed(100.0)
        first = await billing.reserve(email, 10.0)
        with pytest.raises(HTTPException) as exc:
            await billing.reserve(email, 10.0)
        assert exc.value.status_code == 429

        await billing.release(first)
        second = await billing.reserve(email, 10.0)  # slot local rendu
        await billing.release(second)

    _run(client, scenario)


def test_agregat_egal_somme_des_lignes_de_reservation(client):
    """Invariant : reserved_fcfa est exactement la somme des holds actifs."""
    async def scenario():
        email = await _seed(100.0)
        r1 = await db.reserve_credits(email, 30.0)
        r2 = await db.reserve_credits(email, 20.0)

        Session = get_sessionmaker()
        async with Session() as session:
            total = await session.scalar(
                select(func.coalesce(func.sum(CreditReservation.amount_fcfa), 0.0))
                .where(CreditReservation.user_email == email)
            )
        creds = await db.get_credits(email)
        assert float(total) == 50.0
        assert creds["reserved_fcfa"] == 50.0

        await db.release_reservation(email, r1)
        await db.release_reservation(email, r2)
        assert (await db.get_credits(email))["reserved_fcfa"] == 0.0

    _run(client, scenario)


def test_repli_sans_delete_returning(client, monkeypatch):
    """SQLite < 3.35 : libération et purge doivent fonctionner sans `DELETE ... RETURNING`.

    Le repli lit puis supprime dans la même transaction (écrivain SQLite unique) : le
    montant réservé doit revenir à zéro comme avec le chemin RETURNING.
    """
    import db.credits as credits

    monkeypatch.setattr(credits, "supports_returning", lambda: False)

    async def scenario():
        email = await _seed(100.0)

        # Libération ciblée.
        rid = await credits.reserve_credits(email, 40.0)
        assert rid is not None
        assert (await db.get_credits(email))["reserved_fcfa"] == 40.0
        assert await credits.release_reservation(email, rid) == 40.0
        assert (await db.get_credits(email))["reserved_fcfa"] == 0.0
        # Deuxième libération : idempotente.
        assert await credits.release_reservation(email, rid) == 0.0

        # Purge TTL : une réservation expirée est libérée.
        rid2 = await credits.reserve_credits(email, 30.0)
        assert rid2 is not None
        Session = get_sessionmaker()
        async with Session() as session:
            async with session.begin():
                await session.execute(
                    update(CreditReservation)
                    .where(CreditReservation.id == rid2)
                    .values(created_at=_utcnow() - timedelta(minutes=20))
                )
        liberated = await credits.purge_expired_reservations(60, email=email)
        assert liberated == 30.0
        assert (await db.get_credits(email))["reserved_fcfa"] == 0.0
        assert (await db.get_credits(email))["balance_fcfa"] == 100.0

    _run(client, scenario)
