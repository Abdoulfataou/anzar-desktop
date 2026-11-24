"""
db/error_reports.py — Rapports d'erreurs de l'app, regroupés par problème.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from db.base import get_sessionmaker, _utcnow
from db.models import ErrorGroup, ErrorGroupUser
from services.error_scrub import fingerprint, scrub, user_hash

STATUSES = ("new", "analysed", "fixed", "ignored")


def _version_key(v: str) -> tuple:
    parts = []
    for p in (v or "").split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts)


def _to_dict(g: ErrorGroup) -> dict:
    return {
        "id": g.id,
        "fingerprint": g.fingerprint,
        "kind": g.kind,
        "title": g.title,
        "sample": g.sample,
        "count": g.count,
        "users": g.users,
        "last_version": g.last_version,
        "last_os": g.last_os,
        "status": g.status,
        "analysis": g.analysis,
        "issue_url": g.issue_url,
        "fixed_in": g.fixed_in,
        "first_seen": g.first_seen.isoformat() if g.first_seen else None,
        "last_seen": g.last_seen.isoformat() if g.last_seen else None,
    }


async def record_reports(email: str, reports: list[dict]) -> int:
    """Enregistre des rapports (déjà validés) ; renvoie le nombre de problèmes touchés."""
    uh = user_hash(email)
    touched: set[int] = set()
    async_session = get_sessionmaker()
    async with async_session() as session:
        for r in reports:
            title = scrub(r["title"], 200)
            detail = scrub(r.get("detail") or "")
            fp = fingerprint(r["kind"], title, detail)
            version = (r.get("app_version") or "")[:32]
            group = (await session.execute(select(ErrorGroup).where(ErrorGroup.fingerprint == fp))).scalar_one_or_none()
            if group is None:
                group = ErrorGroup(fingerprint=fp, kind=r["kind"], title=title, count=0, users=0)
                session.add(group)
                await session.flush()
            group.count += 1
            group.sample = detail
            group.last_seen = _utcnow()
            group.last_os = (r.get("os") or "")[:32]
            if version and _version_key(version) >= _version_key(group.last_version):
                group.last_version = version
            # Problème marqué corrigé qui revient dans une version ≥ correctif : à revoir.
            if group.status == "fixed" and version and group.fixed_in \
                    and _version_key(version) >= _version_key(group.fixed_in):
                group.status = "new"
            if group.id not in touched:
                try:
                    async with session.begin_nested():
                        session.add(ErrorGroupUser(group_id=group.id, user_hash=uh))
                    group.users += 1
                except IntegrityError:
                    pass
            touched.add(group.id)
        await session.commit()
    return len(touched)


async def list_groups(status: Optional[str] = None, limit: int = 100) -> list[dict]:
    async_session = get_sessionmaker()
    async with async_session() as session:
        stmt = select(ErrorGroup)
        if status:
            stmt = stmt.where(ErrorGroup.status == status)
        stmt = stmt.order_by(ErrorGroup.users.desc(), ErrorGroup.count.desc(), ErrorGroup.last_seen.desc()).limit(limit)
        return [_to_dict(g) for g in (await session.execute(stmt)).scalars().all()]


async def update_group(group_id: int, *, status: Optional[str] = None, analysis: Optional[str] = None,
                       issue_url: Optional[str] = None, fixed_in: Optional[str] = None) -> Optional[dict]:
    async_session = get_sessionmaker()
    async with async_session() as session:
        group = await session.get(ErrorGroup, group_id)
        if group is None:
            return None
        if status is not None:
            group.status = status
        if analysis is not None:
            group.analysis = analysis[:20000]
        if issue_url is not None:
            group.issue_url = issue_url[:500]
        if fixed_in is not None:
            group.fixed_in = fixed_in[:32]
        await session.commit()
        return _to_dict(group)


async def status_counts() -> dict[str, int]:
    """Nombre de problèmes par statut (onglets de l'admin)."""
    async_session = get_sessionmaker()
    async with async_session() as session:
        rows = (await session.execute(select(ErrorGroup.status, func.count()).group_by(ErrorGroup.status))).all()
    counts = {s: 0 for s in STATUSES}
    counts.update({status: int(n) for status, n in rows})
    return counts
