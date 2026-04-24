#!/bin/bash

# ISSALAN - Script de démarrage
# Version 1.0.0

set -e

# Couleurs pour le terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonctions utilitaires
print_header() {
    echo -e "${BLUE}"
    echo "========================================"
    echo "   ISSALAN - Multi-Agent Generator"
    echo "========================================"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_dependencies() {
    print_info "Vérification des dépendances..."
    
    # Vérifier Docker
    if command -v docker &> /dev/null; then
        print_success "Docker trouvé"
    else
        print_error "Docker n'est pas installé"
        exit 1
    fi
    
    # Vérifier Docker Compose
    if command -v docker-compose &> /dev/null || docker compose version &> /dev/null; then
        print_success "Docker Compose trouvé"
    else
        print_error "Docker Compose n'est pas installé"
        exit 1
    fi
    
    # Vérifier Node.js (optionnel)
    if command -v node &> /dev/null; then
        print_success "Node.js trouvé"
    else
        print_warning "Node.js n'est pas installé (optionnel pour développement)"
    fi
    
    # Vérifier Python (optionnel)
    if command -v python3 &> /dev/null; then
        print_success "Python 3 trouvé"
    else
        print_warning "Python 3 n'est pas installé (optionnel pour développement)"
    fi
}

check_env_file() {
    print_info "Vérification du fichier .env..."
    
    if [ -f ".env" ]; then
        print_success "Fichier .env trouvé"
        
        # Vérifier la clé API DeepSeek
        if grep -q "DEEPSEEK_API_KEY=your_deepseek_api_key_here" .env || ! grep -q "DEEPSEEK_API_KEY=" .env; then
            print_warning "Clé API DeepSeek non configurée"
            echo ""
            echo "Pour obtenir une clé API DeepSeek gratuite :"
            echo "1. Allez sur https://platform.deepseek.com/"
            echo "2. Créez un compte gratuit"
            echo "3. Générez une clé API"
            echo "4. Éditez le fichier .env et remplacez 'your_deepseek_api_key_here'"
            echo ""
            read -p "Voulez-vous continuer sans clé API ? (y/n): " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        else
            print_success "Clé API DeepSeek configurée"
        fi
    else
        print_warning "Fichier .env non trouvé"
        cp .env.example .env
        print_success "Fichier .env créé à partir du template"
        echo ""
        echo "Veuillez configurer votre clé API DeepSeek dans le fichier .env"
        echo "Puis relancez ce script."
        exit 1
    fi
}

start_services() {
    print_info "Démarrage des services ISSALAN..."
    
    # Créer le répertoire pour les projets générés
    mkdir -p generated_projects
    mkdir -p logs
    
    # Démarrer les services
    if command -v docker-compose &> /dev/null; then
        docker-compose up --build -d
    else
        docker compose up --build -d
    fi
    
    print_success "Services démarrés avec succès"
}

stop_services() {
    print_info "Arrêt des services ISSALAN..."
    
    if command -v docker-compose &> /dev/null; then
        docker-compose down
    else
        docker compose down
    fi
    
    print_success "Services arrêtés"
}

show_status() {
    print_info "Statut des services ISSALAN..."
    
    echo ""
    echo "Services en cours d'exécution :"
    if command -v docker-compose &> /dev/null; then
        docker-compose ps
    else
        docker compose ps
    fi
    
    echo ""
    echo "Logs des services :"
    if command -v docker-compose &> /dev/null; then
        docker-compose logs --tail=10
    else
        docker compose logs --tail=10
    fi
}

show_urls() {
    print_info "URLs des services ISSALAN :"
    
    echo ""
    echo -e "${GREEN}🌐 Services disponibles :${NC}"
    echo "----------------------------------------"
    echo "📊 API Backend :     http://localhost:8000/docs"
    echo "💻 Application Web : http://localhost:3000"
    echo "📱 Application Mobile : Expo Go sur http://localhost:19002"
    echo "📈 Monitoring :      http://localhost:3001"
    echo "🔍 Prometheus :      http://localhost:9090"
    echo "----------------------------------------"
    echo ""
    echo -e "${YELLOW}🔑 Identifiants Grafana : admin / admin${NC}"
    echo ""
}

run_tests() {
    print_info "Exécution des tests..."
    
    # Tests backend
    if [ -d "packages/shared-bl" ]; then
        cd packages/shared-bl
        if [ -f "requirements.txt" ]; then
            print_info "Installation des dépendances de test..."
            pip install -r requirements.txt
        fi
        
        if command -v pytest &> /dev/null; then
            print_info "Exécution des tests Python..."
            python -m pytest tests/ -v
        else
            print_warning "pytest non installé, installation..."
            pip install pytest
            python -m pytest tests/ -v
        fi
        cd ../..
    else
        print_warning "Répertoire backend non trouvé, tests ignorés"
    fi
}

cleanup() {
    print_info "Nettoyage des ressources..."
    
    # Arrêter les services
    stop_services
    
    # Supprimer les volumes (optionnel)
    read -p "Voulez-vous supprimer les volumes Docker ? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if command -v docker-compose &> /dev/null; then
            docker-compose down -v
        else
            docker compose down -v
        fi
        print_success "Volumes supprimés"
    fi
    
    # Nettoyer le cache
    print_info "Nettoyage du cache..."
    docker system prune -f
    print_success "Nettoyage terminé"
}

show_help() {
    print_header
    echo ""
    echo "Usage: ./start.sh [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  start     - Démarrer tous les services (défaut)"
    echo "  stop      - Arrêter tous les services"
    echo "  restart   - Redémarrer tous les services"
    echo "  status    - Afficher le statut des services"
    echo "  test      - Exécuter les tests"
    echo "  clean     - Nettoyer les ressources"
    echo "  help      - Afficher ce message d'aide"
    echo ""
    echo "Exemples:"
    echo "  ./start.sh           # Démarrer ISSALAN"
    echo "  ./start.sh status    # Vérifier le statut"
    echo "  ./start.sh test      # Exécuter les tests"
    echo ""
}

# Main script
COMMAND=${1:-start}

case $COMMAND in
    start)
        print_header
        check_dependencies
        check_env_file
        start_services
        sleep 5  # Attendre que les services démarrent
        show_status
        show_urls
        print_success "ISSALAN est prêt ! 🚀"
        echo ""
        echo "Pour créer votre première application :"
        echo "1. Allez sur http://localhost:3000"
        echo "2. Cliquez sur 'New Project'"
        echo "3. Décrivez votre application"
        echo "4. Laissez les agents travailler !"
        echo ""
        ;;
    stop)
        print_header
        stop_services
        ;;
    restart)
        print_header
        stop_services
        sleep 2
        start_services
        show_status
        ;;
    status)
        print_header
        show_status
        ;;
    test)
        print_header
        run_tests
        ;;
    clean)
        print_header
        cleanup
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Commande inconnue: $COMMAND"
        show_help
        exit 1
        ;;
esac