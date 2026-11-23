"""
0001 — Multidevise : devises, taux d'affichage, packs par devise, réglages de prix.

up   : crée les tables (si absentes), ajoute les colonnes users/payment_intents,
       charge la liste ISO 4217, les parités fixes, les réglages par défaut et la
       grille XOF actuelle (mêmes packs et bonus qu'aujourd'hui). N'écrase jamais
       une valeur déjà présente (relance sans risque).
down : supprime exactement ce que up a ajouté. Le grand livre (credits,
       transactions) n'est jamais touché.
"""
from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from sqlalchemy import Boolean, Numeric, bindparam, inspect, text
from sqlalchemy.engine import Connection

DATA = Path(__file__).resolve().parents[2] / "services" / "currency" / "reference"

NEW_TABLES = ["topup_packs", "fx_rates", "fx_fetch_log", "pricing_settings", "currencies"]

NEW_COLUMNS = {
    "users": [("preferred_currency", "VARCHAR(3)", None)],
    "payment_intents": [
        ("charged_amount_minor", "BIGINT", None),
        ("fx_rate_used", "NUMERIC(24, 10)", None),
        ("pack_id", "INTEGER", None),
        ("pricing_source", "VARCHAR(16)", "''"),
        ("customer_country", "VARCHAR(2)", "''"),
    ],
}

DEFAULT_SETTINGS = {
    "margin_pct": "3",             # marge de change sur les prix calculés
    "max_daily_change_pct": "25",  # variation d'un taux au-delà de laquelle on n'applique pas sans admin
    "max_rate_age_days": "7",      # au-delà, les prix calculés de la devise sont suspendus
    "fallback_currency": "USD",    # devise de repli si aucun fournisseur n'accepte celle du client
}

# Grille XOF : prix et noms des packs de l'app actuelle. Le crédit inclut le bonus des paliers.
BASE_PACKS = [(500, "Découverte"), (2000, "Starter"), (5000, "Pro"), (15000, "Business"), (50000, "Enterprise")]


def _load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def _tables(conn: Connection) -> set:
    return set(inspect(conn).get_table_names())


def _columns(conn: Connection, table: str) -> set:
    return {c["name"] for c in inspect(conn).get_columns(table)}


def up(conn: Connection) -> None:
    from db.base import Base
    from db import models  # noqa: F401  (enregistre les modèles)
    from config import settings

    # 1) Tables — DDL généré depuis les modèles (identique en SQLite et Postgres)
    md = Base.metadata
    md.create_all(conn, tables=[md.tables[t] for t in reversed(NEW_TABLES)], checkfirst=True)

    # 2) Colonnes sur les tables existantes
    for table, cols in NEW_COLUMNS.items():
        have = _columns(conn, table)
        for name, sqltype, default in cols:
            if name in have:
                continue
            ddl = f"ALTER TABLE {table} ADD COLUMN {name} {sqltype}"
            if default is not None:
                ddl += f" NOT NULL DEFAULT {default}"
            conn.execute(text(ddl))

    # 3) Devises ISO 4217 (ajout seulement : les réglages de l'admin sont conservés)
    have = {r[0] for r in conn.execute(text("SELECT code FROM currencies"))}
    for c in _load("iso4217.json")["currencies"]:
        if c["code"] in have:
            continue
        conn.execute(text(
            "INSERT INTO currencies (code, name, symbol, decimals, active, updated_at)"
            " VALUES (:code, :name, :symbol, :decimals, :active, CURRENT_TIMESTAMP)").bindparams(
                bindparam("active", type_=Boolean())),
            {k: c[k] for k in ("code", "name", "symbol", "decimals", "active")})

    # 4) Parités fixes (toujours réimposées : ce sont des valeurs légales exactes)
    fixed = _load("fixed_parities.json")
    anchor = Decimal(fixed["per_eur"][fixed["anchor"]])
    for code, per_eur in fixed["per_eur"].items():
        rate = (anchor / Decimal(per_eur)).quantize(Decimal("1e-10"))
        conn.execute(text("DELETE FROM fx_rates WHERE currency = :c"), {"c": code})
        # Paramètres typés : Decimal pour asyncpg (Postgres), conversion automatique pour SQLite
        conn.execute(text(
            "INSERT INTO fx_rates (currency, fcfa_per_unit, source, fetched_at, is_fixed)"
            " VALUES (:c, :r, 'parite_fixe', CURRENT_TIMESTAMP, :t)").bindparams(
                bindparam("r", type_=Numeric(24, 10)), bindparam("t", type_=Boolean())),
            {"c": code, "r": rate, "t": True})

    # 5) Réglages par défaut
    have = {r[0] for r in conn.execute(text("SELECT key FROM pricing_settings"))}
    for k, v in DEFAULT_SETTINGS.items():
        if k not in have:
            conn.execute(text("INSERT INTO pricing_settings (key, value, updated_at)"
                              " VALUES (:k, :v, CURRENT_TIMESTAMP)"), {"k": k, "v": v})

    # 6) Grille XOF (seulement si aucune n'existe encore)
    if not conn.execute(text("SELECT 1 FROM topup_packs WHERE currency = 'XOF'")).first():
        for i, (price, label) in enumerate(BASE_PACKS):
            pct = settings.get_recharge_bonus_percent(price)
            credit = price + round(price * pct / 100)
            conn.execute(text(
                "INSERT INTO topup_packs (currency, price_minor, credit_fcfa, label, sort, active,"
                " created_at, updated_at) VALUES ('XOF', :p, :c, :l, :s, :a, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
                .bindparams(bindparam("a", type_=Boolean())),
                {"p": price, "c": credit, "l": label, "s": i, "a": True})


def down(conn: Connection) -> None:
    present = _tables(conn)
    for t in NEW_TABLES:   # ordre : dépendants d'abord
        if t in present:
            conn.execute(text(f"DROP TABLE {t}"))
    for table, cols in NEW_COLUMNS.items():
        have = _columns(conn, table)
        for name, _, _ in cols:
            if name in have:
                conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {name}"))
