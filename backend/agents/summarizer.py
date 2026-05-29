"""
Agent Summarizer — Résumé et compaction de contexte.

Capacités:
  - Résumé de documents longs (articles, rapports, code)
  - Compaction de conversation (préserve les décisions clés, supprime le bruit)
  - Extraction de points clés
  - TL;DR rapide

Optimisé pour minimiser les tokens: un seul appel API avec des limites strictes.
"""

import logging
from typing import Dict, Any, List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)

PROMPT_SUMMARIZE = """Tu es un expert en synthèse. Tu résumes des textes de manière précise et concise.

PRINCIPES:
1. FIDÈLE: Ne déforme jamais le sens original. Si le texte dit X, ton résumé dit X.
2. CONCIS: Élimine la redondance, les exemples superflus, les formulations verbeuses.
3. STRUCTURÉ: Utilise des paragraphes courts ou des listes selon le contenu.
4. COMPLET: Couvre tous les points importants — rien de critique ne doit manquer.
5. AUTONOME: Le résumé doit être compréhensible sans lire l'original.

NIVEAUX DE RÉSUMÉ:
- "brief" (TL;DR): 1-2 phrases max, l'essentiel absolu
- "standard": 3-5 paragraphes, points clés + contexte
- "detailed": Résumé exhaustif avec structure, préservant les nuances

FORMAT SELON LE TYPE:
- Document: sections avec titres
- Conversation: décisions prises + questions ouvertes + prochaines étapes
- Code: ce que fait le code, les patterns utilisés, les dépendances
- Article: thèse + arguments + conclusion"""

PROMPT_COMPACT_CONVERSATION = """Tu es un expert en compaction de contexte de conversation.
Tu condensas des longs échanges en un résumé actionnable.

PRÉSERVER OBLIGATOIREMENT:
1. Les DÉCISIONS prises (choix techniques, orientations, etc.)
2. Les INFORMATIONS FACTUELLES partagées (paths, configs, versions, URLs)
3. Les TÂCHES assignées ou en cours
4. Les PROBLÈMES identifiés et leurs solutions
5. Le CONTEXTE nécessaire pour comprendre la suite

SUPPRIMER:
- Les formules de politesse et bavardage
- Les tentatives échouées (sauf si la leçon est importante)
- Les questions déjà répondues
- Les reformulations et répétitions
- Les détails d'implémentation résolus

FORMAT:
## Contexte
[Résumé du contexte global en 2-3 phrases]

## Décisions
- [Décision 1]: [Raison]
- [Décision 2]: [Raison]

## État actuel
[Ce qui a été fait, ce qui reste à faire]

## Informations clés
- [Info 1]: [Valeur]
- [Info 2]: [Valeur]"""

PROMPT_KEY_POINTS = """Tu es un expert en extraction de points clés.
Extrais les 3-7 points les plus importants de ce texte.

CHAQUE POINT DOIT ÊTRE:
- Spécifique (pas "le sujet est intéressant" mais "la croissance est de 15% YoY")
- Autonome (compréhensible sans contexte)
- Actionnable si possible

Réponds en JSON:
{
    "key_points": [
        {"point": "Le point clé exact", "importance": "critique|haute|moyenne", "category": "catégorie"},
        ...
    ],
    "tldr": "Résumé en 1 phrase"
}"""


class SummarizerAgent(BaseAgent):
    """Agent de résumé — condense les textes et conversations."""

    MODES = {
        "summarize": PROMPT_SUMMARIZE,
        "compact": PROMPT_COMPACT_CONVERSATION,
        "key_points": PROMPT_KEY_POINTS,
    }

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="summarizer",
            role="Synthétiseur",
            description="Résume des documents et compacte les conversations",
            deepseek_client=deepseek_client,
        )

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Résume du contenu.

        Args:
            request: {
                "text": str,            # Texte à résumer
                "mode": str,            # "summarize" | "compact" | "key_points"
                "level": str,           # "brief" | "standard" | "detailed" (pour mode summarize)
                "language": str,        # "fr" | "en"
                "max_words": int,       # Limite de mots pour le résumé (optionnel)
            }

        Returns:
            {
                "status": "success",
                "summary": str,
                "mode": str,
                "tokens_used": int,
            }
        """
        text = request.get("text", "")
        mode = request.get("mode", "summarize")
        level = request.get("level", "standard")
        language = request.get("language", "fr")
        max_words = request.get("max_words", 0)

        if not text or len(text.strip()) < 20:
            return {
                "status": "error",
                "error": "Texte trop court pour être résumé",
                "tokens_used": self.tokens_used,
            }

        if mode not in self.MODES:
            return {
                "status": "error",
                "error": f"Mode inconnu: {mode}. Disponibles: {list(self.MODES.keys())}",
                "tokens_used": self.tokens_used,
            }

        logger.info(f"[{self.name}] Mode: {mode}, Niveau: {level}, Texte: {len(text)} chars")

        # Construire les instructions additionnelles
        extra = []
        lang_map = {"fr": "Réponds en français.", "en": "Answer in English."}
        extra.append(lang_map.get(language, "Réponds en français."))

        if mode == "summarize":
            level_guidance = {
                "brief": "TL;DR: résume en 1-2 phrases maximum.",
                "standard": "Résumé standard: 3-5 paragraphes avec les points clés.",
                "detailed": "Résumé exhaustif: couvre tous les points importants avec nuances.",
            }
            extra.append(level_guidance.get(level, level_guidance["standard"]))

        if max_words > 0:
            extra.append(f"Limite: {max_words} mots maximum.")

        user_message = f"{' '.join(extra)}\n\nTexte à traiter:\n\n{text[:8000]}"

        # Adapter les max_tokens au niveau de résumé
        token_limits = {
            "brief": 256,
            "standard": 1500,
            "detailed": 3000,
        }
        max_tokens = token_limits.get(level, 1500)
        if mode == "compact":
            max_tokens = 2000
        if mode == "key_points":
            max_tokens = 1500

        messages = [
            {"role": "system", "content": self.MODES[mode]},
            {"role": "user", "content": user_message},
        ]

        try:
            response = await self.call_deepseek(
                messages=messages,
                temperature=0.3,
                max_tokens=max_tokens,
                response_format={"type": "json_object"} if mode == "key_points" else None,
            )

            result = {
                "status": "success",
                "summary": response,
                "mode": mode,
                "level": level,
                "original_length": len(text),
                "summary_length": len(response),
                "compression_ratio": round(len(response) / len(text), 2) if text else 0,
                "tokens_used": self.tokens_used,
            }

            # Parser le JSON pour key_points
            if mode == "key_points":
                try:
                    parsed = self.parse_json_response(response)
                    result["key_points"] = parsed.get("key_points", [])
                    result["tldr"] = parsed.get("tldr", "")
                except ValueError:
                    result["key_points"] = []

            logger.info(
                f"[{self.name}] Résumé: {len(text)} → {len(response)} chars "
                f"(ratio {result['compression_ratio']})"
            )

            return result

        except Exception as e:
            logger.error(f"[{self.name}] Erreur: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used,
            }
