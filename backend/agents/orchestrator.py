"""
Agent Orchestrateur — Routage intelligent à coût ZÉRO.

Classifie le message utilisateur et route vers le bon agent
en utilisant UNIQUEMENT des heuristiques locales (regex, scoring, mots-clés).
Aucun appel API = 0 token consommé = gratuit.

Agents disponibles:
  - coder       : Génération, refactoring, debug, review, test de code
  - planner     : Architecture et planification de projet
  - web_search  : Recherche web + synthèse
  - vision      : Analyse d'images
  - doc_writer  : Documentation technique
  - summarizer  : Résumé et compaction
  - student_writer    : Rédaction académique
  - student_corrector : Correction de textes
  - student_researcher: Recherche documentaire
"""

import logging
import re
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class RoutingResult:
    """Résultat du routage avec agent cible et métadonnées."""
    agent: str
    mode: Optional[str] = None    # Mode spécifique (ex: "debug" pour CoderAgent)
    confidence: float = 0.0       # 0.0 - 1.0
    reason: str = ""              # Explication du choix
    fallback: Optional[str] = None  # Agent de secours si le principal échoue


class OrchestratorAgent:
    """
    Classifieur local — route les messages vers le bon agent.
    Zéro appel API, zéro coût.
    """

    def __init__(self):
        self.name = "orchestrator"
        self.role = "Routeur Intelligent"
        logger.info(f"✓ OrchestratorAgent initialisé (0 coût)")

    def route(
        self,
        message: str,
        has_images: bool = False,
        has_code: bool = False,
        conversation_context: Optional[List[Dict[str, str]]] = None,
    ) -> RoutingResult:
        """
        Classifie un message et détermine l'agent cible.

        Args:
            message: Message de l'utilisateur
            has_images: True si le message contient des images
            has_code: True si le message contient des blocs de code
            conversation_context: Messages précédents (optionnel, pour le contexte)

        Returns:
            RoutingResult avec l'agent cible, le mode, et la confiance
        """
        msg = (message or "").strip()
        msg_lower = msg.lower()

        if not msg and not has_images:
            return RoutingResult(agent="coder", mode="code", confidence=0.1, reason="Message vide")

        # ── PRIORITÉ 1: Images → VisionAgent (court-circuit) ──
        if has_images:
            result = self._check_vision(msg_lower)
            if result:
                return result

        # ── PRIORITÉ 2: Détection de prompts "assistant étudiant" ──
        # Ces prompts système commencent par "Tu es un(e) expert/correcteur/..."
        student_result = self._check_student_prompt(msg, msg_lower)
        if student_result:
            return student_result

        # ── PRIORITÉ 3: Scoring par catégorie ──
        scores: Dict[str, float] = {}

        scores["project"] = self._score_project(msg, msg_lower)
        scores["debug"] = self._score_debug(msg, msg_lower, has_code)
        scores["refactor"] = self._score_refactor(msg, msg_lower, has_code)
        scores["review"] = self._score_review(msg, msg_lower, has_code)
        scores["test"] = self._score_test(msg, msg_lower, has_code)
        scores["code_gen"] = self._score_code_gen(msg, msg_lower)
        scores["web_search"] = self._score_web_search(msg, msg_lower)
        scores["doc_writer"] = self._score_doc_writer(msg, msg_lower)
        scores["summarizer"] = self._score_summarizer(msg, msg_lower)
        scores["student_write"] = self._score_student_write(msg, msg_lower)
        scores["student_correct"] = self._score_student_correct(msg, msg_lower)
        scores["student_research"] = self._score_student_research(msg, msg_lower)

        # Trouver le meilleur score
        best_category = max(scores, key=scores.get)
        best_score = scores[best_category]

        # Mapper catégorie → agent + mode
        return self._category_to_routing(best_category, best_score, scores)

    # ────────────────────────────────────────────────────────────────────────
    # DÉTECTION PRIORITAIRE
    # ────────────────────────────────────────────────────────────────────────

    def _check_vision(self, msg_lower: str) -> Optional[RoutingResult]:
        """Court-circuit: images → VisionAgent."""
        # Analyse d'image/screenshot
        if any(kw in msg_lower for kw in [
            "image", "photo", "screenshot", "capture", "écran",
            "regarde", "vois", "montre", "affiche", "cette image",
        ]):
            return RoutingResult(
                agent="vision", confidence=0.95,
                reason="Message avec image + mots-clés visuels",
            )
        # Image sans mots-clés → quand même vision
        return RoutingResult(
            agent="vision", confidence=0.85,
            reason="Message avec image jointe",
        )

    def _check_student_prompt(self, msg: str, msg_lower: str) -> Optional[RoutingResult]:
        """Détecte les prompts système d'assistant étudiant."""
        is_student_prompt = (
            re.match(r"^Tu es un[e]?\s+(super-)?(correct|expert|profess|traducteur|assistant|tuteur)", msg, re.IGNORECASE)
            and re.search(
                r"\b(correction|reformulat|orthographe|grammaire|academique|pedagogique|"
                r"exercice|flashcard|quiz|bareme|evaluat|plagiat|bibliograph|citation|"
                r"revision|memoire|rapport|expose|redaction|traduction|fiche|tuteur|"
                r"enseign|expliqu)\b",
                msg_lower,
            )
        )
        if not is_student_prompt:
            return None

        # Sous-classifier: writer / corrector / researcher
        if re.search(r"\b(corrig|correction|orthograph|grammair|reformul|faute)\b", msg_lower):
            return RoutingResult(
                agent="student_corrector", confidence=0.95,
                reason="Prompt étudiant — correction détectée",
            )
        if re.search(r"\b(recherch|bibliograph|source|citation|document)\b", msg_lower):
            return RoutingResult(
                agent="student_researcher", confidence=0.95,
                reason="Prompt étudiant — recherche détectée",
            )
        return RoutingResult(
            agent="student_writer", confidence=0.90,
            reason="Prompt étudiant — rédaction par défaut",
        )

    # ────────────────────────────────────────────────────────────────────────
    # SCORING PAR CATÉGORIE
    # ────────────────────────────────────────────────────────────────────────

    def _score_project(self, msg: str, msg_lower: str) -> float:
        """Score pour la génération de projet complet."""
        score = 0.0

        # Anti-patterns (pas un projet)
        if "```" in msg:
            return 0.0  # Code snippet → debug/refactor
        if re.search(r"\b(stack trace|traceback|exception)\b", msg_lower):
            return 0.0
        if re.search(r"\b(corrig|fix|debug|bug|erreur)\b", msg_lower):
            return 0.0

        # Verbes de création
        if re.search(r"\b(cr[ée]{1,2}[es]?\b|cr[ée]{1,2}[- ]?moi|g[ée]n[eè]re|développe|construis|fais|monte|build|create|generate|make|develop)\b", msg_lower):
            score += 0.3

        # Objets de type "projet"
        if re.search(r"\b(app|application|projet|site|api|dashboard|plateforme|système|logiciel|outil|saas|mvp|prototype|backend|frontend|page web|landing|project|website|platform)\b", msg_lower):
            score += 0.3

        # Scope (complexité)
        if re.search(r"\b(complet|from scratch|de zéro|entier|full\s*stack|crud|auth|authentification|base de données|database)\b", msg_lower):
            score += 0.2

        # Domaine métier
        if re.search(r"\b(stock|inventaire|crm|facturation|billing|e-?commerce|boutique|restaurant|réservation|booking|gestion)\b", msg_lower):
            score += 0.2

        return min(score, 1.0)

    def _score_debug(self, msg: str, msg_lower: str, has_code: bool) -> float:
        """Score pour le debugging."""
        score = 0.0

        if re.search(r"\b(bug|debug|débug|erreur|error|crash|exception|traceback|stack\s*trace|ne\s+marche\s+pas|ne\s+fonctionne\s+pas|doesn'?t\s+work|broken|cassé|planté|freeze|infinite\s+loop|boucle\s+infinie)\b", msg_lower):
            score += 0.5

        if re.search(r"\b(TypeError|SyntaxError|ReferenceError|AttributeError|NameError|ImportError|KeyError|ValueError|IndexError|RuntimeError|NullPointerException|SegFault|SIGSEGV|500|404|403|401)\b", msg):
            score += 0.3

        if has_code:
            score += 0.15

        if "```" in msg and re.search(r"\b(err|fix|problem|issue|aide|help)\b", msg_lower):
            score += 0.2

        return min(score, 1.0)

    def _score_refactor(self, msg: str, msg_lower: str, has_code: bool) -> float:
        """Score pour le refactoring."""
        score = 0.0

        if re.search(r"\b(refactor[eé]?|refactoris|restructur|réorganis|nettoyer|clean\s*up|simplifi|améliorer?\s+(le\s+)?code|optimis|modernis|DRY|SOLID)\b", msg_lower):
            score += 0.6

        if has_code and re.search(r"\b(mieux|propre|lisible|maintenable|readable|maintainable)\b", msg_lower):
            score += 0.3

        return min(score, 1.0)

    def _score_review(self, msg: str, msg_lower: str, has_code: bool) -> float:
        """Score pour la code review."""
        score = 0.0

        if re.search(r"\b(review|revue|revu|analyse|évaluer?|noter?|qualité|quality|audit|vérifi|check)\b", msg_lower):
            score += 0.4

        if has_code and re.search(r"\b(code|ce\s+code|mon\s+code|this\s+code)\b", msg_lower):
            score += 0.3

        if re.search(r"\b(score|note|/20|/100|avis|opinion|penses?[- ]tu)\b", msg_lower):
            score += 0.2

        return min(score, 1.0)

    def _score_test(self, msg: str, msg_lower: str, has_code: bool) -> float:
        """Score pour la génération de tests."""
        score = 0.0

        if re.search(r"\b(test|tests|tester|testing|unittest|unit\s*test|pytest|jest|vitest|spec|coverage|couverture)\b", msg_lower):
            score += 0.5

        if re.search(r"\b(écr[iy]s?|génère|crée?|generate|write|create)\b", msg_lower) and "test" in msg_lower:
            score += 0.3

        if has_code and "test" in msg_lower:
            score += 0.2

        return min(score, 1.0)

    def _score_code_gen(self, msg: str, msg_lower: str) -> float:
        """Score pour la génération de code (pas un projet complet)."""
        score = 0.0

        # Demande de code spécifique (pas un projet)
        if re.search(r"\b(écr[iy]s?|génère|code|fonction|function|class|composant|component|script|snippet|algorithme|implémente|implement)\b", msg_lower):
            score += 0.3

        # Langage mentionné
        if re.search(r"\b(python|javascript|typescript|react|vue|html|css|java|c\+\+|rust|go|swift|kotlin|php|ruby|sql)\b", msg_lower):
            score += 0.2

        # Mais pas un projet complet (pas de verbe "créer un site/app")
        if re.search(r"\b(site|app|application|projet|project|plateforme)\b", msg_lower):
            score -= 0.2

        return max(0.0, min(score, 1.0))

    def _score_web_search(self, msg: str, msg_lower: str) -> float:
        """Score pour la recherche web."""
        score = 0.0

        if re.search(r"\b(cherche|recherche|search|google|trouve|find|actualité|news|récent|latest|dernier|current|prix|price|version|compare|versus|vs)\b", msg_lower):
            score += 0.4

        # Questions factuelles sur des sujets récents
        if re.search(r"\b(combien|quel|quelle|quand|où|who|what|when|where|how much|how many)\b", msg_lower):
            if re.search(r"\b(2024|2025|2026|aujourd'hui|maintenant|actuellement|currently|now)\b", msg_lower):
                score += 0.3

        if re.search(r"\b(documentation|doc|tuto|tutoriel|tutorial|guide|officiel|official)\b", msg_lower):
            score += 0.2

        return min(score, 1.0)

    def _score_doc_writer(self, msg: str, msg_lower: str) -> float:
        """Score pour la documentation."""
        score = 0.0

        if re.search(r"\b(readme|documentation|doc|api\s*doc|swagger|openapi|jsdoc|docstring|commentaire|wiki)\b", msg_lower):
            score += 0.4

        if re.search(r"\b(génère|écris|crée?|rédige|write|create|generate)\b", msg_lower):
            if re.search(r"\b(doc|readme|documentation|guide|manuel|manual)\b", msg_lower):
                score += 0.4

        return min(score, 1.0)

    def _score_summarizer(self, msg: str, msg_lower: str) -> float:
        """Score pour le résumé."""
        score = 0.0

        if re.search(r"\b(résume|résumé|résumer|summary|summarize|synthèse|synthétise|condense|compact|raccourci|shorten|tl;?dr|en\s+bref|en\s+résumé)\b", msg_lower):
            score += 0.6

        if re.search(r"\b(long|trop\s+long|verbeux|verbose|simplifie|simplifier)\b", msg_lower):
            score += 0.2

        return min(score, 1.0)

    def _score_student_write(self, msg: str, msg_lower: str) -> float:
        """Score pour la rédaction académique."""
        score = 0.0

        if re.search(r"\b(rédige|rédaction|mémoire|thèse|rapport|exposé|dissertation|essay|essai|plan\s+détaillé|introduction|conclusion|développement|problématique)\b", msg_lower):
            score += 0.4

        if re.search(r"\b(académique|universitaire|scolaire|étudiant|student|cours|matière|licence|master|doctorat)\b", msg_lower):
            score += 0.3

        return min(score, 1.0)

    def _score_student_correct(self, msg: str, msg_lower: str) -> float:
        """Score pour la correction de textes."""
        score = 0.0

        if re.search(r"\b(corrige|corrigé|correction|orthographe|grammaire|faute|erreur|reformule|reformulation|ponctuation|syntaxe|conjugaison)\b", msg_lower):
            score += 0.5

        if re.search(r"\b(texte|paragraphe|phrase|rédaction|écriture)\b", msg_lower):
            score += 0.2

        # Différencier de debug (correction de CODE vs de TEXTE)
        if re.search(r"\b(code|function|class|import|def |const |let |var )\b", msg_lower):
            score -= 0.3  # C'est du code, pas du texte

        return max(0.0, min(score, 1.0))

    def _score_student_research(self, msg: str, msg_lower: str) -> float:
        """Score pour la recherche documentaire académique."""
        score = 0.0

        if re.search(r"\b(recherche\s+documentaire|bibliographie|sources|références|littérature|état\s+de\s+l'art|revue\s+de\s+littérature|citation|APA|MLA|Chicago|Harvard)\b", msg_lower):
            score += 0.5

        if re.search(r"\b(académique|scientifique|article|revue|journal|publication|auteur)\b", msg_lower):
            score += 0.2

        return min(score, 1.0)

    # ────────────────────────────────────────────────────────────────────────
    # MAPPING CATÉGORIE → AGENT
    # ────────────────────────────────────────────────────────────────────────

    def _category_to_routing(
        self, category: str, score: float, all_scores: Dict[str, float]
    ) -> RoutingResult:
        """Convertit une catégorie gagnante en RoutingResult."""

        # Seuil minimum — si le score est trop bas, fallback au chat simple
        if score < 0.2:
            return RoutingResult(
                agent="chat", confidence=0.5,
                reason="Aucune catégorie forte — chat général",
            )

        mapping = {
            "project": RoutingResult(
                agent="planner", confidence=score,
                reason="Génération de projet détectée",
                fallback="coder",
            ),
            "debug": RoutingResult(
                agent="coder", mode="debug", confidence=score,
                reason="Debugging détecté",
            ),
            "refactor": RoutingResult(
                agent="coder", mode="refactor", confidence=score,
                reason="Refactoring détecté",
            ),
            "review": RoutingResult(
                agent="coder", mode="review", confidence=score,
                reason="Code review détectée",
            ),
            "test": RoutingResult(
                agent="coder", mode="test", confidence=score,
                reason="Génération de tests détectée",
            ),
            "code_gen": RoutingResult(
                agent="coder", mode="code", confidence=score,
                reason="Génération de code détectée",
            ),
            "web_search": RoutingResult(
                agent="web_search", confidence=score,
                reason="Recherche web détectée",
            ),
            "doc_writer": RoutingResult(
                agent="doc_writer", confidence=score,
                reason="Documentation détectée",
            ),
            "summarizer": RoutingResult(
                agent="summarizer", confidence=score,
                reason="Résumé/synthèse détecté",
            ),
            "student_write": RoutingResult(
                agent="student_writer", confidence=score,
                reason="Rédaction académique détectée",
            ),
            "student_correct": RoutingResult(
                agent="student_corrector", confidence=score,
                reason="Correction de texte détectée",
            ),
            "student_research": RoutingResult(
                agent="student_researcher", confidence=score,
                reason="Recherche documentaire détectée",
            ),
        }

        result = mapping.get(category)
        if result:
            return result

        return RoutingResult(
            agent="chat", confidence=0.3,
            reason=f"Catégorie non mappée: {category}",
        )
