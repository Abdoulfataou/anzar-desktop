# ANZAR - Architecture de Refonte (v2.0)

**Date**: Avril 2026  
**Statut**: Architecture de Référence  
**Auteur**: Équipe ANZAR  
**Audience**: Développeurs, Architectes, Responsables Produit

---

## Table des matières

1. [Vision & Philosophie](#vision--philosophie)
2. [Architecture Nouvelle](#architecture-nouvelle)
3. [Stack Technologique](#stack-technologique)
4. [Structure des Fichiers](#structure-des-fichiers)
5. [Fichiers à Créer vs à Supprimer](#fichiers-à-créer-vs-à-supprimer)
6. [Optimisations Marché Africain](#optimisations-marché-africain)
7. [Stratégie d'Intégration DeepSeek](#stratégie-dintégration-deepseek)
8. [Plan de Migration](#plan-de-migration)
9. [Diagramme d'Architecture](#diagramme-darchitecture)
10. [Checklist Implémentation](#checklist-implémentation)

---

## Vision & Philosophie

### Principes Directeurs

ANZAR v2.0 adopte une philosophie de **minimalisme et d'efficacité**, inspirée par des produits comme Claude Desktop et Trae. L'objectif est d'offrir une expérience puissante sans complexité inutile.

#### Principes Clés

**1. Simplicité d'Abord**
- Une interface épurée avec une hiérarchie claire
- Zéro bureaucratie : pas d'authentification, pas de compte utilisateur en MVP
- Fonctionnalités réduites mais complètes
- Chaque écran doit avoir un seul but principal

**2. Offline-First (Marché Africain)**
- L'application fonctionne hors ligne par défaut
- Les données se synchronisent automatiquement en ligne
- Pas de dépendance réseau pour les opérations de base
- Cache agressif des réponses API

**3. Performance Légère**
- Bundle JavaScript < 2MB (gzip)
- Backend en Python optimisé pour le déploiement sur serveurs faibles
- Tauri pour 0 dépendances système (par rapport à Electron)
- Design responsive pour tous les appareils

**4. Transparence des Agents IA**
- Les utilisateurs voient exactement ce que font les agents
- Progression en temps réel des 5 phases (Orchestration, Planification, Codage, Test, Exécution)
- Valeurs par défaut qui "marchent" pour la plupart des cas
- Contrôle granulaire pour les experts

### Vision Produit

**Pour qui ?** Développeurs africains et du monde en développement qui veulent générer des applications via description vocale/textuelle.

**Pourquoi maintenant ?** 
- Modèles IA (DeepSeek) deviennent accessibles
- Desktop apps (Tauri) réduisent les coûts de distribution
- Marché africain croît rapidement (2x par an)

**Différenciation**
- Offline-first : contrairement à GPT Builder (cloud-only)
- Gratuit : contrairement à GitHub Copilot (freemium)
- Contrôle local : pas de données envoyées au serveur (sauf DeepSeek)
- Multi-agents : meilleur que single LLM chatbot

---

## Architecture Nouvelle

### Vue d'Ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                    ANZAR DESKTOP (Tauri)                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  UI React (TypeScript)                               │   │
│  │  ├─ Chat (pour l'utilisateur)                        │   │
│  │  ├─ Projects (affichage des générés)                │   │
│  │  ├─ Memory (historique & recherche)                 │   │
│  │  └─ Settings (API keys, themes, langues)            │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Zustand Stores (State Management)                  │   │
│  │  ├─ chatStore (messages, sessions)                  │   │
│  │  ├─ projectStore (liste des projets)                │   │
│  │  ├─ memoryStore (mémoire locale)                    │   │
│  │  ├─ themeStore (darkmode, i18n)                     │   │
│  │  └─ settingsStore (préférences utilisateur)         │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Services TypeScript                                │   │
│  │  ├─ deepseek.ts (appels HTTP vers backend)          │   │
│  │  ├─ storage.ts (IndexedDB + localStorage)           │   │
│  │  └─ agents.ts (orchestration côté client)           │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Tauri Rust Bridge                                  │   │
│  │  ├─ Invocation des commandes Rust                   │   │
│  │  ├─ Gestion du système de fichiers                  │   │
│  │  └─ Intégration des processus locaux                │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  SYSTÈME LOCAL (Rust Tauri)                               │
│  ├─ Création de fichiers/dossiers                       │
│  └─ Exécution de commandes système (npm install, etc.)  │
│                                                             │
│  ↕ (HTTPS si en ligne)                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                          ↓↓↓
    ┌─────────────────────────────────────────────────────┐
    │      Backend Python (FastAPI) - OPTIONNEL          │
    │  (Déployable sur serveur local ou cloud)           │
    │  ┌──────────────────────────────────────────────┐   │
    │  │  API Endpoints                               │   │
    │  │  ├─ POST /api/chat (stream responses)         │   │
    │  │  ├─ GET /api/projects                        │   │
    │  │  ├─ POST /api/projects/{id}/execute          │   │
    │  │  └─ GET /api/memory/search                   │   │
    │  └──────────────────────────────────────────────┘   │
    │                       ↓                               │
    │  ┌──────────────────────────────────────────────┐   │
    │  │  Agents Multi-Agents (Python)                │   │
    │  │  ├─ Orchestrator (analyse plan)              │   │
    │  │  ├─ Planner (architecture)                   │   │
    │  │  ├─ Coder (génération code)                  │   │
    │  │  ├─ Tester (validation)                      │   │
    │  │  └─ Executor (création fichiers)             │   │
    │  └──────────────────────────────────────────────┘   │
    │                       ↓                               │
    │  ┌──────────────────────────────────────────────┐   │
    │  │  Services                                    │   │
    │  │  ├─ DeepSeek Client (calls API)              │   │
    │  │  └─ Cache Layer (Redis optionnel)            │   │
    │  └──────────────────────────────────────────────┘   │
    └─────────────────────────────────────────────────────┘
                          ↓↓↓
    ┌─────────────────────────────────────────────────────┐
    │         DeepSeek API (Cloud - via HTTPS)            │
    │  - deepseek-chat (réponses rapides)                 │
    │  - deepseek-reasoner (raisonnement profond)         │
    └─────────────────────────────────────────────────────┘
```

### Flux d'Interaction Principal

```
Utilisateur écrit un prompt
     ↓
React UI capture le texte
     ↓
Service deepseek.ts fait un appel HTTP
     ↓
Backend FastAPI reçoit & valide
     ↓
Orchestrator agent crée un plan
     ↓
Streaming de réponses → UI affiche en temps réel
     ↓
Utilisateur valide le plan (ou demande des modifications)
     ↓
Executor crée les fichiers via Tauri Rust bridge
     ↓
Projet généré visible dans Projects view
```

---

## Stack Technologique

### Frontend (Desktop)

| Technologie | Version | Raison |
|------------|---------|--------|
| **Tauri** | 2.x | Framework desktop léger (Rust + Web) - meilleur que Electron |
| **React** | 18.x | UI library dominante, écosystème mature |
| **TypeScript** | 5.x | Type safety, meilleure expérience dev |
| **Tailwind CSS** | 3.x | Utility-first, zéro CSS custom nécessaire |
| **Zustand** | 4.x | State management minimaliste (500 bytes gzip) |
| **Vite** | 5.x | Build tool ultra-rapide |
| **React Router** | 6.x | Client-side routing léger |

### Backend (Optionnel mais Recommandé)

| Technologie | Version | Raison |
|------------|---------|--------|
| **FastAPI** | 0.110+ | Async Python, documentation auto (Swagger) |
| **Python** | 3.11+ | Multi-agent framework (AG2), data science tools |
| **Pydantic** | 2.x | Validation de données stricte |
| **SQLite** | 3.x | Base de données embarquée (zéro dépendances) |
| **Redis** | 7.x | Cache optionnel pour déploiement production |

### AI/ML

| Service | Configuration | Raison |
|---------|--------------|--------|
| **DeepSeek Chat** | `deepseek-chat` | Réponses rapides (~0.5s), peu chères |
| **DeepSeek Reasoner** | `deepseek-reasoner` | Raisonnement profond pour architecture |
| **AG2 (AutoGen)** | Multi-agent orchestration | Orchestration & coordination d'agents |

### Infrastructure

| Composant | Stack | Détails |
|-----------|-------|---------|
| **Desktop** | Tauri (Rust) | Bundled, ~45MB installer |
| **Backend** | Docker (optionnel) | Docker Compose pour déploiement |
| **Storage** | SQLite + IndexedDB | Zéro dépendances externes |
| **Cache** | Redis (optionnel) | Pour déploiement multi-utilisateur |

---

## Structure des Fichiers

### Arborescence Complète

```
ANZAR/
├── desktop/                              # APPLICATION TAURI (PRINCIPALE)
│   ├── index.html                        # Point d'entrée HTML
│   ├── package.json                      # Dépendances NPM
│   ├── vite.config.ts                    # Configuration Vite
│   ├── tailwind.config.ts                # Configuration Tailwind
│   ├── tsconfig.json                     # Configuration TypeScript
│   ├── postcss.config.js                 # Post-processing CSS
│   │
│   ├── src/
│   │   ├── main.tsx                      # Point d'entrée React
│   │   ├── App.tsx                       # Composant root
│   │   ├── index.css                     # Styles globaux (Tailwind)
│   │   │
│   │   ├── components/
│   │   │   │
│   │   │   ├── ui/                       # DESIGN SYSTEM
│   │   │   │   ├── Button.tsx            # Bouton réutilisable
│   │   │   │   ├── Input.tsx             # Champ texte
│   │   │   │   ├── IconButton.tsx        # Bouton icône
│   │   │   │   ├── Badge.tsx             # Badge/tag
│   │   │   │   ├── Tooltip.tsx           # Info-bulle
│   │   │   │   ├── Spinner.tsx           # Loading state
│   │   │   │   └── ThemeToggle.tsx       # Dark/light mode toggle
│   │   │   │
│   │   │   ├── layout/                   # LAYOUT & NAVIGATION
│   │   │   │   ├── AppLayout.tsx         # Structure principale (sidebar + content)
│   │   │   │   ├── Sidebar.tsx           # Menu latéral (Chat, Projects, Memory, Settings)
│   │   │   │   └── TitleBar.tsx          # Barre titre Tauri (exit, minimize, maximize)
│   │   │   │
│   │   │   ├── chat/                     # CHAT INTERFACE
│   │   │   │   ├── ChatView.tsx          # Container chat complet
│   │   │   │   ├── MessageList.tsx       # Scroll list des messages
│   │   │   │   ├── MessageBubble.tsx     # Message individuel (user/agent)
│   │   │   │   ├── ChatInput.tsx         # Input & bouton send
│   │   │   │   ├── CodeBlock.tsx         # Affichage code avec syntax highlight
│   │   │   │   ├── StreamingDots.tsx     # Animation "..." pendant streaming
│   │   │   │   └── AgentStatus.tsx       # "Orchestrator en cours..." etc
│   │   │   │
│   │   │   ├── projects/                 # PROJETS GÉNÉRÉS
│   │   │   │   ├── ProjectsView.tsx      # Grille/liste des projets
│   │   │   │   ├── ProjectCard.tsx       # Carte projet (thumbnail, actions)
│   │   │   │   ├── FileExplorer.tsx      # Arborescence fichiers du projet
│   │   │   │   └── AgentProgress.tsx     # Barre progression agents
│   │   │   │
│   │   │   └── memory/                   # MÉMOIRE CONVERSATIONNELLE
│   │   │       ├── MemoryView.tsx        # Container mémoire
│   │   │       ├── ConversationList.tsx  # Liste conversations archivées
│   │   │       ├── SearchBar.tsx         # Recherche dans l'historique
│   │   │       └── MemoryStats.tsx       # Stats : N conversations, N projets
│   │   │
│   │   ├── pages/                        # PAGE CONTAINERS
│   │   │   ├── ChatPage.tsx              # Page /chat (route = default)
│   │   │   ├── ProjectsPage.tsx          # Page /projects
│   │   │   ├── MemoryPage.tsx            # Page /memory
│   │   │   └── SettingsPage.tsx          # Page /settings
│   │   │
│   │   ├── stores/                       # ZUSTAND STATE
│   │   │   ├── chatStore.ts              # State: currentMessages[], sessionId, isStreaming
│   │   │   ├── projectStore.ts           # State: projects[], selectedProject
│   │   │   ├── memoryStore.ts            # State: conversations[], stats
│   │   │   ├── themeStore.ts             # State: darkMode, language
│   │   │   └── settingsStore.ts          # State: apiKey, theme, autoSave
│   │   │
│   │   ├── services/                     # LOGIQUE MÉTIER
│   │   │   ├── deepseek.ts               # Client API (HTTP calls via Tauri)
│   │   │   │   └── Fonctions: chat(), stream(), createSession()
│   │   │   ├── storage.ts                # Persévérance locale
│   │   │   │   └── IndexedDB + localStorage, sync avec SQLite backend
│   │   │   └── agents.ts                 # Orchestration côté client (fallback offline)
│   │   │       └── Orchestrator, Planner, Coder, Tester, Executor simulés
│   │   │
│   │   ├── hooks/                        # REACT HOOKS PERSONNALISÉS
│   │   │   ├── useTheme.ts               # Hook pour dark mode
│   │   │   ├── useChat.ts                # Hook pour logique chat (wrapper deepseek.ts)
│   │   │   ├── useOffline.ts             # Hook pour détecter connectivité
│   │   │   ├── useProjects.ts            # Hook pour opérations projets
│   │   │   └── useMemory.ts              # Hook pour recherche historique
│   │   │
│   │   ├── types/                        # TYPE DEFINITIONS
│   │   │   └── index.ts                  # Tous les types TypeScript
│   │   │       ├── Message, Conversation, Project, Agent, etc.
│   │   │       └── Exportés et partagés dans l'app
│   │   │
│   │   └── lib/                          # UTILITIES
│   │       ├── utils.ts                  # Helpers (formatDate, cn, etc.)
│   │       └── constants.ts              # Constantes (MODELS, COLORS, etc.)
│   │
│   └── src-tauri/                        # CODE RUST (TAURI)
│       ├── Cargo.toml                    # Dépendances Rust
│       ├── tauri.conf.json               # Configuration Tauri app
│       └── src/
│           └── main.rs                   # Point d'entrée Rust
│               ├── Invocation file system Tauri
│               ├── Invocation shell commands (npm install, etc.)
│               └── Custom protocol pour file serving
│
├── backend/                              # BACKEND PYTHON (OPTIONNEL)
│   ├── main.py                           # FastAPI app entrypoint
│   ├── config.py                         # Configuration (env vars)
│   ├── requirements.txt                  # Dépendances Python
│   │
│   ├── agents/                           # ORCHESTRATION AGENTS
│   │   ├── __init__.py
│   │   ├── orchestrator.py               # Analyse demande, crée plan
│   │   ├── planner.py                    # Structure projet, dépendances
│   │   ├── coder.py                      # Génère code source
│   │   ├── tester.py                     # Valide, trouve bugs
│   │   └── executor.py                   # Crée fichiers, exécute commandes
│   │
│   ├── services/                         # SERVICES RÉUTILISABLES
│   │   ├── deepseek_client.py            # Client DeepSeek officiel
│   │   │   └── Gère retry, timeout, streaming
│   │   ├── cache.py                      # Redis cache (optionnel)
│   │   ├── storage.py                    # SQLite interaction
│   │   └── file_executor.py              # Création fichiers sécurisée
│   │
│   └── models/                           # DATA MODELS
│       ├── project.py                    # ORM : Project, Conversation
│       └── agent_state.py                # State des agents
│
├── .env.example                          # Template variables d'environnement
│   ├── DEEPSEEK_API_KEY
│   ├── DEEPSEEK_BASE_URL
│   ├── DATABASE_URL (optionnel)
│   └── etc.
│
├── docker-compose.yml                    # Orchestration services
│   ├── web: FastAPI app
│   ├── db: PostgreSQL (optionnel)
│   └─ redis: Cache layer (optionnel)
│
├── Dockerfile.backend                    # Image Docker Python
│
├── .gitignore                            # Fichiers ignorés
│
└── README.md                             # Documentation projet
    └── Quick start, architecture overview, contribution guide
```

### Arborescence du Projet Généré

Chaque projet généré par ANZAR aura cette structure :

```
~/ANZAR_GENERATED/mon-super-app/
├── .anzar/
│   ├── metadata.json          # Infos: date création, prompt original, version ANZAR
│   ├── plan.md                # Plan détaillé du projet
│   ├── agents_log.json        # Log des actions de chaque agent
│   └── conversation.jsonl     # Historique complètement chatbot
├── .gitignore
├── README.md
├── package.json               # Si JavaScript
├── requirements.txt           # Si Python
├── [Structure du projet généré...]
```

---

## Fichiers à Créer vs à Supprimer

### Phase 1 : SUPPRESSION (Legacy Cleanup)

#### Dossiers à Supprimer Entièrement

| Chemin | Raison | Notes |
|--------|--------|-------|
| `Admin/` | Fonctionnalité fusionnée dans Settings | Sauvegarder avant suppression |
| `mobile/` | MVP desktop-only, mobile phase 2 | Sauvegarder le code source |
| `desktop-app-interface/` | Fichiers obsolètes, remplacés par page UI | Archiver |
| `Plan IA/` | Documentation phase 1 | Archiver en `_archive/plan-ia-v1/` |

#### Fichiers à Supprimer

```
desktop/src/app/                           ← Remplacé par pages/
desktop/src/components/AnzarLayout.tsx     ← Legacy, remplacé par layout/AppLayout
desktop/src/components/ModernDesktopLayout.tsx ← Legacy
desktop/src/stores/authStore.ts            ← MVP sans auth
desktop/src/stores/anzarModeStore.ts       ← Simplifié dans themeStore
desktop/src/stores/fileProjectStore.ts     ← Remplacé par projectStore
packages/shared-bl/                        ← Code migré vers backend/
```

#### Archivage Recommandé

```bash
# Créer archive des anciens fichiers
mkdir -p _archive/v1
mv Admin/ _archive/v1/
mv mobile/ _archive/v1/
mv desktop-app-interface/ _archive/v1/
mv "Plan IA/" _archive/v1/
```

### Phase 2 : CRÉATION (New Structure)

#### Fichiers Frontend à Créer

**Design System (`desktop/src/components/ui/`)**
```
Button.tsx                 # Composant Button réutilisable
Input.tsx                  # Input fields avec validation
IconButton.tsx             # Boutons icône (lucide-react)
Badge.tsx                  # Badges et tags
Tooltip.tsx                # Info-bulles
Spinner.tsx                # Loading animation
ThemeToggle.tsx            # Dark/light mode switch
Dialog.tsx                 # Modal dialogs
Card.tsx                   # Conteneur carte
```

**Layout (`desktop/src/components/layout/`)**
```
AppLayout.tsx              # Grille principale (sidebar + content)
Sidebar.tsx                # Navigation latérale
TitleBar.tsx               # Barre titre Tauri
```

**Chat (`desktop/src/components/chat/`)**
```
ChatView.tsx               # Container complet
MessageList.tsx            # Scrollable message list
MessageBubble.tsx          # Message individuel
ChatInput.tsx              # Input + send button
CodeBlock.tsx              # Code highlight
StreamingDots.tsx          # Animation loading
AgentStatus.tsx            # "Planner en cours..."
```

**Projects (`desktop/src/components/projects/`)**
```
ProjectsView.tsx           # Grille/liste
ProjectCard.tsx            # Carte projet
FileExplorer.tsx           # Arborescence
AgentProgress.tsx          # Barre progression
```

**Memory (`desktop/src/components/memory/`)**
```
MemoryView.tsx             # Container
ConversationList.tsx       # Liste archivées
SearchBar.tsx              # Recherche
MemoryStats.tsx            # Statistiques
```

**Pages (`desktop/src/pages/`)**
```
ChatPage.tsx               # Page /chat (par défaut)
ProjectsPage.tsx           # Page /projects
MemoryPage.tsx             # Page /memory
SettingsPage.tsx           # Page /settings
```

**Stores (`desktop/src/stores/`)**
```
chatStore.ts               # Zustand: messages[], isStreaming, sessionId
projectStore.ts            # Zustand: projects[], selectedProject
memoryStore.ts             # Zustand: conversations[]
themeStore.ts              # Zustand: darkMode, language, locale
settingsStore.ts           # Zustand: apiKey, autoSave, defaults
```

**Services (`desktop/src/services/`)**
```
deepseek.ts                # Client API DeepSeek
storage.ts                 # IndexedDB + localStorage
agents.ts                  # Orchestration offline fallback
```

**Hooks (`desktop/src/hooks/`)**
```
useTheme.ts
useChat.ts
useOffline.ts
useProjects.ts
useMemory.ts
```

**Types & Utils (`desktop/src/types/ & lib/`)**
```
types/index.ts             # Tous les types TypeScript
lib/utils.ts               # Fonctions utilitaires
lib/constants.ts           # Constantes
```

#### Fichiers Backend à Créer

**Agents (`backend/agents/`)**
```
__init__.py
orchestrator.py            # Analyse + planification
planner.py                 # Architecture de projet
coder.py                   # Génération code
tester.py                  # Validation + bugs
executor.py                # Création fichiers
```

**Services (`backend/services/`)**
```
deepseek_client.py         # Client API
cache.py                   # Cache Redis
storage.py                 # SQLite
file_executor.py           # File creation
```

**API Endpoints (`backend/main.py`)**
```python
@app.post("/api/chat")              # Stream chat responses
@app.get("/api/projects")            # List projects
@app.post("/api/projects/{id}/execute") # Run project plan
@app.get("/api/memory/search")       # Search history
@app.get("/api/health")              # Health check
```

#### Fichiers Config à Créer

```
.env.example               # Template pour config
docker-compose.yml        # Services Docker
Dockerfile.backend         # Image Python
.dockerignore             # Docker build optimisation
```

---

## Optimisations Marché Africain

### 1. Performance & Taille

#### Bundle Size Optimization

| Métrique | Cible | Méthode |
|----------|-------|--------|
| **JS Bundle (gzip)** | < 2MB | Tree-shake unused code, lazy loading routes |
| **Desktop Installer** | < 50MB | Tauri bundle optimization, native modules |
| **Initial Load** | < 3s | CSS-in-JS inline, préchargement critique |
| **API Response** | < 1s | Server cache, compression gzip |

**Checklist Implémentation:**
- [ ] `vite.config.ts`: manualChunks pour code splitting
- [ ] `package.json`: dépendances légères uniquement
- [ ] React.lazy() pour routes non-critiques
- [ ] Dynamic imports pour modales
- [ ] Compression images (Webp fallback JPEG)
- [ ] Minification CSS/JS automatique

#### Code Splitting par Route

```typescript
// src/App.tsx
const ChatPage = lazy(() => import('./pages/ChatPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
```

### 2. Offline-First Architecture

#### Données Locales

**Technologie**: SQLite (backend) + IndexedDB (frontend)

```typescript
// Flow offline-first
1. utilisateur tape prompt → enregistré en IndexedDB immédiatement
2. Si connecté → envoi au backend + streaming réponse
3. Si offline → fallback agents.ts (orchestration locale)
4. Quand reconnecté → sync bidirectionnelle
```

**Implementation:**

```typescript
// src/services/storage.ts
export class StorageService {
  async saveMessage(msg: Message): Promise<void> {
    // Enregistre en IndexedDB immédiatement
    await db.messages.add(msg);
    
    // Si online, envoie au backend
    if (navigator.onLine) {
      await deepseek.sync(msg);
    }
  }
  
  async syncWhenOnline(): Promise<void> {
    // Appelé après reconnection
    const unsyncedMessages = await db.messages
      .where('synced').equals(false).toArray();
    for (const msg of unsyncedMessages) {
      await deepseek.sync(msg);
    }
  }
}
```

#### Fallback Offline

Si l'utilisateur n'a pas de clé API ou pas de connexion:

```typescript
// src/services/agents.ts
export class OfflineOrchestrator {
  // Agents simulés en JavaScript local
  // Pas d'IA, juste structuration basique
  
  async analyzeRequest(prompt: string): Promise<Plan> {
    // Parsing basique: "crée une app React"
    // → détecte Framework: React, Language: JavaScript
    return {
      title: extractAppName(prompt),
      description: prompt,
      technologies: detectTechs(prompt),
      steps: basicPlanning(prompt),
    };
  }
}
```

### 3. Bande Passante Variable

#### Compression & Delta Sync

```typescript
// src/services/deepseek.ts
export const deepseek = {
  async chat(prompt: string, options?: { compress?: boolean }) {
    // Compression gzip de payload
    const compressed = options?.compress 
      ? await compressPayload(prompt) 
      : prompt;
    
    // Streaming par chunks
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: compressed,
      headers: { 'Content-Encoding': 'gzip' }
    });
    
    // Consomme stream par petit chunks
    for await (const chunk of response.body) {
      store.addMessage(chunk);
      // Sauvegarde en cache immédiatement
      await storage.saveChunk(chunk);
    }
  }
};
```

#### Retry Logic pour Connexion Instable

```python
# backend/services/deepseek_client.py
class DeepSeekClient:
  def __init__(self, timeout=10, max_retries=3):
    self.timeout = timeout
    self.max_retries = max_retries
  
  async def chat_with_retry(self, prompt: str):
    for attempt in range(self.max_retries):
      try:
        return await self.chat(prompt, timeout=self.timeout)
      except (TimeoutError, ConnectionError) as e:
        if attempt == self.max_retries - 1:
          raise
        # Backoff exponentiel: 2^n secondes
        wait = 2 ** attempt
        await asyncio.sleep(wait)
```

### 4. Marché Localisé

#### i18n pour Langues Africaines

```typescript
// src/stores/themeStore.ts
export interface ThemeState {
  language: 'en' | 'fr' | 'es' | 'sw' | 'yo' | 'ha'; // Swahili, Yoruba, Hausa
  locale: string;
  timezone: string;
}

// src/lib/i18n.ts
export const translations = {
  fr: { chat: 'Discussion', projects: 'Projets' },
  sw: { chat: 'Mazungumzo', projects: 'Miradi' },
  yo: { chat: 'Ijiroro', projects: 'Awọn Ekunle' },
};
```

#### Monnaies Locales

```typescript
// Pour affichage API costs
export function formatCost(usdAmount: number, locale: string): string {
  const rates = {
    'fr_SN': { currency: 'CFA', rate: 600 },  // Sénégal
    'en_KE': { currency: 'KES', rate: 150 },  // Kenya
    'en_ZA': { currency: 'ZAR', rate: 20 },   // Afrique du Sud
  };
  const converted = usdAmount * rates[locale].rate;
  return `${converted.toFixed(2)} ${rates[locale].currency}`;
}
```

### 5. Compatibilité Matériel

#### Tests sur Appareils Faibles

```
Cible: CPU 2-4 cores, RAM 4GB, disque 256GB
Tested: Lenovo ThinkPad E14 (budget), MacBook Air M1
```

**Optimisations:**
- [ ] Virtual scrolling pour listes longues (> 100 items)
- [ ] Lazy image loading
- [ ] Debounce input à 300ms minimum
- [ ] Limiter concurrent WebWorkers

### 6. Coût API Optimal

#### Strategy Coût DeepSeek

```python
# backend/services/deepseek_client.py
class SmartModelSelector:
  def select_model(self, task_type: str, prompt_length: int):
    """
    Choisir entre deepseek-chat (rapide, cheap) et 
    deepseek-reasoner (lent, cher, meilleur raisonnement)
    """
    if task_type == 'ORCHESTRATION':
      return 'deepseek-chat'  # Rapide, pas besoin raisonnement
    elif task_type == 'PLANNING':
      return 'deepseek-reasoner'  # Besoin raisonnement
    elif prompt_length > 5000:
      return 'deepseek-chat'  # Coûts plus bas pour long context
    else:
      return 'deepseek-chat'  # Par défaut
```

#### Caching Agressif

```python
# backend/services/cache.py
class CacheService:
  async def get_or_compute(self, key: str, compute_fn, ttl_hours=24):
    """
    Cache les réponses agents pendant 24h.
    Regex matching pour prompts similaires.
    """
    cached = await redis.get(key)
    if cached:
      return json.loads(cached)
    
    result = await compute_fn()
    await redis.setex(key, ttl_hours * 3600, json.dumps(result))
    return result
```

---

## Stratégie d'Intégration DeepSeek

### Architecture de Sécurité

DeepSeek API key est **JAMAIS** stockée ou transmise depuis le frontend. Le flux est:

```
┌─────────────┐
│ Tauri App   │
│ (Frontend)  │
└──────┬──────┘
       │ HTTPS
       │ (no API key in request)
       ↓
┌──────────────────────┐
│ Backend FastAPI      │  ← Seul endroit avec API key
│ (src-tauri ou cloud) │  ← Clé dans env var DEEPSEEK_API_KEY
└──────┬───────────────┘
       │ HTTPS + Auth
       │ (API key sécurisée)
       ↓
   DeepSeek API
   (api.deepseek.com)
```

### Implémentation Backend

```python
# backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
import httpx
import os

app = FastAPI()

DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'

@app.post('/api/chat')
async def chat_endpoint(request: ChatRequest):
    """
    Reçoit le prompt du frontend.
    Appelle DeepSeek avec la clé sécurisée.
    Stream la réponse vers le client.
    """
    
    # Validation
    if not request.prompt:
        raise HTTPException(status_code=400, detail='Empty prompt')
    
    # Déterminer le modèle
    model = select_model(request.task_type, len(request.prompt))
    
    # Appel DeepSeek
    headers = {
        'Authorization': f'Bearer {DEEPSEEK_API_KEY}',
        'Content-Type': 'application/json'
    }
    
    payload = {
        'model': model,
        'messages': [{'role': 'user', 'content': request.prompt}],
        'stream': True,
        'temperature': 0.7
    }
    
    async with httpx.AsyncClient() as client:
        async with client.stream(
            'POST',
            f'{DEEPSEEK_BASE_URL}/chat/completions',
            json=payload,
            headers=headers,
            timeout=120.0
        ) as response:
            # Stream response vers client
            async def generate():
                async for line in response.aiter_lines():
                    if line.startswith('data: '):
                        yield line[6:] + '\n'
            
            return StreamingResponse(generate(), media_type='text/event-stream')
```

### Implémentation Frontend

```typescript
// src/services/deepseek.ts
export const deepseek = {
  async *chat(prompt: string, taskType: string = 'CHAT') {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        task_type: taskType
      })
      // NOTE: Pas de clé API dans le header!
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value);
      const lines = text.split('\n');
      
      for (const line of lines) {
        if (line.trim() === '') continue;
        
        try {
          const data = JSON.parse(line);
          if (data.choices?.[0]?.delta?.content) {
            yield data.choices[0].delta.content;
          }
        } catch (e) {
          // Ignorer parsing errors
        }
      }
    }
  }
};

// Usage dans React
const ChatPage = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const handleSendMessage = async (prompt: string) => {
    setIsLoading(true);
    let fullResponse = '';
    
    try {
      for await (const chunk of deepseek.chat(prompt, 'ORCHESTRATION')) {
        fullResponse += chunk;
        
        // Streaming UI update
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...lastMsg, content: fullResponse }];
          }
          return [...prev, { role: 'assistant', content: fullResponse }];
        });
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="flex flex-col">
      <MessageList messages={messages} />
      <ChatInput onSend={handleSendMessage} disabled={isLoading} />
    </div>
  );
};
```

### Multi-Modèles Strategy

```python
# backend/agents/orchestrator.py
from services.deepseek_client import DeepSeekClient

class Orchestrator:
  def __init__(self):
    self.client = DeepSeekClient()
  
  async def analyze_request(self, prompt: str) -> Plan:
    """Phase 1: Analyze user request et créer plan"""
    
    # Modèle rapide pour l'analyse
    analysis = await self.client.chat(
      model='deepseek-chat',  # Rapide, 0.5s, $0.0001/1K tokens
      messages=[
        {
          'role': 'system',
          'content': '''Tu es un architecte logiciel expert. 
            Analyse cette demande et réponds en JSON avec:
            - app_name: str
            - description: str
            - technologies: list[str]
            - complexity: "simple" | "medium" | "complex"
          '''
        },
        { 'role': 'user', 'content': prompt }
      ]
    )
    
    return Plan.parse_obj(analysis)

class Planner:
  async def create_plan(self, analysis: Plan) -> DetailedPlan:
    """Phase 2: Créer structure détaillée (avec raisonnement si complexe)"""
    
    # Si simple → deepseek-chat rapide
    # Si complexe → deepseek-reasoner meilleur raisonnement
    model = 'deepseek-reasoner' if analysis.complexity == 'complex' else 'deepseek-chat'
    
    plan = await client.chat(
      model=model,
      messages=[{
        'role': 'system',
        'content': f'''Tu es expert en architecture de projets {analysis.technologies[0]}.
          Crée une structure détaillée avec:
          - folder_structure: arborescence
          - dependencies: liste packages
          - estimated_time: heures
          - potential_issues: list[str]
        '''
      }],
      temperature=0.7 if model == 'deepseek-chat' else 0.3
    )
    
    return DetailedPlan.parse_obj(plan)
```

### Error Handling & Fallback

```python
# backend/services/deepseek_client.py
class DeepSeekClient:
  async def chat_with_fallback(self, prompt: str, model: str = 'deepseek-chat'):
    """
    Essayer le modèle demandé.
    Si timeout/error → fallback à deepseek-chat.
    Si offline → retourner erreur avec conseil offline.
    """
    try:
      return await self.chat(prompt, model=model, timeout=120)
    
    except httpx.TimeoutException:
      # Réseau lent → fallback modèle plus rapide
      if model != 'deepseek-chat':
        logger.warning(f'{model} timeout, fallback to deepseek-chat')
        return await self.chat(prompt, model='deepseek-chat', timeout=60)
      raise
    
    except (ConnectionError, HTTPError) as e:
      if 'invalid_request_error' in str(e):
        raise ValueError('API key invalid or insufficient quota')
      if 'service_unavailable' in str(e):
        raise RuntimeError('DeepSeek API temporairement unavailable')
      raise
```

---

## Plan de Migration

### Phase 1: Préparation (Semaine 1)

#### Tâches

- [ ] **Backup complet** de la structure v1 vers `_archive/`
- [ ] **Initialiser** structure de fichiers v2 (créer dossiers vides)
- [ ] **Installer** dépendances: `npm install` + `pip install -r requirements.txt`
- [ ] **Configurer** Vite + Tauri pour nouvelle structure
- [ ] **Tester** que app démarre sans erreur (écran vide = OK)

#### Checklist Technique

```bash
# 1. Archive
mkdir -p _archive/v1
mv Admin _archive/v1/
mv mobile _archive/v1/
mv desktop-app-interface _archive/v1/
mv "Plan IA" _archive/v1/

# 2. Initialiser structure v2
mkdir -p desktop/src/{components,pages,stores,services,hooks,types,lib}
mkdir -p desktop/src/components/{ui,layout,chat,projects,memory}
mkdir -p backend/{agents,services,models}

# 3. Copier config files
cp desktop/vite.config.ts desktop/vite.config.ts.bak
# (Éditer vite.config.ts pour nouvelle structure)

# 4. Install dependencies
cd desktop && npm install && npm run build
cd backend && pip install -r requirements.txt
```

### Phase 2: Design System (Semaine 2)

#### Créer Components UI

- [ ] **Button.tsx** - Composant réutilisable avec variants
- [ ] **Input.tsx** - Form input
- [ ] **Badge.tsx** - Tags
- [ ] **Spinner.tsx** - Loading animation
- [ ] **Tooltip.tsx** - Info-bulles
- [ ] **ThemeToggle.tsx** - Dark mode
- [ ] **Card.tsx** - Container

```bash
# Tests: tous les components doivent être visible
npm run dev
# Accéder à http://localhost:5173
# Vérifier que Tailwind CSS fonctionne
```

#### Tests

```typescript
// desktop/src/components/ui/__tests__/Button.test.tsx
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

describe('Button', () => {
  it('renders with correct label', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });
  
  it('calls onClick handler', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    screen.getByText('Click me').click();
    expect(onClick).toHaveBeenCalled();
  });
});
```

### Phase 3: Layout & Pages (Semaine 3)

#### Créer Structure Principale

- [ ] **AppLayout.tsx** - Grille sidebar + content
- [ ] **Sidebar.tsx** - Navigation (Chat, Projects, Memory, Settings)
- [ ] **ChatPage.tsx** - Page chat complète
- [ ] **App.tsx** - Router principal

#### Routing Setup

```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ChatPage from './pages/ChatPage';
import ProjectsPage from './pages/ProjectsPage';
import MemoryPage from './pages/MemoryPage';
import SettingsPage from './pages/SettingsPage';

export function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
```

### Phase 4: Chat Interface (Semaine 4)

#### Implémentation Chat

- [ ] **ChatView.tsx** + **MessageList.tsx** + **MessageBubble.tsx**
- [ ] **ChatInput.tsx** - Input avec send button
- [ ] **CodeBlock.tsx** - Syntax highlighting
- [ ] **Service deepseek.ts** - Client API
- [ ] **Store chatStore** - Zustand state

#### API Integration

```typescript
// src/services/deepseek.ts
export const deepseek = {
  async *chat(prompt: string, taskType: string = 'CHAT') {
    // Implementation du streaming
  }
};

// src/stores/chatStore.ts
export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sessionId: nanoid(),
  isStreaming: false,
  
  addMessage: (msg) => set((state) => ({
    messages: [...state.messages, msg]
  })),
  
  clearMessages: () => set({ messages: [] })
}));
```

### Phase 5: Backend (Semaine 5)

#### Orchestration Agents

- [ ] **FastAPI server** - main.py avec endpoints
- [ ] **Orchestrator agent** - analyser prompts
- [ ] **Planner agent** - créer plans
- [ ] **Coder agent** - générer code
- [ ] **Tester agent** - valider code
- [ ] **Executor agent** - créer fichiers

```python
# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from agents.orchestrator import Orchestrator

app = FastAPI()

# CORS pour Tauri (localhost:5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'tauri://localhost'],
    allow_methods=['*'],
    allow_headers=['*']
)

orchestrator = Orchestrator()

@app.post('/api/chat')
async def chat(request: ChatRequest):
    # Streaming logic
    pass
```

#### Tests

```python
# backend/tests/test_orchestrator.py
import pytest
from agents.orchestrator import Orchestrator

@pytest.mark.asyncio
async def test_orchestrator_analyzes_request():
    orch = Orchestrator()
    plan = await orch.analyze_request('Create a React app')
    assert plan.app_name is not None
    assert plan.technologies is not None
```

### Phase 6: Offline + Storage (Semaine 6)

- [ ] **IndexedDB setup** - storage.ts
- [ ] **Offline detection** - useOffline.ts hook
- [ ] **Sync logic** - auto-sync when online
- [ ] **Fallback agents** - agents.ts pour mode offline

### Phase 7: Projects & Memory (Semaine 7)

- [ ] **ProjectsPage** - afficher projets générés
- [ ] **MemoryPage** - historique conversations
- [ ] **File explorer** - arborescence projets
- [ ] **Search** - recherche dans mémoire

### Phase 8: Settings & Polish (Semaine 8)

- [ ] **SettingsPage** - API key, theme, langue
- [ ] **i18n** - traductions
- [ ] **Dark mode** - ThemeToggle
- [ ] **Performance** - bundle size < 2MB
- [ ] **Testing** - coverage > 80%
- [ ] **Documentation** - README, API docs

#### Testing Commands

```bash
# Frontend tests
cd desktop && npm test

# Backend tests
cd backend && pytest tests/ -v

# Integration tests
docker-compose up --build
# Test endpoints manuellement

# Bundle size check
cd desktop && npm run build
# Vérifier dist/index.js < 2MB gzip

# Lighthouse audit
npm run build && npm run preview
# Ouvrir Chrome DevTools → Lighthouse
```

### Phase 9: Tauri Build (Semaine 9)

- [ ] **src-tauri/main.rs** - Rust bridge setup
- [ ] **Tauri config** - tauri.conf.json
- [ ] **Desktop build** - `npm run tauri:build`
- [ ] **Testing** - installer + run app
- [ ] **Code signing** - (optionnel, pour production)

#### Build Instructions

```bash
cd desktop

# Development (avec hot reload)
npm run tauri:dev

# Production build
npm run tauri:build
# → Crée installeur dans src-tauri/target/release/bundle/

# Test installer
# macOS: double-clic sur .dmg
# Windows: exécuter .msi
# Linux: installer .deb ou .AppImage
```

### Phase 10: Deployment (Semaine 10)

- [ ] **Docker backend** - docker-compose pour serveur
- [ ] **API documentation** - Swagger /docs
- [ ] **Monitoring** - logs + health checks
- [ ] **Release notes** - documenter v2.0
- [ ] **Public launch** - GitHub release + download links

---

## Diagramme d'Architecture

### Vue d'Ensemble Complète

```
UTILISATEUR
   ↓
   ├─→ DESKTOP APP (Tauri)
   │   ├─ Interface React (TypeScript)
   │   │  ├─ Chat View
   │   │  ├─ Projects View
   │   │  ├─ Memory View
   │   │  └─ Settings
   │   │
   │   ├─ Zustand Stores
   │   │  ├─ chatStore (messages, sessions)
   │   │  ├─ projectStore (projects, selected)
   │   │  ├─ memoryStore (conversations)
   │   │  ├─ themeStore (dark mode, language)
   │   │  └─ settingsStore (config)
   │   │
   │   ├─ Services (TypeScript)
   │   │  ├─ deepseek.ts (API client)
   │   │  ├─ storage.ts (IndexedDB)
   │   │  └─ agents.ts (offline fallback)
   │   │
   │   └─ Tauri Runtime (Rust)
   │      ├─ File system access
   │      ├─ System commands
   │      └─ Process execution
   │
   ├─→ BACKEND (FastAPI, optionnel)
   │   │   ├─ HTTP Server (port 8000)
   │   │   │  ├─ POST /api/chat (streaming)
   │   │   │  ├─ GET /api/projects
   │   │   │  ├─ POST /api/projects/{id}/execute
   │   │   │  └─ GET /api/memory/search
   │   │   │
   │   │   ├─ Agents (Python)
   │   │   │  ├─ Orchestrator (analyze)
   │   │   │  ├─ Planner (structure)
   │   │   │  ├─ Coder (code generation)
   │   │   │  ├─ Tester (validation)
   │   │   │  └─ Executor (file creation)
   │   │   │
   │   │   ├─ Services
   │   │   │  ├─ deepseek_client.py
   │   │   │  ├─ storage.py (SQLite)
   │   │   │  ├─ cache.py (Redis)
   │   │   │  └─ file_executor.py
   │   │   │
   │   │   └─ Storage
   │   │      ├─ SQLite (local)
   │   │      └─ Redis (cache, optional)
   │   │
   │   └─ Docker Compose
   │      ├─ Web service (FastAPI)
   │      ├─ DB service (PostgreSQL, optional)
   │      └─ Cache service (Redis, optional)
   │
   └─→ EXTERNAL SERVICES
       ├─ DeepSeek API
       │  ├─ deepseek-chat (fast, cheap)
       │  └─ deepseek-reasoner (slow, smart)
       │
       └─ File System (generated projects)
          └─ ~/ANZAR_GENERATED/
             └─ [Project folders created by Executor]
```

### Flux Données Principal

```
1. UTILISATEUR tape prompt
   ↓
2. UI React → chatStore.addMessage()
   ↓
3. Service deepseek.chat() → POST /api/chat
   ↓
4. FastAPI reçoit & valide
   ↓
5. Orchestrator agent analyze prompt → DeepSeek API
   ↓
6. Streaming response → EventStream vers UI
   ↓
7. React MessageList affiche en temps réel
   ↓
8. Utilisateur valide le plan
   ↓
9. Executor agent crée fichiers via Tauri
   ↓
10. Projet visible dans ProjectsView
```

### Sécurité & Isolation

```
┌────────────────────────────────────────────────┐
│ SENSITIVE DATA (DeepSeek API Key)              │
│ Location: Backend env var DEEPSEEK_API_KEY     │
│ Access: FastAPI server only, NEVER in frontend │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│ USER DATA (Conversations, Projects)            │
│ Location: IndexedDB (frontend) + SQLite (back) │
│ Sync: Auto when online, encrypted in transit   │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│ GENERATED FILES                                │
│ Location: ~/ANZAR_GENERATED/{project}/        │
│ Security: Isolated per project, no internet    │
└────────────────────────────────────────────────┘
```

---

## Checklist Implémentation

### Semaine 1: Setup
- [ ] Archive ancienne structure → `_archive/`
- [ ] Créer dossiers v2 (components, pages, stores, etc.)
- [ ] Configurer Vite + TypeScript
- [ ] Configurer Tailwind CSS
- [ ] Init git avec `.gitignore` propre
- [ ] Créer `README.md` avec quick start
- [ ] Vérifier app démarre: `npm run dev`

### Semaine 2: Design System
- [ ] Button.tsx (primary, secondary, danger, loading variants)
- [ ] Input.tsx (text, password, number, with validation)
- [ ] Badge.tsx (status colors: pending, success, error, info)
- [ ] Spinner.tsx (animated loading)
- [ ] Tooltip.tsx (on hover)
- [ ] ThemeToggle.tsx (dark/light mode)
- [ ] Dialog.tsx (modal pour confirmations)
- [ ] Tester components dans Storybook (ou simple demo page)

### Semaine 3: Layout & Routing
- [ ] AppLayout.tsx (sidebar + content grid)
- [ ] Sidebar.tsx (nav avec icons, active state)
- [ ] TitleBar.tsx (Tauri window controls)
- [ ] Créer pages: ChatPage, ProjectsPage, MemoryPage, SettingsPage
- [ ] Router config (React Router v6)
- [ ] Navigation entre pages
- [ ] Test: tous les liens marchent

### Semaine 4: Chat Interface
- [ ] MessageList.tsx (scrollable, virtualized)
- [ ] MessageBubble.tsx (user/agent différent style)
- [ ] ChatInput.tsx (textarea, send button, @ mention)
- [ ] CodeBlock.tsx (syntax highlight avec Prism)
- [ ] StreamingDots.tsx (animation "...")
- [ ] AgentStatus.tsx (badge "Orchestrator en cours...")
- [ ] Store chatStore (avec Zustand)
- [ ] Service deepseek.ts (mock first, puis real API)
- [ ] Streaming response affichage
- [ ] Test: write message, see it stream

### Semaine 5: Backend Setup
- [ ] FastAPI main.py avec CORS
- [ ] Endpoint POST /api/chat (streaming)
- [ ] Endpoint GET /api/projects
- [ ] Endpoint POST /api/projects/{id}/execute
- [ ] Endpoint GET /api/memory/search
- [ ] Endpoint GET /api/health
- [ ] DeepSeek client setup (deepseek_client.py)
- [ ] Error handling & retry logic
- [ ] Tests (pytest)
- [ ] Swagger docs /docs working

### Semaine 6: Agents Implementation
- [ ] Orchestrator agent (analyzes prompts)
- [ ] Planner agent (creates detailed plans)
- [ ] Coder agent (generates code)
- [ ] Tester agent (validates code)
- [ ] Executor agent (creates files)
- [ ] Agent logging (structure, timing, errors)
- [ ] Test: run agents manually with test prompts

### Semaine 7: Storage & Offline
- [ ] IndexedDB setup (storage.ts)
- [ ] SQLite backend (sqlite.db)
- [ ] Zustand persists (sync with disk)
- [ ] useOffline hook (navigator.onLine)
- [ ] Offline agents fallback (agents.ts)
- [ ] Sync logic (bidirectional)
- [ ] Test: disable internet, check offline mode works

### Semaine 8: Projects & Memory
- [ ] ProjectsView.tsx (grid of cards)
- [ ] ProjectCard.tsx (thumbnail, delete, open)
- [ ] FileExplorer.tsx (folder tree)
- [ ] AgentProgress.tsx (progress bar)
- [ ] MemoryView.tsx (past conversations)
- [ ] ConversationList.tsx (clickable to restore)
- [ ] SearchBar.tsx (search history)
- [ ] Store projectStore & memoryStore
- [ ] Test: create project, see it in list

### Semaine 9: Tauri Build
- [ ] Configure src-tauri/Cargo.toml
- [ ] Configure src-tauri/tauri.conf.json
- [ ] src-tauri/src/main.rs (window setup)
- [ ] Tauri commands pour file system
- [ ] Test: npm run tauri:dev
- [ ] Build: npm run tauri:build
- [ ] Test installer (macOS/Windows/Linux)

### Semaine 10: Settings & i18n
- [ ] SettingsPage.tsx
- [ ] API Key input (masked, not stored locally)
- [ ] Theme selector (dark/light)
- [ ] Language selector (fr, en, es, sw, yo, ha)
- [ ] i18n setup (translations.ts)
- [ ] Store settingsStore (Zustand + persist)
- [ ] Test: change theme, reload page, persists

### Semaine 11: Polish & Performance
- [ ] Bundle size audit (target < 2MB gzip)
- [ ] Tree-shake unused code
- [ ] Lazy load routes
- [ ] Optimize images (webp)
- [ ] Code splitting
- [ ] Lighthouse score > 90
- [ ] Mobile responsive (test on phone)
- [ ] Dark mode polished

### Semaine 12: Testing & Docs
- [ ] Unit tests (Jest) > 80% coverage
- [ ] Integration tests (Playwright)
- [ ] End-to-end tests (generate real project)
- [ ] API docs (Swagger)
- [ ] README.md complet
- [ ] Contributing guide
- [ ] Troubleshooting guide
- [ ] Architecture.md (ce document, mis à jour)

### Semaine 13: Deployment
- [ ] Docker build & push
- [ ] Github Actions CI/CD
- [ ] Release checklist
- [ ] Update download links
- [ ] Announce v2.0 launch
- [ ] Monitor for bugs/feedback

---

## Recommandations d'Implémentation

### Code Quality

1. **TypeScript Strict Mode**
   ```json
   // tsconfig.json
   {
     "compilerOptions": {
       "strict": true,
       "noImplicitAny": true,
       "strictNullChecks": true
     }
   }
   ```

2. **Prettier + ESLint**
   ```bash
   npm install --save-dev prettier eslint @typescript-eslint/eslint-plugin
   ```

3. **Pre-commit Hooks (Husky)**
   ```bash
   npx husky install
   npx husky add .husky/pre-commit "npm run format && npm run lint"
   ```

### Performance Monitoring

```typescript
// src/lib/monitoring.ts
export function reportWebVitals() {
  // Track Core Web Vitals
  // Use web-vitals library
}

// Send to monitoring service (Sentry, etc.)
```

### Git Workflow

```bash
# Feature branches
git checkout -b feature/chat-interface
git commit -m "feat: add streaming chat UI"
git push origin feature/chat-interface
# → Create PR, get review, merge

# Release branches
git checkout -b release/v2.0
# Only bug fixes
git tag v2.0.0
```

### Documentation Standards

Chaque fichier doit avoir:

```typescript
/**
 * Brief description of what this file does
 * 
 * @example
 * const store = useChatStore();
 * store.addMessage({ role: 'user', content: 'Hello' });
 * 
 * @see {@link ChatView} for usage in UI
 */
```

---

## Conclusion

ANZAR v2.0 est une refonte radicale qui:

1. **Simplifie** l'architecture (pas d'auth, pas de DB complexe)
2. **Optimise** pour l'Afrique (offline-first, bande passante variable)
3. **Sécurise** l'intégration DeepSeek (API key jamais dans frontend)
4. **Accélère** le développement (Tauri < Electron, Zustand < Redux)
5. **Réduit** la surface d'attaque (moins de dépendances)

### Prochaines Étapes

1. Créer branche `refactor/v2.0`
2. Commencer Phase 1 (Setup & Archive)
3. Faire daily standup avec équipe
4. Démonstration UI chaque vendredi
5. Go-live en ~13 semaines

---

**Document maintenu par**: Équipe ANZAR  
**Dernière mise à jour**: Avril 2026  
**Version**: 2.0-planning
