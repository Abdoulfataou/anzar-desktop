"""
Service d'analyse de plagiat et d'originalité pour les travaux étudiants.

Utilise DeepSeek pour analyser le texte en chunks et identifier :
- Les passages potentiellement non-originaux
- Les phrases génériques ou clichés
- Les passages suspectes avec suggestions de reformulation

Usage:
    service = PlagiarismService()
    result = await service.analyze("Texte à analyser", sensitivity="medium")
    reformulated = await service.reformulate("Texte", passages)
"""

import json
import logging
from typing import Optional
import math

from services.deepseek_client import DeepSeekClient

logger = logging.getLogger(__name__)


class PlagiarismService:
    """Service pour analyser le plagiat et reformuler les passages suspects."""

    def __init__(self):
        self.client = DeepSeekClient()
        self.chunk_size = 200  # ~200 words per chunk

    def _split_into_chunks(self, text: str, chunk_size: int = 200) -> list[dict]:
        """Split text into chunks of approximately chunk_size words.

        Args:
            text: Text to split.
            chunk_size: Target words per chunk.

        Returns:
            List of dicts with 'text' and 'index' keys.
        """
        words = text.split()
        chunks = []

        for i in range(0, len(words), chunk_size):
            chunk_words = words[i:i+chunk_size]
            chunk_text = " ".join(chunk_words)
            chunks.append({
                "index": len(chunks),
                "text": chunk_text,
                "word_count": len(chunk_words)
            })

        return chunks

    async def analyze(
        self,
        text: str,
        sensitivity: str = "medium"
    ) -> dict:
        """Analyze text for plagiarism and originality issues.

        Args:
            text: Text to analyze.
            sensitivity: "low", "medium", or "high" - how strict the analysis is.

        Returns:
            Dict with keys:
            - originality_score (0-100)
            - flagged_passages (list of dicts with text, reason, severity, suggestion)
            - summary (str)
            - recommendations (list[str])
        """
        try:
            chunks = self._split_into_chunks(text, self.chunk_size)

            sensitivity_map = {
                "low": "Soyez permissif et ne signalez que les plagiats évidents",
                "medium": "Signalez les passages potentiellement non-originaux et les phrases génériques",
                "high": "Signalez rigoureusement tous les passages suspectes, clichés, ou formules génériques"
            }
            sensitivity_prompt = sensitivity_map.get(sensitivity, sensitivity_map["medium"])

            system_prompt = """Tu es un expert en détection de plagiat académique et en analyse d'originalité.
Analyse chaque chunk de texte fourni et identifie :
1. Les passages potentiellement non-originaux ou plagiés
2. Les phrases génériques, clichés ou formules trop communes
3. Les passages avec un style suspecte ou incohérent

Pour chaque passage problématique, fournis :
- text: le passage exact
- reason: pourquoi c'est suspect (plagiat potentiel, formule générique, etc.)
- severity: "low", "medium", ou "high"
- suggestion: une reformulation possible ou une recommandation

Répondre OBLIGATOIREMENT en JSON valide avec la structure :
{
    "chunk_index": int,
    "flagged_passages": [
        {
            "text": "...",
            "reason": "...",
            "severity": "...",
            "suggestion": "..."
        }
    ],
    "analysis_notes": "Notes générales sur ce chunk"
}

""" + sensitivity_prompt

            all_flagged = []
            chunk_analyses = []

            for chunk in chunks:
                messages = [
                    {
                        "role": "user",
                        "content": f"Analyse ce chunk (index {chunk['index']}) pour plagiat et originalité:\n\n{chunk['text']}"
                    }
                ]

                try:
                    response = await self.client.chat(
                        messages=messages,
                        system=system_prompt,
                        temperature=0.3,
                        max_tokens=1500
                    )

                    # Parse JSON response
                    try:
                        analysis = json.loads(response)
                    except json.JSONDecodeError:
                        # Try to extract JSON from response
                        start = response.find("{")
                        end = response.rfind("}") + 1
                        if start >= 0 and end > start:
                            analysis = json.loads(response[start:end])
                        else:
                            logger.warning(f"Could not parse chunk {chunk['index']} analysis")
                            analysis = {"flagged_passages": [], "analysis_notes": ""}

                    if "flagged_passages" in analysis:
                        all_flagged.extend(analysis["flagged_passages"])

                    chunk_analyses.append(analysis)

                except Exception as e:
                    logger.error(f"Error analyzing chunk {chunk['index']}: {e}")
                    continue

            # Calculate originality score (0-100, higher = more original)
            if all_flagged:
                total_flags = len(all_flagged)
                total_chunks = len(chunks)
                # Severity weights
                severity_weights = {"low": 1, "medium": 3, "high": 5}
                weighted_flags = sum(
                    severity_weights.get(f.get("severity", "low"), 1)
                    for f in all_flagged
                )
                # Score decreases with more/heavier flags
                originality_score = max(0, 100 - (weighted_flags * 10))
            else:
                originality_score = 100

            # Generate summary and recommendations
            summary_messages = [
                {
                    "role": "user",
                    "content": f"""Basé sur l'analyse d'originalité, fournis un résumé de {all_flagged.__len__()} passages problématiques trouvés.

Passages flaggés: {json.dumps(all_flagged[:5], ensure_ascii=False, indent=2)}

Fournis une réponse en JSON:
{{
    "summary": "Résumé de l'analyse (2-3 phrases)",
    "recommendations": ["Recommandation 1", "Recommandation 2", "Recommandation 3"]
}}"""
                }
            ]

            try:
                summary_response = await self.client.chat(
                    messages=summary_messages,
                    system="Tu es un expert académique fournissant des recommandations pour améliorer l'originalité d'un travail.",
                    temperature=0.3,
                    max_tokens=800
                )

                try:
                    summary_data = json.loads(summary_response)
                except json.JSONDecodeError:
                    start = summary_response.find("{")
                    end = summary_response.rfind("}") + 1
                    if start >= 0 and end > start:
                        summary_data = json.loads(summary_response[start:end])
                    else:
                        summary_data = {
                            "summary": "Analyse complétée. Plusieurs passages nécessitent review.",
                            "recommendations": ["Reformulez vos propres idées", "Citez les sources correctement"]
                        }
            except Exception as e:
                logger.error(f"Error generating summary: {e}")
                summary_data = {
                    "summary": "Analyse complétée avec passages à réviser.",
                    "recommendations": ["Revisitez les passages flaggés", "Améliorez les citations"]
                }

            return {
                "originality_score": originality_score,
                "flagged_passages": all_flagged,
                "summary": summary_data.get("summary", "Analyse terminée"),
                "recommendations": summary_data.get("recommendations", [])
            }

        except Exception as e:
            logger.error(f"Error in plagiarism analysis: {e}")
            return {
                "originality_score": 0,
                "flagged_passages": [],
                "summary": f"Erreur lors de l'analyse: {str(e)}",
                "recommendations": ["Veuillez réessayer ultérieurement"]
            }

    async def reformulate(
        self,
        text: str,
        passages: list[dict]
    ) -> str:
        """Reformulate flagged passages to improve originality.

        Args:
            text: Original text.
            passages: List of flagged passages with 'text' and 'suggestion' keys.

        Returns:
            Reformulated text.
        """
        try:
            passages_json = json.dumps(passages, ensure_ascii=False, indent=2)

            messages = [
                {
                    "role": "user",
                    "content": f"""Reformule le texte suivant en remplaçant les passages problématiques.

Texte original:
{text}

Passages à reformuler:
{passages_json}

Fournis le texte complet reformulé, en gardant le même sens et la même longueur approximative."""
                }
            ]

            system_prompt = """Tu es un expert en reformulation académique.
Tes tâches:
1. Reformule les passages flaggés en utilisant des synonymes et des structures différentes
2. Garde le sens et l'intention originale
3. Améliore la clarté et l'originalité
4. Fournis le texte complet reformulé"""

            reformulated = await self.client.chat(
                messages=messages,
                system=system_prompt,
                temperature=0.7,
                max_tokens=4096
            )

            return reformulated

        except Exception as e:
            logger.error(f"Error reformulating text: {e}")
            return text
