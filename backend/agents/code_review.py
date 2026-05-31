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

AUDIT_SYSTEM_PROMPT = """Tu es un architecte logiciel senior et auditeur de code expert.

MISSION: Analyser TOUS les fichiers et produire un rapport d'audit professionnel, structuré et visuel.

MÉTHODE:
1. Identifie le stack technologique exact
2. Comprends l'architecture globale
3. Lis CHAQUE fichier — cite fichiers et lignes pour chaque problème
4. Propose des solutions concrètes

RÈGLES:
- Cite TOUJOURS `fichier:ligne` pour chaque problème
- Utilise des tableaux pour structurer les données (problèmes, tests, docs)
- Utilise des blocs de code pour les exemples de correction
- Numérote les sections et sous-sections (1., 1.1, 1.2, etc.)
- Écris en français, concis et précis
- Ne dis JAMAIS que tu n'as pas accès aux fichiers

FORMAT DU RAPPORT:

# Audit — {nom_du_projet}

## 1. Résumé Exécutif

Score global: **X/10**

| Couche | Qualité | Description |
|--------|---------|-------------|
| Architecture | ✅ Bon / ⚠️ Moyen / ❌ Faible | Description courte |
| Frontend | ✅/⚠️/❌ ... | ... |
| Backend | ✅/⚠️/❌ ... | ... |
| Sécurité | ✅/⚠️/❌ ... | ... |
| Tests | ✅/⚠️/❌ ... | ... |
| Performance | ✅/⚠️/❌ ... | ... |

## 2. ✅ Points Forts

### 2.1 Titre du point fort
Description avec fichiers concernés.

### 2.2 Titre du point fort
Description avec fichiers concernés.

(3-5 sous-sections)

## 3. ❌ Ce qui Manque (Critique)

### 3.1 Sécurité — Problèmes Critiques

| Problème | Fichier | Risque |
|----------|---------|--------|
| Description | `fichier:ligne` | 🔴 Critique / 🟡 Moyen |

### 3.2 Tests — Couverture Insuffisante

```
Actuel : X fichiers de test
Manquant :
├── Tests unitaires (services, contrôleurs)
├── Tests d'intégration
└── Tests E2E
```

### 3.3 Documentation — Absente

| Document | Statut | Priorité |
|----------|--------|----------|
| README.md | ❌ Absent | 🔴 Critique |
| API docs | ❌ Absent | 🔴 Critique |
| Guide install | ❌ Absent | 🟡 Moyenne |

## 4. ⚠️ Problèmes à Corriger

### 4.1 Titre du problème
- **`fichier:ligne`** — Description du problème
- **Correction** : Explication de la solution

```language
// Exemple de code corrigé si pertinent
```

### 4.2 Titre du problème
(même format)

## 5. Performance

Analyse des problèmes de performance avec fichiers et solutions.

## 6. 📋 Plan d'Action

| # | Action | Priorité | Fichier(s) | Effort |
|---|--------|----------|------------|--------|
| 1 | Action concrète | 🔴 Critique | `fichier` | Xh |
| 2 | Action concrète | 🟡 Important | `fichier` | Xh |
| 3 | Action concrète | 🟢 Suggestion | `fichier` | Xh |
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
