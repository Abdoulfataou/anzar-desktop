"""
services/billing.py — Facturation sûre des appels payants.

Principe : aucun appel payant ne part sans que son coût maximal soit couvert par le solde.

1. Avant l'appel : on RÉSERVE le coût maximal (entrée estimée + sortie plafonnée). Les
   réservations vivent en base (`credits.reserved_fcfa`), pas en RAM : deux workers ou un
   redéploiement glissant ne peuvent pas engager deux fois le même solde. Le plafond de
   sortie (max_tokens) est réduit à ce que le disponible peut payer.
2. Après l'appel : on DÉBITE le coût réel, même s'il dépasse le solde (le solde devient
   négatif : c'est une dette, et toute nouvelle requête est refusée jusqu'à la recharge).
   Un dépassement ne peut donc jamais devenir de l'usage gratuit.
3. La réservation est toujours libérée, même si le client coupe la connexion.

Le dictionnaire `_holds` ne porte plus aucun montant : il ne sert qu'au compteur de
concurrence **local au processus** (plafond `max_concurrent_ai_per_user`). La somme qui
compte pour l'admission est `credits.reserved_fcfa`, partagée entre workers.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, Optional

from fastapi import HTTPException

from config import settings
from security import calculate_cost_fcfa

logger = logging.getLogger("anzar.billing")

MAX_OUTPUT_TOKENS = 16384      # plafond de sortie absolu par requête
MIN_OUTPUT_TOKENS = 256        # en dessous, la requête n'a pas de sens : refusée
THINKING_EXTRA_TOKENS = 8192   # réflexion (peut s'ajouter au plafond selon le fournisseur)
TOKENS_PER_IMAGE = 1500

RESERVATION_TTL = 15 * 60       # une réservation oubliée (bug, coupure) expire au bout de 15 min

# id(réservation) → (email, créée_le) : compteur de concurrence local uniquement.
_holds: Dict[int, tuple] = {}
_lock = asyncio.Lock()
_pending: set = set()          # tâches de débit/libération en cours (gardées en vie jusqu'au bout)

NO_CREDIT = "Solde insuffisant. Recharge ton compte pour continuer à utiliser ANZAR."


class Reservation:
    def __init__(self, email: str, amount: float, reservation_id: Optional[int] = None):
        self.email = email
        self.amount = amount
        self.reservation_id = reservation_id  # ligne credit_reservations (None dans les tests unitaires)
        self.released = False                  # slot local déjà rendu
        self.db_released = False               # ligne DB déjà supprimée (règlement/release)


async def _available(email: str) -> float:
    """Disponibilité réelle = solde - réservations actives (source de vérité : base).

    Une seule lecture de la ligne `credits` : le solde et le réservé viennent du même
    instant. L'admission reste malgré tout protégée par l'UPDATE conditionnel de
    `db.reserve_credits`, car une autre écriture peut arriver entre cette lecture et
    la réservation (c'est précisément le cas multi-worker).
    """
    import db  # import local : évite un import circulaire au chargement
    creds = await db.get_credits(email)
    return float(creds.get("balance_fcfa", 0) or 0) - float(creds.get("reserved_fcfa", 0) or 0)


def _active_holds(email: str) -> int:
    """Nombre de requêtes de cet utilisateur en cours DANS CE PROCESSUS.

    Les entrées trop vieilles sont purgées du compteur local : une requête bloquée ne
    doit pas consommer un slot de concurrence indéfiniment. La réservation DB
    correspondante est nettoyée par la purge TTL à l'admission suivante.
    """
    now = time.monotonic()
    count = 0
    for key, (owner, created) in list(_holds.items()):
        if now - created > RESERVATION_TTL:
            _holds.pop(key, None)
            continue
        if owner == email:
            count += 1
    return count


def _check_and_hold(email: str, amount: float, reservation_id: int) -> Reservation:
    res = Reservation(email, amount, reservation_id)
    _holds[id(res)] = (email, time.monotonic())
    return res


def _check_concurrency(count: int) -> None:
    if count >= max(1, int(settings.max_concurrent_ai_per_user)):
        raise HTTPException(429, "Trop de requêtes IA en même temps sur ce compte. Réessaie dans un instant.")


async def reserve(email: str, amount: float) -> Reservation:
    """Réserve un montant fixe (ex. recherche web). 402 si le disponible ne suffit pas.

    Pas de SELECT de solde avant l'UPDATE : l'admission est un seul UPDATE conditionnel
    en base, donc atomique entre workers. Le `_lock` ne sert qu'à sérialiser le compteur
    de concurrence local.
    """
    import db
    if amount <= 0:
        raise HTTPException(402, NO_CREDIT)

    async with _lock:
        _check_concurrency(_active_holds(email))
        reservation_id = await db.reserve_credits(email, amount)
        if reservation_id is None:
            raise HTTPException(402, NO_CREDIT)
        return _check_and_hold(email, amount, reservation_id)


def release_now(res: Optional[Reservation]) -> None:
    """Libère une réservation sans attendre (sûr pendant l'annulation d'une requête).

    La libération DB est planifiée : un appel synchrone ne peut pas attendre la base, et
    les chemins d'annulation (`except BaseException`, `finally` de flux) ne doivent pas
    être bloqués par un `await` supplémentaire. La tâche supprime la ligne
    `credit_reservations` ; si elle n'a pas le temps de tourner, la purge TTL la
    nettoiera à la prochaine admission. La libération est idempotente.
    """
    if res and not res.released:
        res.released = True
        _holds.pop(id(res), None)
        if not res.db_released and res.reservation_id is not None:
            _schedule_db_release(res)


def _schedule_db_release(res: Reservation) -> None:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        # Aucun appelant de production n'est dans ce cas (les routes sont async). On
        # préfère un log explicite à un `asyncio.run()` qui créerait une seconde boucle
        # et contournerait le pool SQLAlchemy : la purge TTL rattrapera la ligne.
        logger.error(
            "RELEASE_NO_LOOP user=%s reservation=%s amount=%s — purge TTL au prochain appel",
            res.email, res.reservation_id, res.amount,
        )
        return

    task = asyncio.ensure_future(_release_db(res))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _release_db(res: Reservation) -> None:
    import db
    try:
        released = await db.release_reservation(res.email, res.reservation_id)
        res.db_released = True
        if released:
            logger.debug(
                "RESERVATION_RELEASED user=%s id=%s amount=%s",
                res.email, res.reservation_id, released,
            )
    except Exception as e:
        # La purge TTL est le filet de sécurité ; on garde une trace exploitable.
        logger.error(
            "RELEASE_FAILED user=%s reservation=%s error=%s",
            res.email, res.reservation_id, e,
        )


async def release(res: Optional[Reservation]) -> None:
    """Version attendable de `release_now` (tests, arrêt propre)."""
    if not res or res.released:
        return
    res.released = True
    _holds.pop(id(res), None)
    if res.db_released or res.reservation_id is None:
        return
    import db
    try:
        await db.release_reservation(res.email, res.reservation_id)
        res.db_released = True
    except Exception as e:
        logger.error(
            "RELEASE_FAILED user=%s reservation=%s error=%s",
            res.email, res.reservation_id, e,
        )


def estimate_input_tokens(body: Dict[str, Any]) -> int:
    """Estimation prudente (surestimée) des jetons d'entrée d'une requête chat."""
    chars = 0
    images = 0
    for m in body.get("messages") or []:
        if not isinstance(m, dict):
            continue
        content = m.get("content")
        if isinstance(content, str):
            chars += len(content)
        elif isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "image_url":
                    images += 1
                else:
                    chars += len(str(part.get("text") or ""))
        chars += len(str(m.get("reasoning_content") or ""))
        if m.get("tool_calls"):
            chars += len(json.dumps(m["tool_calls"], ensure_ascii=False))
        chars += 16  # rôle + séparateurs
    if body.get("tools"):
        chars += len(json.dumps(body["tools"], ensure_ascii=False))
    return chars // 3 + images * TOKENS_PER_IMAGE + 64


def _thinking_enabled(body: Dict[str, Any]) -> bool:
    thinking = body.get("thinking")
    if isinstance(thinking, dict):
        return thinking.get("type") != "disabled"
    return bool(body.get("reasoning_effort"))


async def reserve_for_chat(email: str, provider: str, model: str, body: Dict[str, Any]) -> Reservation:
    """Réserve le coût maximal d'une requête chat et plafonne body['max_tokens'] au solde."""
    import db
    input_tokens = estimate_input_tokens(body)
    input_cost = calculate_cost_fcfa(provider, input_tokens, 0, model=model)[1]
    per_output = calculate_cost_fcfa(provider, 0, 1_000_000, model=model)[1] / 1_000_000

    requested = body.get("max_tokens") or body.get("max_completion_tokens") or MAX_OUTPUT_TOKENS
    try:
        requested = int(requested)
    except (TypeError, ValueError):
        requested = MAX_OUTPUT_TOKENS
    requested = max(MIN_OUTPUT_TOKENS, min(requested, MAX_OUTPUT_TOKENS))

    async with _lock:
        _check_concurrency(_active_holds(email))
        available = await _available(email)
        affordable = int((available - input_cost) / per_output) if per_output > 0 else requested
        if available <= 0 or affordable < MIN_OUTPUT_TOKENS:
            raise HTTPException(402, NO_CREDIT)
        max_out = min(requested, affordable)
        amount = input_cost + max_out * per_output
        if _thinking_enabled(body):
            # Réserve aussi la réflexion quand le solde le permet (sinon : dette bornée, débitée après)
            amount += max(0.0, min(available - amount, THINKING_EXTRA_TOKENS * per_output))
        reservation_id = await db.reserve_credits(email, amount)
        if reservation_id is None:
            # Le disponible a changé entre la lecture et l'UPDATE (autre worker, débit
            # concurrent) : on refuse plutôt que de dépasser le solde.
            raise HTTPException(402, NO_CREDIT)
        res = _check_and_hold(email, amount, reservation_id)

    body.pop("max_completion_tokens", None)
    body["max_tokens"] = max_out
    return res


async def _charge(res: Reservation, cost_fcfa: float, cost_usd: float, description: str,
                  provider: str, model: str, input_tokens: int, output_tokens: int,
                  duration_ms: int, task_type: str, cached_input_tokens: int = 0) -> None:
    import db
    try:
        await db.record_usage(res.email, provider, model, input_tokens, output_tokens,
                              cost_usd, cost_fcfa, duration_ms, task_type=task_type,
                              cached_input_tokens=cached_input_tokens)
        if cost_fcfa > 0:
            await db.deduct_credits(res.email, cost_fcfa, description, provider, model,
                                    input_tokens, output_tokens, allow_negative=True)
    except Exception as e:
        logger.error("BILLING_FAILED user=%s cost_fcfa=%s task=%s error=%s",
                     res.email, cost_fcfa, task_type, e)
    finally:
        # Si le débit a réussi, libère la ligne ; sinon la tâche planifiée la libère et
        # la purge TTL sert de dernier recours.
        release_now(res)


async def settle(res: Reservation, cost_fcfa: float, cost_usd: float, description: str,
                 provider: str, model: str, input_tokens: int = 0, output_tokens: int = 0,
                 duration_ms: int = 0, task_type: str = "chat", cached_input_tokens: int = 0) -> None:
    """Débite le coût réel puis libère la réservation.

    Le débit tourne dans une tâche protégée : si le client coupe la connexion pendant le
    flux (annulation de la requête), le débit va quand même jusqu'au bout.
    """
    task = asyncio.ensure_future(_charge(res, cost_fcfa, cost_usd, description, provider, model,
                                         input_tokens, output_tokens, duration_ms, task_type,
                                         cached_input_tokens))
    _pending.add(task)
    task.add_done_callback(_pending.discard)
    await asyncio.shield(task)
