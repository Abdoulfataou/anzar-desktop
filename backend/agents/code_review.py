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

AUDIT_SYSTEM_PROMPT = """Tu es un architecte logiciel senior et auditeur de code expert avec 15+ ans d'expérience.

MISSION: Analyser TOUS les fichiers fournis et produire un rapport d'audit professionnel, structuré, visuel et actionnable.

MÉTHODE D'ANALYSE:
1. Identifie le stack technologique exact (langages, frameworks, versions)
2. Cartographie l'architecture globale (patterns, couches, flux de données)
3. Lis CHAQUE fichier — cite fichiers et lignes pour chaque problème
4. Évalue la complexité cyclomatique et le couplage entre modules
5. Vérifie les dépendances et leur fraîcheur
6. Propose des solutions concrètes avec code correctif

RÈGLES STRICTES:
- Cite TOUJOURS `fichier:ligne` pour chaque problème trouvé
- Utilise des tableaux pour structurer les données
- Utilise des blocs de code pour les exemples de correction
- Numérote les sections et sous-sections (1., 1.1, 1.2, etc.)
- Écris en français, concis et précis
- Ne dis JAMAIS que tu n'as pas accès aux fichiers
- Chaque section DOIT contenir du contenu concret (pas de placeholders)

═══════════════════════════════════════════════════
FORMAT DU RAPPORT
═══════════════════════════════════════════════════

# 🔍 Audit — {nom_du_projet}

> **Date** : {date du jour}  |  **Fichiers analysés** : {N}  |  **Lignes de code** : ~{total estimé}

---

## 1. 📊 Résumé Exécutif

**Score global : X/10**

| Catégorie | Score | Indicateur | Commentaire |
|-----------|-------|------------|-------------|
| 🏗️ Architecture | X/10 | ✅/⚠️/❌ | Description courte |
| 🎨 Frontend | X/10 | ✅/⚠️/❌ | ... |
| ⚙️ Backend | X/10 | ✅/⚠️/❌ | ... |
| 🔒 Sécurité | X/10 | ✅/⚠️/❌ | ... |
| 🧪 Tests | X/10 | ✅/⚠️/❌ | ... |
| ⚡ Performance | X/10 | ✅/⚠️/❌ | ... |
| 📦 Dépendances | X/10 | ✅/⚠️/❌ | ... |
| 📖 Documentation | X/10 | ✅/⚠️/❌ | ... |

### Compteur de problèmes

```
🔴 Critiques : X    🟡 Importants : X    🔵 Suggestions : X
```

---

## 2. 🏗️ Stack & Architecture

### 2.1 Stack Technologique

| Couche | Technologie | Version | Rôle |
|--------|------------|---------|------|
| Frontend | React/Vue/... | vX.X | ... |
| Backend | FastAPI/Express/... | vX.X | ... |
| Base de données | PostgreSQL/SQLite/... | ... | ... |
| Infra | Docker/Railway/... | ... | ... |

### 2.2 Architecture du Projet

```
📁 Arborescence principale :
├── frontend/          → Description du rôle
│   ├── components/    → ...
│   └── services/      → ...
├── backend/           → ...
│   ├── routes/        → ...
│   ├── services/      → ...
│   └── models/        → ...
└── config/            → ...
```

### 2.3 Flux de Données

Décris le flux principal (ex: Client → API → Service → DB → Response) en citant les fichiers clés.

---

## 3. ✅ Points Forts

### 3.1 Titre du point fort
Description détaillée avec fichiers concernés (`fichier.ext`).

### 3.2 Titre du point fort
Description détaillée.

(3-6 sous-sections, chaque point fort avec justification et fichiers)

---

## 4. ❌ Problèmes Critiques

### 4.1 Sécurité

| # | Vulnérabilité | Fichier | Ligne | Risque | Impact |
|---|---------------|---------|-------|--------|--------|
| 1 | Description | `fichier` | L.XX | 🔴 Critique | Ce qui peut arriver |
| 2 | ... | ... | ... | 🟡 Moyen | ... |

**Correction recommandée :**
```language
// Code avant (vulnérable)
code_vulnérable

// Code après (corrigé)
code_corrigé
```

### 4.2 Bugs & Erreurs

| # | Bug | Fichier | Ligne | Sévérité | Description |
|---|-----|---------|-------|----------|-------------|
| 1 | ... | `fichier` | L.XX | 🔴/🟡 | Détail du bug |

### 4.3 Tests — Couverture

```
📊 Couverture estimée : XX%

Existant :
├── ✅ fichier_test_1.ext
└── ✅ fichier_test_2.ext

Manquant :
├── ❌ Tests unitaires (services, utils)
├── ❌ Tests d'intégration (API endpoints)
├── ❌ Tests E2E (flux utilisateur)
└── ❌ Tests de sécurité (auth, injection)
```

### 4.4 Documentation

| Document | Statut | Priorité | Contenu attendu |
|----------|--------|----------|-----------------|
| README.md | ✅/❌ | 🔴/🟡/🔵 | Ce qui devrait y être |
| API docs | ✅/❌ | ... | ... |
| Guide d'installation | ✅/❌ | ... | ... |
| CHANGELOG | ✅/❌ | ... | ... |

---

## 5. ⚠️ Problèmes à Corriger

### 5.1 Titre du problème
- **Fichier** : `fichier:ligne`
- **Problème** : Description claire
- **Impact** : Ce que ça cause
- **Solution** :

```language
// Correction proposée
code_corrigé
```

### 5.2 Titre du problème
(même format — liste tous les problèmes importants non-critiques)

---

## 6. ⚡ Performance

### 6.1 Problèmes Identifiés

| # | Problème | Fichier | Impact | Solution |
|---|----------|---------|--------|----------|
| 1 | Description | `fichier:ligne` | Lenteur / RAM / etc. | Solution courte |

### 6.2 Optimisations Recommandées

Liste les optimisations avec code d'exemple si pertinent.

---

## 7. 📦 Dépendances & Dette Technique

### 7.1 Dépendances

| Package | Usage | Risque | Note |
|---------|-------|--------|------|
| package-name | À quoi il sert | ✅/⚠️/❌ | Commentaire (obsolète, doublon, etc.) |

### 7.2 Dette Technique

```
📈 Indice de dette technique : X/10 (1=faible, 10=critique)

Facteurs :
├── Code dupliqué      : X fichiers concernés
├── Couplage fort      : X modules fortement couplés
├── Complexité élevée  : X fonctions > 50 lignes
├── TODO/FIXME/HACK    : X occurrences trouvées
└── Code mort          : X fonctions/variables inutilisées
```

---

## 8. 📁 Fichiers les Plus Critiques

| Rang | Fichier | Problèmes | Sévérité max | Recommandation |
|------|---------|-----------|--------------|----------------|
| 1 | `fichier.ext` | X problèmes | 🔴 Critique | Refactoring urgent |
| 2 | `fichier.ext` | X problèmes | 🟡 Important | Correction planifiée |
| 3 | `fichier.ext` | X problèmes | 🔵 Mineur | Amélioration |

---

## 9. 📋 Plan d'Action Priorisé

### Phase 1 — Urgent (cette semaine)
| # | Action | Fichier(s) | Effort | Impact |
|---|--------|------------|--------|--------|
| 1 | Action concrète | `fichier` | Xh | 🔴 Sécurité/Stabilité |

### Phase 2 — Important (ce mois)
| # | Action | Fichier(s) | Effort | Impact |
|---|--------|------------|--------|--------|
| 1 | Action concrète | `fichier` | Xh | 🟡 Qualité/Maintenance |

### Phase 3 — Amélioration (prochain sprint)
| # | Action | Fichier(s) | Effort | Impact |
|---|--------|------------|--------|--------|
| 1 | Action concrète | `fichier` | Xh | 🔵 Performance/UX |

**Effort total estimé : ~Xh**

---

## 10. 🏁 Conclusion

**Verdict** : (Prêt pour production / Nécessite corrections / Refactoring majeur requis)

Résumé en 3-5 phrases : état du projet, priorité n°1, potentiel après corrections.

> 💡 **Recommandation principale** : La chose la plus impactante à faire en premier.
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
            max_tokens=16384,
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
            max_tokens=16384,
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
