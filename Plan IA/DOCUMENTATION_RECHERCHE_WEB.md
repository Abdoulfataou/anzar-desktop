# 📚 Documentation - Recherche Web ISSALAN

## 🎯 Vue d'ensemble

**ISSALAN** intègre désormais un système de recherche web complet avec **Tavily API** et **fallback DuckDuckGo**, spécialement conçu pour les agents IA. Ce système rivalise avec **Trae Solo** et est optimisé pour l'Afrique.

## 🚀 Fonctionnalités Principales

### 1. **Tavily API (Recommandé)**
- ✅ **API spécialement conçue pour les agents IA**
- ✅ **Réponses synthétisées avec citations**
- ✅ **Format JSON optimisé pour les LLM** (économie de tokens)
- ✅ **Free tier: 1000 requêtes/mois** - suffisant pour MVP
- ✅ **Search depth: "basic" ou "advanced"**

### 2. **Fallback DuckDuckGo**
- ✅ **Gratuit, sans clé API requise**
- ✅ **Recherche web complète**
- ✅ **Réponses instantanées (Instant Answers)**
- ✅ **Recherche spécifique au code**

### 3. **Cache Redis Intelligent**
- ✅ **Évite les appels redondants**
- ✅ **TTL configurable** (1 heure par défaut)
- ✅ **Statistiques complètes** (hits, misses, performance)
- ✅ **Fallback mémoire** si Redis indisponible

### 4. **Optimisé pour les Agents IA**
- ✅ **Format JSON structuré** pour les LLM
- ✅ **Contexte intégré** aux requêtes
- ✅ **Recherche spécifique au code** (GitHub, Stack Overflow)
- ✅ **Recherche multiple en parallèle**
- ✅ **Outil `web_search()` prêt pour AG2 `register_function`**

## 📁 Structure des Fichiers

```
packages/shared-bl/tools/
├── search.py                    # Module Tavily Search principal
├── web_search_integration.py    # Intégration avec cache Redis
├── duckduckgo_search.py         # Fallback DuckDuckGo
└── __init__.py                  # Exports du package
```

## 🔧 Installation et Configuration

### 1. **Dépendances Python**
```bash
pip install aiohttp redis
```

### 2. **Variables d'Environnement (Optionnelles)**
```bash
# Tavily API (recommandé)
export TAVILY_API_KEY="votre_clé_api_tavily"

# Redis pour le cache (optionnel)
export REDIS_URL="redis://localhost:6379"
```

**Note:** Le système fonctionne sans configuration - il utilise automatiquement le fallback DuckDuckGo.

### 3. **Utilisation Basique**

```python
import asyncio
from packages.shared_bl.tools.search import web_search

async def main():
    # Recherche simple
    results = await web_search(
        query="Python async programming",
        search_depth="basic",
        max_results=5,
        include_answer=True
    )
    
    print(f"Réponse synthétisée: {results.get('answer')}")
    print(f"Nombre de résultats: {len(results.get('results', []))}")

asyncio.run(main())
```

## 🛠️ API Détaillée

### 1. **Fonction `web_search()`**
```python
async def web_search(
    query: str,
    search_depth: str = "basic",      # "basic" ou "advanced"
    max_results: int = 5,             # 1-10
    include_answer: bool = True,      # Inclure réponse synthétisée
    time_range: Optional[str] = None, # "day", "week", "month", "year"
    domain: Optional[str] = None      # Limiter à un domaine
) -> Dict[str, Any]
```

### 2. **Client TavilySearch**
```python
from packages.shared_bl.tools.search import TavilySearch

client = TavilySearch()
await client.initialize()

# Recherche avec contexte
results = await client.search_with_context(
    query="async programming",
    context="I'm learning Python asyncio",
    search_depth="advanced"
)

# Recherche spécifique au code
code_results = await client.search_code_specific(
    language="python",
    concept="list comprehension",
    include_examples=True
)

# Recherche multiple
multi_results = await client.search_multiple_queries(
    queries=["React", "Vue", "Angular"],
    max_results_per_query=3
)
```

### 3. **Intégration avec Cache Redis**
```python
from packages.shared_bl.tools.web_search_integration import (
    WebSearchWithRedisCache,
    get_web_search_integration
)

integration = get_web_search_integration()
await integration.initialize()

# Recherche avec cache
results = await integration.search(
    query="FastAPI framework",
    max_results=5,
    use_cache=True,
    cache_ttl=3600  # 1 heure
)

# Recherche pour agent
agent_results = await integration.search_for_agent(
    agent_id="agent_001",
    query="React hooks",
    context="Functional components",
    max_results=7
)

# Statistiques
stats = await integration.get_cache_stats()
print(f"Hits cache: {integration.stats['cache_hits']}")
```

### 4. **Outil pour Agents IA**
```python
from packages.shared_bl.tools.web_search_integration import agent_web_search_tool

# Outil prêt pour AG2 register_function
results = await agent_web_search_tool(
    query="Docker container networking",
    search_depth="basic",
    max_results=5,
    include_answer=True
)
```

## 🤖 Intégration avec AG2

```python
from packages.shared_bl.tools.web_search_integration import get_web_search_integration

class MyAgent:
    def __init__(self):
        self.agent_id = "my_agent_001"
        self.web_search_integration = get_web_search_integration()
    
    async def initialize(self):
        await self.web_search_integration.initialize()
        await self.web_search_integration.register_agent_function(self)
    
    # La fonction web_search sera automatiquement enregistrée
    # et disponible pour l'agent
```

## 📊 Format des Résultats

### Structure JSON Optimisée pour les LLM
```json
{
  "query": "Python programming language",
  "answer": "Python est un langage de programmation interprété, haut niveau...",
  "summary": "Résumé des résultats...",
  "results": [
    {
      "title": "Python Official Documentation",
      "url": "https://docs.python.org/",
      "content": "Documentation complète du langage Python...",
      "score": 0.95,
      "published_date": "2024-01-15",
      "author": "Python Software Foundation"
    }
  ],
  "images": [],
  "response_time": 1.2,
  "search_depth": "basic",
  "source": "tavily",  # ou "duckduckgo_fallback"
  "cached": false,
  "search_timestamp": "2024-01-15T10:30:00Z"
}
```

## 🧪 Tests

### 1. **Test du Module**
```bash
python3 test_final_web_search.py
```

### 2. **Tests Disponibles**
- ✅ **Configuration** : Vérifie les variables d'environnement et fichiers
- ✅ **Tavily Search** : Test du module principal
- ✅ **Intégration Web Search** : Test avec cache Redis
- ✅ **Fallback DuckDuckGo** : Test du fallback gratuit

### 3. **Résultats Attendus**
```
🚀 TEST FINAL - Recherche Web ISSALAN
============================================================
✅ Configuration: PASSÉ
✅ Tavily Search: PASSÉ  
✅ Intégration Web Search: PASSÉ
✅ Fallback DuckDuckGo: PASSÉ

Total: 4/4 tests passés (100%)
```

## 🌍 Avantages pour l'Afrique

### 1. **Accessibilité**
- ✅ **Gratuit** avec fallback DuckDuckGo
- ✅ **Faible consommation de données** (format JSON optimisé)
- ✅ **Fonctionne avec connexion limitée**

### 2. **Performance**
- ✅ **Cache intelligent** réduit la latence
- ✅ **Recherche parallèle** pour plusieurs requêtes
- ✅ **Format léger** adapté aux réseaux mobiles

### 3. **Adaptation Locale**
- ✅ **Support multilingue** (français, anglais, etc.)
- ✅ **Optimisé pour les développeurs Africains**
- ✅ **Documentation en français**

## 🔄 Comparaison avec Trae Solo

| Fonctionnalité | ISSALAN | Trae Solo |
|----------------|---------|-----------|
| **API Tavily** | ✅ Optimisée pour agents IA | ❌ Non disponible |
| **Fallback gratuit** | ✅ DuckDuckGo | ⚠️ Limité |
| **Cache Redis** | ✅ Intelligent avec stats | ❌ Basique |
| **Format JSON LLM** | ✅ Optimisé pour tokens | ⚠️ Standard |
| **Recherche code** | ✅ GitHub, Stack Overflow | ⚠️ Limité |
| **Recherche multiple** | ✅ Parallèle | ❌ Séquentielle |
| **Monitoring** | ✅ Statistiques complètes | ⚠️ Basique |
| **Prix** | ✅ Gratuit (fallback) | ❌ Payant |

## 🚀 Déploiement Production

### 1. **Configuration Production**
```bash
# .env.production
TAVILY_API_KEY=sk-tavily-votre-clé
REDIS_URL=redis://redis-prod:6379
CACHE_TTL=3600
```

### 2. **Docker**
```dockerfile
FROM python:3.11-slim
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "-m", "packages.shared_bl.tools.search"]
```

### 3. **Monitoring**
- **Cache hit rate** : Pourcentage de requêtes servies depuis le cache
- **Temps de réponse** : Latence moyenne des recherches
- **Utilisation API** : Nombre de requêtes Tavily vs fallback
- **Erreurs** : Taux d'erreurs et types

## 📞 Support et Dépannage

### Problèmes Courants

1. **"SSL Certificate Verify Failed"**
   ```python
   # Solution: Désactiver la vérification SSL (développement seulement)
   import ssl
   ssl._create_default_https_context = ssl._create_unverified_context
   ```

2. **Tavily API non configurée**
   - Le système utilise automatiquement DuckDuckGo
   - Obtenez une clé gratuite sur https://tavily.com

3. **Redis indisponible**
   - Le cache mémoire est utilisé automatiquement
   - Les fonctionnalités restent disponibles

### Logs
```python
import logging
logging.basicConfig(level=logging.INFO)
# Les logs incluent: cache hits/misses, source utilisée, temps de réponse
```

## 🔮 Roadmap Future

### Q3 2024
- [ ] **Recherche sémantique** : Compréhension contextuelle avancée
- [ ] **Cache distribué** : Redis Cluster pour haute disponibilité
- [ ] **Analytics** : Dashboard de performance

### Q4 2024
- [ ] **Plugins** : Support pour d'autres moteurs de recherche
- [ ] **Localisation** : Résultats optimisés par région Africaine
- [ ] **API GraphQL** : Interface de recherche flexible

## 🎉 Conclusion

**ISSALAN** offre désormais un système de recherche web **complet, performant et optimisé pour l'Afrique** qui rivalise avec **Trae Solo**. Avec son **API Tavily spécialement conçue pour les agents IA**, son **fallback DuckDuckGo gratuit**, et son **cache Redis intelligent**, il constitue une solution de classe entreprise adaptée aux besoins des développeurs Africains.

**Fait pour l'Afrique, par l'Afrique, avec l'ambition de rivaliser avec les meilleurs outils mondiaux.** 🚀

---
*Documentation générée le 18 Avril 2026 - ISSALAN v2.0.0*