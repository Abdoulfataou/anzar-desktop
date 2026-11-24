"""
Rapports d'erreurs — envoi par l'app, suivi dans l'admin, diagnostic automatique.

- POST /api/telemetry/errors            : l'app envoie des erreurs nettoyées (utilisateur connecté)
- GET/PATCH /api/admin/errors           : liste des problèmes et suivi (admin)
- GET/POST /api/agent/errors            : tâche planifiée (DeepSeek Harness) qui lit les problèmes
                                          nouveaux et dépose un diagnostic (jeton dédié)
"""
from __future__ import annotations

import hmac
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from config import settings
from db.error_reports import STATUSES, list_groups, record_reports, update_group
from routes.admin import require_admin_role
from security import get_current_user, rate_limiter

router = APIRouter(tags=["errors"])

Kind = Literal["command", "update", "tool", "crash"]
Status = Literal["new", "analysed", "fixed", "ignored"]


class ErrorReportIn(BaseModel):
    kind: Kind
    title: str = Field(..., min_length=1, max_length=200)
    detail: str = Field(default="", max_length=8000)
    app_version: str = Field(default="", max_length=32)
    os: str = Field(default="", max_length=32)


class ErrorBatchIn(BaseModel):
    reports: list[ErrorReportIn] = Field(..., min_length=1, max_length=20)


class ErrorUpdateIn(BaseModel):
    status: Optional[Status] = None
    analysis: Optional[str] = Field(default=None, max_length=20000)
    issue_url: Optional[str] = Field(default=None, max_length=500, pattern=r"^(https://github\.com/\S+)?$")
    fixed_in: Optional[str] = Field(default=None, max_length=32, pattern=r"^(\d+\.\d+\.\d+)?$")


@router.post("/api/telemetry/errors")
async def send_error_reports(body: ErrorBatchIn, user: dict = Depends(get_current_user)):
    email = user["sub"]
    await rate_limiter.check(f"telemetry:{email}", max_per_minute=10, max_per_day=300, endpoint="telemetry")
    groups = await record_reports(email, [r.model_dump() for r in body.reports])
    return {"ok": True, "groups": groups}


@router.get("/api/admin/errors")
async def admin_list_errors(
    status: Optional[Status] = None,
    limit: int = Query(100, ge=1, le=500),
    admin: dict = Depends(require_admin_role("owner", "admin", "support", "readonly")),
):
    return {"groups": await list_groups(status, limit), "statuses": list(STATUSES)}


@router.patch("/api/admin/errors/{group_id}")
async def admin_update_error(
    group_id: int,
    body: ErrorUpdateIn,
    admin: dict = Depends(require_admin_role("owner", "admin")),
):
    group = await update_group(group_id, **body.model_dump(exclude_none=True))
    if group is None:
        raise HTTPException(404, "Problème introuvable")
    return group


def _require_agent(credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False))) -> None:
    expected = settings.error_analysis_token
    if not expected:
        raise HTTPException(404, "Suivi automatique désactivé")
    given = credentials.credentials if credentials else ""
    if not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(401, "Jeton invalide")


@router.get("/api/agent/errors", dependencies=[Depends(_require_agent)])
async def agent_pending_errors(limit: int = Query(5, ge=1, le=20)):
    """Problèmes sans diagnostic, les plus répandus d'abord."""
    return {"groups": await list_groups("new", limit)}


class AgentAnalysisIn(BaseModel):
    analysis: str = Field(..., min_length=1, max_length=20000)
    issue_url: str = Field(default="", max_length=500, pattern=r"^(https://github\.com/\S+)?$")


@router.post("/api/agent/errors/{group_id}", dependencies=[Depends(_require_agent)])
async def agent_post_analysis(group_id: int, body: AgentAnalysisIn):
    """Dépôt du diagnostic : le problème passe en « analysé ». Rien n'est corrigé ni publié ici."""
    group = await update_group(group_id, status="analysed", analysis=body.analysis, issue_url=body.issue_url)
    if group is None:
        raise HTTPException(404, "Problème introuvable")
    return group
