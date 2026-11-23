"""
services/payments/routing.py — Quel fournisseur pour quelle devise et quel pays.

Un fournisseur est retenu s'il est actif (clé présente) et déclare la devise.
Ordre : d'abord ceux qui déclarent le pays de l'utilisateur, puis ceux qui
servent partout, puis les autres ; à égalité, la priorité déclarée.
"""
from __future__ import annotations

from typing import List

from services.payments.base import PaymentProvider


def providers_for(currency: str, country: str = "") -> List[PaymentProvider]:
    from services.payments.service import PROVIDERS

    cur, country = (currency or "").upper(), (country or "").upper()
    found = [p for p in PROVIDERS.values() if p.enabled() and p.supports(cur)]
    return sorted(found, key=lambda p: (p.country_rank(country), p.info.priority, p.info.id))
