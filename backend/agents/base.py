"""
Classe de base pour tous les agents.
Fournit les fonctionnalités communes: appels DeepSeek, tracking tokens, retry logic.
"""

import logging
import json
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
        stream: bool = False
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
                    max_tokens=max_tokens
                ):
                    result += chunk
                return result
            else:
                return await self.deepseek_client.chat(
                    messages=messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens
                )

        except Exception as e:
            logger.error(f"[{self.name}] Erreur DeepSeek: {e}")
            raise

    def parse_json_response(self, response: str) -> Dict[str, Any]:
        """
        Parse une réponse JSON de DeepSeek.

        Args:
            response: Réponse texte contenant du JSON

        Returns:
            Dict parsé ou vide si erreur

        Raises:
            ValueError si le JSON est invalide
        """
        try:
            # Chercher les blocs JSON entre ``` ou directement
            if "```json" in response:
                json_str = response.split("```json")[1].split("```")[0].strip()
            elif "```" in response:
                json_str = response.split("```")[1].split("```")[0].strip()
            else:
                json_str = response.strip()

            parsed = json.loads(json_str)
            logger.debug(f"[{self.name}] JSON parsé avec succès")
            return parsed

        except json.JSONDecodeError as e:
            logger.error(f"[{self.name}] Erreur parsing JSON: {e}")
            logger.debug(f"Réponse: {response[:200]}...")
            raise ValueError(f"Réponse JSON invalide: {e}")

    def log_stats(self) -> Dict[str, Any]:
        """Retourne les statistiques de l'agent."""
        return {
            "name": self.name,
            "role": self.role,
            "tokens_used": self.tokens_used
        }
