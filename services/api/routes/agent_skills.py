"""
AGENT SKILLS — /api/agent/skills
Skills d'ANZAR servies par le serveur : améliorées sans republier l'app, et absentes du code
de l'application installée. Réservées aux comptes connectés. L'app garde une copie locale et
ne retélécharge que si le contenu a changé (ETag → 304).
"""
import hashlib
import re
from pathlib import Path
from typing import Dict, List, Tuple

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from security import get_current_user

router = APIRouter(prefix="/api/agent", tags=["agent"])

SKILLS_DIR = Path(__file__).resolve().parent.parent / "agent_skills"
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")

_cache: Tuple[float, List[Dict[str, str]], str] | None = None


def _frontmatter(text: str) -> Tuple[Dict[str, str], str]:
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.S)
    if not m:
        return {}, text
    meta: Dict[str, str] = {}
    for line in m.group(1).splitlines():
        k, sep, v = line.partition(":")
        if sep and k.strip() in ("name", "description"):
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, text[m.end():]


def load_skills() -> Tuple[List[Dict[str, str]], str]:
    """Lit les skills (relues seulement si un fichier a changé). Retourne (skills, etag)."""
    global _cache
    files = sorted(SKILLS_DIR.glob("*/SKILL.md")) if SKILLS_DIR.is_dir() else []
    stamp = sum(f.stat().st_mtime for f in files) + len(files)
    if _cache and _cache[0] == stamp:
        return _cache[1], _cache[2]
    skills: List[Dict[str, str]] = []
    digest = hashlib.sha256()
    for f in files:
        raw = f.read_text(encoding="utf-8")
        meta, _ = _frontmatter(raw)
        name = meta.get("name") or f.parent.name
        if not NAME_RE.match(name) or not meta.get("description"):
            continue
        skills.append({"name": name, "description": meta["description"], "markdown": raw})
        digest.update(raw.encode("utf-8"))
    etag = '"' + digest.hexdigest()[:32] + '"'
    _cache = (stamp, skills, etag)
    return skills, etag


@router.get("/skills")
async def agent_skills(request: Request, user: dict = Depends(get_current_user)):
    skills, etag = load_skills()
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse({"version": etag.strip('"')[:12], "skills": skills}, headers=headers)
