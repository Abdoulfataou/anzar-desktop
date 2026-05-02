"""
Agent Rédacteur Étudiant - Pipeline multi-étapes pour la rédaction académique.
Génère des documents académiques (mémoires, rapports, exposés, plans) avec outline, sections, et bibliographie.
"""

import logging
from typing import Dict, Any, List, Optional

from .base import BaseAgent

logger = logging.getLogger(__name__)


class StudentWriterAgent(BaseAgent):
    """Agent spécialisé dans la rédaction académique avec pipeline structuré."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="student_writer",
            role="Rédacteur Académique",
            description="Génère des documents académiques complets avec plans détaillés et sections structurées",
            deepseek_client=deepseek_client
        )

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Exécute le pipeline de rédaction académique multi-étapes.

        Args:
            request: {
                "user_prompt": str,         # Demande de l'utilisateur
                "document_type": str,       # "memoire" | "rapport" | "expose" | "plan"
                "context": {
                    "subject": str,
                    "level": str,
                    "outline": str,
                    "sections_done": list,
                    "current_section": str,
                },
                "messages": list,           # Historique de conversation
            }

        Returns:
            {
                "status": "success",
                "step": str,
                "content": str,
                "outline": dict,
                "sections": list,
                "tokens_used": int,
                "metadata": dict,
            }
        """
        user_prompt = request.get("user_prompt", "")
        document_type = request.get("document_type", "rapport")
        context = request.get("context", {})
        messages = request.get("messages", [])

        logger.info(f"[{self.name}] Démarrage pipeline - Type: {document_type}")

        try:
            # Step 1: Analyser la demande
            subject = context.get("subject")
            level = context.get("level")

            if not subject or not level:
                logger.debug(f"[{self.name}] Step 1: Analyse de la demande")
                analysis = await self._analyze_request(user_prompt, document_type)
                subject = analysis.get("subject", "")
                level = analysis.get("level", "")
            else:
                analysis = {"subject": subject, "level": level}
                logger.debug(f"[{self.name}] Step 1: Contexte fourni (sujet: {subject}, niveau: {level})")

            # Step 2: Générer l'outline/plan
            outline_str = context.get("outline")
            if not outline_str:
                logger.debug(f"[{self.name}] Step 2: Génération du plan/outline")
                outline_response = await self._generate_outline(
                    user_prompt,
                    subject,
                    level,
                    document_type
                )
                outline = outline_response.get("outline", {})
                outline_str = outline_response.get("outline_text", "")
            else:
                outline = self._parse_outline_str(outline_str)
                logger.debug(f"[{self.name}] Step 2: Plan fourni - {len(outline)} sections")

            # Step 3: Rédiger section par section
            sections_done = context.get("sections_done", [])
            current_section = context.get("current_section", "")
            all_sections = list(outline.keys()) if isinstance(outline, dict) else []

            logger.debug(f"[{self.name}] Step 3: Rédaction des sections - {len(sections_done)}/{len(all_sections)} complétées")

            # Déterminer quelle section rédiger
            if not current_section and sections_done:
                # Trouver la prochaine section non complétée
                for section in all_sections:
                    if section not in sections_done:
                        current_section = section
                        break
            elif not current_section:
                # Première section
                current_section = all_sections[0] if all_sections else ""

            full_content = ""
            sections_list = []

            if current_section and current_section not in sections_done:
                section_content = await self._write_section(
                    current_section,
                    outline.get(current_section, ""),
                    subject,
                    level,
                    document_type,
                    all_sections,
                    sections_done
                )
                full_content += f"\n## {current_section}\n\n{section_content}\n"
                sections_done.append(current_section)
                sections_list = sections_done
                logger.debug(f"[{self.name}] Section '{current_section}' rédigée")
            else:
                sections_list = all_sections
                logger.debug(f"[{self.name}] Toutes les sections complétées")

            # Step 4: Relire et polir (si c'est la dernière section)
            if len(sections_done) == len(all_sections):
                logger.debug(f"[{self.name}] Step 4: Relecture et polissage")
                # Reconstituer le document complet depuis le contexte
                # Pour cette première version, on saute cette étape
                pass

            # Step 5: Générer suggestions de bibliographie
            logger.debug(f"[{self.name}] Step 5: Génération des suggestions bibliographiques")
            bibliography = await self._generate_bibliography(
                subject,
                level,
                document_type
            )

            return {
                "status": "success",
                "step": "section_written" if current_section else "outline_generated",
                "content": full_content,
                "outline": outline,
                "sections": sections_list,
                "bibliography": bibliography,
                "tokens_used": self.tokens_used,
                "metadata": {
                    "subject": subject,
                    "level": level,
                    "document_type": document_type,
                    "sections_completed": len(sections_done),
                    "total_sections": len(all_sections),
                    "current_section": current_section,
                }
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur dans le pipeline: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used
            }

    async def _analyze_request(self, user_prompt: str, document_type: str) -> Dict[str, Any]:
        """Étape 1: Analyser et clarifier la demande."""
        system_prompt = """Tu es un assistant académique expert. Analyse la demande de l'étudiant et extrait:
- Le sujet/thème principal
- Le niveau académique estimé (Lycée | Licence | Master)
- Les mots-clés importants
- Les angles d'approche suggérés

Réponds en JSON avec les clés: subject, level, keywords, approaches"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Demande d'étudiant (type: {document_type}):\n{user_prompt}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.5,
            max_tokens=1024
        )

        try:
            result = self.parse_json_response(response)
            logger.debug(f"[{self.name}] Analyse: {result.get('subject', 'N/A')}")
            return result
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur parsing analyse: {e}")
            return {
                "subject": user_prompt[:50],
                "level": "Licence",
                "keywords": [],
                "approaches": []
            }

    async def _generate_outline(
        self,
        user_prompt: str,
        subject: str,
        level: str,
        document_type: str
    ) -> Dict[str, Any]:
        """Étape 2: Générer un plan/outline structuré."""

        type_guidance = {
            "memoire": "Structure académique formelle: Introduction, État de l'art, Méthodologie, Résultats, Discussion, Conclusion",
            "rapport": "Structure professionnelle: Introduction, Contexte, Analyse, Recommandations, Conclusion",
            "expose": "Structure présentatoire: Introduction, Points-clés (3-5), Conclusion, Discussion",
            "plan": "Plan détaillé du sujet sans rédaction complète"
        }

        system_prompt = f"""Tu es un expert en structuration académique. Génère un plan détaillé et structuré pour ce document.

Type de document: {document_type}
Guidance: {type_guidance.get(document_type, '')}
Niveau: {level}

Crée 5-7 sections principales avec sous-points. Réponds en JSON:
{{
    "outline": {{
        "section_1": "Description détaillée de cette section",
        "section_2": "Description...",
        ...
    }},
    "outline_text": "Version texte formatée du plan"
}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Sujet: {subject}\n\nDemande: {user_prompt}"}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.6,
            max_tokens=2048
        )

        try:
            result = self.parse_json_response(response)
            logger.debug(f"[{self.name}] Plan généré - {len(result.get('outline', {}))} sections")
            return result
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur parsing plan: {e}")
            return {
                "outline": {
                    "Introduction": "Présentation du sujet et de la problématique",
                    "Développement": "Analyse détaillée des aspects clés",
                    "Conclusion": "Synthèse et perspectives"
                },
                "outline_text": "Plan générique"
            }

    async def _write_section(
        self,
        section_title: str,
        section_description: str,
        subject: str,
        level: str,
        document_type: str,
        all_sections: List[str],
        sections_done: List[str]
    ) -> str:
        """Étape 3: Rédiger une section spécifique."""

        context_str = ""
        if sections_done:
            context_str = f"Sections déjà rédigées: {', '.join(sections_done)}\n"

        section_order = f"Section {len(sections_done) + 1}/{len(all_sections)}"

        system_prompt = f"""Tu es un excellent rédacteur académique. Rédige cette section de manière:
- Structurée et claire
- Adaptée au niveau {level}
- Cohérente avec le type de document ({document_type})
- Professionnelle et engageante

Section à rédiger: {section_title} ({section_order})
Description: {section_description}

Sujet global: {subject}
{context_str}

Rédige la section en markdown. Sois complet mais concis (400-600 mots). Inclus des sous-titres si pertinent."""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Rédige cette section complètement et de manière structurée."}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.7,
            max_tokens=3000
        )

        logger.debug(f"[{self.name}] Section '{section_title}' rédigée")
        return response

    async def _generate_bibliography(
        self,
        subject: str,
        level: str,
        document_type: str
    ) -> List[Dict[str, str]]:
        """Étape 5: Générer des suggestions de bibliographie."""

        system_prompt = f"""Tu es un expert en recherche académique. Suggère 5-8 sources pertinentes pour ce sujet.

Niveau: {level}
Type de document: {document_type}

Réponds en JSON avec un array 'bibliography' contenant des objets avec:
- "author": Auteur
- "title": Titre
- "year": Année
- "type": Type (livre, article, site web, etc.)
- "citation_apa": Citation format APA

Exemple:
{{
    "bibliography": [
        {{"author": "Dupont, J.", "title": "Titre du livre", "year": 2020, "type": "livre", "citation_apa": "Dupont, J. (2020)..."}}
    ]
}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Sujet: {subject}\n\nSuggère des sources pertinentes pour ce sujet."}
        ]

        response = await self.call_deepseek(
            messages=messages,
            temperature=0.5,
            max_tokens=2048
        )

        try:
            result = self.parse_json_response(response)
            bibliography = result.get("bibliography", [])
            logger.debug(f"[{self.name}] Bibliographie: {len(bibliography)} sources")
            return bibliography
        except Exception as e:
            logger.warning(f"[{self.name}] Erreur parsing bibliographie: {e}")
            return []

    def _parse_outline_str(self, outline_str: str) -> Dict[str, str]:
        """Parse une outline stockée en string JSON vers dict."""
        try:
            if isinstance(outline_str, str):
                import json
                parsed = json.loads(outline_str)
                if isinstance(parsed, dict):
                    return parsed
        except Exception:
            pass

        # Fallback: créer un dict simple
        return {"Section 1": outline_str}
