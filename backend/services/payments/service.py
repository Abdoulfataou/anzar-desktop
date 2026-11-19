"""
services/payments/service.py — Orchestration des paiements automatiques.

Cycle d'une recharge :
  1. start_payment : demande « pending » en base → paiement créé chez le fournisseur → lien.
  2. L'utilisateur paie sur la page du fournisseur.
  3. Trois chemins mènent au même règlement (refresh_intent), le premier arrivé gagne :
       - le webhook signé du fournisseur ;
       - l'app qui interroge GET /api/payments/{id} pendant l'attente ;
       - le rattrapage périodique (reconcile_pending), si les deux autres ont échoué.
  4. refresh_intent relit le statut CHEZ le fournisseur, vérifie montant et devise,
     puis crédite une seule fois (external_ref payment:<id>).
"""
from __future__ import annotations

import logging
import uuid as _uuid
from datetime import timedelta
from typing import Any, Dict, List, Mapping, Optional

from sqlalchemy import func, select

from config import settings
from db.base import _model_to_dict, _utcnow, get_sessionmaker
from db.models import PaymentIntent, Transaction, User
from db.payments import credit_intent
from db.credits import deduct_credits
from db.users import deactivate_user
from services.payments.base import (
    PaymentError, PaymentProvider, RefundEvent, RemoteStatus, amounts_match, describe,
)
from services.payments.fedapay import FedaPayProvider
from services.payments.stripe_provider import StripeProvider

logger = logging.getLogger("anzar.payments")

PROVIDERS: Dict[str, PaymentProvider] = {
    "fedapay": FedaPayProvider(),
    "stripe": StripeProvider(),
}

MIN_FCFA = 500
MAX_FCFA = 1_000_000
MAX_PENDING_PER_HOUR = 6


def get_provider(provider_id: str) -> Optional[PaymentProvider]:
    p = PROVIDERS.get((provider_id or "").strip().lower())
    return p if p and p.enabled() else None


def list_methods() -> Dict[str, Any]:
    return {"providers": describe(PROVIDERS), "manual": bool(settings.manual_payments_enabled),
            "min_fcfa": MIN_FCFA, "max_fcfa": MAX_FCFA}


def _public(intent: PaymentIntent) -> Dict[str, Any]:
    """Vue utilisateur d'une demande (pas d'identifiants internes du fournisseur)."""
    return {"intent_id": intent.id, "status": intent.status, "provider": intent.provider,
            "amount_fcfa": float(intent.amount_fcfa), "charged_amount": float(intent.charged_amount or 0),
            "charged_currency": intent.charged_currency, "paymentUrl": intent.payment_url or None,
            "failure_reason": intent.failure_reason}


def _return_urls(intent_id: str) -> tuple[str, str]:
    base = settings.public_api_url.rstrip("/")
    return (f"{base}/api/payments/return?i={intent_id}",
            f"{base}/api/payments/return?i={intent_id}&r=cancel")


async def start_payment(user_email: str, amount_fcfa: float, provider_id: str) -> Dict[str, Any]:
    provider = get_provider(provider_id)
    if not provider:
        raise ValueError("Ce moyen de paiement n'est pas disponible")
    amount_fcfa = float(int(round(float(amount_fcfa or 0))))
    if amount_fcfa < MIN_FCFA or amount_fcfa > MAX_FCFA:
        raise ValueError(f"Montant entre {MIN_FCFA} et {MAX_FCFA:,} FCFA".replace(",", " "))
    user_email = (user_email or "").strip().lower()
    quote = provider.quote(amount_fcfa)

    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            since = _utcnow() - timedelta(hours=1)
            recent = int((await session.execute(select(func.count(PaymentIntent.id)).where(
                PaymentIntent.user_email == user_email, PaymentIntent.status == "pending",
                PaymentIntent.created_at >= since))).scalar() or 0)
            if recent >= MAX_PENDING_PER_HOUR:
                raise ValueError("Trop de paiements en attente. Termine ou annule les précédents, puis réessaie.")
            intent = PaymentIntent(
                id=_uuid.uuid4().hex, user_email=user_email, amount_fcfa=amount_fcfa,
                currency="XOF", method=provider.info.kind, status="pending",
                provider=provider.info.id, charged_amount=quote.amount,
                charged_currency=quote.currency, provider_ref="", payment_url="",
            )
            session.add(intent)
            intent_id = intent.id

    ok_url, cancel_url = _return_urls(intent_id)
    try:
        co = await provider.create_checkout(intent_id=intent_id, amount_fcfa=amount_fcfa, quote=quote,
                                            customer_email=user_email, return_url=ok_url, cancel_url=cancel_url)
    except PaymentError as e:
        await _update(intent_id, status="failed", failure_reason=str(e)[:255])
        raise

    intent = await _update(intent_id, provider_tx_id=co.tx_id, payment_url=co.payment_url)
    return _public(intent)


async def _update(intent_id: str, **fields) -> PaymentIntent:
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            intent = await session.scalar(select(PaymentIntent).where(PaymentIntent.id == intent_id).with_for_update())
            for k, v in fields.items():
                setattr(intent, k, v)
            intent.updated_at = _utcnow()
        await session.refresh(intent)
        return intent


async def _load(intent_id: str) -> Optional[PaymentIntent]:
    Session = get_sessionmaker()
    async with Session() as session:
        return await session.scalar(select(PaymentIntent).where(PaymentIntent.id == (intent_id or "").strip()))


async def get_user_intent(intent_id: str, user_email: str, refresh: bool = True) -> Optional[Dict[str, Any]]:
    intent = await _load(intent_id)
    if not intent or intent.user_email != (user_email or "").strip().lower():
        return None   # même réponse si elle n'existe pas ou appartient à un autre compte
    if refresh and intent.status == "pending" and intent.provider and intent.provider_tx_id:
        intent = await refresh_intent(intent.id) or intent
    return _public(intent)


async def apply_refund(
    intent: PaymentIntent,
    *,
    state: str = "refunded",
    amount: float = 0,
    raw_status: str = "",
    provider_payment_id: str = "",
) -> PaymentIntent:
    """Débite les crédits d'un paiement remboursé/contesté et bloque le compte.

    Idempotent : le débit porte une référence unique par paiement et le statut
    final est terminal. Un remboursement partiel débite la part correspondante
    du crédit total (bonus inclus).
    """
    state = state if state in ("refunded", "disputed") else "refunded"
    if intent.status in ("refunded", "disputed"):
        return intent
    if intent.status != "paid":
        # Rien n'a été crédité : on garde seulement la trace du statut distant.
        return await _update(intent.id, status=state, remote_status=raw_status or state,
                             failure_reason="Remboursement/litige avant crédit",
                             provider_payment_id=provider_payment_id or intent.provider_payment_id)

    Session = get_sessionmaker()
    async with Session() as session:
        credit_tx = await session.scalar(select(Transaction).where(
            Transaction.external_ref == f"payment:{intent.id}"))
        credited = abs(float(credit_tx.amount_fcfa)) if credit_tx else float(intent.amount_fcfa or 0)

    debit = credited
    if amount and intent.charged_amount:
        ratio = max(0.0, min(1.0, float(amount) / float(intent.charged_amount)))
        debit = round(credited * ratio, 2)
    debit = max(0.0, debit)

    if debit > 0:
        await deduct_credits(
            intent.user_email,
            debit,
            description=f"Remboursement/litige {intent.provider} ({raw_status or state})",
            external_ref=f"refund:{intent.id}",
            allow_negative=True,
            tx_type="refund",
            count_as_usage=False,
        )

    # Le compte est bloqué : un litige carte ne doit pas continuer à consommer.
    await deactivate_user(intent.user_email)
    logger.warning("Paiement %s remboursé/contesté (%s) : débit %.2f FCFA, compte %s bloqué",
                   intent.id, state, debit, intent.user_email)
    return await _update(
        intent.id,
        status=state,
        remote_status=raw_status or state,
        failure_reason=f"Remboursement/litige ({raw_status or state}) : compte bloqué",
        provider_payment_id=provider_payment_id or intent.provider_payment_id,
    )


async def _find_refund_intent(provider_id: str, event: RefundEvent) -> Optional[PaymentIntent]:
    Session = get_sessionmaker()
    async with Session() as session:
        if event.intent_id:
            intent = await session.scalar(select(PaymentIntent).where(
                PaymentIntent.id == event.intent_id, PaymentIntent.provider == provider_id))
            if intent:
                return intent
        if event.payment_id:
            intent = await session.scalar(select(PaymentIntent).where(
                PaymentIntent.provider == provider_id,
                PaymentIntent.provider_payment_id == event.payment_id))
            if intent:
                return intent
        if event.tx_id:
            intent = await session.scalar(select(PaymentIntent).where(
                PaymentIntent.provider == provider_id,
                PaymentIntent.provider_tx_id == event.tx_id))
            if intent:
                return intent
    return None


async def apply_remote(intent: PaymentIntent, remote: RemoteStatus) -> PaymentIntent:
    if remote.state in ("refunded", "disputed"):
        return await apply_refund(intent, state=remote.state, amount=remote.amount,
                                  raw_status=remote.raw_status,
                                  provider_payment_id=remote.provider_payment_id)
    if intent.status in ("refunded", "disputed"):
        return intent
    if intent.status == "paid":
        return intent
    if remote.state == "paid":
        cur_ok = not remote.currency or remote.currency == (intent.charged_currency or "").lower()
        if not (cur_ok and amounts_match(remote.amount, intent.charged_amount)):
            # Jamais de crédit sur un montant différent : un admin tranche
            logger.error("Paiement %s : montant %s %s ≠ attendu %s %s", intent.id, remote.amount,
                         remote.currency, intent.charged_amount, intent.charged_currency)
            return await _update(intent.id, remote_status=remote.raw_status,
                                 failure_reason="Montant reçu différent du montant facturé : à vérifier")
        await credit_intent(intent.id, intent.user_email, float(intent.amount_fcfa),
                            f"Paiement {intent.provider} confirmé", provider_ref=intent.provider_tx_id)
        return await _update(intent.id, remote_status=remote.raw_status,
                             provider_payment_id=remote.provider_payment_id or intent.provider_payment_id)
    if remote.state in ("failed", "cancelled") and intent.status == "pending":
        reason = "Paiement refusé" if remote.state == "failed" else "Paiement annulé ou expiré"
        return await _update(intent.id, status=remote.state, remote_status=remote.raw_status,
                             failure_reason=reason)
    if remote.raw_status != intent.remote_status:
        return await _update(intent.id, remote_status=remote.raw_status)
    return intent


async def refresh_intent(intent_id: str) -> Optional[PaymentIntent]:
    """Relit le statut chez le fournisseur et règle la demande. Sûr à appeler en parallèle."""
    intent = await _load(intent_id)
    if not intent or not intent.provider or not intent.provider_tx_id:
        return intent
    provider = PROVIDERS.get(intent.provider)
    if not provider or not provider.enabled():
        return intent
    try:
        remote = await provider.fetch_status(intent.provider_tx_id)
    except PaymentError as e:
        logger.warning("Statut %s indisponible pour %s: %s", intent.provider, intent.id, e)
        return intent
    return await apply_remote(intent, remote)


async def handle_webhook(provider_id: str, raw: bytes, headers: Mapping[str, str]) -> str:
    """Retourne « ok » / « ignored ». Lève SignatureError (→ 400) si la signature est mauvaise."""
    provider = PROVIDERS.get(provider_id)
    if not provider or not provider.enabled() or not provider.webhooks_enabled():
        return "disabled"

    refund = provider.webhook_refund_event(raw, headers)
    if refund:
        intent = await _find_refund_intent(provider_id, refund)
        if not intent:
            return "ignored"
        await apply_refund(
            intent,
            state=refund.state,
            amount=refund.amount,
            raw_status=refund.raw_status,
            provider_payment_id=refund.payment_id,
        )
        return "ok"

    tx_id = provider.webhook_tx_id(raw, headers)
    if not tx_id:
        return "ignored"
    Session = get_sessionmaker()
    async with Session() as session:
        intent_id = await session.scalar(select(PaymentIntent.id).where(
            PaymentIntent.provider == provider_id, PaymentIntent.provider_tx_id == tx_id))
    if not intent_id:
        return "ignored"
    await refresh_intent(intent_id)
    return "ok"


async def reconcile_pending(max_age_days: int = 3, limit: int = 50) -> int:
    """Rattrape les paiements dont le webhook n'est jamais arrivé. Retourne le nombre relu."""
    Session = get_sessionmaker()
    now = _utcnow()
    async with Session() as session:
        ids: List[str] = list((await session.scalars(select(PaymentIntent.id).where(
            PaymentIntent.status == "pending", PaymentIntent.provider != "",
            PaymentIntent.provider_tx_id != "",
            PaymentIntent.created_at >= now - timedelta(days=max_age_days),
            PaymentIntent.updated_at <= now - timedelta(minutes=2),
        ).order_by(PaymentIntent.updated_at.asc()).limit(limit))).all())
        stale = list((await session.scalars(select(PaymentIntent.id).where(
            PaymentIntent.status == "pending", PaymentIntent.provider != "",
            PaymentIntent.created_at < now - timedelta(days=max_age_days)).limit(limit))).all())
    for i in ids:
        await refresh_intent(i)
    for i in stale:
        intent = await refresh_intent(i)
        if intent and intent.status == "pending":
            await _update(i, status="cancelled", failure_reason="Expiré sans paiement confirmé")
    return len(ids) + len(stale)




__all__ = ["PROVIDERS", "get_provider", "list_methods", "start_payment", "refresh_intent",
           "handle_webhook", "reconcile_pending", "get_user_intent", "_model_to_dict"]
