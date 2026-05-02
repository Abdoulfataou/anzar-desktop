"""
Service de génération d'exercices pédagogiques variés.

Génère des exercices de plusieurs types :
- "qcm": Questions à choix multiples
- "vrai_faux": Assertions vraies/fausses
- "reponse_courte": Réponses courtes (1-3 phrases)
- "cas_pratique": Cas d'études complexes
- "calcul": Exercices de calcul ou résolution

Usage:
    service = ExerciseGeneratorService()
    exercices = await service.generate(subject="Mathématiques", level="secondary", exercise_types=["qcm", "calcul"])
    exercices = await service.generate_from_content(content="...", exercise_types=["qcm"])
"""

import json
import logging
from typing import Optional

from services.deepseek_client import DeepSeekClient

logger = logging.getLogger(__name__)


class ExerciseGeneratorService:
    """Service pour générer des exercices pédagogiques."""

    EXERCISE_TYPES = ["qcm", "vrai_faux", "reponse_courte", "cas_pratique", "calcul"]

    def __init__(self):
        self.client = DeepSeekClient()

    def _get_exercise_type_description(self, exercise_type: str) -> str:
        """Get description for an exercise type."""
        descriptions = {
            "qcm": "Question à choix multiples (4-5 options)",
            "vrai_faux": "Assertion à juger vraie ou fausse",
            "reponse_courte": "Réponse courte (1-3 phrases)",
            "cas_pratique": "Cas d'étude ou scénario à analyser",
            "calcul": "Exercice de calcul ou résolution"
        }
        return descriptions.get(exercise_type, exercise_type)

    def _get_points_for_type(self, exercise_type: str, difficulty: str) -> int:
        """Get points based on type and difficulty."""
        base_points = {
            "qcm": 1,
            "vrai_faux": 1,
            "reponse_courte": 2,
            "cas_pratique": 3,
            "calcul": 2
        }

        multipliers = {
            "easy": 1,
            "medium": 1.5,
            "hard": 2
        }

        base = base_points.get(exercise_type, 1)
        multiplier = multipliers.get(difficulty, 1)
        return int(base * multiplier)

    async def generate(
        self,
        subject: str,
        level: str,
        exercise_types: list[str],
        count: int = 10,
        difficulty: str = "medium"
    ) -> dict:
        """Generate exercises for a subject.

        Args:
            subject: Subject or course (e.g., "Mathématiques", "Histoire").
            level: Education level ("elementary", "secondary", "university").
            exercise_types: List of exercise types to include.
            count: Total number of exercises to generate.
            difficulty: "easy", "medium", or "hard".

        Returns:
            Dict with keys:
            - exercises: List of exercise dicts
            - total_points: Sum of all points
            - answer_key: Formatted answer key for teacher
            - difficulty_distribution: Count by difficulty level
        """
        try:
            # Validate exercise types
            valid_types = [t for t in exercise_types if t in self.EXERCISE_TYPES]
            if not valid_types:
                valid_types = ["qcm", "reponse_courte"]

            # Build type descriptions for prompt
            type_descriptions = "\n".join(
                f"- {t}: {self._get_exercise_type_description(t)}"
                for t in valid_types
            )

            system_prompt = f"""Tu es un expert pédagogue capable de générer des exercices éducatifs de qualité.

Sujet: {subject}
Niveau: {level}
Difficulté: {difficulty}

Types d'exercices à générer:
{type_descriptions}

Règles d'exercices :

**QCM**: 4-5 options, une seule correcte, distracteurs plausibles

**Vrai/Faux**: Assertions claires, pas d'ambiguïté

**Réponse courte**: Question ouverte nécessitant 1-3 phrases

**Cas pratique**: Scénario réaliste avec question analytique

**Calcul**: Exercice mathématique ou de résolution avec étapes

Chaque exercice doit avoir:
- id: entier unique (1, 2, 3, ...)
- type: type d'exercice
- question: énoncé clair et précis
- options: liste (seulement pour QCM)
- answer: réponse correcte
- explanation: explication pédagogique de la réponse
- difficulty: "easy", "medium", ou "hard"
- points: points attribués

Output JSON obligatoire:
{{
    "exercises": [
        {{
            "id": 1,
            "type": "qcm|vrai_faux|reponse_courte|cas_pratique|calcul",
            "question": "...",
            "options": ["A", "B", "C", "D"] ou null,
            "answer": "Réponse correcte",
            "explanation": "Explication pédagogique",
            "difficulty": "easy|medium|hard",
            "points": int
        }}
    ]
}}

Distribue les types d'exercices régulièrement. Assure une cohérence pédagogique."""

            messages = [
                {
                    "role": "user",
                    "content": f"""Génère {count} exercices pour {subject} au niveau {level}.

Types à inclure: {', '.join(valid_types)}
Difficulté globale: {difficulty}

Génère les exercices maintenant en JSON valide."""
                }
            ]

            response = await self.client.chat(
                messages=messages,
                system=system_prompt,
                temperature=0.6,
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
                    logger.error("Could not parse exercises response")
                    return {
                        "exercises": [],
                        "total_points": 0,
                        "answer_key": "Erreur lors de la génération",
                        "difficulty_distribution": {}
                    }

            exercises = result.get("exercises", [])
            if not isinstance(exercises, list):
                exercises = []

            # Validate and clean exercises
            for ex in exercises:
                if "id" not in ex:
                    ex["id"] = exercises.index(ex) + 1
                if "points" not in ex:
                    ex["points"] = self._get_points_for_type(
                        ex.get("type", "qcm"),
                        ex.get("difficulty", "medium")
                    )
                if "difficulty" not in ex:
                    ex["difficulty"] = "medium"

                # Ensure options is None if not QCM
                if ex.get("type") != "qcm" and "options" in ex:
                    ex["options"] = None

            # Calculate total points
            total_points = sum(ex.get("points", 0) for ex in exercises)

            # Build answer key for teacher
            answer_key_lines = [f"Clé de réponse - {subject}"]
            answer_key_lines.append(f"Nombre de questions: {len(exercises)}")
            answer_key_lines.append(f"Points totaux: {total_points}")
            answer_key_lines.append("")

            for ex in exercises:
                ex_id = ex.get("id", "?")
                answer = ex.get("answer", "N/A")
                points = ex.get("points", 0)
                answer_key_lines.append(f"{ex_id}. {answer} ({points} points)")
                explanation = ex.get("explanation", "")
                if explanation:
                    answer_key_lines.append(f"   Explication: {explanation}")
                answer_key_lines.append("")

            answer_key = "\n".join(answer_key_lines)

            # Count difficulty distribution
            difficulty_distribution = {}
            for ex in exercises:
                diff = ex.get("difficulty", "medium")
                difficulty_distribution[diff] = difficulty_distribution.get(diff, 0) + 1

            logger.info(f"Generated {len(exercises)} exercises for {subject}")

            return {
                "exercises": exercises[:count],
                "total_points": total_points,
                "answer_key": answer_key,
                "difficulty_distribution": difficulty_distribution
            }

        except Exception as e:
            logger.error(f"Error generating exercises: {e}")
            return {
                "exercises": [],
                "total_points": 0,
                "answer_key": f"Erreur: {str(e)}",
                "difficulty_distribution": {}
            }

    async def generate_from_content(
        self,
        content: str,
        exercise_types: list[str],
        count: int = 10
    ) -> dict:
        """Generate exercises from uploaded content.

        Args:
            content: Course material, text, or article.
            exercise_types: List of exercise types to include.
            count: Number of exercises to generate.

        Returns:
            Dict with exercises, total_points, answer_key, difficulty_distribution.
        """
        try:
            # Validate exercise types
            valid_types = [t for t in exercise_types if t in self.EXERCISE_TYPES]
            if not valid_types:
                valid_types = ["qcm", "reponse_courte"]

            # Build type descriptions
            type_descriptions = "\n".join(
                f"- {t}: {self._get_exercise_type_description(t)}"
                for t in valid_types
            )

            system_prompt = f"""Tu es un pédagogue expert capable de générer des exercices de qualité basés sur un contenu.

À partir du contenu fourni, génère des exercices pédagogiques cohérents.

Types d'exercices à générer:
{type_descriptions}

Règles:
1. Les exercices doivent couvrir les concepts principaux du contenu
2. Assure une progression logique
3. Distribue les types d'exercices régulièrement
4. Varie les difficultés
5. Fournis des explications claires

Output JSON avec structure:
{{
    "exercises": [
        {{
            "id": int,
            "type": "qcm|vrai_faux|reponse_courte|cas_pratique|calcul",
            "question": "...",
            "options": [...] ou null,
            "answer": "Réponse",
            "explanation": "Explication",
            "difficulty": "easy|medium|hard",
            "points": int
        }}
    ]
}}"""

            messages = [
                {
                    "role": "user",
                    "content": f"""Génère {count} exercices à partir du contenu suivant.

Types à inclure: {', '.join(valid_types)}

CONTENU:
{content}

Génère les exercices en JSON valide."""
                }
            ]

            response = await self.client.chat(
                messages=messages,
                system=system_prompt,
                temperature=0.6,
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
                    logger.error("Could not parse exercises response")
                    return {
                        "exercises": [],
                        "total_points": 0,
                        "answer_key": "Erreur lors de la génération",
                        "difficulty_distribution": {}
                    }

            exercises = result.get("exercises", [])
            if not isinstance(exercises, list):
                exercises = []

            # Validate and clean exercises
            for ex in exercises:
                if "id" not in ex:
                    ex["id"] = exercises.index(ex) + 1
                if "points" not in ex:
                    ex["points"] = self._get_points_for_type(
                        ex.get("type", "qcm"),
                        ex.get("difficulty", "medium")
                    )
                if "difficulty" not in ex:
                    ex["difficulty"] = "medium"

                # Ensure options is None if not QCM
                if ex.get("type") != "qcm" and "options" in ex:
                    ex["options"] = None

            # Calculate total points
            total_points = sum(ex.get("points", 0) for ex in exercises)

            # Build answer key
            answer_key_lines = ["Clé de réponse - Exercices"]
            answer_key_lines.append(f"Nombre de questions: {len(exercises)}")
            answer_key_lines.append(f"Points totaux: {total_points}")
            answer_key_lines.append("")

            for ex in exercises:
                ex_id = ex.get("id", "?")
                answer = ex.get("answer", "N/A")
                points = ex.get("points", 0)
                answer_key_lines.append(f"{ex_id}. {answer} ({points} points)")
                explanation = ex.get("explanation", "")
                if explanation:
                    answer_key_lines.append(f"   Explication: {explanation}")
                answer_key_lines.append("")

            answer_key = "\n".join(answer_key_lines)

            # Difficulty distribution
            difficulty_distribution = {}
            for ex in exercises:
                diff = ex.get("difficulty", "medium")
                difficulty_distribution[diff] = difficulty_distribution.get(diff, 0) + 1

            logger.info(f"Generated {len(exercises)} exercises from content")

            return {
                "exercises": exercises[:count],
                "total_points": total_points,
                "answer_key": answer_key,
                "difficulty_distribution": difficulty_distribution
            }

        except Exception as e:
            logger.error(f"Error generating exercises from content: {e}")
            return {
                "exercises": [],
                "total_points": 0,
                "answer_key": f"Erreur: {str(e)}",
                "difficulty_distribution": {}
            }
