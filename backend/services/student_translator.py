"""
Service de traduction académique avec glossaire et notes.

Assure une traduction fidèle en maintenant le registre académique et la terminologie.

Langues supportées: "fr", "en", "ar"
Domaines: "general", "sciences", "droit", "economie", "lettres", "medecine", "informatique"

Usage:
    service = AcademicTranslatorService()
    result = await service.translate("Texte", source_lang="en", target_lang="fr", domain="sciences")
"""

import json
import logging
from typing import Optional

from services.deepseek_client import DeepSeekClient

logger = logging.getLogger(__name__)


class AcademicTranslatorService:
    """Service de traduction académique avec glossaire et notes."""

    SUPPORTED_LANGUAGES = ["fr", "en", "ar"]
    SUPPORTED_DOMAINS = ["general", "sciences", "droit", "economie", "lettres", "medecine", "informatique"]

    LANGUAGE_NAMES = {
        "fr": "Français",
        "en": "Anglais",
        "ar": "Arabe"
    }

    DOMAIN_DESCRIPTIONS = {
        "general": "Usage général et courant",
        "sciences": "Sciences naturelles, chimie, biologie, physique",
        "droit": "Droit, légalité, contrats, jurisprudence",
        "economie": "Économie, finances, commerce, gestion",
        "lettres": "Littérature, humanités, sciences sociales",
        "medecine": "Médecine, santé, anatomie, pharmacologie",
        "informatique": "Informatique, programmation, technologie"
    }

    def __init__(self):
        self.client = DeepSeekClient()

    async def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        domain: str = "general"
    ) -> dict:
        """Translate academic text while maintaining register and terminology.

        Args:
            text: Text to translate.
            source_lang: Source language code (fr, en, ar).
            target_lang: Target language code (fr, en, ar).
            domain: Academic domain for terminology accuracy.

        Returns:
            Dict with keys:
            - translated_text: The translated text
            - glossary: List of dicts with original, translated, context
            - notes: List of translation notes explaining key choices
        """
        try:
            # Validate languages
            if source_lang not in self.SUPPORTED_LANGUAGES:
                return {
                    "translated_text": text,
                    "glossary": [],
                    "notes": [f"Langue source '{source_lang}' non supportée"]
                }

            if target_lang not in self.SUPPORTED_LANGUAGES:
                return {
                    "translated_text": text,
                    "glossary": [],
                    "notes": [f"Langue cible '{target_lang}' non supportée"]
                }

            if source_lang == target_lang:
                return {
                    "translated_text": text,
                    "glossary": [],
                    "notes": ["Les langues source et cible sont identiques"]
                }

            # Validate domain
            if domain not in self.SUPPORTED_DOMAINS:
                domain = "general"
                logger.warning(f"Unknown domain, defaulting to 'general'")

            source_name = self.LANGUAGE_NAMES.get(source_lang, source_lang)
            target_name = self.LANGUAGE_NAMES.get(target_lang, target_lang)
            domain_desc = self.DOMAIN_DESCRIPTIONS.get(domain, domain)

            system_prompt = f"""Tu es un expert en traduction académique du {source_name} vers le {target_name}.

Domaine d'expertise: {domain} ({domain_desc})

Règles de traduction:
1. Conserve la formalité et le registre académique
2. Utilise la terminologie appropriée au domaine
3. Assure la clarté et la precision
4. Maintient les citations et références dans leur forme originale
5. Adapte les expressions idiomatiques au contexte académique
6. Préserve la structure logique et les nuances

Output JSON obligatoire:
{{
    "translated_text": "Texte traduit complet",
    "glossary": [
        {{
            "original": "Terme original",
            "translated": "Terme traduit",
            "context": "Contexte d'utilisation"
        }}
    ],
    "notes": [
        "Note 1: explication des choix de traduction",
        "Note 2: ...",
        "..."
    ]
}}

Fournis au moins 3-5 entrées de glossaire pour les termes importants."""

            messages = [
                {
                    "role": "user",
                    "content": f"""Traduis ce texte académique du {source_name} vers le {target_name}.

Domaine: {domain}

TEXTE À TRADUIRE:
{text}

Fournis la traduction avec glossaire et notes en JSON valide."""
                }
            ]

            response = await self.client.chat(
                messages=messages,
                system=system_prompt,
                temperature=0.3,
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
                    logger.error("Could not parse translation response")
                    return {
                        "translated_text": text,
                        "glossary": [],
                        "notes": ["Erreur lors du parsing de la réponse"]
                    }

            # Validate result
            translated = result.get("translated_text", text)
            glossary = result.get("glossary", [])
            notes = result.get("notes", [])

            if not isinstance(glossary, list):
                glossary = []

            if not isinstance(notes, list):
                notes = []

            # Ensure glossary entries have required fields
            for entry in glossary:
                if not all(k in entry for k in ["original", "translated", "context"]):
                    logger.warning(f"Glossary entry missing fields: {entry}")

            logger.info(f"Translated {len(text.split())} words from {source_lang} to {target_lang}")

            return {
                "translated_text": translated,
                "glossary": glossary,
                "notes": notes
            }

        except Exception as e:
            logger.error(f"Error in translation: {e}")
            return {
                "translated_text": text,
                "glossary": [],
                "notes": [f"Erreur de traduction: {str(e)}"]
            }
