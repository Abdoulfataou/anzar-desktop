# ISSALAN - Phase 2: Recherche Web Intégrée

## 🚀 Vue d'ensemble

ISSALAN entre dans sa Phase 2 avec l'implémentation d'un système de recherche web intégré qui rivalise avec Trae Solo. Cette phase transforme ISSALAN en une plateforme de développement IA complète, optimisée pour l'Afrique et inspirée par l'efficacité chinoise.

## ✨ Fonctionnalités Implémentées

### 🔍 Recherche Web Intelligente
- **Google Search API** - Résultats précis et à jour
- **DuckDuckGo Search** - Alternative gratuite et respectueuse de la vie privée
- **Orchestrateur Intelligent** - Combine les résultats des deux moteurs
- **Recherche Contextuelle** - Analyse le code pour des requêtes pertinentes
- **Cache Intelligent** - Optimise les performances

### 🌐 Endpoints API

#### Recherche Web
```bash
# Recherche web générale
POST /api/web/search
{
  "query": "Python async programming",
  "search_type": "general",
  "max_results": 10
}

# Recherche contextuelle basée sur le code
POST /api/web/search/code-context
{
  "code": "async def fetch_data(url): ...",
  "language": "python",
  "error_message": "ConnectionError"
}

# Recherche par lots
POST /api/web/search/batch
{
  "queries": ["Python", "JavaScript", "React"],
  "search_type": "general"
}

# Tendances de recherche
GET /api/web/search/trends

# Statistiques du cache
GET /api/web/cache/stats

# Nettoyer le cache
POST /api/web/cache/clear
```

## 🛠 Installation et Configuration

### Prérequis
- Python 3.8+
- pip3

### Installation des Dépendances
```bash
# Installer les dépendances principales
pip3 install fastapi uvicorn aiohttp beautifulsoup4 requests

# Installer les dépendances Google Search (optionnel)
pip3 install google-api-python-client google-auth-httplib2 google-auth-oauthlib
```

### Configuration
1. **Créer le fichier .env**
```bash
cp .env.example .env
```

2. **Configurer les clés API** (dans .env)
```env
# DeepSeek API
DEEPSEEK_API_KEY=votre_clé_api_ici

# Google Search API (optionnel)
GOOGLE_API_KEY=votre_clé_google_api_ici
GOOGLE_CSE_ID=votre_id_cse_ici
```

### Démarrer le Serveur
```bash
# Rendre le script exécutable
chmod +x start_web_api.sh

# Démarrer le serveur
./start_web_api.sh
```

## 🧪 Tests

### Test de la Recherche Web
```bash
# Exécuter le test simple
python3 test_search_simple.py

# Exécuter le test complet
python3 test_web_search.py
```

### Test des Endpoints API
```bash
# Test avec curl
curl -X POST "http://localhost:8000/api/web/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "Python programming", "max_results": 3}'
```

## 📁 Structure des Fichiers

```
ISSALAN/
├── packages/shared-bl/
│   ├── tools/
│   │   ├── search_orchestrator.py    # Orchestrateur principal
│   │   ├── google_search.py          # Client Google Search
│   │   └── duckduckgo_search.py      # Client DuckDuckGo
│   └── api/
│       ├── main.py                   # API principale
│       └── web_endpoints.py          # Endpoints recherche web
├── test_search_simple.py             # Test simple
├── test_web_search.py                # Test complet
├── start_web_api.sh                  # Script de démarrage
├── RECOMMANDATIONS_PHASE_2.md        # Recommandations complètes
└── README_PHASE_2.md                 # Ce fichier
```

## 🔧 Architecture Technique

### Composants Principaux

1. **SearchOrchestrator**
   - Combine Google et DuckDuckGo
   - Gère le cache intelligent
   - Analyse le contexte du code
   - Classe les résultats par pertinence

2. **GoogleSearch Client**
   - Interface avec Google Custom Search API
   - Recherche d'exemples de code
   - Recherche de documentation
   - Solutions d'erreurs

3. **DuckDuckGo Client**
   - Recherche gratuite et open source
   - Réponses instantanées
   - Respect de la vie privée
   - Alternative à Google

4. **API Endpoints**
   - FastAPI pour des performances optimales
   - Validation avec Pydantic
   - Documentation automatique (Swagger)
   - Gestion des erreurs

## 🎯 Cas d'Utilisation

### 1. Développeur Cherchant une Solution
```python
# Code avec une erreur
result = await search_orchestrator.search_code_with_context(
    code="df['column'].apply(lambda x: x.strip())",
    language="python",
    error_message="AttributeError: 'float' object has no attribute 'strip'"
)
```

### 2. Apprentissage d'un Nouveau Framework
```python
# Recherche de documentation
result = await search_orchestrator.search(
    query="React hooks useEffect tutorial",
    search_type="documentation",
    max_results=5
)
```

### 3. Recherche de Meilleures Pratiques
```python
# Recherche contextuelle
result = await search_orchestrator.search_code_with_context(
    code="""
    async def process_data(data):
        results = []
        for item in data:
            result = await api_call(item)
            results.append(result)
        return results
    """,
    language="python"
)
```

## 📈 Performance et Optimisation

### Cache
- **TTL:** 3 minutes pour les résultats frais
- **Déduplication:** Évite les résultats dupliqués
- **Classement:** Score de pertinence basé sur la source et le contenu

### Timeout
- **Recherche:** 10 secondes maximum par requête
- **Parallélisme:** Recherches simultanées sur plusieurs moteurs
- **Fallback:** Utilisation de DuckDuckGo si Google échoue

## 🔒 Sécurité

### Authentification
- API keys pour les services externes
- Validation des entrées utilisateur
- Limitation de débit (rate limiting)

### Données
- Cache local uniquement (pas de stockage permanent)
- Pas de logs des requêtes utilisateur
- Chiffrement des communications

## 🌍 Optimisation pour l'Afrique

### Infrastructure
- Serveurs locaux recommandés
- CDN régional pour de meilleures performances
- Support des langues locales

### Contenu
- Documentation en français
- Exemples pertinents pour le contexte africain
- Templates pour les projets africains

## 🚀 Prochaines Étapes

### Phase 2.1 (1-2 mois)
- [ ] Implémenter le système RAG (Retrieval-Augmented Generation)
- [ ] Ajouter la collaboration en temps réel
- [ ] Améliorer l'intégration Git
- [ ] Créer le marketplace d'extensions

### Phase 2.2 (2-3 mois)
- [ ] Développer le déploiement cloud automatisé
- [ ] Améliorer le support mobile
- [ ] Créer les IA spécialisées par domaine

## 📞 Support et Contribution

### Documentation
- [Recommandations Phase 2](RECOMMANDATIONS_PHASE_2.md)
- [Documentation API](http://localhost:8000/docs)
- [Code Source](https://github.com/issalan)

### Contact
- **Email:** contact@issalan.africa
- **GitHub:** https://github.com/issalan
- **Site Web:** https://issalan.africa

## 📄 Licence

ISSALAN est un projet open source sous licence MIT. Voir le fichier LICENSE pour plus de détails.

---

**ISSALAN - L'outil de développement IA pour l'Afrique, rivalisant avec les meilleurs outils mondiaux.**