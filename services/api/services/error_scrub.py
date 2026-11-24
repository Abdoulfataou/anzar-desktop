"""
Nettoyage et empreinte des rapports d'erreurs envoyés par l'app.

L'app nettoie déjà avant l'envoi ; le serveur repasse derrière (défense en profondeur) :
aucun chemin personnel, aucune clé, aucun e-mail ne doit être stocké.
"""
from __future__ import annotations

import hashlib
import re

MAX_SAMPLE = 4000

_SECRETS = [
    # Clés et jetons connus (préfixes), JWT, en-têtes d'autorisation, paires clé=valeur sensibles.
    (re.compile(r"\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{12,}\b"), "<clé>"),
    (re.compile(r"\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}\b"), "<clé>"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "<clé>"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"), "<jeton>"),
    (re.compile(r"(?i)(authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._~+/=-]{12,}"), r"\1 <jeton>"),
    (re.compile(r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\b(\s*[:=]\s*)(\"[^\"]*\"|'[^']*'|\S+)"), r"\1\2<masqué>"),
    (re.compile(r"(?i)(https?://)[^/\s:@]+:[^/\s@]+@"), r"\1<identifiants>@"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "<e-mail>"),
]
_HOME = [
    (re.compile(r"/Users/[^/\s]+"), "~"),
    (re.compile(r"/home/[^/\s]+"), "~"),
    (re.compile(r"(?i)[A-Z]:\\Users\\[^\\\s]+"), "~"),
]


def scrub(text: str, limit: int = MAX_SAMPLE) -> str:
    """Retire chemins personnels, clés, jetons et e-mails ; borne la longueur."""
    out = str(text or "")
    for pattern, repl in _HOME:
        out = pattern.sub(repl, out)
    for pattern, repl in _SECRETS:
        out = pattern.sub(repl, out)
    out = out.replace("\x00", "")
    return out[-limit:] if len(out) > limit else out


_VOLATILE = [
    (re.compile(r"\b[0-9a-f]{7,}\b", re.I), "#"),          # empreintes, identifiants
    (re.compile(r"\b\d+(\.\d+)*\b"), "N"),                   # nombres, versions, durées
    (re.compile(r"(['\"]).*?\1"), "'…'"),                     # valeurs citées
    (re.compile(r"\s+"), " "),
]


def _normalize(text: str) -> str:
    out = text.lower()
    for pattern, repl in _VOLATILE:
        out = pattern.sub(repl, out)
    return out.strip()


def _signature_line(detail: str) -> str:
    """Première ligne d'erreur parlante (là où se trouve la cause), sinon la dernière."""
    lines = [l.strip() for l in detail.splitlines() if l.strip()]
    for line in lines:
        if re.search(r"(?i)error|erreur|exception|failed|échec|introuvable|not found|denied|refus", line):
            return line
    return lines[-1] if lines else ""


def fingerprint(kind: str, title: str, detail: str) -> str:
    """Même problème → même empreinte, quelles que soient les valeurs variables."""
    base = "|".join([kind, _normalize(title), _normalize(_signature_line(detail))])
    return hashlib.sha256(base.encode("utf-8")).hexdigest()[:32]


def user_hash(email: str) -> str:
    """Compte des utilisateurs touchés sans stocker leur e-mail."""
    return hashlib.sha256(("anzar-err|" + email.strip().lower()).encode("utf-8")).hexdigest()[:32]
