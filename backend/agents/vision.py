"""
Agent Vision — Analyse d'images via Kimi (Moonshot API).

Capacités:
  - Analyse de screenshots (UI/UX review, extraction de texte)
  - Description d'images (contenu, contexte, détails)
  - Extraction OCR (texte dans les images)
  - Analyse de diagrammes/schémas
  - Comparaison de designs (mockup vs implémentation)

Utilise l'API Kimi (Moonshot) qui est compatible OpenAI avec support vision.
"""

import logging
import json
import base64
from typing import Dict, Any, List, Optional
from pathlib import Path

import httpx
from config import settings

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPTS
# ────────────────────────────────────────────────────────────────────────────

VISION_ANALYZE_PROMPT = """Tu es un expert en analyse visuelle. Tu analyses les images avec précision et détail.

CAPACITÉS:
- Description détaillée du contenu visuel
- Extraction de texte (OCR) — retranscris tout texte visible fidèlement
- Analyse d'interfaces utilisateur (UI/UX)
- Interprétation de graphiques, diagrammes et schémas
- Identification de problèmes visuels (bugs d'affichage, erreurs de design)

RÈGLES:
1. Sois PRÉCIS: décris ce que tu vois réellement, pas ce que tu devines
2. Sois STRUCTURÉ: organise ta réponse par sections logiques
3. Sois COMPLET: ne saute aucun détail visible important
4. Pour les screenshots d'UI: identifie le layout, les composants, les couleurs, la typographie
5. Pour le texte dans les images: retranscris-le EXACTEMENT comme il apparaît
6. Si tu n'es pas sûr d'un élément, dis-le explicitement"""

VISION_UI_REVIEW_PROMPT = """Tu es un expert UI/UX senior. Tu analyses les screenshots d'interfaces et fournis un audit complet.

ÉVALUATION SUR 5 AXES:
1. DESIGN VISUEL (couleurs, typographie, espacements, cohérence)
2. UTILISABILITÉ (navigation, clarté, hiérarchie d'information)
3. RESPONSIVE (adaptation écran, éléments tronqués, scrolling)
4. ACCESSIBILITÉ (contrastes, tailles de texte, zones cliquables)
5. BUGS VISUELS (overflow, chevauchements, alignements cassés)

Pour chaque problème: décris-le, localise-le dans l'image, propose un fix concret.

Réponds en JSON:
{
    "score": 75,
    "axes": {
        "design": {"score": 80, "issues": ["..."], "suggestions": ["..."]},
        "usability": {"score": 70, "issues": ["..."], "suggestions": ["..."]},
        "responsive": {"score": 75, "issues": ["..."], "suggestions": ["..."]},
        "accessibility": {"score": 65, "issues": ["..."], "suggestions": ["..."]},
        "bugs": {"score": 85, "issues": ["..."], "suggestions": ["..."]}
    },
    "critical_issues": ["Issues bloquantes"],
    "quick_wins": ["Améliorations faciles à impact fort"],
    "verdict": "Résumé en 2 phrases"
}"""


class VisionAgent:
    """Agent vision — analyse d'images via l'API Kimi (Moonshot)."""

    def __init__(self):
        self.name = "vision"
        self.role = "Analyste Visuel"
        self.description = "Analyse les images et screenshots"
        self.tokens_used = 0
        self.api_key = settings.kimi_api_key
        self.base_url = (settings.kimi_base_url or "https://api.moonshot.cn").rstrip("/")
        if not self.base_url.endswith("/v1"):
            self.base_url = f"{self.base_url}/v1"
        self.model = settings.kimi_model
        self.timeout = httpx.Timeout(120.0, connect=15.0)

        logger.info(f"✓ VisionAgent initialisé (modèle: {self.model})")

    @property
    def is_available(self) -> bool:
        """True si l'API Kimi est configurée."""
        return bool(self.api_key)

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyse une image.

        Args:
            request: {
                "image_data": str,      # Base64-encoded image data
                "image_url": str,       # URL de l'image (alternatif à image_data)
                "prompt": str,          # Question/instruction sur l'image
                "mode": str,            # "analyze" | "ui_review" | "ocr" (défaut: "analyze")
            }

        Returns:
            {
                "status": "success",
                "analysis": str,        # Résultat de l'analyse
                "mode": str,
                "tokens_used": int,
            }
        """
        image_data = request.get("image_data", "")
        image_url = request.get("image_url", "")
        prompt = request.get("prompt", "Analyse cette image en détail.")
        mode = request.get("mode", "analyze")

        if not self.is_available:
            return {
                "status": "error",
                "error": "API Kimi non configurée (KIMI_API_KEY manquante)",
                "tokens_used": 0,
            }

        if not image_data and not image_url:
            return {
                "status": "error",
                "error": "Aucune image fournie (image_data ou image_url requis)",
                "tokens_used": 0,
            }

        logger.info(f"[{self.name}] Analyse image - Mode: {mode}")

        # Choisir le system prompt selon le mode
        system_prompts = {
            "analyze": VISION_ANALYZE_PROMPT,
            "ui_review": VISION_UI_REVIEW_PROMPT,
            "ocr": "Tu es un expert OCR. Extrais et retranscris TOUT le texte visible dans cette image, en préservant la mise en forme (titres, paragraphes, listes). Sois exhaustif et fidèle.",
        }
        system_prompt = system_prompts.get(mode, VISION_ANALYZE_PROMPT)

        # Construire le contenu multimodal
        content: List[Dict[str, Any]] = []

        # Ajouter l'image
        if image_data:
            # Détecter le type MIME
            mime_type = "image/png"
            if image_data.startswith("/9j/"):
                mime_type = "image/jpeg"
            elif image_data.startswith("iVBOR"):
                mime_type = "image/png"
            elif image_data.startswith("R0lGOD"):
                mime_type = "image/gif"

            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{image_data}",
                },
            })
        elif image_url:
            content.append({
                "type": "image_url",
                "image_url": {"url": image_url},
            })

        # Ajouter le prompt texte
        content.append({"type": "text", "text": prompt})

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ]

        try:
            response = await self._call_kimi(messages, mode)

            return {
                "status": "success",
                "analysis": response,
                "mode": mode,
                "tokens_used": self.tokens_used,
            }

        except Exception as e:
            logger.error(f"[{self.name}] Erreur analyse: {e}")
            return {
                "status": "error",
                "error": str(e),
                "tokens_used": self.tokens_used,
            }

    async def _call_kimi(self, messages: List[Dict], mode: str) -> str:
        """Appel à l'API Kimi avec gestion d'erreur."""
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3 if mode == "ocr" else 0.5,
            "max_tokens": 2048 if mode == "ocr" else 3000,
        }

        if mode == "ui_review":
            payload["response_format"] = {"type": "json_object"}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
            )

            if response.status_code != 200:
                error_text = response.text[:300]
                logger.error(f"[{self.name}] Kimi API error {response.status_code}: {error_text}")
                raise Exception(f"Kimi API error {response.status_code}")

            data = response.json()

            # Estimer les tokens
            usage = data.get("usage", {})
            input_tokens = usage.get("prompt_tokens", 0)
            output_tokens = usage.get("completion_tokens", 0)
            if input_tokens or output_tokens:
                self.tokens_used += input_tokens + output_tokens
            else:
                # Estimation fallback
                content_len = sum(
                    len(str(m.get("content", ""))) for m in messages
                )
                self.tokens_used += content_len // 4

            # Extraire la réponse
            choices = data.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "")

            return ""

    def log_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques de l'agent."""
        return {
            "name": self.name,
            "role": self.role,
            "tokens_used": self.tokens_used,
            "available": self.is_available,
        }
