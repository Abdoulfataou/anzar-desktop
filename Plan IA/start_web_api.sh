#!/bin/bash

# Script pour démarrer l'API ISSALAN avec recherche web intégrée
# Version: Phase 2 - Recherche Web

echo "🚀 Démarrage de l'API ISSALAN avec recherche web intégrée"
echo "========================================================"

# Vérifier si Python 3 est installé
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 n'est pas installé"
    exit 1
fi

# Vérifier les dépendances
echo "📦 Vérification des dépendances..."

# Vérifier les packages Python requis
REQUIRED_PACKAGES=(
    "fastapi"
    "uvicorn"
    "aiohttp"
    "beautifulsoup4"
    "requests"
    "google-api-python-client"
)

for package in "${REQUIRED_PACKAGES[@]}"; do
    if ! python3 -c "import $package" 2>/dev/null; then
        echo "⚠️  Package manquant: $package"
        echo "   Installation avec: pip3 install $package"
    fi
done

# Vérifier les variables d'environnement
echo "🔧 Configuration de l'environnement..."

if [ ! -f ".env" ]; then
    echo "⚠️  Fichier .env non trouvé, création d'un template..."
    cat > .env << EOF
# Configuration ISSALAN API
API_HOST=0.0.0.0
API_PORT=8000
DEBUG=true

# DeepSeek API
DEEPSEEK_API_KEY=votre_clé_api_ici
DEEPSEEK_BASE_URL=https://api.deepseek.com

# Google Search API (optionnel)
GOOGLE_API_KEY=votre_clé_google_api_ici
GOOGLE_CSE_ID=votre_id_cse_ici

# Base de données
DATABASE_URL=postgresql://user:password@localhost/issalan

# Redis
REDIS_URL=redis://localhost:6379

# Sécurité
SECRET_KEY=votre_clé_secrète_ici
ALLOWED_HOSTS=localhost,127.0.0.1
EOF
    echo "✅ Template .env créé. Veuillez configurer vos clés API."
fi

# Charger les variables d'environnement
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
    echo "✅ Variables d'environnement chargées"
else
    echo "⚠️  Fichier .env non trouvé, utilisation des valeurs par défaut"
    export API_HOST=0.0.0.0
    export API_PORT=8000
    export DEBUG=true
fi

# Vérifier le port
if lsof -Pi :$API_PORT -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Le port $API_PORT est déjà utilisé"
    read -p "Voulez-vous utiliser un autre port? (o/n): " change_port
    if [[ $change_port == "o" ]]; then
        read -p "Nouveau port: " NEW_PORT
        export API_PORT=$NEW_PORT
    else
        echo "❌ Impossible de démarrer, port occupé"
        exit 1
    fi
fi

# Démarrer le serveur
echo "🌐 Démarrage du serveur sur http://$API_HOST:$API_PORT"
echo "📚 Documentation: http://$API_HOST:$API_PORT/docs"
echo "🔍 Endpoints recherche web:"
echo "   POST http://$API_HOST:$API_PORT/api/web/search"
echo "   POST http://$API_HOST:$API_PORT/api/web/search/code-context"
echo "   GET  http://$API_HOST:$API_PORT/api/web/search/trends"
echo ""
echo "🔄 Démarrage en cours..."

# Exécuter le serveur
cd "$(dirname "$0")"
python3 packages/shared-bl/api/main.py

# Code de sortie
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Serveur arrêté normalement"
else
    echo "❌ Serveur arrêté avec code d'erreur: $EXIT_CODE"
fi

exit $EXIT_CODE