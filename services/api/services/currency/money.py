"""
services/currency/money.py — Montants exacts : Decimal et unités mineures entières.

Aucun flottant ici. Une « unité mineure » suit la norme ISO 4217 de la devise :
0 décimale (XOF, JPY, KRW…) → 1 unité mineure = 1 unité ; 2 décimales (EUR, USD…)
→ centimes ; 3 décimales (KWD, BHD…) → millièmes.
"""
from __future__ import annotations

import json
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional, Union

DATA = Path(__file__).resolve().parent / "reference"
Number = Union[Decimal, int, str]


def D(v: Number) -> Decimal:
    return v if isinstance(v, Decimal) else Decimal(str(v))


def to_minor(amount: Number, decimals: int) -> int:
    """12.345 (2 déc.) → 1235. Arrondi commercial."""
    return int((D(amount) * (Decimal(10) ** decimals)).to_integral_value(ROUND_HALF_UP))


def from_minor(minor: int, decimals: int) -> Decimal:
    return (Decimal(int(minor)) / (Decimal(10) ** decimals)).quantize(Decimal(1).scaleb(-decimals))


def _ceil_div(a: int, b: int) -> int:
    return -((-a) // b)


def _ceil_nice(n: Decimal) -> int:
    """Plus petit nombre de la forme {1, 2, 5} × 10^k qui soit ≥ n (et ≥ 1)."""
    n = max(D(n), Decimal(1))
    k = Decimal(10) ** n.adjusted()
    for m in (1, 2, 5, 10):
        if m * k >= n:
            return int(m * k)
    return int(10 * k)  # pragma: no cover


def nice_round_up_minor(value: Number, decimals: int, granularity_minor: int = 1) -> int:
    """Prix lisible, arrondi VERS LE HAUT (jamais en dessous du coût), en unités mineures.

    Pas d'arrondi selon le premier chiffre significatif (mantisse m) :
      m < 2 → 0,05 × 10^e   ·   m < 5 → 0,1 × 10^e   ·   sinon 0,2 × 10^e
    soit au plus ~5 % au-dessus de la valeur exacte. Exemples :
      8,34 $ → 8,40 $   ·   16,67 $ → 17,00 $   ·   12 345 ₦ → 12 500 ₦   ·   0,734 KWD → 0,740 KWD

    granularity_minor : contrainte du fournisseur (ex. 10 pour les devises à
    3 décimales chez Stripe, 100 pour ISK/UGX en unités « Stripe »).
    """
    v = D(value)
    if v <= 0:
        raise ValueError("montant à arrondir ≤ 0")
    e = v.adjusted()
    mantissa = v.scaleb(-e)
    s = Decimal("0.05") if mantissa < 2 else Decimal("0.1") if mantissa < 5 else Decimal("0.2")
    step_minor = _ceil_nice(s.scaleb(e) * (Decimal(10) ** decimals))
    g = max(1, int(granularity_minor))
    if step_minor % g:
        step_minor = _ceil_div(step_minor, g) * g
    v_minor = int((v * (Decimal(10) ** decimals)).to_integral_value(ROUND_CEILING))
    return _ceil_div(v_minor, step_minor) * step_minor


def ceil_to_granularity(minor: int, granularity_minor: int = 1) -> int:
    g = max(1, int(granularity_minor))
    return _ceil_div(int(minor), g) * g


@lru_cache(maxsize=1)
def iso_table() -> Dict[str, dict]:
    rows = json.loads((DATA / "iso4217.json").read_text(encoding="utf-8"))["currencies"]
    return {r["code"]: r for r in rows}


@lru_cache(maxsize=1)
def country_currencies() -> Dict[str, str]:
    return json.loads((DATA / "country_currency.json").read_text(encoding="utf-8"))["countries"]


@lru_cache(maxsize=1)
def fixed_parities() -> dict:
    return json.loads((DATA / "fixed_parities.json").read_text(encoding="utf-8"))


def currency_for_country(country: Optional[str]) -> Optional[str]:
    return country_currencies().get((country or "").strip().upper()) if country else None


def norm_code(code: Optional[str]) -> str:
    c = (code or "").strip().upper()
    return c if len(c) == 3 and c.isalpha() else ""
