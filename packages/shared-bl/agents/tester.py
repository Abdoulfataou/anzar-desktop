"""
Agent Testeur - Vérifie et corrige le code généré.
Analyse le code, trouve les bugs, les failles de sécurité, et propose des corrections.
"""

import ast
import json
import re
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from ag2 import Agent
from pydantic import BaseModel, Field
import logging

logger = logging.getLogger(__name__)


class CodeIssue(BaseModel):
    """Problème détecté dans le code."""
    severity: str = Field(..., description="high|medium|low")
    type: str = Field(..., description="bug|security|performance|style|documentation")
    location: str = Field(..., description="Fichier et ligne")
    description: str = Field(..., description="Description du problème")
    suggestion: str = Field(..., description="Suggestion de correction")
    code_snippet: str = Field("", description="Extrait de code problématique")


class CodeReview(BaseModel):
    """Revue de code complète."""
    file_path: str = Field(..., description="Chemin du fichier")
    language: str = Field(..., description="Langage de programmation")
    issues: List[CodeIssue] = Field(default_factory=list)
    score: float = Field(0.0, description="Score de qualité (0-100)")
    passed: bool = Field(False, description="Le code passe-t-il la revue ?")
    improvements: List[str] = Field(default_factory=list)


class TesterAgent:
    """Agent testeur pour vérifier la qualité du code."""
    
    def __init__(self, deepseek_client):
        self.deepseek_client = deepseek_client
        self.system_prompt = """Tu es un testeur QA rigoureux avec 10 ans d'expérience.
Ton rôle : Analyser le code, trouver les bugs, les failles de sécurité, et proposer des corrections.

Processus à suivre :
1. Analyse le code ligne par ligne pour trouver des problèmes
2. Identifie les bugs potentiels et les erreurs de logique
3. Détecte les failles de sécurité (injections, validation manquante, etc.)
4. Vérifie les problèmes de performance
5. Évalue la qualité du code (lisibilité, documentation, conventions)
6. Propose des corrections concrètes et améliorations

Format de réponse attendu (JSON) :
{
    "issues": [
        {
            "severity": "high",
            "type": "security",
            "location": "main.py:42",
            "description": "Injection SQL potentielle",
            "suggestion": "Utiliser des requêtes paramétrées",
            "code_snippet": "cursor.execute(f\"SELECT * FROM users WHERE name = '{name}'\")"
        }
    ],
    "score": 75.5,
    "passed": false,
    "improvements": [
        "Ajouter la validation des entrées",
        "Documenter les fonctions publiques"
    ]
}

Sois rigoureux, précis, et constructif dans tes retours."""
        
        self.agent = Agent(
            name="tester",
            system_prompt=self.system_prompt,
            tools=[],
            llm_client=self.deepseek_client
        )
    
    async def review_code(self, file_path: str, content: str, language: str) -> CodeReview:
        """Revue le code d'un fichier."""
        
        logger.info(f"Revue du code pour : {file_path} ({language})")
        
        # Vérifications automatiques basées sur le langage
        auto_issues = self._auto_analyze(file_path, content, language)
        
        # Analyse avec l'IA
        ai_review = await self._ai_review(file_path, content, language)
        
        # Combiner les résultats
        all_issues = auto_issues + ai_review.issues
        
        # Calculer le score
        score = self._calculate_score(all_issues, len(content.split('\n')))
        
        # Déterminer si le code passe
        passed = self._determine_pass(all_issues, score)
        
        # Générer les améliorations
        improvements = self._generate_improvements(all_issues)
        
        return CodeReview(
            file_path=file_path,
            language=language,
            issues=all_issues,
            score=score,
            passed=passed,
            improvements=improvements
        )
    
    def _auto_analyze(self, file_path: str, content: str, language: str) -> List[CodeIssue]:
        """Analyse automatique basée sur des règles."""
        issues = []
        
        if language == 'python':
            issues.extend(self._analyze_python(content, file_path))
        elif language in ['javascript', 'typescript']:
            issues.extend(self._analyze_javascript(content, file_path))
        
        # Vérifications communes
        issues.extend(self._common_checks(content, file_path))
        
        return issues
    
    def _analyze_python(self, content: str, file_path: str) -> List[CodeIssue]:
        """Analyse spécifique au Python."""
        issues = []
        
        try:
            tree = ast.parse(content)
            
            # Vérifier les imports dangereux
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name in ['pickle', 'marshal', 'os', 'subprocess']:
                            issues.append(CodeIssue(
                                severity="medium",
                                type="security",
                                location=f"{file_path}:{node.lineno}",
                                description=f"Import potentiellement dangereux : {alias.name}",
                                suggestion="Valider l'utilisation de ce module",
                                code_snippet=content.split('\n')[node.lineno-1]
                            ))
                
                # Vérifier les appels à eval()
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    if node.func.id == 'eval':
                        issues.append(CodeIssue(
                            severity="high",
                            type="security",
                            location=f"{file_path}:{node.lineno}",
                            description="Utilisation de eval() qui est dangereuse",
                            suggestion="Éviter eval(), utiliser des alternatives sécurisées",
                            code_snippet=content.split('\n')[node.lineno-1]
                        ))
                
                # Vérifier les chaînes de requêtes SQL brutes
                if isinstance(node, ast.Call):
                    # Recherche de patterns SQL
                    line = content.split('\n')[node.lineno-1]
                    if 'f"' in line and ('SELECT' in line or 'INSERT' in line or 'UPDATE' in line):
                        issues.append(CodeIssue(
                            severity="high",
                            type="security",
                            location=f"{file_path}:{node.lineno}",
                            description="Injection SQL potentielle avec f-string",
                            suggestion="Utiliser des requêtes paramétrées avec placeholders",
                            code_snippet=line
                        ))
        
        except SyntaxError as e:
            issues.append(CodeIssue(
                severity="high",
                type="bug",
                location=f"{file_path}:{e.lineno}",
                description=f"Erreur de syntaxe : {e.msg}",
                suggestion="Corriger la syntaxe Python",
                code_snippet=content.split('\n')[e.lineno-1] if e.lineno else ""
            ))
        
        return issues
    
    def _analyze_javascript(self, content: str, file_path: str) -> List[CodeIssue]:
        """Analyse spécifique au JavaScript/TypeScript."""
        issues = []
        
        # Vérifier eval()
        for i, line in enumerate(content.split('\n'), 1):
            if 'eval(' in line and not line.strip().startswith('//'):
                issues.append(CodeIssue(
                    severity="high",
                    type="security",
                    location=f"{file_path}:{i}",
                    description="Utilisation de eval() qui est dangereuse",
                    suggestion="Éviter eval(), utiliser JSON.parse() ou d'autres alternatives",
                    code_snippet=line
                ))
            
            # Vérifier innerHTML non échappé
            if '.innerHTML' in line and 'innerText' not in line and 'textContent' not in line:
                if not any(escape in line for escape in ['escape', 'encode', 'sanitize']):
                    issues.append(CodeIssue(
                        severity="medium",
                        type="security",
                        location=f"{file_path}:{i}",
                        description="Utilisation de innerHTML sans échappement",
                        suggestion="Utiliser textContent ou échapper le contenu",
                        code_snippet=line
                    ))
            
            # Vérifier les variables non déclarées
            if ' = ' in line and not any(decl in line for decl in ['let ', 'const ', 'var ', 'function ', 'class ']):
                if not line.strip().startswith('//') and not line.strip().startswith('*'):
                    # Simple check pour les affectations globales
                    issues.append(CodeIssue(
                        severity="low",
                        type="style",
                        location=f"{file_path}:{i}",
                        description="Variable potentiellement globale",
                        suggestion="Déclarer avec let, const ou var",
                        code_snippet=line
                    ))
        
        return issues
    
    def _common_checks(self, content: str, file_path: str) -> List[CodeIssue]:
        """Vérifications communes à tous les langages."""
        issues = []
        
        lines = content.split('\n')
        
        # Vérifier les lignes trop longues
        for i, line in enumerate(lines, 1):
            if len(line) > 120:
                issues.append(CodeIssue(
                    severity="low",
                    type="style",
                    location=f"{file_path}:{i}",
                    description="Ligne trop longue (>120 caractères)",
                    suggestion="Diviser la ligne ou reformater",
                    code_snippet=line[:100] + "..."
                ))
        
        # Vérifier les TODOs
        for i, line in enumerate(lines, 1):
            if 'TODO' in line.upper() or 'FIXME' in line.upper():
                issues.append(CodeIssue(
                    severity="low",
                    type="documentation",
                    location=f"{file_path}:{i}",
                    description="TODO ou FIXME trouvé",
                    suggestion="Implémenter ou résoudre le point marqué",
                    code_snippet=line
                ))
        
        # Vérifier les fonctions sans documentation
        if 'def ' in content or 'function ' in content:
            # Simple check pour les fonctions sans docstring/commentaire
            issues.append(CodeIssue(
                severity="low",
                type="documentation",
                location=file_path,
                description="Fonctions potentiellement non documentées",
                suggestion="Ajouter des docstrings ou commentaires",
                code_snippet=""
            ))
        
        return issues
    
    async def _ai_review(self, file_path: str, content: str, language: str) -> CodeReview:
        """Revue avec l'IA DeepSeek."""
        
        user_message = f"""
        Revue de code pour le fichier suivant :
        
        Fichier : {file_path}
        Langage : {language}
        
        Code à revoir :
        ```{language}
        {content}
        ```
        
        Analyse ce code et fournis une revue complète avec :
        1. Les problèmes de bugs potentiels
        2. Les failles de sécurité
        3. Les problèmes de performance
        4. Les problèmes de style et de documentation
        5. Un score de qualité (0-100)
        6. Des suggestions d'amélioration
        
        Format de réponse : JSON uniquement.
        """
        
        try:
            response = await self.agent.chat(user_message)
            
            if isinstance(response, str):
                # Essayer d'extraire le JSON
                import re
                json_match = re.search(r'\{.*\}', response, re.DOTALL)
                if json_match:
                    response_data = json.loads(json_match.group())
                else:
                    # Retour par défaut
                    return CodeReview(
                        file_path=file_path,
                        language=language,
                        issues=[],
                        score=50.0,
                        passed=False,
                        improvements=["Impossible d'analyser avec l'IA"]
                    )
            else:
                response_data = response
            
            # Convertir les issues
            issues = []
            for issue_data in response_data.get('issues', []):
                issues.append(CodeIssue(
                    severity=issue_data.get('severity', 'low'),
                    type=issue_data.get('type', 'style'),
                    location=issue_data.get('location', file_path),
                    description=issue_data.get('description', ''),
                    suggestion=issue_data.get('suggestion', ''),
                    code_snippet=issue_data.get('code_snippet', '')
                ))
            
            return CodeReview(
                file_path=file_path,
                language=language,
                issues=issues,
                score=response_data.get('score', 50.0),
                passed=response_data.get('passed', False),
                improvements=response_data.get('improvements', [])
            )
            
        except Exception as e:
            logger.error(f"Erreur lors de la revue IA : {e}")
            return CodeReview(
                file_path=file_path,
                language=language,
                issues=[],
                score=30.0,
                passed=False,
                improvements=["Erreur lors de l'analyse IA"]
            )
    
    def _calculate_score(self, issues: List[CodeIssue], line_count: int) -> float:
        """Calcule un score de qualité basé sur les problèmes."""
        if line_count == 0:
            return 100.0
        
        # Pondération par sévérité
        severity_weights = {
            'high': 10,
            'medium': 5,
            'low': 1
        }
        
        # Calculer le score de pénalité
        penalty = 0
        for issue in issues:
            penalty += severity_weights.get(issue.severity, 1)
        
        # Normaliser par nombre de lignes
        normalized_penalty = min(penalty / max(line_count, 1), 50)
        
        # Score de base
        base_score = 70.0  # Score par défaut pour du code moyen
        
        # Ajuster le score
        score = max(0.0, min(100.0, base_score - normalized_penalty))
        
        # Bonus pour le code sans problème
        if not issues:
            score = min(100.0, score + 20.0)
        
        return round(score, 1)
    
    def _determine_pass(self, issues: List[CodeIssue], score: float) -> bool:
        """Détermine si le code passe la revue."""
        # Vérifier les problèmes critiques
        critical_issues = [i for i in issues if i.severity == 'high' and i.type in ['security', 'bug']]
        
        if critical_issues:
            return False
        
        # Score minimum
        if score < 60.0:
            return False
        
        return True
    
    def _generate_improvements(self, issues: List[CodeIssue]) -> List[str]:
        """Génère une liste d'améliorations basées sur les problèmes."""
        improvements = []
        
        # Regrouper par type
        issue_types = {}
        for issue in issues:
            if issue.type not in issue_types:
                issue_types[issue.type] = []
            issue_types[issue.type].append(issue)
        
        # Générer des améliorations par catégorie
        if 'security' in issue_types:
            improvements.append("Renforcer la sécurité : valider toutes les entrées utilisateur")
        
        if 'bug' in issue_types:
            improvements.append("Corriger les bugs potentiels identifiés")
        
        if 'performance' in issue_types:
            improvements.append("Optimiser les performances")
        
        if 'style' in issue_types:
            improvements.append("Améliorer la lisibilité et suivre les conventions")
        
        if 'documentation' in issue_types:
            improvements.append("Ajouter/améliorer la documentation")
        
        # Si pas de problèmes spécifiques
        if not improvements and issues:
            improvements.append("Revoir le code généré pour amélioration générale")
        
        # Toujours recommander ces améliorations
        base_improvements = [
            "Ajouter des tests unitaires",
            "Configurer l'intégration continue (CI/CD)",
            "Documenter l'API si applicable"
        ]
        
        improvements.extend(base_improvements)
        
        return list(set(improvements))[:5]  # Limiter à 5 améliorations
    
    def suggest_fixes(self, issues: List[CodeIssue]) -> Dict[str, str]:
        """Suggère des corrections pour les problèmes identifiés."""
        fixes = {}
        
        for issue in issues:
            if issue.severity in ['high', 'medium']:
                fixes[issue.location] = {
                    'problem': issue.description,
                    'suggestion': issue.suggestion,
                    'code_snippet': issue.code_snippet
                }
        
        return fixes