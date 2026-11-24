#!/usr/bin/env python3
"""Une seule fois : crée le jeton du suivi des erreurs et l'enregistre sur ce Mac.

    python3 scripts/erreurs/configurer.py

Affiche la ligne à ajouter au .env du serveur (ERROR_ANALYSIS_TOKEN=…).
Relancer réutilise le jeton existant.
"""
import json
import os
import secrets

from commun import API_PAR_DEFAUT, CONFIG

CONFIG.parent.mkdir(parents=True, exist_ok=True)
os.chmod(CONFIG.parent, 0o700)
data = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
if not data.get("token"):
    data["token"] = secrets.token_urlsafe(32)
data.setdefault("api", API_PAR_DEFAUT)
CONFIG.write_text(json.dumps(data, indent=2), encoding="utf-8")
os.chmod(CONFIG, 0o600)
print(f"✓ Configuration : {CONFIG} (serveur {data['api']})")
print("Ajoute cette ligne au .env du serveur, puis redémarre l'API :")
print(f"ERROR_ANALYSIS_TOKEN={data['token']}")
