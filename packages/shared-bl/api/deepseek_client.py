"""
Client DeepSeek pour les appels à l'API.
Gère les deux modes : standard (chat) et raisonnement (reasoner).
"""

import os
import json
import logging
from typing import Dict, List, Any, Optional, AsyncGenerator
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class DeepSeekClient:
    """Client pour l'API DeepSeek avec support des deux modes."""
    
    def __init__(self):
        api_key = os.getenv('DEEPSEEK_API_KEY')
        base_url = os.getenv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')
        
        if not api_key or api_key == 'your_deepseek_api_key_here':
            raise ValueError("La clé API DeepSeek n'est pas configurée. Ajoutez-la dans le fichier .env")
        
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url
        )
        
        self.standard_model = os.getenv('DEEPSEEK_MODEL', 'deepseek-chat')
        self.reasoner_model = os.getenv('DEEPSEEK_REASONER_MODEL', 'deepseek-reasoner')
        
        logger.info(f"Client DeepSeek initialisé avec URL: {base_url}")
        logger.info(f"Modèles disponibles: Standard={self.standard_model}, Reasoner={self.reasoner_model}")
    
    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
        stream: bool = False,
        **kwargs
    ) -> Any:
        """
        Appel de complétion de chat.
        
        Args:
            messages: Liste des messages (system, user, assistant)
            model: Modèle à utiliser (None pour auto-sélection)
            temperature: Créativité (0.0-2.0)
            max_tokens: Nombre maximum de tokens en sortie
            stream: Streamer la réponse
            **kwargs: Paramètres additionnels
            
        Returns:
            Réponse de l'API
        """
        if model is None:
            # Détecter automatiquement le modèle basé sur le contexte
            model = self._detect_model_from_context(messages)
        
        # En mode reasoner, certains paramètres sont ignorés
        if model == self.reasoner_model:
            # Selon la documentation, en mode reasoner, temperature, top_p, presence_penalty, frequency_penalty sont ignorés
            params = {
                'model': model,
                'messages': messages,
                'max_tokens': max_tokens,
                'stream': stream,
            }
        else:
            params = {
                'model': model,
                'messages': messages,
                'temperature': temperature,
                'max_tokens': max_tokens,
                'stream': stream,
            }
        
        # Ajouter les paramètres additionnels
        params.update(kwargs)
        
        try:
            logger.debug(f"Appel API DeepSeek avec modèle: {model}, messages: {len(messages)}")
            
            if stream:
                return self._stream_completion(params)
            else:
                response = await self.client.chat.completions.create(**params)
                logger.debug(f"Réponse API reçue: {response.usage if response.usage else 'N/A'}")
                return response
        
        except Exception as e:
            logger.error(f"Erreur API DeepSeek: {e}")
            raise
    
    async def _stream_completion(self, params: Dict[str, Any]) -> AsyncGenerator[str, None]:
        """Gère les réponses streamées."""
        try:
            stream = await self.client.chat.completions.create(**params)
            
            async for chunk in stream:
                if chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content
        
        except Exception as e:
            logger.error(f"Erreur lors du streaming: {e}")
            yield f"[Erreur: {str(e)}]"
    
    def _detect_model_from_context(self, messages: List[Dict[str, str]]) -> str:
        """
        Détecte le modèle approprié basé sur le contexte.
        
        Règles:
        - Utilise le mode reasoner pour les tâches complexes (planification, analyse)
        - Utilise le mode standard pour les tâches simples (chat, débogage)
        """
        if not messages:
            return self.standard_model
        
        # Analyser le dernier message utilisateur
        last_user_message = None
        for msg in reversed(messages):
            if msg.get('role') == 'user':
                last_user_message = msg.get('content', '')
                break
        
        if not last_user_message:
            return self.standard_model
        
        # Mots-clés pour le mode reasoner
        reasoner_keywords = [
            'plan', 'planifier', 'architecture', 'analyser', 'analyse',
            'complexe', 'problème', 'solution', 'réflexion', 'raisonnement',
            'décomposer', 'étape', 'séquence', 'logique', 'algorithme',
            'design', 'concevoir', 'structurer', 'organiser', 'système'
        ]
        
        # Mots-clés pour le mode standard
        standard_keywords = [
            'code', 'écrire', 'générer', 'fichier', 'dossier',
            'simple', 'rapide', 'aide', 'question', 'explication',
            'bug', 'erreur', 'corriger', 'déboguer', 'tester'
        ]
        
        last_message_lower = last_user_message.lower()
        
        # Compter les occurrences
        reasoner_count = sum(1 for keyword in reasoner_keywords if keyword in last_message_lower)
        standard_count = sum(1 for keyword in standard_keywords if keyword in last_message_lower)
        
        # Décision basée sur les comptes et la longueur
        if reasoner_count > standard_count:
            return self.reasoner_model
        elif len(last_user_message) > 500:  # Messages longs → reasoner
            return self.reasoner_model
        else:
            return self.standard_model
    
    async def generate_text(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs
    ) -> str:
        """
        Génère du texte à partir d'un prompt.
        
        Args:
            prompt: Prompt utilisateur
            system_prompt: Prompt système (optionnel)
            model: Modèle spécifique (optionnel)
            **kwargs: Paramètres additionnels
            
        Returns:
            Texte généré
        """
        messages = []
        
        if system_prompt:
            messages.append({'role': 'system', 'content': system_prompt})
        
        messages.append({'role': 'user', 'content': prompt})
        
        response = await self.chat_completion(
            messages=messages,
            model=model,
            **kwargs
        )
        
        if hasattr(response, 'choices') and response.choices:
            return response.choices[0].message.content
        else:
            return str(response)
    
    async def generate_json(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Génère une réponse JSON à partir d'un prompt.
        
        Args:
            prompt: Prompt utilisateur
            system_prompt: Prompt système (optionnel)
            model: Modèle spécifique (optionnel)
            **kwargs: Paramètres additionnels
            
        Returns:
            Données JSON
        """
        # Ajouter une instruction pour formater en JSON
        json_prompt = f"{prompt}\n\nFormatte la réponse en JSON valide."
        
        if system_prompt:
            json_system = f"{system_prompt}\nTu dois toujours répondre avec du JSON valide."
        else:
            json_system = "Tu dois toujours répondre avec du JSON valide."
        
        response_text = await self.generate_text(
            prompt=json_prompt,
            system_prompt=json_system,
            model=model,
            **kwargs
        )
        
        try:
            # Essayer d'extraire le JSON de la réponse
            import re
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                # Si pas de JSON trouvé, essayer de parser directement
                return json.loads(response_text)
        except json.JSONDecodeError:
            logger.warning(f"Impossible de parser JSON de la réponse: {response_text[:200]}")
            return {'raw_response': response_text}
    
    def get_available_models(self) -> List[str]:
        """Retourne la liste des modèles disponibles."""
        return [self.standard_model, self.reasoner_model]
    
    def get_model_info(self, model: str) -> Dict[str, Any]:
        """Retourne des informations sur un modèle spécifique."""
        models_info = {
            self.standard_model: {
                'name': 'DeepSeek Chat',
                'description': 'Réponses rapides pour les questions simples, le débogage, les tâches courantes',
                'icon': '⚡',
                'context_length': 128000,
                'supports_streaming': True,
                'reasoning_mode': False
            },
            self.reasoner_model: {
                'name': 'DeepSeek Reasoner',
                'description': 'Réflexion approfondie pour les problèmes complexes, la planification, l\'analyse',
                'icon': '🧠',
                'context_length': 128000,
                'supports_streaming': True,
                'reasoning_mode': True
            }
        }
        
        return models_info.get(model, {
            'name': model,
            'description': 'Modèle DeepSeek',
            'icon': '🤖',
            'context_length': 128000,
            'supports_streaming': True,
            'reasoning_mode': False
        })


# Instance globale pour une utilisation facile
async def get_deepseek_client() -> DeepSeekClient:
    """Factory pour obtenir une instance de client DeepSeek."""
    return DeepSeekClient()