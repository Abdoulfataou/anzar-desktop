# 🚀 ARCHITECTURE MVP - 8 SEMAINES (SOLO-DEV REALISTE)

## 🎯 **CONTEXTE & CONTRAINTES**

### **Votre Situation**
- 👤 **Solo développeur** auto-financé aux USA
- 🎯 **Cible** : Marché Africain (connexions intermittentes)
- ⚔️ **Concurrent** : Trae Solo (à battre sur votre territoire)
- ⏱️ **Deadline** : 8 semaines pour MVP fonctionnel
- 🔑 **API** : DeepSeek (gratuit, puissant)

### **Problème Africain Spécifique**
```
✅ Connexion BONNE quand elle est là
❌ Mais elle COUPE SOUVENT (intermittence)
🎯 Solution : File d'attente offline, pas cache 7 jours
```

## 🏗️ **ARCHITECTURE SIMPLE & ROBUSTE**

### **Stack Minimaliste mais Puissante**
```yaml
Frontend (Desktop): 
  - Tauri 2.0 (Rust + WebView) → App native performante
  - React + TypeScript → Développement rapide
  - TailwindCSS → UI rapide
  - IndexedDB → File d'attente offline

Backend (Light API):
  - Python FastAPI → Simple et rapide
  - DeepSeek API → Gratuit et puissant
  - SQLite → Base de données légère
  - File system → Stockage projets

Pas de:
  - ❌ Kubernetes (trop complexe)
  - ❌ Redis (overkill pour MVP)
  - ❌ Microservices (trop de maintenance)
  - ❌ Rust backend (trop long à développer)
```

### **Architecture en 3 Couches**
```
1. FRONTEND (Tauri + React)
   ├── Interface utilisateur
   ├── File d'attente offline (IndexedDB)
   ├── Validation plans (Mode Plan)
   └── Gestion projets

2. AGENT CORE (Python)
   ├── SimpleAgent (fusionné)
   ├── FileExecutor (sécurisé)
   ├── DeepSeek Client
   └── Queue Manager

3. STORAGE (Local)
   ├── Projets générés
   ├── File d'attente
   └── Configuration
```

## 🔄 **WORKFLOW OFFLINE-FIRST (INTERMITTENCE)**

### **1. Mode Connecté**
```
Utilisateur → "Crée une app todo"
           ↓
Agent → Génère PLAN (arborescence + fichiers)
           ↓
Interface → Affiche PLAN à l'utilisateur
           ↓
Utilisateur → "APPROUVE" ou "MODIFIE"
           ↓
Agent → Exécute et crée fichiers
```

### **2. Mode Déconnecté (Connexion coupée)**
```
Utilisateur → "Crée une app todo"
           ↓
Interface → "Hors ligne - Action en file d'attente"
           ↓
IndexedDB → Sauvegarde action dans queue
           ↓
Interface → "X actions en attente"
           ↓
[Connexion revient]
           ↓
Queue Manager → Exécute automatiquement
           ↓
Agent → Génère PLAN (quand online)
           ↓
[Suite normale...]
```

### **3. File d'Attente Intelligente**
```typescript
// Queue Manager simple mais robuste
class OfflineQueue {
  private queue: Action[] = [];
  private db: IDBDatabase;
  
  async addAction(action: Action): Promise<void> {
    // Sauvegarde dans IndexedDB
    await this.saveToIndexedDB(action);
    this.queue.push(action);
    
    // Si online, exécute immédiatement
    if (navigator.onLine) {
      await this.processQueue();
    }
  }
  
  async processQueue(): Promise<void> {
    while (this.queue.length > 0 && navigator.onLine) {
      const action = this.queue[0];
      try {
        await this.executeAction(action);
        this.queue.shift();
        await this.removeFromIndexedDB(action.id);
      } catch (error) {
        // Réessaie plus tard
        console.error('Queue error:', error);
        break;
      }
    }
  }
}
```

## 🤖 **AGENT SIMPLE MAIS PUISSANT**

### **SimpleAgent (Fusionné)**
```python
# Un seul agent qui fait tout (réaliste pour solo-dev)
class SimpleAgent:
    """
    Fusion de:
    1. Analyseur de demande
    2. Planificateur de structure
    3. Générateur de code
    4. Validateur basique
    
    Pour MVP: Simple, efficace, maintenable
    """
    
    def __init__(self, deepseek_api_key: str):
        self.deepseek = DeepSeekClient(api_key=deepseek_api_key)
        self.file_executor = FileExecutor()
    
    async def generate_plan(self, user_request: str) -> ProjectPlan:
        """Génère un plan complet en une seule requête."""
        prompt = f"""
        Crée un plan pour: {user_request}
        
        Format JSON:
        {{
          "project_name": "nom",
          "description": "description",
          "files": [
            {{"path": "chemin", "content": "contenu", "type": "code|config|doc"}}
          ],
          "structure": {{"root": "nom", "folders": []}},
          "dependencies": []
        }}
        """
        
        response = await self.deepseek.generate_json(prompt)
        return ProjectPlan(**response)
    
    async def execute_plan(self, plan: ProjectPlan):
        """Exécute le plan après validation utilisateur."""
        return await self.file_executor.execute(plan)
```

### **FileExecutor Sécurisé**
```python
class FileExecutor:
    """Crée les fichiers après validation manuelle."""
    
    async def execute(self, plan: ProjectPlan) -> ExecutionResult:
        # Validation sécurité
        if not self.validate_paths(plan):
            raise SecurityError("Chemins dangereux détectés")
        
        # Création fichiers
        for file in plan.files:
            await self.create_file(file)
        
        return ExecutionResult(success=True)
    
    def validate_paths(self, plan: ProjectPlan) -> bool:
        """Empêche les chemins dangereux."""
        forbidden = ["..", "/", "~", "$HOME"]
        for file in plan.files:
            if any(f in file.path for f in forbidden):
                return False
        return True
```

## 🖥️ **INTERFACE UTILISATEUR SIMPLE**

### **Composants Essentiels**
```typescript
// 1. Écran principal
const HomeScreen = () => (
  <div>
    <ProjectCreator />      // Créer nouveau projet
    <OfflineStatus />       // Statut connexion
    <PendingActions />      // Actions en attente
    <RecentProjects />      // Projets récents
  </div>
);

// 2. Créateur de projet
const ProjectCreator = () => {
  const [description, setDescription] = useState("");
  
  const handleSubmit = async () => {
    // Ajoute à la file d'attente
    await queue.addAction({
      type: "generate_project",
      data: { description }
    });
  };
  
  return (
    <div>
      <textarea 
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Décris ton projet..."
      />
      <button onClick={handleSubmit}>
        {navigator.onLine ? "Générer" : "Mettre en file d'attente"}
      </button>
    </div>
  );
};

// 3. Statut offline
const OfflineStatus = () => (
  <div className={navigator.onLine ? "online" : "offline"}>
    {navigator.onLine ? "✅ En ligne" : "⚠️ Hors ligne"}
  </div>
);
```

### **PlanValidationModal (Existant)**
```typescript
// Réutilise le composant existant
<PlanValidationModal
  plan={generatedPlan}
  isOpen={isModalOpen}
  onApprove={handleApprove}
  onReject={handleReject}
/>
```

## 💾 **SYSTÈME DE STOCKAGE LOCAL**

### **IndexedDB pour la File d'Attente**
```typescript
// Configuration simple
const dbPromise = openDB('issalan-queue', 1, {
  upgrade(db) {
    db.createObjectStore('actions', { keyPath: 'id' });
    db.createObjectStore('projects', { keyPath: 'id' });
  },
});

// Opérations basiques
const queueDB = {
  async addAction(action: Action) {
    const db = await dbPromise;
    await db.add('actions', action);
  },
  
  async getPendingActions(): Promise<Action[]> {
    const db = await dbPromise;
    return await db.getAll('actions');
  },
  
  async removeAction(id: string) {
    const db = await dbPromise;
    await db.delete('actions', id);
  }
};
```

### **Stockage des Projets**
```
generated_projects/
├── project-1/
│   ├── .issalan_metadata.json
│   ├── README.md
│   ├── src/
│   └── package.json
├── project-2/
└── project-3/
```

## 🗓️ **PLAN 8 SEMAINES DÉTAILLÉ**

### **Semaine 1-2 : Fondations**
```
✅ Jour 1-3 : Setup projet Tauri + React
✅ Jour 4-5 : Interface basique (HomeScreen, ProjectCreator)
✅ Jour 6-7 : IndexedDB pour file d'attente
✅ Jour 8-10 : Composant OfflineStatus
✅ Jour 11-14 : Tests basiques
```

### **Semaine 3-4 : Agent Core**
```
✅ Jour 15-17 : SimpleAgent Python (DeepSeek integration)
✅ Jour 18-20 : FileExecutor avec sécurité
✅ Jour 21-23 : API FastAPI simple
✅ Jour 24-26 : Communication frontend-backend
✅ Jour 27-28 : Tests d'intégration
```

### **Semaine 5-6 : Mode Plan & Validation**
```
✅ Jour 29-31 : PlanValidationModal (existant à adapter)
✅ Jour 32-34 : Workflow validation utilisateur
✅ Jour 35-37 : File d'attente intelligente
✅ Jour 38-40 : Gestion erreurs et retry
✅ Jour 41-42 : Tests offline
```

### **Semaine 7-8 : Polish & Déploiement**
```
✅ Jour 43-45 : UI/UX improvements
✅ Jour 46-48 : Documentation utilisateur
✅ Jour 49-51 : Tests end-to-end
✅ Jour 52-54 : Build & packaging
✅ Jour 55-56 : Déploiement beta
```

## 📦 **PAQUETS À INSTALLER**

### **Frontend (Tauri)**
```bash
# Dans desktop/
npm install react react-dom typescript tailwindcss
npm install @tauri-apps/api @tauri-apps/cli
npm install idb lucide-react
```

### **Backend (Python)**
```bash
# Dans packages/shared-bl/
pip install fastapi uvicorn python-dotenv
pip install pydantic httpx
# DeepSeek API via HTTP requests simples
```

## 🔧 **CONFIGURATION MINIMALE**

### **.env**
```env
DEEPSEEK_API_KEY=[INSERE TA CLE API ICI]
APP_ENV=development
STORAGE_PATH=./generated_projects
```

### **tauri.conf.json**
```json
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "package": {
    "productName": "ISSALAN",
    "version": "0.1.0"
  }
}
```

## 🧪 **TESTS ESSENTIELS (PAS 100% COVERAGE)**

### **Tests à Prioriser**
```python
# 1. Test offline queue
def test_offline_queue():
    queue = OfflineQueue()
    queue.add_action(offline_action)
    assert queue.has_pending_actions()
    queue.process()  # Quand online
    assert not queue.has_pending_actions()

# 2. Test sécurité chemins
def test_path_security():
    executor = FileExecutor()
    assert executor.validate_paths(safe_plan) == True
    assert executor.validate_paths(dangerous_plan) == False

# 3. Test génération plan
def test_plan_generation():
    agent = SimpleAgent(api_key="test")
    plan = await agent.generate_plan("todo app")
    assert plan.project_name is not None
    assert len(plan.files) > 0
```

### **Tests Manuels (Suffisants pour MVP)**
```
✅ Test 1 : Créer projet en ligne
✅ Test 2 : Créer projet offline (file d'attente)
✅ Test 3 : Valider plan avant exécution
✅ Test 4 : Chemins dangereux rejetés
✅ Test 5 : Reconnexion auto-exécute queue
```

## 🚀 **DÉPLOIEMENT BETA**

### **Pour Testeurs Africains**
```
1. Build application Tauri (.app, .exe, .deb)
2. Upload sur Google Drive / Dropbox
3. Partager lien avec 5-10 testeurs
4. Collecter feedback semaine 9
5. Itérer rapidement
```

### **Mesures de Succès Beta**
```
🎯 1. Génération projet fonctionne offline/online
🎯 2. File d'attente gère bien l'intermittence
🎯 3. Interface simple et intuitive
🎯 4. Performance acceptable (< 30s génération)
🎯 5. 0 crash critique
```

## 💰 **COÛTS & RESSOURCES**

### **Coûts Mensuels**
```
✅ DeepSeek API : Gratuit (limite généreuse)
✅ Hébergement : 0$ (tout local)
✅ Domaine : 0$ (pas besoin pour MVP)
✅ Marketing : 0$ (bouche à oreille)
✅ Total : 0$ 🎉
```

### **Temps de Développement**
```
👨‍💻 Vous seul : 8 semaines à temps plein
🕐 40h/semaine × 8 = 320 heures
🎯 Livrable : MVP fonctionnel prêt beta
```

## ⚡ **AVANTAGES vs TRAE SOLO**

### **Trae Solo**
```
❌ Échoue quand connexion coupe
❌ Pas de file d'attente offline
❌ Validation manuelle limitée
❌ Pas optimisé Afrique
```

### **ISSALAN MVP**
```
✅ Fonctionne offline avec file d'attente
✅ Validation manuelle obligatoire (sécurité)
✅ Optimisé connexions intermittentes
✅ Desktop app native (performante)
✅ Gratuit (DeepSeek API gratuit)
```

## 🎯 **FEATURES CLÉS DU MVP**

### **Must Have (Semaine 8)**
```
✅ 1. Génération projet simple (web app)
✅ 2. File d'attente offline
✅ 3. Validation manuelle plans
✅ 4. Interface desktop native
✅ 5. DeepSeek integration
✅ 6. Stockage local projets
```

### **Nice to Have (Post-MVP)**
```
🔜 1. Plus de templates projets
🔜 2. Éditeur de code intégré
🔜 3. Déploiement automatique
🔜 4. Collaboration basique
🔜 5. Marketplace plugins
```

## 🛠️ **OUTILS & RESSOURCES**

### **Pour Vous (Solo Dev)**
```
1. VS Code + Extensions
2. GitHub (version control)
3. Tauri CLI
4. Python venv
5. Postman (tests API)
6. Browser DevTools
```

### **Documentation à Lire**
```
1. Tauri Docs (tauri.app)
2. DeepSeek API Docs
3. IndexedDB MDN
4. FastAPI Tutorial
```

## 🚨 **RISQUES & MITIGATIONS**

### **Risque 1 : DeepSeek API Limits**
- **Risque** : Limite d'usage gratuit dépassée
- **Mitigation** : Cache intelligent + fallback local
- **Action** : Monitorer usage API

### **Risque 2 : Complexité Tauri**
- **Risque** : Courbe d'apprentissage Tauri
- **Mitigation** : Starter template simple
- **Action** : Suivre tutorial officiel

### **Risque 3 : Tests Offline**
- **Risque** : Difficile à tester sans coupures réelles
- **Mitigation** : Simulateur offline dans DevTools
- **Action** : Tester avec airplane mode

### **Risque 4 : Performance Génération**
- **Risque** : Génération trop lente (> 60s)
- **Mitigation** : Optimiser prompts DeepSeek
- **Action** : Pré-générer templates communs

## 📞 **SUPPORT & COMMUNAUTÉ**

### **Support Beta**
```
1. WhatsApp group avec testeurs
2. Issues GitHub
3. Email dédié
4. Documentation simple
```

### **Feedback Loop Rapide**
```
Lundi : Déploiement nouvelle version
Mardi-Jeudi : Collecte feedback
Vendredi : Analyse feedback
Weekend : Corrections bugs
Lundi : Nouvelle version
```

## 🎉 **CÉL