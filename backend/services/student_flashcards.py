"""
Service de génération de flashcards pour l'apprentissage.

Utilise DeepSeek pour générer des flashcards (recto/verso) à partir :
- D'un contenu pédagogique (cours, texte, article)
- D'un sujet spécifique

Chaque flashcard contient :
- recto: Question ou concept
- verso: Réponse ou définition
- theme: Thème ou catégorie
- difficulty: Niveau de difficulté

Usage:
    service = FlashcardService()
    cards = await service.generate("Contenu du cours", count=20)
    cards = await service.generate_from_topic("Photosynthèse", level="secondary")
"""

import json
import logging
from typing import Optional

from services.deepseek_client import DeepSeekClient

logger = logging.getLogger(__name__)


class FlashcardService:
    """Service pour générer des flashcards pédagogiques."""

    def __init__(self):
        self.client = DeepSeekClient()

    async def generate(
        self,
        content: str,
        count: int = 20,
        difficulty: str = "medium"
    ) -> dict:
        """Generate flashcards from educational content.

        Args:
            content: Course material, text, or article to create cards from.
            count: Number of flashcards to generate (default 20).
            difficulty: "easy", "medium", or "hard" - difficulty level.

        Returns:
            Dict with keys:
            - cards: List of flashcards with id, recto, verso, theme, difficulty
            - themes: List of identified themes/topics
            - study_plan: Suggested spaced repetition schedule
        """
        try:
            system_prompt = """Tu es un expert pédagogique spécialisé dans la création de flashcards efficaces.

À partir du contenu fourni, génère des flashcards au format JSON.

Chaque flashcard doit avoir :
- id: entier unique
- recto: Question, concept ou clé (10-30 mots max)
- verso: Réponse, définition ou explication (50-200 mots)
- theme: Catégorie ou thème (ex: "Biologie", "Histoire", "Grammaire")
- difficulty: "easy", "medium", ou "hard"

Règles :
1. Recto = la question ou le concept clé
2. Verso = explication claire, concise mais complète
3. Assure une progression logique
4. Mélange les difficultés
5. Utilise la terminologie appropriée

Réponds OBLIGATOIREMENT en JSON valide avec la structure :
{
    "cards": [
        {
            "id": 1,
            "recto": "...",
            "verso": "...",
            "theme": "...",
            "difficulty": "easy|medium|hard"
        }
    ],
    "themes": ["Thème1", "Thème2", "..."],
    "study_plan": "Suggestion de plan d'étude avec répétition espacée"
}

Critique ton output JSON avant de le fournir."""

            difficulty_hint = {
                "easy": "Surtout des concepts fondamentaux et définitions simples",
                "medium": "Mélange de concepts et d'applications",
                "hard": "Concepts avancés, analyse, synthèse et cas complexes"
            }

            messages = [
                {
                    "role": "user",
                    "content": f"""Génère {count} flashcards à partir du contenu suivant.
Niveau de difficulté: {difficulty} ({difficulty_hint.get(difficulty, 'mixed')})

CONTENU À CONVERTIR:
{content}

Génère les flashcards maintenant en JSON valide."""
                }
            ]

            response = await self.client.chat(
                messages=messages,
                system=system_prompt,
                temperature=0.5,
                max_tokens=4096,
                response_format={"type": "json_object"}
            )

            # Parse JSON response
            try:
                result = json.loads(response)
            except json.JSONDecodeError:
                # Try to extract JSON from response
                start = response.find("{")
                end = response.rfind("}") + 1
                if start >= 0 and end > start:
                    result = json.loads(response[start:end])
                else:
                    logger.error("Could not parse flashcard generation response")
                    return {
                        "cards": [],
                        "themes": [],
                        "study_plan": "Erreur lors de la génération"
                    }

            # Validate and clean cards
            cards = result.get("cards", [])
            if not isinstance(cards, list):
                cards = []

            # Ensure all cards have required fields
            for card in cards:
                if "id" not in card:
                    card["id"] = cards.index(card) + 1
                if "difficulty" not in card:
                    card["difficulty"] = "medium"
                if not all(k in card for k in ["recto", "verso", "theme"]):
                    logger.warning(f"Flashcard missing required fields: {card}")

            # Get themes and study plan
            themes = result.get("themes", [])
            if not isinstance(themes, list):
                themes = []

            study_plan = result.get("study_plan", "Étudier les flashcards dans l'ordre proposé")

            logger.info(f"Generated {len(cards)} flashcards with {len(themes)} themes")

            return {
                "cards": cards[:count],  # Ensure we don't exceed requested count
                "themes": themes,
                "study_plan": study_plan
            }

        except Exception as e:
            logger.error(f"Error generating flashcards: {e}")
            return {
                "cards": [],
                "themes": [],
                "study_plan": f"Erreur: {str(e)}"
            }

    async def generate_from_topic(
        self,
        topic: str,
        level: str,
        count: int = 20
    ) -> dict:
        """Generate flashcards from a topic without content.

        Args:
            topic: Topic or subject (e.g., "Photosynthesis", "Calculus II").
            level: Education level ("elementary", "secondary", "university", "professional").
            count: Number of flashcards to generate.

        Returns:
            Dict with cards, themes, and study_plan (same structure as generate()).
        """
        try:
            # Map levels to difficulty and depth
            level_map = {
                "elementary": ("easy", "Concepts fondamentaux simples"),
                "secondary": ("medium", "Concepts intermédiaires et applications"),
                "university": ("hard", "Concepts avancés, théories et cas complexes"),
                "professional": ("hard", "Concepts appliqués en contexte professionnel")
            }

            difficulty, description = level_map.get(level, ("medium", "Mélange"))

            system_prompt = f"""Tu es un expert pédagogique capable de générer des flashcards complètes sur n'importe quel sujet.

Niveau d'études: {level} ({description})

Génère des flashcards cohérentes et structurées en JSON valide.

Structure JSON obligatoire:
{{
    "cards": [
        {{
            "id": int,
            "recto": "Question/concept",
            "verso": "Réponse/explication",
            "theme": "Catégorie",
            "difficulty": "easy|medium|hard"
        }}
    ],
    "themes": ["Thème1", "Thème2"],
    "study_plan": "Plan d'étude avec répétition espacée"
}}

Règles :
1. Adapte le contenu au niveau {level}
2. Assure progressivité et cohérence
3. Utilise la terminologie appropriée
4. Couvre les concepts principaux du sujet"""

            messages = [
                {
                    "role": "user",
                    "content": f"""Génère {count} flashcards sur le sujet: "{topic}"

Niveau: {level}

Génère des flashcards complètes et variées en JSON valide."""
                }
            ]

            response = await self.client.chat(
                messages=messages,
                system=system_prompt,
                temperature=0.5,
                max_tokens=4096,
                response_format={"type": "json_object"}
            )

            # Parse JSON response
            try:
                result = json.loads(response)
            except json.JSONDecodeError:
                # Try to extract JSON from response
                start = response.find("{")
                end = response.rfind("}") + 1
                if start >= 0 and end > start:
                    result = json.loads(response[start:end])
                else:
                    logger.error(f"Could not parse flashcards for topic {topic}")
                    return {
                        "cards": [],
                        "themes": [],
                        "study_plan": "Erreur lors de la génération"
                    }

            # Validate and clean cards
            cards = result.get("cards", [])
            if not isinstance(cards, list):
                cards = []

            for card in cards:
                if "id" not in card:
                    card["id"] = cards.index(card) + 1
                if "difficulty" not in card:
                    card["difficulty"] = difficulty
                if not all(k in card for k in ["recto", "verso", "theme"]):
                    logger.warning(f"Card missing fields: {card}")

            themes = result.get("themes", [])
            if not isinstance(themes, list):
                themes = []

            study_plan = result.get("study_plan", f"Étudier les flashcards sur {topic} progressivement")

            logger.info(f"Generated {len(cards)} flashcards for topic '{topic}'")

            return {
                "cards": cards[:count],
                "themes": themes,
                "study_plan": study_plan
            }

        except Exception as e:
            logger.error(f"Error generating flashcards from topic: {e}")
            return {
                "cards": [],
                "themes": [],
                "study_plan": f"Erreur: {str(e)}"
            }
