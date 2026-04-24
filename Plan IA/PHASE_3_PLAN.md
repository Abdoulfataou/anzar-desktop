# PHASE 3 : Système RAG (Retrieval-Augmented Generation)

## 🎯 Objectif
Implémenter un système de recherche augmentée par récupération (RAG) pour ISSALAN, permettant aux agents IA d'accéder à une base de connaissances riche et pertinente pour fournir des réponses plus précises et contextuelles.

## 📊 Architecture du Système RAG

### 1. Système d'Embeddings
- **Multi-fournisseurs**: OpenAI, DeepSeek, Sentence Transformers, Ollama
- **Cache intelligent**: Mémoire + disque avec TTL configurable
- **Optimisation batch**: Génération d'embeddings par lots
- **Similarité cosinus**: Calcul de similarité entre textes

### 2. Base de Données Vectorielle
- **Backends supportés**: 
  - ChromaDB (production)
  - FAISS (local haute performance)
  - Qdrant (cloud/auto-hébergé)
  - Pinecone (cloud managé)
  - Simple (développement)
- **Persistance**: Stockage local avec sauvegarde automatique
- **Indexation**: Recherche sémantique optimisée

### 3. Gestion des Documents
- **Types de documents**: Code, documentation, solutions d'erreurs, meilleures pratiques, tutoriels, références API
- **Sources**: GitHub, StackOverflow, documentation officielle, recherche web, upload utilisateur
- **Métadonnées**: Tags, langage, score de qualité, URL, timestamps
- **Indexation**: Index multiples (source, type, langage, tags)

### 4. API RAG
- **Endpoints RESTful**: CRUD complet pour les documents
- **Recherche sémantique**: API de recherche avec filtres
- **Batch operations**: Ajout/suppression en masse
- **Monitoring**: Statistiques et santé du système

## 🚀 Fonctionnalités Implémentées

### ✅ Système d'Embeddings
- [x] Support multi-modèles (OpenAI, DeepSeek, Sentence Transformers, Ollama)
- [x] Cache mémoire et disque avec expiration
- [x] Génération batch d'embeddings
- [x] Calcul de similarité cosinus
- [x] Recherche des textes les plus similaires

### ✅ Base de Données Vectorielle
- [x] Support 5 backends différents
- [x] Persistance automatique
- [x] Recherche sémantique avec filtres
- [x] Gestion complète des documents
- [x] Statistiques et monitoring

### ✅ Gestion des Documents
- [x] 7 types de documents supportés
- [x] 8 sources différentes
- [x] Indexation multi-critères
- [x] Score de qualité automatique
- [x] Import/export JSON

### ✅ API RAG
- [x] 8 endpoints RESTful
- [x] Documentation OpenAPI automatique
- [x] Validation des données avec Pydantic
- [x] Gestion d'erreurs complète
- [x] Monitoring de santé

## 🔧 Installation et Configuration

### 1. Dépendances
```bash
# Dépendances de base
pip install sentence-transformers numpy

# Pour ChromaDB
pip install chromadb

# Pour FAISS
pip install faiss-cpu  # ou faiss-gpu pour CUDA

# Pour Qdrant
pip install qdrant-client

# Pour Pinecone
pip install pinecone-client

# Dépendances optionnelles
pip install openai  # Pour OpenAI embeddings
pip install aiohttp  # Pour Ollama embeddings
```

### 2. Configuration Environnement
```bash
# Fichier .env
OPENAI_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...
OLLAMA_BASE_URL=http://localhost:11434
QDRANT_HOST=localhost
QDRANT_PORT=6333
PINECONE_API_KEY=...
```

### 3. Initialisation
```python
from packages.shared-bl.rag.vector_db import get_vector_database
from packages.shared-bl.rag.embeddings import EmbeddingProvider
from packages.shared-bl.rag.vector_db import VectorDBBackend

# Initialisation simple
vector_db = get_vector_database(
    backend=VectorDBBackend.SIMPLE,
    embedding_provider=EmbeddingProvider.SENTENCE_TRANSFORMERS,
    collection_name="issalan_rag"
)

# Initialisation production avec ChromaDB
vector_db = get_vector_database(
    backend=VectorDBBackend.CHROMADB,
    embedding_provider=EmbeddingProvider.OPENAI,
    collection_name="issalan_production",
    persist_directory="./data/chromadb"
)
```

## 📖 Utilisation

### 1. Ajout de Documents
```python
from packages.shared-bl.rag.vector_db import Document, DocumentSource, DocumentType

# Créer un document
document = Document(
    id="",  # Généré automatiquement
    content="Contenu du document...",
    title="Titre du document",
    source=DocumentSource.GITHUB,
    doc_type=DocumentType.CODE,
    language="python",
    url="https://github.com/example",
    tags=["python", "example", "code"]
)

# Ajouter à la base
doc_id = await vector_db.add_document(document)
```

### 2. Recherche Sémantique
```python
# Recherche simple
results = await vector_db.search(
    query="Comment gérer les erreurs en Python?",
    top_k=5,
    min_score=0.3
)

# Recherche avec filtres
results = await vector_db.search(
    query="API REST avec FastAPI",
    top_k=3,
    filters={
        "language": "python",
        "doc_type": DocumentType.API_REFERENCE.value
    },
    min_score=0.4
)
```

### 3. Utilisation de l'API
```bash
# Créer un document
curl -X POST http://localhost:8000/api/rag/documents \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Contenu du document...",
    "title": "Document de test",
    "source": "github",
    "doc_type": "code",
    "language": "python"
  }'

# Rechercher
curl -X POST http://localhost:8000/api/rag/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Python error handling",
    "top_k": 5
  }'

# Statistiques
curl http://localhost:8000/api/rag/stats
```

## 🔗 Intégration avec les Agents IA

### 1. Agent RAG-Enhanced
```python
class RAGEnhancedAgent:
    """Agent IA amélioré avec RAG."""
    
    async def answer_with_rag(self, question: str) -> str:
        # Rechercher des documents pertinents
        relevant_docs = await self.vector_db.search(
            query=question,
            top_k=3,
            min_score=0.4
        )
        
        # Construire le contexte
        context = self._build_context(relevant_docs)
        
        # Générer la réponse avec le contexte
        prompt = f"""
        Contexte:
        {context}
        
        Question: {question}
        
        Réponse:
        """
        
        return await self.llm.generate(prompt)
```

### 2. Intégration avec la Recherche Web
```python
class WebSearchWithRAG:
    """Recherche web enrichie avec RAG."""
    
    async def enhanced_search(self, query: str) -> Dict:
        # Recherche web standard
        web_results = await self.web_search.search(query)
        
        # Recherche RAG
        rag_results = await self.vector_db.search(query, top_k=3)
        
        # Fusionner et classer les résultats
        combined_results = self._merge_results(web_results, rag_results)
        
        # Ajouter au RAG pour future référence
        await self._add_to_rag(web_results, query)
        
        return combined_results
```

## 🧪 Tests

### 1. Test du Système
```bash
# Exécuter les tests RAG
python test_rag_system.py
```

### 2. Tests Unitaires
```python
# Test des embeddings
python -m pytest tests/test_embeddings.py

# Test de la base vectorielle
python -m pytest tests/test_vector_db.py

# Test de l'API
python -m pytest tests/test_rag_api.py
```

## 📈 Métriques et Monitoring

### 1. Métriques de Performance
- **Latence de recherche**: < 100ms pour 1000 documents
- **Précision**: Score de similarité > 0.7 pour documents pertinents
- **Couverture**: Support de 10+ langages de programmation
- **Scalabilité**: Jusqu'à 1 million de documents

### 2. Dashboard de Monitoring
```python
# Accéder aux statistiques
stats = vector_db.get_stats()
print(f"Documents: {stats['document_count']}")
print(f"Par source: {stats['documents_by_source']}")
print(f"Par type: {stats['documents_by_type']}")
```

## 🔄 Workflow de Développement

### 1. Développement Local
```bash
# 1. Cloner le repository
git clone https://github.com/issalan/issalan.git

# 2. Installer les dépendances
pip install -r requirements.txt
pip install -r requirements-rag.txt

# 3. Lancer les tests
python test_rag_system.py

# 4. Démarrer l'API
python -m packages.shared-bl.api.main
```

### 2. Déploiement Production
```bash
# 1. Build Docker
docker build -t issalan-rag .

# 2. Lancer avec Docker Compose
docker-compose -f docker-compose.rag.yml up -d

# 3. Vérifier la santé
curl http://localhost:8000/api/rag/health
```

## 🎨 Interface Utilisateur

### 1. Dashboard RAG
- **Recherche**: Interface de recherche sémantique
- **Gestion**: CRUD des documents
- **Analytics**: Visualisation des statistiques
- **Import/Export**: Gestion des données

### 2. Intégration Desktop/Mobile
```typescript
// Composant React pour la recherche RAG
const RAGSearch: React.FC = () => {
  const [results, setResults] = useState<RAGResult[]>([]);
  
  const search = async (query: string) => {
    const response = await api.post('/api/rag/search', { query });
    setResults(response.data.results);
  };
  
  return (
    <div>
      <SearchBar onSearch={search} />
      <ResultsList results={results} />
    </div>
  );
};
```

## 🔮 Roadmap Future

### Phase 3.1 (Q2 2026)
- [ ] Support multi-langues (Français, Anglais, Arabe)
- [ ] Fine-tuning des embeddings sur code Africain
- [ ] Intégration avec GitHub/GitLab
- [ ] Plugin pour VS Code/IntelliJ

### Phase 3.2 (Q3 2026)
- [ ] Système de recommandation intelligent
- [ ] Apprentissage actif (active learning)
- [ ] Collaboration multi-utilisateurs
- [ ] API GraphQL

### Phase 3.3 (Q4 2026)
- [ ] Edge computing pour embeddings
- [ ] Confidentialité différentielle
- [ ] Blockchain pour traçabilité
- [ ] Marketplace de connaissances

## 📚 Ressources

### Documentation
- [Guide d'installation](docs/rag/installation.md)
- [API Reference](docs/rag/api.md)
- [Best Practices](docs/rag/best-practices.md)
- [Troubleshooting](docs/rag/troubleshooting.md)

### Exemples
- [Exemple d'intégration](examples/rag-integration.py)
- [Script d'import](examples/rag-import.py)
- [Dashboard React](examples/rag-dashboard/)

### Communauté
- [Discord](https://discord.gg/issalan)
- [GitHub Issues](https://github.com/issalan/issalan/issues)
- [Documentation Contributing](CONTRIBUTING.md)

## 🏆 Avantages pour l'Afrique

### 1. Connaissances Locales
- **Documentation en langues locales**
- **Exemples de code adaptés au contexte Africain**
- **Solutions aux problèmes spécifiques**

### 2. Accessibilité
- **Fonctionne hors ligne**
- **Faible consommation de données**
- **Support des langues Africaines**

### 3. Innovation
- **Premier système RAG optimisé pour l'Afrique**
- **Communauté open-source**
- **Transfert de connaissances Nord-Sud**

## 🚨 Dépannage

### Problèmes Courants
```bash
# Erreur: Module non trouvé
pip install sentence-transformers

# Erreur: Mémoire insuffisante
export OMP_NUM_THREADS=1

# Erreur: API key manquante
echo "OPENAI_API_KEY=sk-..." >> .env
```

### Support
- **Email**: support@issalan.africa
- **GitHub**: Issues et Discussions
- **Communauté**: Discord et Forums

---

**ISSALAN RAG** - Système de connaissances intelligent pour l'innovation Africaine 🚀

*"Donner aux développeurs Africains les outils pour construire l'avenir"*