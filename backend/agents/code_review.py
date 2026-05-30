"""
Agent d'Audit de Code — Analyse approfondie et structurée de projets entiers.

Utilise DeepSeek V4 Pro pour une analyse multi-sections:
  - Architecture et structure du projet
  - Qualité du code et bonnes pratiques
  - Bugs potentiels et problèmes
  - Sécurité
  - Performance
  - Recommandations prioritaires
"""

import logging
from typing import Dict, Any, List, Optional

from .base import BaseAgent, MODEL_PRO

logger = logging.getLogger(__name__)
_NL = "\n"

# ────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT — Audit expert complet
# ────────────────────────────────────────────────────────────────────────────

AUDIT_SYSTEM_PROMPT = """Tu es un architecte logiciel senior et auditeur de code avec 20 ans d'expérience.
Tu réalises des audits de code PROFESSIONNELS et DÉTAILLÉS.

MISSION: Analyser en profondeur TOUS les fichiers fournis et produire un rapport d'audit structuré.

MÉTHODE D'ANALYSE:
1. D'abord, identifie le STACK TECHNOLOGIQUE exact (langages, frameworks, versions, dépendances)
2. Comprends l'ARCHITECTURE globale (patterns, structure dossiers, flux de données)
3. Lis CHAQUE FICHIER attentivement — ne survole pas
4. Identifie les problèmes CONCRETS avec des références aux fichiers et lignes
5. Propose des solutions ACTIONABLES, pas des conseils génériques

IMPORTANT:
- Tu as accès à TOUS les fichiers du projet ci-dessous. Lis-les TOUS.
- Cite TOUJOURS les fichiers et lignes concernés quand tu signales un problème.
- Sois PRÉCIS: pas de "il pourrait y avoir des problèmes", mais "dans fichier X, ligne Y, le problème est Z".
- Ne dis JAMAIS que tu n'as pas accès aux fichiers — ils sont tous fournis.
- Adapte ton niveau de détail à la taille du projet.

FORMAT DU RAPPORT (Markdown):

# 🔍 Audit du Projet — {nom_du_projet}

## 📋 Résumé Exécutif
Score global: X/10
Résumé en 3-4 lignes de l'état du projet.

## 🏗️ Architecture & Stack
- Stack technologique identifié
- Structure des dossiers et organisation
- Patterns architecturaux utilisés (MVC, Clean Architecture, etc.)
- Points forts et faiblesses de l'architecture

## ✅ Points Forts
Ce qui est bien fait dans le projet (minimum 3 points).

## 🐛 Bugs & Problèmes Critiques
Problèmes qui cassent ou risquent de casser l'application.
Format: `fichier:ligne` — description du problème — solution proposée.

## ⚠️ Qualité du Code
- Lisibilité et conventions de nommage
- Duplication de code (DRY)
- Complexité des fonctions
- Gestion d'erreurs
- Types et validation

## 🔒 Sécurité
- Injections (SQL, XSS, etc.)
- Gestion des secrets et credentials
- Validation des entrées utilisateur
- Permissions et authentification

## ⚡ Performance
- Requêtes N+1 ou appels réseau inutiles
- Fuites mémoire potentielles
- Optimisations manquées
- Lazy loading et cache

## 📝 Recommandations Prioritaires
Liste ordonnée des 5-10 actions les plus importantes, par priorité décroissante.
Chaque recommandation avec: priorité (🔴 critique / 🟡 important / 🟢 suggestion), fichier(s) concerné(s), action concrète.
"""

CHUNK_ANALYSIS_PROMPT = """Tu es un auditeur de code expert. Analyse ce lot de fichiers d'un projet plus large.

Contexte du projet:
{project_context}

Analyse ces fichiers et retourne un JSON avec:
{{
  "issues": [
    {{"file": "path", "line": "N", "severity": "critical|warning|info", "category": "bug|security|performance|quality", "description": "...", "suggestion": "..."}}
  ],
  "strengths": ["..."],
  "stack_details": ["..."],
  "architecture_notes": "..."
}}

Sois PRÉCIS et CONCRET. Cite les fichiers et lignes."""


class CodeReviewAgent(BaseAgent):
    """Agent d'audit de code approfondi pour projets entiers."""

    # Max chars per chunk for multi-pass analysis
    CHUNK_SIZE = 80_000  # ~20K tokens per chunk
    # Threshold: above this many files, use multi-pass
    MULTI_PASS_THRESHOLD = 80

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="code_review",
            role="audit",
            description="Audit de code approfondi — architecture, bugs, sécurité, performance",
            deepseek_client=deepseek_client,
        )

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Exécute un audit complet du projet.

        Args:
            request: {
                "project_name": str,
                "files": dict[path, content],
                "focus": str | None  — focus spécifique (ex: "sécurité")
            }

        Returns:
            {"report": str (markdown), "tokens_used": int, "model": str}
        """
        project_name = request.get("project_name", "Projet")
        files = request.get("files", {})
        focus = request.get("focus")

        if not files:
            return {
                "report": f"# Audit — {project_name}\n\nAucun fichier fourni pour l'audit.",
                "tokens_used": 0,
                "model": "",
            }

        num_files = len(files)
        logger.info(f"[CodeReview] Audit de '{project_name}' — {num_files} fichiers")

        if num_files > self.MULTI_PASS_THRESHOLD:
            report = await self._multi_pass_audit(project_name, files, focus)
        else:
            report = await self._single_pass_audit(project_name, files, focus)

        return {
            "report": report,
            "tokens_used": self.tokens_used,
            "model": self.model_used,
        }

    async def _single_pass_audit(
        self, project_name: str, files: Dict[str, str], focus: Optional[str] = None
    ) -> str:
        """Audit en une seule passe — pour projets < 80 fichiers."""

        files_content = self._format_files(files)

        focus_instruction = ""
        if focus:
            focus_instruction = f"\n\nFOCUS SPÉCIFIQUE DEMANDÉ: {focus}\nAccorde une attention particulière à ce sujet tout en couvrant les autres aspects.\n"

        user_prompt = f"""Voici le projet "{project_name}" avec {len(files)} fichiers à auditer.
{focus_instruction}
══════ FICHIERS DU PROJET ══════

{files_content}

══════ FIN DES FICHIERS ══════

Produis un rapport d'audit complet et détaillé en Markdown selon le format demandé.
Cite systématiquement les fichiers et lignes quand tu identifies un problème."""

        model = self.resolve_model(MODEL_PRO)
        logger.info(f"[CodeReview] Single-pass audit avec {model}")

        report = await self.call_deepseek(
            messages=[
                {"role": "system", "content": AUDIT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            model=model,
            temperature=0.3,
            max_tokens=8192,
        )

        return report

    async def _multi_pass_audit(
        self, project_name: str, files: Dict[str, str], focus: Optional[str] = None
    ) -> str:
        """Audit multi-passe pour gros projets (>80 fichiers).

        Pass 1: Analyse par chunks → collecte des issues
        Pass 2: Synthèse finale → rapport structuré
        """
        logger.info(f"[CodeReview] Multi-pass audit — {len(files)} fichiers")

        # Build project structure overview
        structure = "Structure:\n" + "\n".join(f"  {p}" for p in sorted(files.keys()))

        # Split files into chunks
        chunks = self._chunk_files(files)
        logger.info(f"[CodeReview] Découpé en {len(chunks)} chunks")

        # Pass 1: Analyze each chunk
        chunk_results = []
        model = self.resolve_model(MODEL_PRO)

        for i, chunk in enumerate(chunks):
            logger.info(f"[CodeReview] Chunk {i+1}/{len(chunks)}")

            chunk_content = self._format_files(chunk)
            prompt = CHUNK_ANALYSIS_PROMPT.format(project_context=structure)

            result = await self.call_deepseek(
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": f"Fichiers (lot {i+1}/{len(chunks)}):\n\n{chunk_content}"},
                ],
                model=model,
                temperature=0.3,
                max_tokens=4096,
            )
            chunk_results.append(result)

        # Pass 2: Synthesize into final report
        synthesis_prompt = f"""Tu as analysé le projet "{project_name}" ({len(files)} fichiers) en {len(chunks)} lots.
Voici les résultats de chaque lot:

{_NL.join("--- Lot {} ---{}{}{}".format(i+1, _NL, r, _NL) for i, r in enumerate(chunk_results))}

{f"FOCUS SPÉCIFIQUE: {focus}" if focus else ""}

Produis maintenant le rapport d'audit FINAL et COMPLET en Markdown selon le format standard.
Fusionne et déduplique les issues. Priorise les problèmes critiques."""

        report = await self.call_deepseek(
            messages=[
                {"role": "system", "content": AUDIT_SYSTEM_PROMPT},
                {"role": "user", "content": synthesis_prompt},
            ],
            model=model,
            temperature=0.3,
            max_tokens=8192,
        )

        return report

    def _format_files(self, files: Dict[str, str]) -> str:
        """Formate les fichiers pour le prompt."""
        parts = []
        for path, content in sorted(files.items()):
            # Truncate very large files (>500 lines) with note
            lines = content.split("\n")
            if len(lines) > 500:
                truncated = "\n".join(lines[:500])
                parts.append(f"── {path} ({len(lines)} lignes, tronqué à 500) ──\n{truncated}\n[... {len(lines)-500} lignes restantes ...]\n")
            else:
                parts.append(f"── {path} ──\n{content}\n")
        return "\n".join(parts)

    def _chunk_files(self, files: Dict[str, str]) -> List[Dict[str, str]]:
        """Découpe les fichiers en chunks de ~CHUNK_SIZE chars."""
        chunks: List[Dict[str, str]] = []
        current_chunk: Dict[str, str] = {}
        current_size = 0

        for path, content in sorted(files.items()):
            entry_size = len(path) + len(content) + 20
            if current_size + entry_size > self.CHUNK_SIZE and current_chunk:
                chunks.append(current_chunk)
                current_chunk = {}
                current_size = 0
            current_chunk[path] = content
            current_size += entry_size

        if current_chunk:
            chunks.append(current_chunk)

        return chunks
