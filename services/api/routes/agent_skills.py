"""
AGENT SKILLS — /api/agent/skills
Skills d'ANZAR servies par le serveur : améliorées sans republier l'app, et absentes du code
de l'application installée. Réservées aux comptes connectés. L'app garde une copie locale et
ne retélécharge que si le contenu a changé (ETag → 304).

Une skill peut joindre des fichiers texte (references/, modeles/, LICENSE…) : ils sont servis
dans « files » ({chemin relatif: contenu}) et lus par l'agent seulement à la demande
(load_skill avec file). Une app qui ne connaît pas ce champ l'ignore et garde le SKILL.md.
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

# Fichiers joints : texte seulement, mêmes limites que l'app (MAX_SKILL_FILE_CHARS, MAX_FILES_PER_SKILL)
FILE_EXTS = {".md", ".html", ".txt", ".svg", ".css", ".json"}
FILE_NAMES = {"LICENSE", "NOTICE"}
MAX_FILE_CHARS = 40_000
MAX_FILES = 60

_cache: Tuple[float, List[Dict[str, object]], str] | None = None


def _attached(skill_dir: Path) -> List[Path]:
    """Fichiers joints d'une skill, triés, sans SKILL.md ni fichiers cachés (3 niveaux au plus)."""
    out: List[Path] = []
    for f in sorted(skill_dir.rglob("*")):
        rel = f.relative_to(skill_dir)
        if not f.is_file() or f.is_symlink() or len(rel.parts) > 4:
            continue
        if any(p.startswith(".") for p in rel.parts) or rel.as_posix().lower() == "skill.md":
            continue
        if f.suffix.lower() in FILE_EXTS or f.name in FILE_NAMES:
            out.append(f)
    return out[:MAX_FILES]


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


def load_skills() -> Tuple[List[Dict[str, object]], str]:
    """Lit les skills (relues seulement si un fichier a changé). Retourne (skills, etag)."""
    global _cache
    files = sorted(SKILLS_DIR.glob("*/SKILL.md")) if SKILLS_DIR.is_dir() else []
    attached = {f: _attached(f.parent) for f in files}
    every = files + [a for lst in attached.values() for a in lst]
    stamp = sum(f.stat().st_mtime for f in every) + len(every)
    if _cache and _cache[0] == stamp:
        return _cache[1], _cache[2]
    skills: List[Dict[str, object]] = []
    digest = hashlib.sha256()
    for f in files:
        raw = f.read_text(encoding="utf-8")
        meta, _ = _frontmatter(raw)
        name = meta.get("name") or f.parent.name
        if not NAME_RE.match(name) or not meta.get("description"):
            continue
        joined: Dict[str, str] = {}
        for a in attached[f]:
            try:
                text = a.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if len(text) <= MAX_FILE_CHARS:
                joined[a.relative_to(f.parent).as_posix()] = text
        skills.append({"name": name, "description": meta["description"], "markdown": raw, "files": joined})
        digest.update(raw.encode("utf-8"))
        for rel, text in joined.items():
            digest.update(b"\0" + rel.encode("utf-8") + b"\0" + text.encode("utf-8"))
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
