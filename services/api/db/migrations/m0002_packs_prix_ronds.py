"""
0002 — Grilles de départ à prix ronds pour les devises actives (EUR, USD, GBP, CAD,
NGN, GHS, KES, ZAR, MAD, UGX, TZS, RWF, XAF).

Données : services/currency/reference/default_packs.json (prix en unités mineures ISO,
crédits FCFA bonus compris). Une devise qui a déjà une grille n'est pas touchée.
down : retire exactement les packs ajoutés ici (même devise, même prix, même crédit),
s'ils existent encore ; une grille modifiée depuis dans l'admin est conservée.
"""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import Boolean, bindparam, text
from sqlalchemy.engine import Connection

DATA = Path(__file__).resolve().parents[2] / "services" / "currency" / "reference" / "default_packs.json"


def _load() -> dict:
    return json.loads(DATA.read_text(encoding="utf-8"))


def up(conn: Connection) -> None:
    data = _load()
    labels = data["labels"]
    known = {r[0] for r in conn.execute(text("SELECT code FROM currencies"))}
    for cur, rows in data["packs"].items():
        if cur not in known:
            continue
        if conn.execute(text("SELECT 1 FROM topup_packs WHERE currency = :c"), {"c": cur}).first():
            continue
        for i, (price_minor, credit) in enumerate(rows):
            conn.execute(text(
                "INSERT INTO topup_packs (currency, price_minor, credit_fcfa, label, sort, active,"
                " created_at, updated_at) VALUES (:c, :p, :k, :l, :s, :a, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
                .bindparams(bindparam("a", type_=Boolean())),
                {"c": cur, "p": int(price_minor), "k": int(credit),
                 "l": labels[i] if i < len(labels) else "", "s": i, "a": True})


def down(conn: Connection) -> None:
    for cur, rows in _load()["packs"].items():
        for price_minor, credit in rows:
            conn.execute(text("DELETE FROM topup_packs WHERE currency = :c AND price_minor = :p AND credit_fcfa = :k"),
                         {"c": cur, "p": int(price_minor), "k": int(credit)})
