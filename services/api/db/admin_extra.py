"""
db/admin_extra.py — Requêtes du panneau admin : journal d'audit, filtres, statistiques,
corrections de solde, comptes admin.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_, select, update

from db.base import get_sessionmaker, _utcnow, _model_to_dict
from db.models import Admin, AdminAudit, Credits, PaymentIntent, Transaction, UsageRecord, User
from db.password import hash_password

ADMIN_ROLES = ("owner", "admin", "support", "readonly")


def _iso(v: Any) -> Any:
    return v.isoformat() if hasattr(v, "isoformat") else v


# ============================================================================
# JOURNAL D'AUDIT
# ============================================================================

async def record_audit(admin_email: str, action: str, target: str = "", details: str = "", ip: str = "") -> None:
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            session.add(AdminAudit(
                admin_email=(admin_email or "")[:255],
                action=(action or "")[:64],
                target=(target or "")[:255],
                details=(details or "")[:2000],
                ip=(ip or "")[:64],
            ))


async def list_audit(limit: int = 100, offset: int = 0, admin_email: str = "", action: str = "", target: str = "") -> Dict[str, Any]:
    Session = get_sessionmaker()
    async with Session() as session:
        where = []
        if admin_email:
            where.append(AdminAudit.admin_email.ilike(f"%{admin_email.strip()}%"))
        if action:
            where.append(AdminAudit.action == action.strip())
        if target:
            where.append(AdminAudit.target.ilike(f"%{target.strip()}%"))
        total = int((await session.execute(select(func.count(AdminAudit.id)).where(*where))).scalar() or 0)
        rows = (await session.scalars(
            select(AdminAudit).where(*where).order_by(AdminAudit.created_at.desc(), AdminAudit.id.desc())
            .limit(limit).offset(offset)
        )).all()
        return {"entries": [_model_to_dict(r) for r in rows], "total": total}


# ============================================================================
# LISTES FILTRÉES
# ============================================================================

async def list_transactions(limit: int = 100, offset: int = 0, email: str = "", tx_type: str = "") -> Dict[str, Any]:
    Session = get_sessionmaker()
    async with Session() as session:
        where = []
        if email:
            where.append(Transaction.user_email.ilike(f"%{email.strip().lower()}%"))
        if tx_type and tx_type != "all":
            where.append(Transaction.type == tx_type)
        total = int((await session.execute(select(func.count(Transaction.id)).where(*where))).scalar() or 0)
        sums = (await session.execute(
            select(
                func.coalesce(func.sum(Transaction.amount_fcfa).filter(Transaction.amount_fcfa > 0), 0).label("credited"),
                func.coalesce(func.sum(Transaction.amount_fcfa).filter(Transaction.amount_fcfa < 0), 0).label("debited"),
            ).where(*where)
        )).mappings().first() or {}
        rows = (await session.scalars(
            select(Transaction).where(*where).order_by(Transaction.created_at.desc(), Transaction.id.desc())
            .limit(limit).offset(offset)
        )).all()
        return {
            "transactions": [_model_to_dict(r) for r in rows],
            "total": total,
            "sum_credited": float(sums.get("credited") or 0),
            "sum_debited": float(sums.get("debited") or 0),
        }


async def list_usage(limit: int = 100, offset: int = 0, email: str = "", model: str = "", task_type: str = "") -> Dict[str, Any]:
    Session = get_sessionmaker()
    async with Session() as session:
        where = []
        if email:
            where.append(UsageRecord.user_email.ilike(f"%{email.strip().lower()}%"))
        if model:
            where.append(UsageRecord.model == model)
        if task_type:
            if task_type == "anomalies":
                where.append(or_(UsageRecord.task_type == "billing_failed", UsageRecord.task_type.like("%estimated")))
            else:
                where.append(UsageRecord.task_type == task_type)
        total = int((await session.execute(select(func.count(UsageRecord.id)).where(*where))).scalar() or 0)
        sums = (await session.execute(
            select(
                func.coalesce(func.sum(UsageRecord.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(UsageRecord.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("cost_fcfa"),
            ).where(*where)
        )).mappings().first() or {}
        rows = (await session.scalars(
            select(UsageRecord).where(*where).order_by(UsageRecord.created_at.desc(), UsageRecord.id.desc())
            .limit(limit).offset(offset)
        )).all()
        return {
            "usage": [_model_to_dict(r) for r in rows],
            "total": total,
            "sum_input_tokens": int(sums.get("input_tokens") or 0),
            "sum_output_tokens": int(sums.get("output_tokens") or 0),
            "sum_cost_fcfa": float(sums.get("cost_fcfa") or 0),
        }


async def list_payments(status: str = "all", email: str = "", limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    Session = get_sessionmaker()
    async with Session() as session:
        where = []
        if status and status != "all":
            where.append(PaymentIntent.status == status)
        if email:
            where.append(PaymentIntent.user_email.ilike(f"%{email.strip().lower()}%"))
        total = int((await session.execute(select(func.count(PaymentIntent.id)).where(*where))).scalar() or 0)
        amount = float((await session.execute(
            select(func.coalesce(func.sum(PaymentIntent.amount_fcfa), 0)).where(*where))).scalar() or 0)
        rows = (await session.scalars(
            select(PaymentIntent).where(*where).order_by(PaymentIntent.created_at.desc()).limit(limit).offset(offset)
        )).all()
        counts_rows = await session.execute(
            select(PaymentIntent.status, func.count(PaymentIntent.id)).group_by(PaymentIntent.status))
        counts = {s: int(c) for s, c in counts_rows.all()}
        return {"payment_intents": [_model_to_dict(r) for r in rows], "total": total,
                "sum_amount_fcfa": amount, "counts": counts}


async def cancel_payment_intent(intent_id: str) -> Dict[str, Any]:
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            intent = await session.scalar(
                select(PaymentIntent).where(PaymentIntent.id == (intent_id or "").strip()).with_for_update())
            if not intent:
                raise ValueError("Demande introuvable")
            if intent.status != "pending":
                raise ValueError(f"Seule une demande en attente peut être annulée (statut : {intent.status})")
            intent.status = "cancelled"
            intent.updated_at = _utcnow()
            return _model_to_dict(intent)


# ============================================================================
# STATISTIQUES
# ============================================================================

def _rate(part, total) -> float:
    total = int(total or 0)
    return round(int(part or 0) / total, 4) if total > 0 else 0.0


async def extra_stats() -> Dict[str, Any]:
    """Compléments du tableau de bord : paiements en attente, dettes, recharges récentes."""
    cutoff_30d = _utcnow() - timedelta(days=30)
    Session = get_sessionmaker()
    async with Session() as session:
        pending = (await session.execute(
            select(func.count(PaymentIntent.id), func.coalesce(func.sum(PaymentIntent.amount_fcfa), 0))
            .where(PaymentIntent.status == "pending"))).one()
        debts = (await session.execute(
            select(func.count(Credits.id), func.coalesce(func.sum(Credits.balance_fcfa), 0))
            .where(Credits.balance_fcfa < 0))).one()
        funded = int((await session.execute(
            select(func.count(Credits.id)).where(Credits.balance_fcfa > 0))).scalar() or 0)
        recharged_30d = float((await session.execute(
            select(func.coalesce(func.sum(Transaction.amount_fcfa), 0))
            .where(Transaction.type == "recharge", Transaction.created_at >= cutoff_30d))).scalar() or 0)
        bonus_30d = float((await session.execute(
            select(func.coalesce(func.sum(Transaction.amount_fcfa), 0))
            .where(Transaction.type == "bonus", Transaction.created_at >= cutoff_30d))).scalar() or 0)
        cache_row = (await session.execute(
            select(func.coalesce(func.sum(UsageRecord.cached_input_tokens), 0),
                   func.coalesce(func.sum(UsageRecord.input_tokens), 0))
            .where(UsageRecord.created_at >= cutoff_30d))).one()
        anomalies_30d = int((await session.execute(
            select(func.count(UsageRecord.id)).where(
                UsageRecord.created_at >= cutoff_30d,
                or_(UsageRecord.task_type == "billing_failed", UsageRecord.task_type.like("%estimated")),
            ))).scalar() or 0)
        return {
            "payments_pending": {"count": int(pending[0] or 0), "amount_fcfa": float(pending[1] or 0)},
            "debts": {"count": int(debts[0] or 0), "amount_fcfa": float(debts[1] or 0)},
            "funded_users": funded,
            "recharged_30d": recharged_30d,
            "bonus_30d": bonus_30d,
            "billing_anomalies_30d": anomalies_30d,
            # Part des jetons d'entrée servis par le cache DeepSeek (0 à 1)
            "cache_rate_30d": _rate(cache_row[0], cache_row[1]),
        }


async def daily_series(days: int = 30) -> List[Dict[str, Any]]:
    """Par jour : requêtes IA, jetons, consommation facturée, recharges et nouveaux comptes."""
    days = max(1, min(days, 365))
    start = (_utcnow() - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    Session = get_sessionmaker()
    async with Session() as session:
        u_day = func.date(UsageRecord.created_at)
        usage_rows = (await session.execute(
            select(u_day.label("d"), func.count(UsageRecord.id),
                   func.coalesce(func.sum(UsageRecord.input_tokens + UsageRecord.output_tokens), 0),
                   func.coalesce(func.sum(UsageRecord.cost_fcfa), 0))
            .where(UsageRecord.created_at >= start).group_by(u_day))).all()
        t_day = func.date(Transaction.created_at)
        rech_rows = (await session.execute(
            select(t_day.label("d"), func.coalesce(func.sum(Transaction.amount_fcfa), 0))
            .where(Transaction.created_at >= start, Transaction.type == "recharge").group_by(t_day))).all()
        n_day = func.date(User.created_at)
        user_rows = (await session.execute(
            select(n_day.label("d"), func.count(User.id)).where(User.created_at >= start).group_by(n_day))).all()

    def key(d: Any) -> str:
        return str(d)[:10]

    usage = {key(d): (int(n), int(t), float(c)) for d, n, t, c in usage_rows}
    rech = {key(d): float(a) for d, a in rech_rows}
    users = {key(d): int(n) for d, n in user_rows}
    out = []
    for i in range(days):
        day = (start + timedelta(days=i)).date().isoformat()
        n, t, c = usage.get(day, (0, 0, 0.0))
        out.append({"day": day, "requests": n, "tokens": t, "cost_fcfa": round(c, 2),
                    "recharged_fcfa": round(rech.get(day, 0.0), 2), "new_users": users.get(day, 0)})
    return out


async def usage_breakdown(days: int = 30, limit: int = 10) -> Dict[str, Any]:
    cutoff = _utcnow() - timedelta(days=max(1, min(days, 365)))
    Session = get_sessionmaker()
    async with Session() as session:
        def grouped(col):
            return (
                select(col.label("key"), func.count(UsageRecord.id).label("requests"),
                       func.coalesce(func.sum(UsageRecord.input_tokens), 0).label("input_tokens"),
                       func.coalesce(func.sum(UsageRecord.cached_input_tokens), 0).label("cached_input_tokens"),
                       func.coalesce(func.sum(UsageRecord.output_tokens), 0).label("output_tokens"),
                       func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).label("cost_fcfa"))
                .where(UsageRecord.created_at >= cutoff).group_by(col)
                .order_by(func.coalesce(func.sum(UsageRecord.cost_fcfa), 0).desc())
            )
        by_model = (await session.execute(grouped(UsageRecord.model))).mappings().all()
        by_task = (await session.execute(grouped(UsageRecord.task_type))).mappings().all()
        top_users = (await session.execute(grouped(UsageRecord.user_email).limit(limit))).mappings().all()

    def clean(rows):
        return [{**dict(r), "cost_fcfa": round(float(r["cost_fcfa"] or 0), 2),
                 "input_tokens": int(r["input_tokens"] or 0), "output_tokens": int(r["output_tokens"] or 0),
                 "cached_input_tokens": int(r["cached_input_tokens"] or 0),
                 "cache_rate": _rate(r["cached_input_tokens"], r["input_tokens"])} for r in rows]

    return {"days": days, "by_model": clean(by_model), "by_task_type": clean(by_task), "top_users": clean(top_users)}


# ============================================================================
# COMPTES ADMIN
# ============================================================================

def _public_admin(a: Admin) -> Dict[str, Any]:
    d = _model_to_dict(a)
    d.pop("password_hash", None)
    d.pop("salt", None)
    return d


def generate_temp_password() -> str:
    return secrets.token_urlsafe(12)


async def create_admin(email: str, name: str, role: str, password: str) -> Dict[str, Any]:
    email = (email or "").strip().lower()
    if role not in ADMIN_ROLES:
        raise ValueError("Rôle invalide")
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            if await session.scalar(select(Admin.id).where(Admin.email == email)):
                raise ValueError("Un admin existe déjà avec cet e-mail")
            pw_hash, salt = hash_password(password)
            admin = Admin(email=email, name=name or email.split("@")[0], role=role, password_hash=pw_hash,
                          salt=salt, must_change_password=True, is_active=True)
            session.add(admin)
            await session.flush()
            return _public_admin(admin)


async def update_admin(admin_id: int, name: Optional[str] = None, role: Optional[str] = None,
                       is_active: Optional[bool] = None) -> Dict[str, Any]:
    updates: Dict[str, Any] = {}
    if name is not None:
        updates["name"] = name.strip()
    if role is not None:
        if role not in ADMIN_ROLES:
            raise ValueError("Rôle invalide")
        updates["role"] = role
    if is_active is not None:
        updates["is_active"] = bool(is_active)
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            admin = await session.scalar(select(Admin).where(Admin.id == int(admin_id)).with_for_update())
            if not admin:
                raise LookupError("Admin introuvable")
            removing_owner = admin.role == "owner" and admin.is_active and (
                updates.get("role", "owner") != "owner" or updates.get("is_active") is False)
            if removing_owner:
                owners = int((await session.execute(select(func.count(Admin.id)).where(
                    Admin.role == "owner", Admin.is_active.is_(True)))).scalar() or 0)
                if owners <= 1:
                    raise ValueError("Impossible : il doit rester au moins un propriétaire (owner) actif")
            for k, v in updates.items():
                setattr(admin, k, v)
            await session.flush()
            return _public_admin(admin)


async def reset_admin_password(admin_id: int) -> str:
    temp = generate_temp_password()
    pw_hash, salt = hash_password(temp)
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            res = await session.execute(update(Admin).where(Admin.id == int(admin_id)).values(
                password_hash=pw_hash, salt=salt, must_change_password=True))
            if not (res.rowcount or 0):
                raise LookupError("Admin introuvable")
    return temp


async def change_admin_email(admin_id: int, new_email: str) -> None:
    new_email = (new_email or "").strip().lower()
    if "@" not in new_email:
        raise ValueError("E-mail invalide")
    Session = get_sessionmaker()
    async with Session() as session:
        async with session.begin():
            other = await session.scalar(select(Admin.id).where(Admin.email == new_email, Admin.id != int(admin_id)))
            if other:
                raise ValueError("Cet e-mail est déjà utilisé par un autre admin")
            await session.execute(update(Admin).where(Admin.id == int(admin_id)).values(email=new_email))
