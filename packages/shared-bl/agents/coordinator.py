"""
Coordinateur intelligent - Gestionnaire de workflow des agents IA.
Orchestre la collaboration entre les 5 agents avec reprise sur erreur et routage intelligent.
"""

import asyncio
import json
import logging
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass, field
from enum import Enum
import time

logger = logging.getLogger(__name__)


class AgentStatus(Enum):
    """Statut d'un agent."""
    IDLE = "idle"
    PROCESSING = "processing"
    SUCCESS = "success"
    FAILED = "failed"
    RETRYING = "retrying"


@dataclass
class AgentResult:
    """Résultat d'exécution d'un agent."""
    agent_name: str
    status: AgentStatus
    output: Any
    error: Optional[str] = None
    execution_time: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkflowStep:
    """Étape du workflow."""
    agent_name: str
    dependencies: List[str] = field(default_factory=list)
    timeout: int = 300  # secondes
    max_retries: int = 3
    fallback_agent: Optional[str] = None


class AgentCoordinator:
    """Coordinateur intelligent pour les agents IA."""
    
    def __init__(self, agents: Dict[str, Any]):
        self.agents = agents
        self.results: Dict[str, AgentResult] = {}
        self.workflow_history: List[Dict[str, Any]] = []
        
        # Définition du workflow par défaut
        self.default_workflow = [
            WorkflowStep(
                agent_name="orchestrator",
                dependencies=[],
                timeout=60,
                max_retries=2
            ),
            WorkflowStep(
                agent_name="planner",
                dependencies=["orchestrator"],
                timeout=120,
                max_retries=3,
                fallback_agent="backup_planner"
            ),
            WorkflowStep(
                agent_name="coder",
                dependencies=["planner"],
                timeout=180,
                max_retries=3,
                fallback_agent="backup_coder"
            ),
            WorkflowStep(
                agent_name="tester",
                dependencies=["coder"],
                timeout=150,
                max_retries=2
            ),
            WorkflowStep(
                agent_name="executor",
                dependencies=["tester"],
                timeout=90,
                max_retries=1
            )
        ]
        
        # Métriques de performance
        self.metrics = {
            'total_executions': 0,
            'successful_executions': 0,
            'failed_executions': 0,
            'average_execution_time': 0.0,
            'total_retries': 0
        }
    
    async def execute_workflow(self, user_request: Dict[str, Any], 
                              custom_workflow: Optional[List[WorkflowStep]] = None) -> Dict[str, Any]:
        """
        Exécute le workflow complet des agents.
        
        Args:
            user_request: Requête utilisateur
            custom_workflow: Workflow personnalisé (optionnel)
            
        Returns:
            Résultats du workflow
        """
        workflow = custom_workflow or self.default_workflow
        self.results.clear()
        self.workflow_history = []
        
        logger.info(f"Démarrage du workflow avec {len(workflow)} étapes")
        
        # Vérifier la disponibilité des agents
        available_agents = await self._check_agent_availability(workflow)
        if not available_agents:
            raise ValueError("Agents requis non disponibles")
        
        # Exécuter le workflow étape par étape
        for step in workflow:
            try:
                result = await self._execute_step(step, user_request)
                self.results[step.agent_name] = result
                
                # Enregistrer dans l'historique
                self.workflow_history.append({
                    'step': step.agent_name,
                    'timestamp': time.time(),
                    'status': result.status.value,
                    'execution_time': result.execution_time,
                    'has_output': bool(result.output)
                })
                
                # Si l'agent a échoué et qu'un fallback existe
                if result.status == AgentStatus.FAILED and step.fallback_agent:
                    logger.warning(f"Agent {step.agent_name} a échoué, utilisation du fallback: {step.fallback_agent}")
                    fallback_result = await self._execute_fallback(step, user_request)
                    self.results[step.fallback_agent] = fallback_result
                
                # Mettre à jour les métriques
                self._update_metrics(result)
                
            except Exception as e:
                logger.error(f"Erreur lors de l'exécution de l'étape {step.agent_name}: {e}")
                # Continuer avec l'étape suivante si possible
                continue
        
        # Générer le rapport final
        final_report = await self._generate_final_report(user_request)
        
        logger.info(f"Workflow terminé. Succès: {self.metrics['successful_executions']}/{self.metrics['total_executions']}")
        
        return final_report
    
    async def _execute_step(self, step: WorkflowStep, user_request: Dict[str, Any]) -> AgentResult:
        """Exécute une étape du workflow."""
        start_time = time.time()
        
        # Vérifier les dépendances
        if not await self._check_dependencies(step):
            return AgentResult(
                agent_name=step.agent_name,
                status=AgentStatus.FAILED,
                output=None,
                error="Dépendances non satisfaites",
                execution_time=0.0
            )
        
        # Préparer le contexte
        context = await self._prepare_context(step)
        
        # Exécuter avec reprise sur erreur
        for attempt in range(step.max_retries):
            try:
                logger.info(f"Exécution de l'agent {step.agent_name} (tentative {attempt + 1}/{step.max_retries})")
                
                # Obtenir l'agent
                agent = self.agents.get(step.agent_name)
                if not agent:
                    raise ValueError(f"Agent {step.agent_name} non trouvé")
                
                # Exécuter avec timeout
                task = asyncio.create_task(agent.process(user_request, context=context))
                output = await asyncio.wait_for(task, timeout=step.timeout)
                
                # Succès
                execution_time = time.time() - start_time
                return AgentResult(
                    agent_name=step.agent_name,
                    status=AgentStatus.SUCCESS,
                    output=output,
                    execution_time=execution_time,
                    metadata={'attempts': attempt + 1}
                )
                
            except asyncio.TimeoutError:
                error_msg = f"Timeout après {step.timeout} secondes"
                logger.warning(f"Timeout pour l'agent {step.agent_name}: {error_msg}")
                
                if attempt == step.max_retries - 1:
                    execution_time = time.time() - start_time
                    return AgentResult(
                        agent_name=step.agent_name,
                        status=AgentStatus.FAILED,
                        output=None,
                        error=error_msg,
                        execution_time=execution_time,
                        metadata={'attempts': attempt + 1, 'timeout': True}
                    )
                
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Erreur de l'agent {step.agent_name}: {error_msg}")
                
                if attempt == step.max_retries - 1:
                    execution_time = time.time() - start_time
                    return AgentResult(
                        agent_name=step.agent_name,
                        status=AgentStatus.FAILED,
                        output=None,
                        error=error_msg,
                        execution_time=execution_time,
                        metadata={'attempts': attempt + 1}
                    )
                
                # Attendre avant de réessayer
                await asyncio.sleep(2 ** attempt)  # Backoff exponentiel
        
        # Ne devrait jamais arriver ici
        execution_time = time.time() - start_time
        return AgentResult(
            agent_name=step.agent_name,
            status=AgentStatus.FAILED,
            output=None,
            error="Échec après tous les essais",
            execution_time=execution_time
        )
    
    async def _execute_fallback(self, step: WorkflowStep, user_request: Dict[str, Any]) -> AgentResult:
        """Exécute l'agent de fallback."""
        if not step.fallback_agent:
            return AgentResult(
                agent_name=step.fallback_agent or "unknown",
                status=AgentStatus.FAILED,
                output=None,
                error="Aucun agent de fallback défini"
            )
        
        # Créer une étape de fallback simplifiée
        fallback_step = WorkflowStep(
            agent_name=step.fallback_agent,
            dependencies=step.dependencies,
            timeout=step.timeout,
            max_retries=1
        )
        
        return await self._execute_step(fallback_step, user_request)
    
    async def _check_agent_availability(self, workflow: List[WorkflowStep]) -> bool:
        """Vérifie la disponibilité des agents requis."""
        required_agents = set()
        for step in workflow:
            required_agents.add(step.agent_name)
            if step.fallback_agent:
                required_agents.add(step.fallback_agent)
        
        missing_agents = []
        for agent_name in required_agents:
            if agent_name not in self.agents:
                missing_agents.append(agent_name)
        
        if missing_agents:
            logger.warning(f"Agents manquants: {missing_agents}")
            return False
        
        return True
    
    async def _check_dependencies(self, step: WorkflowStep) -> bool:
        """Vérifie si les dépendances sont satisfaites."""
        for dep in step.dependencies:
            if dep not in self.results:
                return False
            
            result = self.results[dep]
            if result.status != AgentStatus.SUCCESS:
                return False
        
        return True
    
    async def _prepare_context(self, step: WorkflowStep) -> Dict[str, Any]:
        """Prépare le contexte pour l'agent."""
        context = {}
        
        # Ajouter les résultats des dépendances
        for dep in step.dependencies:
            if dep in self.results:
                context[dep] = self.results[dep].output
        
        # Ajouter des métadonnées
        context['workflow_step'] = step.agent_name
        context['previous_results'] = {k: v.status.value for k, v in self.results.items()}
        
        return context
    
    def _update_metrics(self, result: AgentResult):
        """Met à jour les métriques de performance."""
        self.metrics['total_executions'] += 1
        
        if result.status == AgentStatus.SUCCESS:
            self.metrics['successful_executions'] += 1
        else:
            self.metrics['failed_executions'] += 1
        
        # Mettre à jour le temps d'exécution moyen
        total_time = self.metrics['average_execution_time'] * (self.metrics['total_executions'] - 1)
        self.metrics['average_execution_time'] = (total_time + result.execution_time) / self.metrics['total_executions']
        
        # Compter les tentatives
        if 'attempts' in result.metadata and result.metadata['attempts'] > 1:
            self.metrics['total_retries'] += result.metadata['attempts'] - 1
    
    async def _generate_final_report(self, user_request: Dict[str, Any]) -> Dict[str, Any]:
        """Génère un rapport final du workflow."""
        successful_agents = []
        failed_agents = []
        
        for agent_name, result in self.results.items():
            if result.status == AgentStatus.SUCCESS:
                successful_agents.append({
                    'agent': agent_name,
                    'execution_time': result.execution_time,
                    'has_output': bool(result.output)
                })
            else:
                failed_agents.append({
                    'agent': agent_name,
                    'error': result.error,
                    'execution_time': result.execution_time
                })
        
        # Calculer le score de succès
        total_agents = len(self.results)
        success_rate = (len(successful_agents) / total_agents * 100) if total_agents > 0 else 0
        
        report = {
            'user_request': user_request,
            'summary': {
                'total_agents': total_agents,
                'successful_agents': len(successful_agents),
                'failed_agents': len(failed_agents),
                'success_rate': round(success_rate, 2),
                'total_execution_time': sum(r.execution_time for r in self.results.values()),
                'average_execution_time': self.metrics['average_execution_time']
            },
            'agent_results': {
                'successful': successful_agents,
                'failed': failed_agents
            },
            'workflow_history': self.workflow_history,
            'metrics': self.metrics,
            'final_output': await self._compile_final_output()
        }
        
        return report
    
    async def _compile_final_output(self) -> Dict[str, Any]:
        """Compile la sortie finale à partir des résultats des agents."""
        output = {}
        
        for agent_name, result in self.results.items():
            if result.status == AgentStatus.SUCCESS and result.output:
                output[agent_name] = result.output
        
        return output
    
    def get_workflow_status(self) -> Dict[str, Any]:
        """Retourne le statut actuel du workflow."""
        return {
            'active_agents': len(self.results),
            'successful': sum(1 for r in self.results.values() if r.status == AgentStatus.SUCCESS),
            'failed': sum(1 for r in self.results.values() if r.status == AgentStatus.FAILED),
            'metrics': self.metrics,
            'history': self.workflow_history
        }
    
    async def optimize_workflow(self, historical_data: List[Dict[str, Any]]) -> List[WorkflowStep]:
        """
        Optimise le workflow basé sur des données historiques.
        
        Args:
            historical_data: Données d'exécution précédentes
            
        Returns:
            Workflow optimisé
        """
        # Analyser les performances historiques
        agent_performance = {}
        for data in historical_data:
            for agent_result in data.get('agent_results', {}).get('successful', []):
                agent_name = agent_result['agent']
                if agent_name not in agent_performance:
                    agent_performance[agent_name] = []
                agent_performance[agent_name].append(agent_result['execution_time'])
        
        # Calculer les temps moyens
        avg_times = {}
        for agent_name, times in agent_performance.items():
            avg_times[agent_name] = sum(times) / len(times)
        
        # Réorganiser le workflow basé sur les performances
        # (les agents plus rapides en premier quand possible)
        optimized_workflow = []
        
        # Pour l'instant, retourner le workflow par défaut
        # Une implémentation plus sophistiquée analyserait les dépendances
        # et optimiserait l'ordre d'exécution
        
        return self.default_workflow


# Factory pour créer le coordinateur
async def create_agent_coordinator(agents: Dict[str, Any]) -> AgentCoordinator:
    """Factory pour créer un coordinateur d'agents."""
    return AgentCoordinator(agents)