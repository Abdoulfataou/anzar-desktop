"""
Classe de base pour tous les agents.
Fournit les fonctionnalités communes: appels DeepSeek, tracking tokens, retry logic.
"""

import logging
import json
import re
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod

from services.deepseek_client import DeepSeekClient

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """Classe de base pour tous les agents spécialisés."""

    def __init__(
        self,
        name: str,
        role: str,
        description: str,
        deepseek_client: Optional[DeepSeekClient] = None
    ):
        """
        Initialise un agent.

        Args:
            name: Nom unique de l'agent
            role: Rôle/domaine de l'agent
            description: Description de la responsabilité
            deepseek_client: Client DeepSeek (défaut: création d'une instance)
        """
        self.name = name
        self.role = role
        self.description = description
        self.deepseek_client = deepseek_client or DeepSeekClient()
        self.tokens_used = 0
        logger.info(f"✓ Agent initialisé: {name} ({role})")

    @abstractmethod
    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Exécute la tâche principale de l'agent.

        Args:
            request: Requête contenant les paramètres de la tâche

        Returns:
            Résultat de l'exécution
        """
        pass

    async def call_deepseek(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        stream: bool = False,
        response_format: Optional[Dict] = None,
    ) -> str:
        """
        Effectue un appel à l'API DeepSeek avec gestion d'erreur.

        Args:
            messages: Messages au format OpenAI
            model: Modèle à utiliser
            temperature: Température de génération
            max_tokens: Tokens maximums
            stream: Utiliser le streaming

        Returns:
            Réponse texte de DeepSeek
        """
        try:
            logger.debug(f"[{self.name}] Appel DeepSeek (tokens max: {max_tokens})")

            # Estimation tokens (approximation)
            self.tokens_used += max_tokens // 3

            if stream:
                result = ""
                async for chunk in self.deepseek_client.stream_chat(
                    messages=messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    response_format=response_format,
                ):
                    result += chunk
                return result
            else:
                return await self.deepseek_client.chat(
                    messages=messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    response_format=response_format,
                )

        except Exception as e:
            logger.error(f"[{self.name}] Erreur DeepSeek: {e}")
            raise

    @staticmethod
    def _repair_json(text: str) -> str:
        """Try to fix common LLM JSON errors so json.loads succeeds."""
        # Remove trailing commas before } or ]
        text = re.sub(r',\s*([}\]])', r'\1', text)
        # Add missing commas between "value" "key" (adjacent strings)
        text = re.sub(r'("\s*)\n(\s*")', r'\1,\n\2', text)
        # Add missing commas between } "key" or ] "key"
        text = re.sub(r'([}\]]\s*)\n(\s*")', r'\1,\n\2', text)
        # Add missing commas between "value"\n{ or "value"\n[
        text = re.sub(r'("\s*)\n(\s*[{\[])', r'\1,\n\2', text)
        # Fix unescaped newlines inside string values (crude but effective)
        # Remove any control characters except \n \r \t
        text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
        return text

    def parse_json_response(self, response: str) -> Dict[str, Any]:
        """
        Parse une réponse JSON de DeepSeek.
        Handles: raw JSON, ```json blocks, ```blocks, and JSON embedded in text.

        Args:
            response: Réponse texte contenant du JSON

        Returns:
            Dict parsé

        Raises:
            ValueError si le JSON est invalide
        """
        if not response or not response.strip():
            raise ValueError("Réponse vide de l'IA")

        candidates = []

        # Strategy 1: ```json block
        if "```json" in response:
            candidates.append(response.split("```json")[1].split("```")[0].strip())
        # Strategy 2: ``` block
        if "```" in response and "```json" not in response:
            parts = response.split("```")
            if len(parts) >= 3:
                candidates.append(parts[1].strip())
        # Strategy 3: raw string
        candidates.append(response.strip())
        # Strategy 4: find first { ... last }
        first_brace = response.find("{")
        last_brace = response.rfind("}")
        if first_brace != -1 and last_brace > first_brace:
            candidates.append(response[first_brace:last_brace + 1].strip())

        last_error = None
        for candidate in candidates:
            if not candidate:
                continue
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    logger.debug(f"[{self.name}] JSON parsé avec succès")
                    return parsed
            except json.JSONDecodeError as e:
                last_error = e
                continue

        # Strategy 5: try repairing common LLM JSON errors
        for candidate in candidates:
            if not candidate:
                continue
            try:
                repaired = self._repair_json(candidate)
                parsed = json.loads(repaired)
                if isinstance(parsed, dict):
                    logger.info(f"[{self.name}] JSON parsé après réparation")
                    return parsed
            except json.JSONDecodeError:
                continue

        logger.error(f"[{self.name}] Erreur parsing JSON: {last_error}")
        logger.debug(f"Réponse: {response[:300]}...")
        raise ValueError(f"Réponse JSON invalide: {last_error}")

    def log_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques de l'agent."""
        return {
            "name": self.name,
            "role": self.role,
            "tokens_used": self.tokens_used
        }
