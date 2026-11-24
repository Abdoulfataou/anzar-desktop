"""Outils partagés du suivi des erreurs (bibliothèque standard uniquement)."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]          # dépôt ANZAR
TRAVAIL = RACINE / ".erreurs"                          # ignoré par git
A_ANALYSER = TRAVAIL / "a-analyser"
ANALYSES = TRAVAIL / "analyses"
ENVOYES = TRAVAIL / "envoyes"
# Hors du dépôt : l'agent n'a pas besoin du jeton, seuls les scripts le lisent.
CONFIG = Path.home() / ".anzar-erreurs" / "config.json"
API_PAR_DEFAUT = "https://anzar-api.issalanhub.com"


def config() -> dict:
    if not CONFIG.exists():
        sys.exit(f"Configuration absente ({CONFIG}). Lance d'abord : python3 scripts/erreurs/configurer.py")
    data = json.loads(CONFIG.read_text(encoding="utf-8"))
    if not data.get("token"):
        sys.exit("Jeton absent de la configuration. Relance : python3 scripts/erreurs/configurer.py")
    data.setdefault("api", API_PAR_DEFAUT)
    return data


def appel(methode: str, chemin: str, corps: dict | None = None) -> dict:
    c = config()
    req = urllib.request.Request(
        c["api"].rstrip("/") + chemin,
        method=methode,
        data=json.dumps(corps).encode("utf-8") if corps is not None else None,
        headers={"Authorization": f"Bearer {c['token']}", "Content-Type": "application/json",
                 "User-Agent": "anzar-suivi-erreurs"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        if e.code == 404 and chemin.startswith("/api/agent/errors") and methode == "GET":
            sys.exit("Le serveur n'a pas le suivi des erreurs activé (ERROR_ANALYSIS_TOKEN vide ou serveur pas à jour).")
        if e.code == 401:
            sys.exit("Jeton refusé : il doit être identique à ERROR_ANALYSIS_TOKEN sur le serveur.")
        sys.exit(f"Erreur du serveur ({e.code}) : {e.read().decode('utf-8', 'replace')[:300]}")
    except urllib.error.URLError as e:
        sys.exit(f"Serveur injoignable : {e.reason}")


def dossiers() -> None:
    for d in (A_ANALYSER, ANALYSES, ENVOYES):
        d.mkdir(parents=True, exist_ok=True)
