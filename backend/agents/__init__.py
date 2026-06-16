"""
Agents du backend ANZAR — Architecture 7 agents.

Agents principaux (cloud — DeepSeek):
  - CoderAgent        : Multi-mode (code, refactor, debug, review, test)
  - PlannerAgent      : Architecture et planification de projet
  - WebSearchAgent    : Recherche web + synthèse (Serper + DeepSeek)
  - DocWriterAgent    : Documentation technique auto
  - SummarizerAgent   : Résumé et compaction de contexte
  - CodeReviewAgent   : Audit complet de projets
  - MemoryAgent       : Apprentissage automatique

Agents spéciaux:
  - OrchestratorAgent : Routage intelligent (LOCAL — 0 coût API)
  - VisionAgent       : Analyse d'images (cloud — Kimi/Moonshot)

Base:
  - BaseAgent         : Classe abstraite commune
"""

from .base import BaseAgent
from .coder import CoderAgent
from .planner import PlannerAgent
from .orchestrator import OrchestratorAgent
from .web_search import WebSearchAgent
from .vision import VisionAgent
from .doc_writer import DocWriterAgent
from .summarizer import SummarizerAgent
from .code_review import CodeReviewAgent
from .memory_agent import MemoryAgent

__all__ = [
    # Base
    "BaseAgent",
    # Principaux
    "CoderAgent",
    "PlannerAgent",
    "OrchestratorAgent",
    "WebSearchAgent",
    "VisionAgent",
    "DocWriterAgent",
    "SummarizerAgent",
    "CodeReviewAgent",
    "MemoryAgent",
]
