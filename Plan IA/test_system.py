#!/usr/bin/env python3
"""
Script de test pour vérifier que le système ISSALAN est correctement configuré.
"""

import os
import sys
import json
import subprocess
from pathlib import Path

def check_file_exists(path, description):
    """Vérifie si un fichier existe."""
    exists = os.path.exists(path)
    status = "✓" if exists else "✗"
    print(f"{status} {description}: {path}")
    return exists

def check_directory_exists(path, description):
    """Vérifie si un répertoire existe."""
    exists = os.path.isdir(path)
    status = "✓" if exists else "✗"
    print(f"{status} {description}: {path}")
    return exists

def check_python_import(module_name):
    """Vérifie si un module Python peut être importé."""
    try:
        __import__(module_name)
        print(f"✓ Module Python: {module_name}")
        return True
    except ImportError as e:
        print(f"✗ Module Python manquant: {module_name} - {e}")
        return False

def check_node_version():
    """Vérifie la version de Node.js."""
    try:
        result = subprocess.run(['node', '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✓ Node.js version: {result.stdout.strip()}")
            return True
        else:
            print("✗ Node.js non disponible")
            return False
    except FileNotFoundError:
        print("✗ Node.js non installé")
        return False

def check_docker():
    """Vérifie si Docker est disponible."""
    try:
        result = subprocess.run(['docker', '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✓ Docker version: {result.stdout.strip()}")
            return True
        else:
            print("✗ Docker non disponible")
            return False
    except FileNotFoundError:
        print("✗ Docker non installé")
        return False

def check_env_file():
    """Vérifie le fichier .env."""
    env_path = Path('.env')
    if env_path.exists():
        content = env_path.read_text()
        if 'your_deepseek_api_key_here' in content:
            print("⚠ Fichier .env trouvé mais clé API non configurée")
            return False
        else:
            print("✓ Fichier .env configuré correctement")
            return True
    else:
        print("✗ Fichier .env non trouvé")
        return False

def check_project_structure():
    """Vérifie la structure du projet."""
    print("\n📁 Structure du projet:")
    
    required_dirs = [
        ('packages/shared-bl/agents', 'Répertoire des agents'),
        ('packages/shared-bl/api', 'Répertoire API'),
        ('packages/shared-bl/tools', 'Répertoire des outils'),
        ('desktop/src', 'Répertoire desktop'),
        ('mobile/src', 'Répertoire mobile'),
    ]
    
    required_files = [
        ('requirements.txt', 'Dépendances Python'),
        ('docker-compose.yml', 'Configuration Docker'),
        ('Dockerfile.backend', 'Dockerfile backend'),
        ('README.md', 'Documentation'),
        ('start.sh', 'Script de démarrage'),
    ]
    
    all_good = True
    
    for dir_path, description in required_dirs:
        if not check_directory_exists(dir_path, description):
            all_good = False
    
    for file_path, description in required_files:
        if not check_file_exists(file_path, description):
            all_good = False
    
    return all_good

def check_backend_agents():
    """Vérifie les fichiers des agents backend."""
    print("\n🤖 Agents backend:")
    
    agent_files = [
        'packages/shared-bl/agents/orchestrator.py',
        'packages/shared-bl/agents/planner.py',
        'packages/shared-bl/agents/coder.py',
        'packages/shared-bl/agents/tester.py',
        'packages/shared-bl/agents/executor.py',
    ]
    
    all_good = True
    for agent_file in agent_files:
        if not check_file_exists(agent_file, f"Agent: {Path(agent_file).stem}"):
            all_good = False
    
    return all_good

def main():
    print("🧪 Test du système ISSALAN")
    print("=" * 50)
    
    # Vérifier les prérequis système
    print("\n🔧 Prérequis système:")
    check_node_version()
    check_docker()
    
    # Vérifier le fichier .env
    print("\n🔐 Configuration:")
    check_env_file()
    
    # Vérifier la structure du projet
    structure_ok = check_project_structure()
    
    # Vérifier les agents
    agents_ok = check_backend_agents()
    
    # Vérifier les imports Python
    print("\n🐍 Dépendances Python:")
    required_modules = [
        'fastapi',
        'uvicorn',
        'pydantic',
        'dotenv',
        'httpx',
    ]
    
    modules_ok = True
    for module in required_modules:
        if not check_python_import(module):
            modules_ok = False
    
    # Résumé
    print("\n" + "=" * 50)
    print("📊 RÉSUMÉ DU TEST")
    print("=" * 50)
    
    if structure_ok and agents_ok and modules_ok:
        print("✅ Système ISSALAN correctement configuré !")
        print("\n🚀 Pour démarrer:")
        print("   1. Configurez votre clé API DeepSeek dans le fichier .env")
        print("   2. Démarrez Docker Desktop")
        print("   3. Exécutez: ./start.sh")
        print("\n🌐 URLs après démarrage:")
        print("   - API Backend: http://localhost:8000/docs")
        print("   - Application Desktop: http://localhost:3000")
        print("   - Monitoring: http://localhost:3001 (admin/admin)")
    else:
        print("⚠️  Certains problèmes détectés.")
        print("\n🔧 Actions recommandées:")
        if not structure_ok:
            print("   - Vérifiez la structure du projet")
        if not agents_ok:
            print("   - Vérifiez les fichiers des agents")
        if not modules_ok:
            print("   - Installez les dépendances Python: pip install -r requirements.txt")
        
        print("\n💡 Pour installer les dépendances Python:")
        print("   python -m venv venv")
        print("   source venv/bin/activate  # ou venv\\Scripts\\activate sur Windows")
        print("   pip install -r requirements.txt")
    
    return 0 if structure_ok and agents_ok and modules_ok else 1

if __name__ == "__main__":
    sys.exit(main())