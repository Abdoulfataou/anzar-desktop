"""
Agent Codeur Multi-Mode — Le couteau suisse du développement dans ANZAR.

5 modes distincts, chacun avec un system prompt expert:
  - code     : Génération de code complet (projets, composants, scripts)
  - refactor : Refactoring intelligent avec préservation du comportement
  - debug    : Diagnostic et correction de bugs
  - review   : Revue de code avec scoring et suggestions
  - test     : Génération de tests unitaires/intégration
"""

import asyncio
import logging
import re
from typing import Dict, Any, List, Optional

from .base import BaseAgent, MODEL_PRO, MODEL_FLASH

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPTS — un par mode, blindé et complet
# ────────────────────────────────────────────────────────────────────────────

PROMPT_CODE = """Tu es un développeur full-stack senior avec 15 ans d'expérience.
Tu écris du code de PRODUCTION — pas de prototypes, pas de démos.

PRINCIPES ABSOLUS:
1. COMPLET: Chaque fichier est 100% fonctionnel. JAMAIS de "// TODO", "// à compléter",
   "...", "// rest of code", ou placeholder vide. Si tu commences un fichier, tu le finis.
2. MODERNE: ES2024+, Python 3.12+, dernières best practices. Pas de patterns obsolètes.
3. ROBUSTE: Validation des entrées, gestion d'erreurs exhaustive, edge cases couverts.
4. LISIBLE: Noms descriptifs, fonctions courtes (<30 lignes), commentaires sur le "pourquoi" pas le "quoi".
5. SÉCURISÉ: Pas d'injection SQL, pas de XSS, sanitization systématique, pas de secrets en dur.

POUR LE FRONTEND (HTML/CSS/JS/React):
- Design MODERNE et PROFESSIONNEL — gradients, ombres, animations CSS, transitions
- RESPONSIVE obligatoire — mobile-first, flexbox/grid
- Variables CSS pour couleurs/tailles (design tokens)
- Contenu RÉALISTE — pas de "Lorem ipsum", du vrai texte contextuel
- Images: https://placehold.co/WxH/hex/hex ou SVG inline
- Typographie: Google Fonts (Inter, Poppins, Playfair Display)
- Hover/focus states sur TOUS les éléments interactifs
- Accessibility: aria-labels, rôles ARIA, contraste WCAG AA

POUR LE BACKEND (Python/Node/API):
- Types complets (TypedDict, Pydantic, TypeScript strict)
- Logging structuré à chaque étape critique
- Retry logic sur les appels réseau
- Rate limiting et validation des payloads
- Docstrings complètes (Args, Returns, Raises)

FORMAT DE SORTIE — chaque fichier comme:
```language
// Chemin: filepath
[code complet]
```"""

PROMPT_REFACTOR = """Tu es un architecte logiciel expert en refactoring.
Ta mission: transformer du code existant en code propre SANS changer le comportement.

PRINCIPES DE REFACTORING:
1. PRÉSERVER LE COMPORTEMENT: Le code refactoré doit produire exactement les mêmes résultats.
   Aucune fonctionnalité ne doit être ajoutée, retirée, ou modifiée.
2. AMÉLIORER LA STRUCTURE:
   - Extraire les fonctions longues (>30 lignes) en sous-fonctions nommées
   - Éliminer la duplication (DRY) — identifier les patterns répétés
   - Appliquer le Single Responsibility Principle
   - Réduire la complexité cyclomatique (max 10 par fonction)
3. MODERNISER:
   - Remplacer les patterns obsolètes par des équivalents modernes
   - Utiliser les fonctionnalités du langage (destructuring, optional chaining, etc.)
   - Types stricts partout
4. NOMMER CORRECTEMENT:
   - Variables: ce qu'elles contiennent, pas comment elles sont utilisées
   - Fonctions: verbe + objet (calculateTotal, validateEmail, formatDate)
   - Constantes: UPPER_SNAKE_CASE
5. DOCUMENTER LES CHANGEMENTS:
   - Liste chaque modification avec le "pourquoi"
   - Identifie les risques potentiels

FORMAT DE SORTIE:
```language
// Chemin: filepath
[code refactoré complet]
```

Suivi d'un résumé:
## Changements effectués
- [Changement 1]: [Raison]
- [Changement 2]: [Raison]

## Risques identifiés
- [Risque éventuel]"""

PROMPT_DEBUG = """Tu es un expert en debugging avec une approche méthodique et scientifique.
Tu diagnostiques les bugs comme un médecin diagnostique une maladie: symptômes → hypothèses → tests → diagnostic → traitement.

MÉTHODOLOGIE DE DIAGNOSTIC:
1. COMPRENDRE LE SYMPTÔME:
   - Qu'est-ce qui se passe exactement? (message d'erreur, comportement inattendu)
   - Quand ça se produit? (toujours, aléatoire, conditions spécifiques)
   - Depuis quand? (après quel changement)

2. ANALYSER LE CONTEXTE:
   - Lire le code impliqué ligne par ligne
   - Tracer le flux de données (d'où vient chaque variable)
   - Identifier les dépendances (imports, APIs, BDD)

3. FORMULER DES HYPOTHÈSES:
   - Lister les 3-5 causes possibles par ordre de probabilité
   - Pour chaque hypothèse, expliquer pourquoi elle pourrait causer le symptôme

4. DIAGNOSTIQUER:
   - Identifier LA cause racine (pas le symptôme)
   - Expliquer la chaîne causale complète

5. CORRIGER:
   - Fournir le fix exact avec le code corrigé
   - Expliquer pourquoi ce fix résout le problème
   - Mentionner les effets de bord possibles

FORMAT DE SORTIE:
## Diagnostic
**Symptôme**: [description]
**Cause racine**: [explication]
**Chaîne causale**: [A → B → C → bug]

## Correction
```language
// Chemin: filepath
[code corrigé]
```

## Prévention
- [Comment éviter ce type de bug à l'avenir]"""

PROMPT_REVIEW = """Tu es un tech lead exigeant qui fait des code reviews de niveau FAANG.
Tu évalues le code sur 6 axes avec un scoring /100.

AXES D'ÉVALUATION:
1. CORRECTION (0-20): Le code fait-il ce qu'il est censé faire?
   - Bugs logiques, edge cases manqués, off-by-one errors
   - Gestion d'erreurs incomplète

2. SÉCURITÉ (0-20): Le code est-il sûr?
   - Injections (SQL, XSS, command), sanitization
   - Secrets en dur, permissions trop larges
   - Validation des entrées utilisateur

3. PERFORMANCE (0-15): Le code est-il performant?
   - Complexité algorithmique (O(n²) évitable?)
   - Requêtes N+1, boucles inutiles
   - Fuites mémoire, goroutines/promesses non gérées

4. MAINTENABILITÉ (0-15): Le code est-il maintenable?
   - Lisibilité, nommage, complexité cyclomatique
   - DRY, Single Responsibility
   - Tests associés

5. ARCHITECTURE (0-15): L'architecture est-elle bonne?
   - Séparation des responsabilités
   - Couplage/cohésion
   - Extensibilité

6. STYLE (0-15): Le code suit-il les conventions?
   - Formatting, indentation, conventions du langage
   - Commentaires utiles (pas de noise)
   - Cohérence avec le reste du projet

FORMAT DE SORTIE — JSON strict:
{
    "score": 75,
    "grade": "B",
    "axes": {
        "correction": {"score": 18, "max": 20, "issues": ["..."]},
        "securite": {"score": 12, "max": 20, "issues": ["..."]},
        "performance": {"score": 13, "max": 15, "issues": ["..."]},
        "maintenabilite": {"score": 10, "max": 15, "issues": ["..."]},
        "architecture": {"score": 12, "max": 15, "issues": ["..."]},
        "style": {"score": 10, "max": 15, "issues": ["..."]}
    },
    "critical_issues": ["Issues bloquantes à corriger impérativement"],
    "suggestions": ["Améliorations recommandées"],
    "verdict": "Résumé en 2 phrases: qualité globale + action recommandée"
}

Grading: A (90-100) = Excellent, B (75-89) = Bon, C (60-74) = Acceptable, D (40-59) = Insuffisant, F (<40) = Rejet"""

PROMPT_ITERATE = """Tu es un développeur senior qui travaille sur un projet existant.
L'utilisateur te demande de MODIFIER son projet. Tu as DÉJÀ accès à tous les fichiers du projet —
ils sont fournis ci-dessous. Tu n'as PAS besoin de demander le code à l'utilisateur.

TON RÔLE:
- Tu LIS les fichiers du projet fournis dans le contexte
- Tu COMPRENDS la demande de modification de l'utilisateur
- Tu MODIFIES les fichiers concernés selon sa demande
- Tu retournes les fichiers modifiés EN ENTIER (pas juste le diff)

RÈGLES ABSOLUES:
1. NE DEMANDE JAMAIS à l'utilisateur de coller du code — tu l'as déjà
2. Retourne UNIQUEMENT les fichiers que tu as modifiés (pas les fichiers inchangés)
3. Chaque fichier modifié doit être COMPLET (tout le code, pas de "..." ou "// reste du code")
4. Préserve tout le code existant non concerné par la modification
5. Respecte le style, les conventions et le design system du projet existant
6. Si la modification touche le style (couleurs, layout, etc.), modifie le CSS/style correspondant
7. Si la modification implique une nouvelle fonctionnalité, ajoute le HTML + CSS + JS nécessaire

FORMAT DE SORTIE — pour chaque fichier modifié:
```language
// Chemin: filepath
[code complet du fichier modifié]
```

Ne retourne que les blocs de code des fichiers modifiés. Pas d'explication avant ou après, sauf si l'utilisateur pose une question."""

PROMPT_PATCH = """Tu es un développeur senior qui corrige des erreurs dans un projet existant.
Tu reçois des erreurs de lint/compilation structurées avec le fichier et la ligne exacte.

TON RÔLE:
- Tu LIS les erreurs fournies (fichier, ligne, message)
- Tu LIS le code du projet fourni dans le contexte
- Tu CORRIGES chaque erreur avec un patch SEARCH/REPLACE minimal

FORMAT DE SORTIE — pour chaque correction:
<<<PATCH
FILE: chemin/du/fichier.ts
SEARCH:
[lignes exactes du code original à remplacer — copie EXACTE, espaces et indentation inclus]
REPLACE:
[lignes corrigées qui remplacent le bloc SEARCH]
>>>

RÈGLES:
1. Le bloc SEARCH doit correspondre EXACTEMENT au code existant (même espaces, même indentation)
2. Inclus suffisamment de contexte autour de l'erreur pour que le match soit unique
3. Un PATCH par correction (plusieurs patchs possibles pour un même fichier)
4. Ne corrige QUE ce qui cause l'erreur, pas de refactoring
5. Si un import manque, ajoute-le avec un patch au début du fichier
6. Si tu ne peux pas patcher (fichier trop modifié), retourne le fichier complet au format classique:
   ```language
   // Chemin: filepath
   [code complet]
   ```"""

PROMPT_TEST = """Tu es un ingénieur QA expert en testing automatisé.
Tu écris des tests qui PROUVENT que le code fonctionne — pas des tests qui passent toujours.

PRINCIPES DE TESTING:
1. COUVERTURE COMPLÈTE:
   - Happy path (cas normal)
   - Edge cases (limites, valeurs vides, nulls, listes vides)
   - Error cases (exceptions, erreurs réseau, données invalides)
   - Boundary values (min, max, zéro, négatif)

2. STRUCTURE AAA:
   - Arrange: préparer les données et mocks
   - Act: exécuter l'action testée
   - Assert: vérifier le résultat

3. TESTS INDÉPENDANTS:
   - Chaque test s'exécute seul, sans dépendance d'ordre
   - Setup/teardown pour chaque test
   - Pas d'état partagé mutable entre tests

4. NOMMAGE DESCRIPTIF:
   - test_[fonction]_[scénario]_[résultat_attendu]
   - Exemple: test_calculate_total_empty_cart_returns_zero

5. MOCKING INTELLIGENT:
   - Mock uniquement les dépendances externes (BDD, API, filesystem)
   - Ne jamais mocker la logique testée
   - Vérifier les appels aux mocks (called_with, call_count)

FRAMEWORKS PAR LANGAGE:
- Python: pytest + pytest-asyncio + pytest-mock
- JavaScript/TypeScript: vitest ou jest + @testing-library
- React: @testing-library/react + vitest

FORMAT DE SORTIE:
```language
// Chemin: tests/test_[module].py (ou .test.ts)
[tests complets]
```"""


# ────────────────────────────────────────────────────────────────────────────
# AGENT
# ────────────────────────────────────────────────────────────────────────────

class CoderAgent(BaseAgent):
    """Agent codeur multi-mode: code, refactor, debug, review, test."""

    # Registry des modes et leurs prompts
    MODES = {
        "code": PROMPT_CODE,
        "refactor": PROMPT_REFACTOR,
        "iterate": PROMPT_ITERATE,
        "patch": PROMPT_PATCH,
        "debug": PROMPT_DEBUG,
        "review": PROMPT_REVIEW,
        "test": PROMPT_TEST,
    }

    # Températures optimales par mode
    MODE_TEMPERATURES = {
        "code": 0.5,       # Créatif mais déterministe
        "refactor": 0.3,   # Très déterministe — on ne veut pas de surprises
        "iterate": 0.4,    # Équilibre entre respect du contexte et créativité
        "patch": 0.2,      # Ultra-précis — corrections chirurgicales
        "debug": 0.3,      # Analytique et précis
        "review": 0.2,     # Évaluation objective
        "test": 0.4,       # Un peu de créativité pour les edge cases
    }

    # Max tokens par mode — V4 supporte 384K output, on utilise 32-64K pour qualité/coût
    MODE_MAX_TOKENS = {
        "code": 32000,       # ~800-1000 lignes de code par batch
        "code_complex": 48000,  # Pour fichiers complexes (API, DB, auth)
        "refactor": 32000,   # Refactoring avec contexte complet
        "iterate": 32000,   # Itérations sur projet existant
        "patch": 8000,       # Corrections ciblées — petits diffs
        "debug": 8000,
        "review": 4000,
        "test": 12000,
    }

    # Model tier par mode — Pro pour la qualité, Flash pour la vitesse
    MODE_MODEL_TIER = {
        "code": MODEL_PRO,       # Génération de projet: qualité maximale
        "refactor": MODEL_FLASH, # Refactoring: rapide et économique
        "iterate": MODEL_FLASH,  # Itérations: rapidité prioritaire (interactif)
        "patch": MODEL_FLASH,    # Patch: rapide et économique
        "debug": MODEL_PRO,      # Debug: précision critique
        "review": MODEL_PRO,     # Review: évaluation approfondie
        "test": MODEL_FLASH,     # Tests: patterns répétitifs, Flash suffit
    }

    # Nombre de fichiers par batch — moins = plus de détail par fichier
    CODE_BATCH_SIZE = 6

    # Nombre de batches à exécuter en parallèle (après le 1er batch séquentiel)
    MAX_PARALLEL_BATCHES = 3

    # Seuil pour considérer un fichier comme tronqué (se termine sans fermer les blocs)
    TRUNCATION_MARKERS = ["// ...", "/* ...", "# ...", "...", "// TODO", "// rest"]

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="coder",
            role="Développeur Senior Multi-Mode",
            description="Génère, refactorise, débugge, review et teste du code",
            deepseek_client=deepseek_client,
        )

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Point d'entrée unique — route vers le bon mode.

        Args:
            request: {
                "mode": "code" | "refactor" | "debug" | "review" | "test",
                # ── Mode "code" (génération projet) ──
                "architecture": dict,
                "plan": dict,
                "project_name": str,
                # ── Modes "refactor" / "debug" / "review" / "test" ──
                "code": str,           # Code source à traiter
                "language": str,       # Langage du code
                "context": str,        # Contexte additionnel (message utilisateur, erreur, etc.)
                "file_path": str,      # Chemin du fichier (optionnel)
            }

        Returns:
            Dict avec "status", "result", et des champs spécifiques au mode.
        """
        mode = request.get("mode", "code")

        if mode not in self.MODES:
            return {
                "status": "error",
                "error": f"Mode inconnu: {mode}. Modes disponibles: {list(self.MODES.keys())}",
                "tokens_used": self.tokens_used,
            }

        logger.info(f"[{self.name}] Mode: {mode}")

        dispatch = {
            "code": self._execute_code,
            "refactor": self._execute_single,
            "iterate": self._execute_single,
            "patch": self._execute_single,
            "debug": self._execute_single,
            "review": self._execute_review,
            "test": self._execute_single,
        }

        handler = dispatch[mode]
        return await handler(request, mode)

    # ────────────────── Mode CODE (génération projet par batch) ──────────────

    async def _execute_code(self, request: Dict[str, Any], mode: str) -> Dict[str, Any]:
        """Génère le code source d'un projet complet par batch de fichiers.

        Stratégie d'exécution:
        1. Le 1er batch est exécuté seul (fournit le contexte de base).
        2. Les batches suivants sont lancés en parallèle (max MAX_PARALLEL_BATCHES
           simultanés) avec la liste des fichiers déjà générés pour la cohérence.
        """
        architecture = request.get("architecture", {})
        plan = request.get("plan", {})
        project_name = request.get("project_name", "project")

        logger.info(f"[{self.name}] Génération code: {project_name}")

        files_to_generate = architecture.get("structure", {}).get("files", [])
        total_files = len(files_to_generate)

        if total_files == 0:
            logger.warning(f"[{self.name}] Aucun fichier à générer")
            return {
                "status": "error",
                "error": "Aucun fichier dans l'architecture",
                "files": {},
                "tokens_used": self.tokens_used,
            }

        # Découper en batches
        all_files: Dict[str, str] = {}
        batch_size = self.CODE_BATCH_SIZE
        batches = [
            files_to_generate[i : i + batch_size]
            for i in range(0, total_files, batch_size)
        ]

        # Design info
        design_info = plan.get("architecture", {}).get("design", {})
        design_context = ""
        if design_info:
            colors = design_info.get("colors", {})
            design_context = (
                f"\nDesign System:\n"
                f"- Style: {design_info.get('style', 'moderne et professionnel')}\n"
                f"- Couleur primaire: {colors.get('primary', '#3B82F6')}\n"
                f"- Couleur secondaire: {colors.get('secondary', '#8B5CF6')}\n"
                f"- Couleur accent: {colors.get('accent', '#F59E0B')}\n"
                f"- Typographie: {design_info.get('fonts', 'Inter, system-ui, sans-serif')}\n"
            )

        arch_summary = str(architecture)[:2000]
        desc_summary = str(plan.get("description", ""))[:1000]

        # ── Batch 1 : séquentiel (crée le contexte de base — fichiers fondation) ──
        first_batch = batches[0]
        first_result = await self._generate_batch(
            batch=first_batch,
            batch_idx=0,
            total_batches=len(batches),
            project_name=project_name,
            design_context=design_context,
            arch_summary=arch_summary,
            desc_summary=desc_summary,
            existing_files_context="",
        )
        all_files.update(first_result)
        logger.info(f"[{self.name}] Batch 1/{len(batches)}: {len(first_result)} fichiers")

        # ── Batches 2+ : parallèle, avec contenu réel du batch 1 en contexte ──
        remaining = batches[1:]
        if remaining:
            # Build real context from generated files (not just names)
            existing_context = self._build_files_context(all_files, max_chars=30000)

            parallel_groups = [
                remaining[i : i + self.MAX_PARALLEL_BATCHES]
                for i in range(0, len(remaining), self.MAX_PARALLEL_BATCHES)
            ]

            for group in parallel_groups:
                tasks = [
                    self._generate_batch(
                        batch=batch,
                        batch_idx=batches.index(batch),
                        total_batches=len(batches),
                        project_name=project_name,
                        design_context=design_context,
                        arch_summary=arch_summary,
                        desc_summary=desc_summary,
                        existing_files_context=existing_context,
                    )
                    for batch in group
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                for i, result in enumerate(results):
                    if isinstance(result, Exception):
                        logger.error(f"[{self.name}] Batch parallèle échoué: {result}")
                        continue
                    all_files.update(result)
                    logger.info(
                        f"[{self.name}] Batch parallèle: {len(result)} fichiers"
                    )

                # Update context with newly generated files for next group
                existing_context = self._build_files_context(all_files, max_chars=30000)

        if not all_files:
            return {
                "status": "error",
                "error": "Aucun fichier généré",
                "files": {},
                "tokens_used": self.tokens_used,
            }

        # ── Détection et correction des fichiers tronqués ──
        truncated = self._detect_truncated_files(all_files)
        if truncated:
            logger.warning(f"[{self.name}] {len(truncated)} fichier(s) tronqué(s) détecté(s), relance...")
            for path in truncated:
                try:
                    retry_result = await self._regenerate_single_file(
                        path=path,
                        description=next(
                            (f.get("description", "") for f in files_to_generate if f.get("path") == path),
                            ""
                        ),
                        project_name=project_name,
                        design_context=design_context,
                        arch_summary=arch_summary,
                        existing_files_context=self._build_files_context(
                            {k: v for k, v in all_files.items() if k != path},
                            max_chars=20000,
                        ),
                    )
                    if retry_result:
                        all_files[path] = retry_result
                        logger.info(f"[{self.name}] Fichier {path} régénéré avec succès")
                except Exception as e:
                    logger.error(f"[{self.name}] Échec retry pour {path}: {e}")

        return {
            "status": "success",
            "files": all_files,
            "count": len(all_files),
            "tokens_used": self.tokens_used,
        }

    async def _generate_batch(
        self,
        batch: List[Dict[str, Any]],
        batch_idx: int,
        total_batches: int,
        project_name: str,
        design_context: str,
        arch_summary: str,
        desc_summary: str,
        existing_files_context: str,
    ) -> Dict[str, str]:
        """Génère un seul batch de fichiers. Retourne {path: content}."""
        files_str = "\n".join(
            f"- {f.get('path')}: {f.get('description')} ({f.get('type', 'unknown')})"
            for f in batch
        )

        # Determine complexity — more files or backend = use higher token budget
        has_complex = any(
            f.get("type") in ("py", "ts", "tsx", "js", "jsx") and
            any(kw in (f.get("description") or "").lower() for kw in ["api", "auth", "database", "model", "route", "service", "middleware"])
            for f in batch
        )
        max_tokens = self.MODE_MAX_TOKENS["code_complex"] if has_complex else self.MODE_MAX_TOKENS["code"]

        context_section = ""
        if existing_files_context:
            context_section = (
                f"\n\n═══ FICHIERS DÉJÀ GÉNÉRÉS (référence pour cohérence) ═══\n"
                f"{existing_files_context}\n"
                f"═══ FIN DU CONTEXTE ═══\n\n"
                "IMPORTANT: Tes fichiers DOIVENT être cohérents avec le code ci-dessus. "
                "Utilise les mêmes noms de variables, fonctions, classes, routes, et styles."
            )

        user_message = (
            f"Génère le code source COMPLET pour ces fichiers du projet "
            f"'{project_name}' (batch {batch_idx + 1}/{total_batches}):\n\n"
            f"{files_str}\n{design_context}\n"
            f"Architecture globale: {arch_summary}\n\n"
            f"Description du projet: {desc_summary}\n"
            f"{context_section}\n\n"
            "RÈGLES CRITIQUES:\n"
            "- Chaque fichier doit être 100% COMPLET et FONCTIONNEL — JAMAIS de '...', '// TODO', '// rest of code'\n"
            "- Si un fichier est long, ÉCRIS-LE ENTIÈREMENT. Ne raccourcis JAMAIS.\n"
            "- Le design doit être MODERNE et PROFESSIONNEL\n"
            "- Utilise du contenu RÉALISTE (pas de Lorem ipsum)\n"
            "- Les imports/liens entre fichiers doivent être EXACTS et cohérents\n\n"
            "Format chaque fichier comme:\n"
            "```language\n// Chemin: filepath\n[code complet ici — AUCUNE coupure]\n```"
        )

        messages = [
            {"role": "system", "content": self.MODES["code"]},
            {"role": "user", "content": user_message},
        ]

        response = await self.call_deepseek(
            messages=messages,
            model=self.resolve_model(self.MODE_MODEL_TIER["code"]),
            temperature=self.MODE_TEMPERATURES["code"],
            max_tokens=max_tokens,
        )
        return self._extract_code_blocks(response)

    # ────────────────── Modes REFACTOR / DEBUG / TEST (single-shot) ──────────

    async def _execute_single(self, request: Dict[str, Any], mode: str) -> Dict[str, Any]:
        """Exécute un mode single-shot: refactor, debug, ou test."""
        code = request.get("code", "")
        language = request.get("language", "")
        context = request.get("context", "")
        file_path = request.get("file_path", "")

        if not code and not context:
            return {
                "status": "error",
                "error": "Aucun code ou contexte fourni",
                "tokens_used": self.tokens_used,
            }

        # Construire le message utilisateur selon le mode
        parts = []
        if file_path:
            parts.append(f"Fichier: {file_path}")
        if language:
            parts.append(f"Langage: {language}")
        if context:
            parts.append(f"Contexte: {context}")
        if code:
            parts.append(f"```{language or ''}\n{code}\n```")

        user_message = "\n\n".join(parts)

        messages = [
            {"role": "system", "content": self.MODES[mode]},
            {"role": "user", "content": user_message},
        ]

        try:
            model_tier = self.MODE_MODEL_TIER.get(mode, MODEL_FLASH)
            response = await self.call_deepseek(
                messages=messages,
                model=self.resolve_model(model_tier),
                temperature=self.MODE_TEMPERATURES[mode],
                max_tokens=self.MODE_MAX_TOKENS[mode],
            )

            return {
                "status": "success",
                "mode": mode,
                "model": self.model_used,
                "result": response,
                "tokens_used": self.tokens_used,
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur mode {mode}: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used,
            }

    # ────────────────── Mode REVIEW (retourne du JSON structuré) ─────────────

    async def _execute_review(self, request: Dict[str, Any], mode: str) -> Dict[str, Any]:
        """Exécute une code review avec scoring structuré."""
        code = request.get("code", "")
        language = request.get("language", "")
        context = request.get("context", "")
        file_path = request.get("file_path", "")

        if not code:
            return {
                "status": "error",
                "error": "Aucun code fourni pour la review",
                "tokens_used": self.tokens_used,
            }

        parts = []
        if file_path:
            parts.append(f"Fichier: {file_path}")
        if language:
            parts.append(f"Langage: {language}")
        if context:
            parts.append(f"Contexte: {context}")
        parts.append(f"```{language or ''}\n{code}\n```")

        user_message = "\n\n".join(parts)

        messages = [
            {"role": "system", "content": self.MODES["review"]},
            {"role": "user", "content": user_message},
        ]

        try:
            response = await self.call_deepseek(
                messages=messages,
                model=self.resolve_model(self.MODE_MODEL_TIER["review"]),
                temperature=self.MODE_TEMPERATURES["review"],
                max_tokens=self.MODE_MAX_TOKENS["review"],
                response_format={"type": "json_object"},
            )

            # Parser le JSON de review
            try:
                review_data = self.parse_json_response(response)
            except ValueError:
                # Fallback: renvoyer le texte brut
                review_data = {"raw_review": response}

            return {
                "status": "success",
                "mode": "review",
                "review": review_data,
                "score": review_data.get("score", 0),
                "grade": review_data.get("grade", "?"),
                "tokens_used": self.tokens_used,
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur review: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used,
            }

    # ────────────────── Extraction de blocs de code ──────────────────────────

    def _extract_code_blocks(self, response: str) -> Dict[str, str]:
        """Extrait les blocs de code de la réponse (multi-pattern, robust).

        Handles many LLM output variations:
        - // Chemin: path, <!-- Chemin: path -->, # Chemin: path
        - // File: path, // Path: path, /* path */
        - Filename as first comment line
        """
        files: Dict[str, str] = {}

        # Pattern 1: ```lang\n// Chemin: filepath\ncode```
        pattern1 = r"```(\w+)\n//\s*Chemin:\s*([^\n]+)\n(.*?)```"
        for _, filepath, code in re.findall(pattern1, response, re.DOTALL):
            files[filepath.strip()] = code.strip()

        # Pattern 2: ```lang\n<!-- Chemin: filepath -->\ncode```
        pattern2 = r"```(\w+)\n<!--\s*Chemin:\s*([^\n]+?)\s*-->\n(.*?)```"
        for _, filepath, code in re.findall(pattern2, response, re.DOTALL):
            if filepath.strip() not in files:
                files[filepath.strip()] = code.strip()

        # Pattern 3: ```lang\n# Chemin: filepath\ncode```
        pattern3 = r"```(\w+)\n#\s*Chemin:\s*([^\n]+)\n(.*?)```"
        for _, filepath, code in re.findall(pattern3, response, re.DOTALL):
            if filepath.strip() not in files:
                files[filepath.strip()] = code.strip()

        # Pattern 4: ```lang\n// File: filepath or // Path: filepath
        pattern4 = r"```(\w+)\n//\s*(?:File|Path|Fichier):\s*([^\n]+)\n(.*?)```"
        for _, filepath, code in re.findall(pattern4, response, re.DOTALL):
            if filepath.strip() not in files:
                files[filepath.strip()] = code.strip()

        # Pattern 5: ```lang\n/* filepath */\ncode```
        pattern5 = r"```(\w+)\n/\*\s*([^\n*]+?)\s*\*/\n(.*?)```"
        for _, filepath, code in re.findall(pattern5, response, re.DOTALL):
            fp = filepath.strip()
            if fp not in files and ("." in fp or "/" in fp):
                files[fp] = code.strip()

        # Pattern 6: Heading before code block — **filepath** or ### filepath
        pattern6 = r"(?:^|\n)(?:\*\*|#{1,4}\s*)([^\n*#]+\.(?:py|js|ts|tsx|jsx|html|css|json|md|yml|yaml|toml|sql|go|rs|java|sh))\s*(?:\*\*)?[^\n]*\n```\w*\n(.*?)```"
        for filepath, code in re.findall(pattern6, response, re.DOTALL):
            fp = filepath.strip().strip("`")
            if fp not in files:
                files[fp] = code.strip()

        if not files:
            # Last resort: try to split by file-like markers in the response
            # (fallback logic below)
            # Look for lines that look like file paths between code blocks
            blocks = re.findall(r"```\w*\n(.*?)```", response, re.DOTALL)
            if len(blocks) == 1:
                files["generated_code.txt"] = blocks[0].strip()
            elif blocks:
                for i, block in enumerate(blocks):
                    # Check if first line is a path-like comment
                    first_line = block.split("\n")[0].strip()
                    path_match = re.match(r'^(?://|#|/\*)\s*(.+\.\w+)', first_line)
                    if path_match:
                        fp = path_match.group(1).strip().rstrip(" */")
                        rest = "\n".join(block.split("\n")[1:]).strip()
                        files[fp] = rest
                    else:
                        files[f"file_{i+1}.txt"] = block.strip()
            else:
                files["generated_code.txt"] = response

        return files

    # ────────────────── Context & Truncation helpers ──────────────────────────

    @staticmethod
    def _build_files_context(files: Dict[str, str], max_chars: int = 30000) -> str:
        """Build a context string from generated files for cross-batch coherence.

        Priority: config/shared files first (they define types, routes, styles),
        then other files. Each file is included in full if budget allows,
        otherwise as a signature (first 10 lines).
        """
        if not files:
            return ""

        # Priority: config, types, models, styles, then everything else
        priority_keywords = ["config", "types", "model", "schema", "style", "css",
                             "utils", "helpers", "constants", "shared", "common",
                             "package.json", "index", "app", "main", "server"]

        def sort_key(path: str) -> int:
            lower = path.lower()
            for i, kw in enumerate(priority_keywords):
                if kw in lower:
                    return i
            return 100

        sorted_paths = sorted(files.keys(), key=sort_key)

        parts = []
        used = 0

        for path in sorted_paths:
            content = files[path]
            entry_full = f"\n--- {path} ---\n{content}\n"

            if used + len(entry_full) < max_chars:
                parts.append(entry_full)
                used += len(entry_full)
            else:
                # Signature only (first 10 lines)
                sig = "\n".join(content.split("\n")[:10])
                entry_sig = f"\n--- {path} (extrait) ---\n{sig}\n...\n"
                if used + len(entry_sig) < max_chars:
                    parts.append(entry_sig)
                    used += len(entry_sig)

        return "".join(parts)

    def _detect_truncated_files(self, files: Dict[str, str]) -> List[str]:
        """Detect files that appear to be truncated (incomplete code).

        Checks for:
        - Ends with a truncation marker (// ..., # ..., TODO)
        - Unmatched braces/brackets (more opens than closes)
        - Suspiciously short for its type
        """
        truncated = []

        for path, content in files.items():
            if not content or len(content.strip()) < 20:
                continue

            lines = content.strip().split("\n")
            last_line = lines[-1].strip().lower() if lines else ""

            # Check truncation markers
            is_truncated = False
            for marker in self.TRUNCATION_MARKERS:
                if last_line.endswith(marker.lower()) or last_line == marker.lower():
                    is_truncated = True
                    break

            # Check unmatched braces (common in JS/TS/CSS/JSON)
            ext = path.rsplit(".", 1)[-1] if "." in path else ""
            if ext in ("js", "ts", "tsx", "jsx", "css", "json", "java", "go", "rs"):
                opens = content.count("{") + content.count("[")
                closes = content.count("}") + content.count("]")
                if opens > closes + 2:  # tolerance of 2
                    is_truncated = True

            # Check HTML/XML unclosed tags
            if ext in ("html", "xml", "ejs", "vue", "svelte"):
                opens = content.count("<") - content.count("</") - content.count("/>")
                if opens > 5:
                    is_truncated = True

            if is_truncated:
                truncated.append(path)

        return truncated

    async def _regenerate_single_file(
        self,
        path: str,
        description: str,
        project_name: str,
        design_context: str,
        arch_summary: str,
        existing_files_context: str,
    ) -> Optional[str]:
        """Regenerate a single file with a dedicated high token budget.

        Used for:
        - Files detected as truncated
        - Complex files that need individual attention
        """
        ext = path.rsplit(".", 1)[-1] if "." in path else ""
        lang_hint = ext if ext else "plaintext"

        user_message = (
            f"Génère le fichier COMPLET suivant pour le projet '{project_name}':\n\n"
            f"Fichier: {path}\n"
            f"Description: {description}\n"
            f"Type: {lang_hint}\n"
            f"{design_context}\n\n"
            f"Architecture: {arch_summary}\n\n"
        )

        if existing_files_context:
            user_message += (
                f"═══ CONTEXTE DU PROJET (fichiers existants) ═══\n"
                f"{existing_files_context}\n"
                f"═══ FIN CONTEXTE ═══\n\n"
            )

        user_message += (
            "RÈGLES:\n"
            "- Le fichier doit être 100% COMPLET. AUCUNE coupure, AUCUN placeholder.\n"
            "- Écris TOUT le code du début à la fin sans raccourci.\n"
            "- Les imports et références aux autres fichiers doivent être exacts.\n\n"
            f"Réponds UNIQUEMENT avec le code du fichier, dans un bloc:\n"
            f"```{lang_hint}\n// Chemin: {path}\n[code complet]\n```"
        )

        messages = [
            {"role": "system", "content": self.MODES["code"]},
            {"role": "user", "content": user_message},
        ]

        response = await self.call_deepseek(
            messages=messages,
            model=self.resolve_model(MODEL_PRO),
            temperature=0.5,  # Lower temp for precision on retry
            max_tokens=self.MODE_MAX_TOKENS["code_complex"],
        )

        extracted = self._extract_code_blocks(response)
        # Return the content of the target file (or any extracted file)
        if path in extracted:
            return extracted[path]
        if extracted:
            return next(iter(extracted.values()))
        return None
