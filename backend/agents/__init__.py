"""
Agents du backend ANZAR — Architecture 4 agents actifs.

Agents principaux (cloud — DeepSeek):
  - CoderAgent        : Multi-mode (code, refactor, debug, review, test)
  - PlannerAgent      : Architecture et planification de projet
  - CodeReviewAgent   : Audit complet de projets

Agents spéciaux:
  - VisionAgent       : Analyse d'images (cloud — Kimi/Moonshot)

Base:
  - BaseAgent         : Classe abstraite commune
"""

from .base import BaseAgent
from .coder import CoderAgent
from .planner import PlannerAgent
from .vision import VisionAgent
from .code_review import CodeReviewAgent

__all__ = [
    # Base
    "BaseAgent",
    # Principaux
    "CoderAgent",
    "PlannerAgent",
    "VisionAgent",
    "CodeReviewAgent",
]
