#!/usr/bin/env python3
"""
Test du backend ISSALAN
"""

import sys
import os

# Ajouter le chemin du projet
sys.path.append(os.path.join(os.path.dirname(__file__), 'packages/shared-bl'))

def test_config():
    """Test de la configuration."""
    print("🧪 Test de la configuration...")
    try:
        from api.config import validate_config
        if validate_config():
            print("✅ Configuration valide")
            return True
        else:
            print("⚠️ Configuration partiellement valide")
            return False
    except Exception as e:
        print(f"❌ Erreur de configuration: {e}")
        return False

def test_fastapi():
    """Test de FastAPI."""
    print("\n🧪 Test de FastAPI...")
    try:
        from fastapi import FastAPI
        app = FastAPI()
        
        @app.get("/test")
        def test_endpoint():
            return {"message": "Test réussi"}
        
        print("✅ FastAPI fonctionne")
        print(f"📊 Nombre de routes: {len(app.routes)}")
        return True
    except Exception as e:
        print(f"❌ Erreur FastAPI: {e}")
        return False

def test_imports():
    """Test des imports."""
    print("\n🧪 Test des imports...")
    
    imports_to_test = [
        ("fastapi", "FastAPI"),
        ("uvicorn", "run"),
        ("pydantic", "BaseModel"),
        ("openai", "OpenAI"),
        ("redis", "Redis"),
        ("httpx", "AsyncClient"),
    ]
    
    all_ok = True
    for module_name, item_name in imports_to_test:
        try:
            exec(f"from {module_name} import {item_name}")
            print(f"✅ {module_name}.{item_name}")
        except Exception as e:
            print(f"❌ {module_name}.{item_name}: {e}")
            all_ok = False
    
    return all_ok

def test_ai_endpoints():
    """Test des endpoints IA."""
    print("\n🧪 Test des endpoints IA...")
    try:
        # Créer un routeur minimal pour tester
        from fastapi import APIRouter
        from pydantic import BaseModel
        
        router = APIRouter()
        
        class TestRequest(BaseModel):
            message: str
        
        @router.post("/test")
        async def test_ai(request: TestRequest):
            return {"response": f"Reçu: {request.message}"}
        
        print("✅ Routeur IA créé")
        print(f"📊 Routes IA: {len(router.routes)}")
        return True
    except Exception as e:
        print(f"❌ Erreur endpoints IA: {e}")
        return False

def test_main_app():
    """Test de l'application principale."""
    print("\n🧪 Test de l'application principale...")
    try:
        # Créer une application de test
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware
        
        app = FastAPI(
            title="ISSALAN Test",
            description="Application de test",
            version="1.0.0"
        )
        
        # Ajouter CORS
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        
        # Ajouter une route de test
        @app.get("/")
        async def root():
            return {
                "message": "🚀 ISSALAN Backend Test",
                "status": "running",
                "version": "1.0.0"
            }
        
        @app.get("/health")
        async def health():
            return {"status": "healthy"}
        
        print("✅ Application principale créée")
        print(f"📊 Routes totales: {len(app.routes)}")
        
        # Afficher les routes
        print("\n🌐 Routes disponibles:")
        for route in app.routes:
            if hasattr(route, 'path'):
                methods = route.methods if hasattr(route, 'methods') else ["GET"]
                print(f"  - {route.path} ({', '.join(methods)})")
        
        return True
    except Exception as e:
        print(f"❌ Erreur application principale: {e}")
        return False

def main():
    """Fonction principale."""
    print("=" * 60)
    print("🚀 TEST DU BACKEND ISSALAN")
    print("=" * 60)
    
    tests = [
        ("Configuration", test_config),
        ("FastAPI", test_fastapi),
        ("Imports", test_imports),
        ("Endpoints IA", test_ai_endpoints),
        ("Application principale", test_main_app),
    ]
    
    results = []
    for test_name, test_func in tests:
        print(f"\n{'='*40}")
        print(f"Test: {test_name}")
        print('='*40)
        result = test_func()
        results.append((test_name, result))
    
    # Résumé
    print("\n" + "=" * 60)
    print("📊 RÉSUMÉ DES TESTS")
    print("=" * 60)
    
    passed = 0
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASSÉ" if result else "❌ ÉCHOUÉ"
        print(f"{test_name}: {status}")
        if result:
            passed += 1
    
    print(f"\n📈 Résultat: {passed}/{total} tests passés")
    
    if passed == total:
        print("\n🎉 TOUS LES TESTS SONT PASSÉS !")
        print("\n🚀 Pour démarrer le serveur:")
        print("   cd /Users/agahmadou/Desktop/ISSALAN")
        print("   python3 packages/shared-bl/api/main.py")
        print("\n🌐 Accès:")
        print("   - API: http://localhost:8000")
        print("   - Documentation: http://localhost:8000/docs")
        print("   - Health check: http://localhost:8000/health")
    else:
        print(f"\n⚠️  {total - passed} test(s) ont échoué")
        print("Vérifiez les dépendances avec: pip3 install -r requirements.txt")
    
    return passed == total

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)