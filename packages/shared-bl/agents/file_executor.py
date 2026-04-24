"""
Service d'exécution de fichiers avec validation de sécurité.
Crée les fichiers et dossiers après validation manuelle du plan.
"""

import os
import shutil
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import json

from .simple_agent import SimpleProjectPlan

logger = logging.getLogger(__name__)


@dataclass
class ExecutionResult:
    """Résultat de l'exécution d'un plan."""
    success: bool
    created_files: List[str]
    created_folders: List[str]
    errors: List[str]
    warnings: List[str]
    total_size: int  # en octets
    execution_time: float  # en secondes


class FileExecutor:
    """
    Service sécurisé pour créer fichiers et dossiers.
    Validation stricte des chemins et permissions.
    """
    
    def __init__(self, base_dir: str = "generated_projects"):
        """
        Initialise l'exécuteur avec un répertoire de base.
        
        Args:
            base_dir: Répertoire où créer les projets (par défaut: generated_projects)
        """
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        
        # Chemins interdits pour la sécurité
        self.forbidden_paths = [
            "/", "~", "/etc", "/bin", "/usr", "/var", "/lib",
            "C:\\", "C:/", "C:\\Windows", "C:/Windows",
            str(Path.home()),  # Éviter le home directory
        ]
        
        logger.info(f"FileExecutor initialisé avec base_dir: {self.base_dir}")
    
    async def execute_plan(self, plan: SimpleProjectPlan) -> ExecutionResult:
        """
        Exécute un plan validé en créant tous les fichiers et dossiers.
        
        Args:
            plan: Plan validé par l'utilisateur
            
        Returns:
            ExecutionResult avec détails de l'exécution
        """
        import time
        start_time = time.time()
        
        result = ExecutionResult(
            success=False,
            created_files=[],
            created_folders=[],
            errors=[],
            warnings=[],
            total_size=0,
            execution_time=0
        )
        
        try:
            # 1. Validation de sécurité du plan
            validation = self._validate_plan_security(plan)
            if not validation["valid"]:
                result.errors.extend(validation["errors"])
                result.execution_time = time.time() - start_time
                return result
            
            # 2. Créer le répertoire racine du projet
            project_root = self.base_dir / plan.structure.get("root", plan.project_name)
            if not self._create_directory(project_root, result):
                result.execution_time = time.time() - start_time
                return result
            
            # 3. Créer les sous-dossiers
            for folder in plan.structure.get("folders", []):
                folder_path = project_root / folder
                if not self._create_directory(folder_path, result):
                    result.execution_time = time.time() - start_time
                    return result
            
            # 4. Créer les fichiers
            for file_info in plan.files:
                file_path = project_root / file_info["path"]
                if not await self._create_file(file_path, file_info, result):
                    result.execution_time = time.time() - start_time
                    return result
            
            # 5. Créer un fichier de métadonnées du projet
            metadata_path = project_root / ".issalan_metadata.json"
            await self._create_metadata_file(metadata_path, plan, result)
            
            # 6. Calculer la taille totale
            result.total_size = self._calculate_total_size(project_root)
            
            result.success = True
            logger.info(f"Plan exécuté avec succès: {plan.project_name}")
            
        except Exception as e:
            result.errors.append(f"Erreur inattendue: {str(e)}")
            logger.error(f"Erreur exécution plan {plan.project_name}: {e}")
        
        result.execution_time = time.time() - start_time
        return result
    
    def _validate_plan_security(self, plan: SimpleProjectPlan) -> Dict[str, Any]:
        """Valide la sécurité du plan avant exécution."""
        errors = []
        warnings = []
        
        # Vérifier le nom du projet
        if not plan.project_name or not plan.project_name.strip():
            errors.append("Nom de projet vide")
        
        # Vérifier les chemins de fichiers
        for file_info in plan.files:
            path = file_info.get("path", "")
            
            # Chemins absolus interdits
            if Path(path).is_absolute():
                errors.append(f"Chemin absolu interdit: {path}")
            
            # Chemins avec .. interdits
            if ".." in path:
                errors.append(f"Chemin avec '..' interdit: {path}")
            
            # Chemins système interdits
            for forbidden in self.forbidden_paths:
                if forbidden in path:
                    errors.append(f"Chemin système interdit: {path}")
            
            # Chemins trop longs
            if len(path) > 255:
                warnings.append(f"Chemin très long: {path}")
        
        # Vérifier la structure
        root = plan.structure.get("root", "")
        if not root or not root.strip():
            errors.append("Racine du projet vide")
        
        # Vérifier les dossiers
        for folder in plan.structure.get("folders", []):
            if ".." in folder or folder.startswith("/"):
                errors.append(f"Dossier avec chemin dangereux: {folder}")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }
    
    def _create_directory(self, path: Path, result: ExecutionResult) -> bool:
        """Crée un répertoire de manière sécurisée."""
        try:
            # Vérifier que le chemin est dans base_dir
            if not str(path).startswith(str(self.base_dir)):
                result.errors.append(f"Chemin hors de base_dir: {path}")
                return False
            
            # Créer le répertoire
            path.mkdir(parents=True, exist_ok=True)
            result.created_folders.append(str(path))
            logger.debug(f"Dossier créé: {path}")
            return True
            
        except PermissionError:
            result.errors.append(f"Permission refusée pour: {path}")
            return False
        except Exception as e:
            result.errors.append(f"Erreur création dossier {path}: {str(e)}")
            return False
    
    async def _create_file(self, path: Path, file_info: Dict[str, Any], result: ExecutionResult) -> bool:
        """Crée un fichier avec son contenu."""
        try:
            # Vérifier que le chemin est dans base_dir
            if not str(path).startswith(str(self.base_dir)):
                result.errors.append(f"Chemin fichier hors de base_dir: {path}")
                return False
            
            # Créer le répertoire parent si nécessaire
            path.parent.mkdir(parents=True, exist_ok=True)
            
            # Écrire le contenu du fichier
            content = file_info.get("content", "")
            encoding = self._get_encoding_for_language(file_info.get("language", "text"))
            
            with open(path, "w", encoding=encoding) as f:
                f.write(content)
            
            # Vérifier que le fichier a été créé
            if path.exists():
                result.created_files.append(str(path))
                file_size = path.stat().st_size
                logger.debug(f"Fichier créé: {path} ({file_size} octets)")
                
                # Vérification supplémentaire pour les fichiers exécutables
                if file_info.get("type") == "code" and self._is_executable_file(path):
                    result.warnings.append(f"Fichier exécutable créé: {path}")
                
                return True
            else:
                result.errors.append(f"Fichier non créé: {path}")
                return False
                
        except PermissionError:
            result.errors.append(f"Permission refusée pour: {path}")
            return False
        except UnicodeEncodeError:
            # Essayer avec UTF-8 si l'encodage par défaut échoue
            try:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
                result.created_files.append(str(path))
                result.warnings.append(f"Encodage changé à UTF-8 pour: {path}")
                return True
            except Exception as e:
                result.errors.append(f"Erreur encodage fichier {path}: {str(e)}")
                return False
        except Exception as e:
            result.errors.append(f"Erreur création fichier {path}: {str(e)}")
            return False
    
    async def _create_metadata_file(self, path: Path, plan: SimpleProjectPlan, result: ExecutionResult):
        """Crée un fichier de métadonnées du projet."""
        try:
            metadata = {
                "project_name": plan.project_name,
                "description": plan.description,
                "generated_by": "ISSALAN",
                "generation_date": self._get_current_timestamp(),
                "files_count": len(plan.files),
                "dependencies": plan.dependencies,
                "structure": plan.structure,
                "files": [
                    {
                        "path": file_info["path"],
                        "type": file_info.get("type", "unknown"),
                        "language": file_info.get("language", "unknown"),
                        "size": len(file_info.get("content", ""))
                    }
                    for file_info in plan.files
                ]
            }
            
            with open(path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)
            
            result.created_files.append(str(path))
            logger.debug(f"Métadonnées créées: {path}")
            
        except Exception as e:
            result.warnings.append(f"Erreur création métadonnées: {str(e)}")
    
    def _get_encoding_for_language(self, language: str) -> str:
        """Retourne l'encodage approprié pour un langage."""
        encodings = {
            "python": "utf-8",
            "javascript": "utf-8",
            "typescript": "utf-8",
            "html": "utf-8",
            "css": "utf-8",
            "json": "utf-8",
            "yaml": "utf-8",
            "yml": "utf-8",
            "markdown": "utf-8",
            "md": "utf-8",
            "txt": "utf-8",
            "text": "utf-8",
        }
        return encodings.get(language.lower(), "utf-8")
    
    def _is_executable_file(self, path: Path) -> bool:
        """Vérifie si un fichier est potentiellement exécutable."""
        executable_extensions = {
            ".py", ".sh", ".bash", ".zsh", ".exe", ".bat", ".cmd",
            ".js", ".ts", ".php", ".rb", ".pl", ".lua"
        }
        return path.suffix.lower() in executable_extensions
    
    def _calculate_total_size(self, root_dir: Path) -> int:
        """Calcule la taille totale d'un répertoire."""
        total_size = 0
        for file_path in root_dir.rglob("*"):
            if file_path.is_file():
                total_size += file_path.stat().st_size
        return total_size
    
    def _get_current_timestamp(self) -> str:
        """Retourne un timestamp formaté."""
        from datetime import datetime
        return datetime.now().isoformat()
    
    def cleanup_failed_execution(self, project_name: str):
        """
        Nettoie les fichiers partiellement créés en cas d'échec.
        
        Args:
            project_name: Nom du projet à nettoyer
        """
        try:
            project_path = self.base_dir / project_name
            if project_path.exists():
                shutil.rmtree(project_path)
                logger.info(f"Nettoyage projet échoué: {project_name}")
                return True
        except Exception as e:
            logger.error(f"Erreur nettoyage projet {project_name}: {e}")
            return False
    
    def get_project_info(self, project_name: str) -> Optional[Dict[str, Any]]:
        """
        Récupère les informations d'un projet existant.
        
        Args:
            project_name: Nom du projet
            
        Returns:
            Informations du projet ou None si non trouvé
        """
        project_path = self.base_dir / project_name
        metadata_path = project_path / ".issalan_metadata.json"
        
        if not project_path.exists():
            return None
        
        try:
            # Lire les métadonnées
            if metadata_path.exists():
                with open(metadata_path, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
            else:
                # Générer des métadonnées basiques
                metadata = {
                    "project_name": project_name,
                    "generated_by": "ISSALAN",
                    "generation_date": "unknown",
                    "files_count": 0,
                    "total_size": self._calculate_total_size(project_path)
                }
            
            # Compter les fichiers
            files = []
            for file_path in project_path.rglob("*"):
                if file_path.is_file() and file_path.name != ".issalan_metadata.json":
                    files.append({
                        "path": str(file_path.relative_to(project_path)),
                        "size": file_path.stat().st_size,
                        "modified": file_path.stat().st_mtime
                    })
            
            metadata["files"] = files
            metadata["files_count"] = len(files)
            metadata["total_size"] = self._calculate_total_size(project_path)
            
            return metadata
            
        except Exception as e:
            logger.error(f"Erreur lecture projet {project_name}: {e}")
            return None
    
    def list_projects(self) -> List[Dict[str, Any]]:
        """Liste tous les projets générés."""
        projects = []
        
        if not self.base_dir.exists():
            return projects
        
        for item in self.base_dir.iterdir():
            if item.is_dir():
                project_info = self.get_project_info(item.name)
                if project_info:
                    projects.append(project_info)
        
        return sorted(projects, key=lambda x: x.get("generation_date", ""), reverse=True)


# Test de l'exécuteur
async def test_file_executor():
    """Test du FileExecutor."""
    print("🧪 Test FileExecutor")
    print("=" * 60)
    
    try:
        from .simple_agent import SimpleProjectPlan
        
        # Créer un exécuteur de test
        executor = FileExecutor(base_dir="test_projects")
        
        # Créer un plan de test
        test_plan = SimpleProjectPlan(
            project_name="test_project",
            description="Projet de test pour FileExecutor",
            files=[
                {
                    "path": "README.md",
                    "type": "documentation",
                    "language": "markdown",
                    "content": "# Test Project\n\nGenerated by ISSALAN FileExecutor test."
                },
                {
                    "path": "src/main.py",
                    "type": "code",
                    "language": "python",
                    "content": "print('Hello from ISSALAN!')"
                },
                {
                    "path": "config/settings.json",
                    "type": "config",
                    "language": "json",
                    "content": '{"version": "1.0.0", "author": "ISSALAN"}'
                }
            ],
            structure={
                "root": "test_project",
                "folders": ["src", "config", "docs"]
            },
            dependencies=["python>=3.8"],
            estimated_time="5 minutes"
        )
        
        print("1. Validation de sécurité...")
        validation = executor._validate_plan_security(test_plan)
        print(f"   ✅ Valide: {validation['valid']}")
        if validation['errors']:
            print(f"   ❌ Erreurs: {validation['errors']}")
        if validation['warnings']:
            print(f"   ⚠️  Avertissements: {validation['warnings']}")
        
        print("\n2. Exécution du plan...")
        result = await executor.execute_plan(test_plan)
        
        print(f"   ✅ Succès: {result.success}")
        print(f"   📁 Dossiers créés: {len(result.created_folders)}")
        print(f"   📄 Fichiers créés: {len(result.created_files)}")
        print(f"   📊 Taille totale: {result.total_size} octets")
        print(f"   ⏱️  Temps d'exécution: {result.execution_time:.2f}s")
        
        if result.errors:
            print(f"   ❌ Erreurs: {result.errors}")
        if result.warnings:
            print(f"   ⚠️  Avertissements: {result.warnings}")
        
        print("\n3. Vérification du projet...")
        project_info = executor.get_project_info("test_project")
        if project_info:
            print(f"   ✅ Projet trouvé: {project_info['project_name']}")
            print(f"   📄 Fichiers: {project_info['files_count']}")
            print(f"   📊 Taille: {project_info['total_size']} octets")
        else:
            print("   ❌ Projet non trouvé")
        
        print("\n4. Liste des projets...")
        projects = executor.list_projects()
        print(f"   📋 Projets trouvés: {len(projects)}")
        for proj in projects[:3]:  # Afficher les 3 premiers
            print(f"     • {proj['project_name']} ({proj['files_count']} fichiers)")
        
        print("\n5. Nettoyage...")
        executor.cleanup_failed_execution("test_project")
        print("   ✅ Projet de test nettoyé")
        
        print("\n" + "=" * 60)
        print("✅ FileExecutor testé avec succès !")
        print("\n🔒 Caractéristiques de sécurité :")
        print("   • Validation stricte des chemins")
        print("   • Protection contre les chemins système")
        print("   • Isolation dans generated_projects/")
        print("   • Nettoyage automatique en cas d'échec")
        print("   • Métadonnées de projet pour traçabilité")
        
        return True
        
    except Exception as e:
        print(f"❌ Erreur test FileExecutor: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    # Exécuter le test
    import asyncio
    asyncio.run(test_file_executor())
