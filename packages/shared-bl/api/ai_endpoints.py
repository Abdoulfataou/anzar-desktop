"""
Endpoints API pour les fonctionnalités IA
Optimisé pour l'efficacité chinoise : rapide, fiable, scalable
"""

import asyncio
import json
import logging
from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Import relatif simplifié
try:
    from ..tools.code_completion import (
        CodeCompletionEngine, 
        CompletionRequest, 
        CompletionResponse,
        CompletionItem,
        SuggestionItem
    )
    from ..api.enhanced_deepseek_client import EnhancedDeepSeekClient
except ImportError:
    # Fallback pour les tests
    CodeCompletionEngine = None
    CompletionRequest = None
    CompletionResponse = None
    CompletionItem = None
    SuggestionItem = None
    EnhancedDeepSeekClient = None

logger = logging.getLogger(__name__)

# Modèles Pydantic pour la validation
class AICompletionRequest(BaseModel):
    code: str
    language: str
    cursor_position: Dict[str, int]
    context: Optional[str] = None
    file_path: Optional[str] = None
    project_context: Optional[str] = None
    max_completions: int = 5

class AICompletionResponse(BaseModel):
    completions: List[Dict[str, Any]]
    suggestions: List[Dict[str, Any]]
    context: str
    latency: float
    confidence: float

class CodeGenerationRequest(BaseModel):
    prompt: str
    language: str
    context: Optional[str] = None
    model: str = "deepseek-chat"
    temperature: float = 0.7
    max_tokens: int = 2000

class CodeGenerationResponse(BaseModel):
    code: str
    explanation: Optional[str] = None
    latency: float

class CodeAnalysisRequest(BaseModel):
    code: str
    language: str
    include_suggestions: bool = True

class CodeAnalysisResponse(BaseModel):
    complexity: int
    quality_score: int
    security_score: int
    performance_score: int
    maintainability_score: int
    issues: List[Dict[str, Any]]
    suggestions: List[str]
    performance_tips: List[str]
    security_recommendations: List[str]
    architecture_insights: List[str]
    latency: float

class CodeRefactoringRequest(BaseModel):
    code: str
    language: str
    refactoring_type: str = "extract_method"
    target_lines: Optional[List[int]] = None

class CodeRefactoringResponse(BaseModel):
    refactored_code: str
    changes: int
    explanation: str
    latency: float

class CodeDebuggingRequest(BaseModel):
    code: str
    language: str
    error_message: Optional[str] = None
    stack_trace: Optional[str] = None

class CodeDebuggingResponse(BaseModel):
    fixed_code: str
    issues: List[Dict[str, Any]]
    explanation: str
    latency: float

class DocumentationSearchRequest(BaseModel):
    query: str
    language: str
    max_results: int = 5

class DocumentationSearchResponse(BaseModel):
    results: List[Dict[str, str]]
    summary: str
    latency: float

# Routeur FastAPI
router = APIRouter(prefix="/api/ai", tags=["AI"])

# Clients globaux
deepseek_client = None
completion_engine = None

def init_ai_endpoints(app, deepseek_client_instance):
    """Initialise les endpoints IA."""
    global deepseek_client, completion_engine
    
    deepseek_client = deepseek_client_instance
    completion_engine = CodeCompletionEngine(deepseek_client)
    
    # Inclure le routeur dans l'application
    app.include_router(router)
    
    logger.info("Endpoints IA initialisés")

@router.post("/completions", response_model=AICompletionResponse)
async def get_ai_completions(request: AICompletionRequest):
    """
    Obtient des complétions de code IA en temps réel.
    
    Args:
        request: Requête de complétion
        
    Returns:
        Réponse avec les complétions et suggestions
    """
    try:
        # Convertir la requête Pydantic en objet CompletionRequest
        completion_request = CompletionRequest(
            code=request.code,
            language=request.language,
            cursor_position=request.cursor_position,
            context=request.context,
            file_path=request.file_path,
            project_context=request.project_context,
            max_completions=request.max_completions
        )
        
        # Obtenir les complétions
        response = await completion_engine.get_completions(completion_request)
        
        # Convertir en format JSON
        completions_json = [
            {
                "text": item.text,
                "type": item.type,
                "confidence": item.confidence,
                "language": item.language,
                "documentation": item.documentation,
                "parameters": item.parameters,
                "return_type": item.return_type,
                "is_inline": item.is_inline
            }
            for item in response.completions
        ]
        
        suggestions_json = [
            {
                "type": item.type,
                "description": item.description,
                "code": item.code,
                "confidence": item.confidence,
                "impact": item.impact
            }
            for item in response.suggestions
        ]
        
        return AICompletionResponse(
            completions=completions_json,
            suggestions=suggestions_json,
            context=response.context,
            latency=response.latency,
            confidence=response.confidence
        )
        
    except Exception as e:
        logger.error(f"Erreur dans /completions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generate", response_model=CodeGenerationResponse)
async def generate_code(request: CodeGenerationRequest):
    """
    Génère du code avec IA.
    
    Args:
        request: Requête de génération de code
        
    Returns:
        Code généré avec explication
    """
    try:
        # Préparer le prompt
        system_prompt = f"""Tu es un expert en développement {request.language}. 
        Génère du code de haute qualité, bien structuré et commenté.
        Inclus des commentaires pour expliquer les parties importantes.
        """
        
        user_prompt = f"""
        Langage: {request.language}
        
        Prompt: {request.prompt}
        
        Contexte: {request.context or 'Aucun contexte supplémentaire'}
        
        Génère du code {request.language} qui répond au prompt.
        """
        
        # Appeler l'API DeepSeek
        response = await deepseek_client.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            model=request.model
        )
        
        code = response.choices[0].message.content
        
        # Extraire l'explication si présente
        explanation = None
        if "Explication:" in code or "Explanation:" in code:
            parts = code.split("Explication:" if "Explication:" in code else "Explanation:")
            if len(parts) > 1:
                code = parts[0].strip()
                explanation = parts[1].strip()
        
        return CodeGenerationResponse(
            code=code,
            explanation=explanation,
            latency=response.latency
        )
        
    except Exception as e:
        logger.error(f"Erreur dans /generate: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/analyze", response_model=CodeAnalysisResponse)
async def analyze_code(request: CodeAnalysisRequest):
    """
    Analyse le code avec IA.
    
    Args:
        request: Requête d'analyse de code
        
    Returns:
        Analyse détaillée du code
    """
    try:
        # Préparer le prompt d'analyse
        system_prompt = f"""Tu es un expert en analyse de code {request.language}.
        Analyse le code fourni et fournis une évaluation détaillée.
        """
        
        user_prompt = f"""
        Langage: {request.language}
        
        Code à analyser:
        ```{request.language}
        {request.code}
        ```
        
        Fournis une analyse complète incluant:
        1. Complexité (1-10)
        2. Score de qualité (0-100)
        3. Score de sécurité (0-100)
        4. Score de performance (0-100)
        5. Score de maintenabilité (0-100)
        6. Problèmes détectés (ligne, colonne, message, sévérité, catégorie)
        7. Suggestions d'amélioration
        8. Conseils de performance
        9. Recommandations de sécurité
        10. Insights d'architecture
        
        Format de réponse JSON:
        {{
            "complexity": 5,
            "quality_score": 85,
            "security_score": 90,
            "performance_score": 75,
            "maintainability_score": 80,
            "issues": [
                {{
                    "line": 1,
                    "column": 1,
                    "message": "Message",
                    "severity": "error|warning|info",
                    "category": "security|performance|style|bug|maintainability",
                    "fix": "Correction suggérée"
                }}
            ],
            "suggestions": ["Suggestion 1", "Suggestion 2"],
            "performance_tips": ["Tip 1", "Tip 2"],
            "security_recommendations": ["Rec 1", "Rec 2"],
            "architecture_insights": ["Insight 1", "Insight 2"]
        }}
        """
        
        # Appeler l'API DeepSeek
        response = await deepseek_client.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.2,
            max_tokens=2000,
            model="deepseek-reasoner"
        )
        
        # Parser la réponse JSON
        analysis_text = response.choices[0].message.content
        
        # Extraire le JSON de la réponse
        import re
        json_match = re.search(r'\{.*\}', analysis_text, re.DOTALL)
        
        if json_match:
            analysis_data = json.loads(json_match.group())
        else:
            # Fallback si pas de JSON
            analysis_data = {
                "complexity": 5,
                "quality_score": 70,
                "security_score": 80,
                "performance_score": 70,
                "maintainability_score": 75,
                "issues": [],
                "suggestions": ["Analyse complète non disponible"],
                "performance_tips": [],
                "security_recommendations": [],
                "architecture_insights": []
            }
        
        return CodeAnalysisResponse(
            complexity=analysis_data.get("complexity", 5),
            quality_score=analysis_data.get("quality_score", 70),
            security_score=analysis_data.get("security_score", 80),
            performance_score=analysis_data.get("performance_score", 70),
            maintainability_score=analysis_data.get("maintainability_score", 75),
            issues=analysis_data.get("issues", []),
            suggestions=analysis_data.get("suggestions", []),
            performance_tips=analysis_data.get("performance_tips", []),
            security_recommendations=analysis_data.get("security_recommendations", []),
            architecture_insights=analysis_data.get("architecture_insights", []),
            latency=response.latency
        )
        
    except Exception as e:
        logger.error(f"Erreur dans /analyze: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/refactor", response_model=CodeRefactoringResponse)
async def refactor_code(request: CodeRefactoringRequest):
    """
    Refactorise le code avec IA.
    
    Args:
        request: Requête de refactoring
        
    Returns:
        Code refactorisé
    """
    try:
        # Déterminer le type de refactoring
        refactoring_types = {
            "extract_method": "Extraire une méthode",
            "rename": "Renommer",
            "inline": "Inline",
            "simplify": "Simplifier"
        }
        
        refactoring_desc = refactoring_types.get(
            request.refactoring_type, 
            "Améliorer le code"
        )
        
        # Préparer le prompt
        system_prompt = f"""Tu es un expert en refactoring de code {request.language}.
        Refactorise le code pour l'améliorer selon: {refactoring_desc}
        """
        
        user_prompt = f"""
        Langage: {request.language}
        Type de refactoring: {refactoring_desc}
        
        Code à refactoriser:
        ```{request.language}
        {request.code}
        ```
        
        Lignes cibles: {request.target_lines or 'Toutes'}
        
        Fournis:
        1. Code refactorisé
        2. Nombre de changements
        3. Explication des changements
        
        Format:
        ```refactored
        [code refactorisé]
        ```
        
        Changements: [nombre]
        
        Explication: [explication]
        """
        
        # Appeler l'API DeepSeek
        response = await deepseek_client.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=2000,
            model="deepseek-reasoner"
        )
        
        response_text = response.choices[0].message.content
        
        # Extraire les parties
        import re
        
        # Extraire le code refactorisé
        code_match = re.search(r'```refactored\s*\n(.*?)\n```', response_text, re.DOTALL)
        if code_match:
            refactored_code = code_match.group(1).strip()
        else:
            # Fallback: prendre tout le texte
            refactored_code = response_text
        
        # Extraire le nombre de changements
        changes_match = re.search(r'Changements:\s*(\d+)', response_text)
        changes = int(changes_match.group(1)) if changes_match else 1
        
        # Extraire l'explication
        explanation_match = re.search(r'Explication:\s*(.*?)(?=\n\n|\Z)', response_text, re.DOTALL)
        explanation = explanation_match.group(1).strip() if explanation_match else "Refactoring effectué"
        
        return CodeRefactoringResponse(
            refactored_code=refactored_code,
            changes=changes,
            explanation=explanation,
            latency=response.latency
        )
        
    except Exception as e:
        logger.error(f"Erreur dans /refactor: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/debug", response_model=CodeDebuggingResponse)
async def debug_code(request: CodeDebuggingRequest):
    """
    Débogue le code avec IA.
    
    Args:
        request: Requête de débogage
        
    Returns:
        Code corrigé et explication
    """
    try:
        # Préparer le prompt
        system_prompt = f"""Tu es un expert en débogage de code {request.language}.
        Trouve et corrige les bugs dans le code.
        """
        
        user_prompt = f"""
        Langage: {request.language}
        
        Code à déboguer:
        ```{request.language}
        {request.code}
        ```
        
        Message d'erreur: {request.error_message or 'Aucun'}
        Stack trace: {request.stack_trace or 'Aucun'}
        
        Fournis:
        1. Code corrigé
        2. Liste des problèmes trouvés
        3. Explication des corrections
        
        Format:
        ```fixed
        [code corrigé]
        ```
        
        Problèmes:
        - [Problème 1]
        - [Problème 2]
        
        Explication: [explication]
        """
        
        # Appeler l'API DeepSeek
        response = await deepseek_client.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.2,
            max_tokens=2000,
            model="deepseek-reasoner"
        )
        
        response_text = response.choices[0].message.content
        
        # Extraire les parties
        import re
        
        # Extraire le code corrigé
        code_match = re.search(r'```fixed\s*\n(.*?)\n```', response_text, re.DOTALL)
        if code_match:
            fixed_code = code_match.group(1).strip()
        else:
            # Fallback: prendre tout le texte
            fixed_code = response_text
        
        # Extraire les problèmes
        issues = []
        problems_section = re.search(r'Problèmes:\s*(.*?)(?=\n\nExplication:|\Z)', response_text, re.DOTALL)
        if problems_section:
            problems_text = problems_section.group(1)
            problem_lines = [line.strip('- ') for line in problems_text.split('\n') if line.strip().startswith('-')]
            
            for i, problem in enumerate(problem_lines):
                issues.append({
                    "line": i + 1,
                    "column": 1,
                    "message": problem,
                    "severity": "error",
                    "category": "bug",
                    "fix": "Corrigé dans le code"
                })
        
        # Extraire l'explication
        explanation_match = re.search(r'Explication:\s*(.*?)(?=\n\n|\Z)', response_text, re.DOTALL)
        explanation = explanation_match.group(1).strip() if explanation_match else "Bugs corrigés avec succès"
        
        return CodeDebuggingResponse(
            fixed_code=fixed_code,
            issues=issues,
            explanation=explanation,
            latency=response.latency
        )
        
    except Exception as e:
        logger.error(f"Erreur dans /debug: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/documentation", response_model=DocumentationSearchResponse)
async def search_documentation(request: DocumentationSearchRequest):
    """
    Recherche de documentation avec IA.
    
    Args:
        request: Requête de recherche de documentation
        
    Returns:
        Résultats de recherche
    """
    try:
        # Préparer le prompt
        system_prompt = f"""Tu es un expert en documentation {request.language}.
        Recherche et fournis des informations de documentation pertinentes.
        """
        
        user_prompt = f"""
        Langage: {request.language}
        Requête: {request.query}
        
        Fournis jusqu'à {request.max_results} résultats de documentation pertinents.
        Inclus des liens, des exemples de code et des explications.
        
        Format:
        Résultats:
        1. [Titre] - [Description]
           [Lien/URL]
           [Exemple de code]
        2. [Titre] - [Description]
           [Lien/URL]
           [Exemple de code]
        
        Résumé: [résumé des résultats]
        """
        
        # Appeler l'API DeepSeek
        response = await deepseek_client.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=2000,
            model="deepseek-chat"
        )
        
        response_text = response.choices[0].message.content
        
        # Parser les résultats
        import re
        results = []
        
        # Extraire les résultats individuels
        result_pattern = r'(\d+)\.\s*(.*?)\s*-\s*(.*?)\n\s*(.*?)\n\s*```(?:.*?)\n(.*?)\n```'
        result_matches = re.findall(result_pattern, response_text, re.DOTALL)
        
        for match in result_matches:
            results.append({
                "title": match[1].strip(),
                "description": match[2].strip(),
                "url": match[3].strip(),
                "code_example": match[4].strip()
            })
        
        # Extraire le résumé
        summary_match = re.search(r'Résumé:\s*(.*?)(?=\n\n|\Z)', response_text, re.DOTALL)
        summary = summary_match.group(1).strip() if summary_match else "Documentation trouvée"
        
        return DocumentationSearchResponse(
            results=results,
            summary=summary,
            latency=response.latency
        )
        
    except Exception as e:
        logger.error(f"Erreur dans /documentation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Exporter le routeur
__all__ = ["router", "init_ai_endpoints"]
