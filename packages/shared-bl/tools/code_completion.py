"""
Outil de Complétion de Code IA
Inspiré de l'efficacité chinoise : rapide, précis, intelligent
"""

import os
import json
import asyncio
import logging
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import hashlib
import redis.asyncio as redis
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


@dataclass
class CompletionRequest:
    """Requête de complétion de code."""
    code: str
    language: str
    cursor_position: Dict[str, int]
    context: Optional[str] = None
    file_path: Optional[str] = None
    project_context: Optional[str] = None
    max_completions: int = 5


@dataclass
class CompletionItem:
    """Élément de complétion."""
    text: str
    type: str  # 'function', 'variable', 'class', 'import', 'comment', 'snippet', 'method', 'property'
    confidence: float
    language: str
    documentation: Optional[str] = None
    parameters: Optional[List[str]] = None
    return_type: Optional[str] = None
    is_inline: bool = False


@dataclass
class SuggestionItem:
    """Suggestion d'amélioration."""
    type: str  # 'refactor', 'optimize', 'fix', 'document', 'test'
    description: str
    code: str
    confidence: float
    impact: str  # 'low', 'medium', 'high'


@dataclass
class CompletionResponse:
    """Réponse de complétion."""
    completions: List[CompletionItem]
    suggestions: List[SuggestionItem]
    context: str
    latency: float
    confidence: float
    timestamp: datetime = field(default_factory=datetime.now)


class CodeCompletionEngine:
    """
    Moteur de complétion de code IA.
    Utilise DeepSeek API pour générer des complétions intelligentes.
    """
    
    def __init__(self, deepseek_client, redis_client=None):
        self.deepseek_client = deepseek_client
        self.redis_client = redis_client
        
        # Cache configuration
        self.cache_ttl = 300  # 5 minutes
        
        # Templates de prompts par langage
        self.prompt_templates = {
            'typescript': self._typescript_prompt_template,
            'javascript': self._javascript_prompt_template,
            'python': self._python_prompt_template,
            'java': self._java_prompt_template,
            'cpp': self._cpp_prompt_template,
            'go': self._go_prompt_template,
            'rust': self._rust_prompt_template,
            'html': self._html_prompt_template,
            'css': self._css_prompt_template,
            'sql': self._sql_prompt_template,
            'dockerfile': self._dockerfile_prompt_template,
            'yaml': self._yaml_prompt_template,
            'json': self._json_prompt_template,
            'markdown': self._markdown_prompt_template,
        }
        
        # Snippets par défaut par langage
        self.default_snippets = self._load_default_snippets()
        
        logger.info("Moteur de complétion de code initialisé")
    
    async def get_completions(self, request: CompletionRequest) -> CompletionResponse:
        """
        Obtient des complétions de code intelligentes.
        
        Args:
            request: Requête de complétion
            
        Returns:
            Réponse de complétion
        """
        start_time = datetime.now()
        
        # Générer la clé de cache
        cache_key = self._generate_cache_key(request)
        
        # Vérifier le cache
        cached = await self._get_cached_completions(cache_key)
        if cached:
            logger.debug(f"Cache hit pour {cache_key}")
            cached.latency = (datetime.now() - start_time).total_seconds() * 1000
            return cached
        
        try:
            # Obtenir des complétions IA
            ai_completions = await self._get_ai_completions(request)
            
            # Obtenir des suggestions
            suggestions = await self._get_suggestions(request)
            
            # Combiner avec les snippets par défaut
            all_completions = self._combine_completions(ai_completions, request.language)
            
            # Limiter le nombre de complétions
            limited_completions = all_completions[:request.max_completions]
            
            response = CompletionResponse(
                completions=limited_completions,
                suggestions=suggestions,
                context=f"Complétions IA pour {request.language}",
                latency=(datetime.now() - start_time).total_seconds() * 1000,
                confidence=self._calculate_confidence(limited_completions)
            )
            
            # Mettre en cache
            await self._cache_completions(cache_key, response)
            
            return response
            
        except Exception as e:
            logger.error(f"Erreur lors de la génération des complétions: {e}")
            # Retourner des complétions par défaut
            return self._get_fallback_completions(request, start_time)
    
    async def _get_ai_completions(self, request: CompletionRequest) -> List[CompletionItem]:
        """Obtient des complétions depuis l'API IA."""
        try:
            # Préparer le prompt
            prompt = self._build_prompt(request)
            
            # Appeler l'API DeepSeek
            response = await self.deepseek_client.chat_completion(
                messages=[
                    {
                        'role': 'system',
                        'content': 'Tu es un assistant de complétion de code expert. '
                                  'Génère uniquement du code, sans explications.'
                    },
                    {
                        'role': 'user',
                        'content': prompt
                    }
                ],
                temperature=0.3,
                max_tokens=500,
                model='deepseek-chat'
            )
            
            # Parser la réponse
            completions_text = response.choices[0].message.content
            
            # Convertir en CompletionItems
            return self._parse_completions(completions_text, request.language)
            
        except Exception as e:
            logger.warning(f"Erreur API IA: {e}. Utilisation des complétions par défaut.")
            return []
    
    def _build_prompt(self, request: CompletionRequest) -> str:
        """Construit le prompt pour l'API IA."""
        template_func = self.prompt_templates.get(
            request.language, 
            self._generic_prompt_template
        )
        
        return template_func(request)
    
    def _typescript_prompt_template(self, request: CompletionRequest) -> str:
        """Template de prompt pour TypeScript."""
        return f"""
        Langage: TypeScript
        Code actuel:
        ```typescript
        {request.code}
        ```
        
        Position du curseur: Ligne {request.cursor_position['line']}, Colonne {request.cursor_position['column']}
        
        Contexte: {request.context or 'Aucun contexte supplémentaire'}
        
        Génère 3-5 complétions de code pertinentes pour cette position.
        Format de réponse:
        ```
        1. [type] texte_de_la_complétion
        2. [type] texte_de_la_complétion
        ...
        ```
        
        Types possibles: function, variable, class, import, method, property, snippet
        """
    
    def _python_prompt_template(self, request: CompletionRequest) -> str:
        """Template de prompt pour Python."""
        return f"""
        Langage: Python
        Code actuel:
        ```python
        {request.code}
        ```
        
        Position du curseur: Ligne {request.cursor_position['line']}, Colonne {request.cursor_position['column']}
        
        Contexte: {request.context or 'Aucun contexte supplémentaire'}
        
        Génère 3-5 complétions de code pertinentes pour cette position.
        Format de réponse:
        ```
        1. [type] texte_de_la_complétion
        2. [type] texte_de_la_complétion
        ...
        ```
        
        Types possibles: function, variable, class, import, method, snippet
        """
    
    def _javascript_prompt_template(self, request: CompletionRequest) -> str:
        """Template de prompt pour JavaScript."""
        return f"""
        Langage: JavaScript
        Code actuel:
        ```javascript
        {request.code}
        ```
        
        Position du curseur: Ligne {request.cursor_position['line']}, Colonne {request.cursor_position['column']}
        
        Contexte: {request.context or 'Aucun contexte supplémentaire'}
        
        Génère 3-5 complétions de code pertinentes pour cette position.
        Format de réponse:
        ```
        1. [type] texte_de_la_complétion
        2. [type] texte_de_la_complétion
        ...
        ```
        
        Types possibles: function, variable, class, import, method, property, snippet
        """
    
    def _generic_prompt_template(self, request: CompletionRequest) -> str:
        """Template de prompt générique."""
        return f"""
        Langage: {request.language}
        Code actuel:
        ```{request.language}
        {request.code}
        ```
        
        Position du curseur: Ligne {request.cursor_position['line']}, Colonne {request.cursor_position['column']}
        
        Génère 3-5 complétions de code pertinentes pour cette position.
        Format de réponse:
        ```
        1. [type] texte_de_la_complétion
        2. [type] texte_de_la_complétion
        ...
        ```
        """
    
    def _parse_completions(self, completions_text: str, language: str) -> List[CompletionItem]:
        """Parse les complétions de la réponse IA."""
        items = []
        
        lines = completions_text.strip().split('\n')
        for line in lines:
            line = line.strip()
            if not line or not line[0].isdigit():
                continue
            
            # Extraire le type et le texte
            parts = line.split(' ', 1)
            if len(parts) < 2:
                continue
            
            number_part = parts[0]
            rest = parts[1]
            
            # Chercher le type entre crochets
            import re
            type_match = re.search(r'\[(\w+)\]', rest)
            
            if type_match:
                completion_type = type_match.group(1)
                text = rest[type_match.end():].strip()
            else:
                completion_type = 'snippet'
                text = rest.strip()
            
            # Nettoyer le numéro
            text = re.sub(r'^\d+\.\s*', '', text)
            
            # Créer l'item de complétion
            item = CompletionItem(
                text=text,
                type=completion_type,
                confidence=0.8,  # Confiance par défaut
                language=language,
                documentation=self._generate_documentation(text, completion_type, language)
            )
            
            items.append(item)
        
        return items
    
    def _generate_documentation(self, text: str, completion_type: str, language: str) -> str:
        """Génère une documentation pour la complétion."""
        if completion_type == 'function':
            return f"Fonction {language}"
        elif completion_type == 'variable':
            return f"Variable {language}"
        elif completion_type == 'class':
            return f"Classe {language}"
        elif completion_type == 'import':
            return f"Import {language}"
        elif completion_type == 'method':
            return f"Méthode {language}"
        elif completion_type == 'property':
            return f"Propriété {language}"
        else:
            return f"Snippet {language}"
    
    async def _get_suggestions(self, request: CompletionRequest) -> List[SuggestionItem]:
        """Obtient des suggestions d'amélioration."""
        suggestions = []
        
        # Analyser le code pour des suggestions
        code_analysis = await self._analyze_code_for_suggestions(request.code, request.language)
        
        for analysis in code_analysis:
            suggestion = SuggestionItem(
                type=analysis['type'],
                description=analysis['description'],
                code=analysis['code'],
                confidence=analysis['confidence'],
                impact=analysis['impact']
            )
            suggestions.append(suggestion)
        
        return suggestions
    
    async def _analyze_code_for_suggestions(self, code: str, language: str) -> List[Dict[str, Any]]:
        """Analyse le code pour générer des suggestions."""
        suggestions = []
        
        # Suggestions basiques basées sur des patterns communs
        if language in ['typescript', 'javascript']:
            # Vérifier les fonctions trop longues
            lines = code.split('\n')
            function_start = -1
            for i, line in enumerate(lines):
                if 'function ' in line or 'const ' in line and '=' in line and '=>' in line:
                    function_start = i
                elif function_start != -1 and line.strip() == '}':
                    function_length = i - function_start
                    if function_length > 20:
                        suggestions.append({
                            'type': 'refactor',
                            'description': f'Fonction trop longue ({function_length} lignes)',
                            'code': '// TODO: Extraire cette fonction en méthodes plus petites',
                            'confidence': 0.7,
                            'impact': 'medium'
                        })
                    function_start = -1
            
            # Vérifier les variables non utilisées
            import re
            variable_pattern = r'(const|let|var)\s+(\w+)\s*='
            variables = re.findall(variable_pattern, code)
            declared_vars = [var[1] for var in variables]
            
            for var_name in declared_vars:
                # Compter les utilisations (sans la déclaration)
                uses = len(re.findall(rf'\b{var_name}\b', code)) - 1
                if uses == 0:
                    suggestions.append({
                        'type': 'fix',
                        'description': f'Variable "{var_name}" déclarée mais non utilisée',
                        'code': f'// TODO: Supprimer ou utiliser la variable {var_name}',
                        'confidence': 0.9,
                        'impact': 'low'
                    })
        
        return suggestions
    
    def _combine_completions(self, ai_completions: List[CompletionItem], language: str) -> List[CompletionItem]:
        """Combine les complétions IA avec les snippets par défaut."""
        # Obtenir les snippets par défaut pour ce langage
        default_items = self.default_snippets.get(language, [])
        
        # Combiner et dédupliquer
        all_items = []
        seen_texts = set()
        
        # Ajouter d'abord les complétions IA
        for item in ai_completions:
            if item.text not in seen_texts:
                all_items.append(item)
                seen_texts.add(item.text)
        
        # Ajouter les snippets par défaut
        for item in default_items:
            if item.text not in seen_texts:
                all_items.append(item)
                seen_texts.add(item.text)
        
        # Trier par confiance
        all_items.sort(key=lambda x: x.confidence, reverse=True)
        
        return all_items
    
    def _load_default_snippets(self) -> Dict[str, List[CompletionItem]]:
        """Charge les snippets par défaut pour chaque langage."""
        snippets = {}
        
        # TypeScript/JavaScript
        snippets['typescript'] = snippets['javascript'] = [
            CompletionItem(
                text='console.log(${1:value});',
                type='snippet',
                confidence=0.9,
                language='typescript',
                documentation='Affiche une valeur dans la console'
            ),
            CompletionItem(
                text='const ${1:variable} = ${2:value};',
                type='variable',
                confidence=0.95,
                language='typescript',
                documentation='Déclare une constante'
            ),
            CompletionItem(
                text='function ${1:name}(${2:params}) {\n  ${3:// code}\n}',
                type='function',
                confidence=0.9,
                language='typescript',
                documentation='Déclare une fonction'
            ),
            CompletionItem(
                text='class ${1:ClassName} {\n  constructor(${2:params}) {\n    ${3:// code}\n  }\n}',
                type='class',
                confidence=0.85,
                language='typescript',
                documentation='Déclare une classe'
            ),
            CompletionItem(
                text='import { ${1:module} } from "${2:package}";',
                type='import',
                confidence=0.8,
                language='typescript',
                documentation='Importe un module'
            ),
        ]
        
        # Python
        snippets['python'] = [
            CompletionItem(
                text='print(${1:value})',
                type='snippet',
                confidence=0.9,
                language='python',
                documentation='Affiche une valeur'
            ),
            CompletionItem(
                text='def ${1:function_name}(${2:params}):\n    ${3:pass}',
                type='function',
                confidence=0.95,
                language='python',
                documentation='Déclare une fonction'
            ),
            CompletionItem(
                text='class ${1:ClassName}:\n    def __init__(self${2:, params}):\n        ${3:pass}',
                type='class',
                confidence=0.85,
                language='python',
                documentation='Déclare une classe'
            ),
            CompletionItem(
                text='import ${1:module}',
                type='import',
                confidence=0.8,
                language='python',
                documentation='Importe un module'
           