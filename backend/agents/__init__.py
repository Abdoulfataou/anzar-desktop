"""
Agents du backend ANZAR — Architecture 10 agents.

Agents principaux (cloud — DeepSeek):
  - CoderAgent        : Multi-mode (code, refactor, debug, review, test)
  - PlannerAgent      : Architecture et planification de projet
  - WebSearchAgent    : Recherche web + synthèse (Serper + DeepSeek)
  - DocWriterAgent    : Documentation technique auto
  - SummarizerAgent   : Résumé et compaction de contexte

Agents étudiants (cloud — DeepSeek):
  - StudentWriterAgent    : Rédaction académique
  - StudentCorrectorAgent : Correction de textes
  - StudentResearcherAgent: Recherche documentaire

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
from .student_writer import StudentWriterAgent
from .student_corrector import StudentCorrectorAgent
from .student_researcher import StudentResearcherAgent

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
    # Étudiants
    "StudentWriterAgent",
    "StudentCorrectorAgent",
    "StudentResearcherAgent",
]
