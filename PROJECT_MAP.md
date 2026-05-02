# ANZAR — Carte du Projet (Reference Rapide)

> Derniere mise a jour : 2026-04-30
> Ce fichier sert de reference rapide pour explorer le projet sans tout relire.

---

## Vue d'ensemble

- **Nom** : ANZAR (Assistant IA de Vibecoding pour l'Afrique)
- **Version** : 2.0.0
- **Stack** : Tauri v1 + React 18 + TypeScript + Vite + Tailwind + Zustand (frontend) / Python FastAPI (backend sur Railway)
- **IA** : DeepSeek (fast + reasoning) + Kimi (vision + long context), proxy backend
- **Auth** : OTP email (Brevo) + JWT
- **Credits** : Systeme prepaye, cout par appel API

---

## Structure des dossiers

```
ANZAR/
  desktop/                    # App Tauri (frontend React)
    src/
      pages/                  # 4 pages : ChatPage, LoginPage, ProjectWorkspacePage, SettingsPage
      components/
        chat/                 # ChatView, ChatInput, MessageBubble, MessageAI, MessageUser, CodeBlock, ActivityTimeline, AgentProgress, ProjectWizardModal, etc.
        layout/               # AppLayout, Sidebar, TitleBar, StatusBar
        ui/                   # Button, Input, Card, Badge, Avatar, Tooltip, Skeleton, CommandPalette, OnboardingWelcome, etc.
        projects/             # ProjectsView, ProjectCard, ProjectChat, CodeEditor, FileExplorer
        files/                # FileTree, FileEditor, FileUploader, ProjectExplorer
        terminal/             # Terminal
        runs/                 # RunPanel, DiffView, ChangePreviewModal
        memory/               # MemoryView, ConversationList, SearchBar
        error/                # ErrorBoundary
      stores/                 # chatStore, projectStore, accountStore, settingsStore, memoryStore, usageStore, activityStore, runStore, changeStore, commandStore, themeStore, studentStore
      services/               # ai.ts, router.ts, agents.ts, projectGeneration.ts, prompts.ts, studentPrompts.ts, studentService.ts, fileSystem.ts, documentExport.ts, presentationExport.ts, diagnostic.ts, terminal.ts, auth.ts, etc.
      hooks/                  # useChat, useAnzarIA, useFIMCompletion, useTheme, useOffline
      types/                  # index.ts (types principaux), modules.d.ts, file-project.ts, run.ts
      lib/                    # utils.ts (cn, isTauri, etc.)
    src-tauri/                # Config Tauri (Rust) + tauri.conf.json
  backend/
    main.py                   # FastAPI — tous les endpoints
    config.py                 # Variables d'environnement
    database.py               # SQLAlchemy (users, credits, projects, otps, transactions)
    security.py               # JWT, rate limiting, validation
    agents/                   # Pipeline multi-agents : orchestrator, planner, coder, tester, executor, enricher, student_writer, student_corrector, student_researcher
    services/                 # deepseek_client.py, email.py, web_search.py, cache.py, student_plagiarism.py, student_flashcards.py, student_translator.py, student_exercises.py
  Admin/                      # Dashboard admin (app Tauri separee)
  Plan IA/                    # Archive prompts/plans
```

---

## Routes frontend

| Route | Page | Description |
|-------|------|-------------|
| `/` | ChatPage (ChatView) | Interface chat principale + cartes fonctionnalites |
| `/login` | LoginPage | Authentification OTP |
| `/projects/:id` | ProjectWorkspacePage | Editeur projet + file explorer + chat |
| `/settings` | SettingsPage | 5 onglets : Profil, Abonnement, Preferences, Avance, A propos |

---

## Endpoints backend (main.py)

**Auth** : POST /api/auth/send-code, verify-code, refresh, logout
**Users** : GET/PATCH /api/users/me, change-password, DELETE
**Credits** : GET /api/credits/balance, POST /api/credits/add, GET /api/usage/stats, history, transactions
**Projects** : CRUD /api/projects
**AI** : POST /api/stream (SSE), POST /api/complete
**Student** : GET/DELETE /api/student/projects, POST /api/student/write, correct, research, plagiarism, flashcards, translate, exercises

---

## Feature : Assistant Etudiant

Architecture : prompts modulaires (studentPrompts.ts) + agents backend (student_*.py) + skills backend (student_*.py) + endpoints API (/api/student/*) + service frontend (studentService.ts) + store Zustand (studentStore.ts)

### 13 fonctionnalites (9 workflows + 4 skills) :

**Workflows (via prompts):**
1. **Rediger un memoire** — Guide etape par etape (5 questions), genere plan detaille, chapitres, biblio
2. **Rapport de stage** — Creation structuree (5 questions), couverture + TDM + sections + analyse
3. **Corriger / Reformuler** — Upload fichier + 4 sous-modes (langue, reformulation, academique, tout)
4. **Plan detaille** — Numerotation academique I.A.1.a, objectifs, pages estimees
5. **Resume de cours** — Fiche revision, definitions, formules, quiz
6. **Preparer un expose** — Slides, notes orales, anti-seche, export PPTX
7. **Generer des citations** — Biblio APA, MLA, Chicago, Harvard, IEEE
8. **Quiz de revision** — QCM interactif, scoring, explication
9. **Mode Professeur** — Evaluation /20, grille par discipline

**Skills (nouveaux, avec backend dedie) :**
10. **Anti-Plagiat** — Analyse par chunks, detection passages suspects, reformulation auto, score %
11. **Flashcards** — Cartes recto-verso depuis un cours, mode revision espacee (Anki)
12. **Traducteur Academique** — FR/EN/AR, registre academique, glossaire technique
13. **Generateur d'Exercices** — QCM, vrai/faux, reponse courte, cas pratique, calcul

### 3 Agents backend (pipeline multi-etapes) :
- **StudentWriterAgent** (student_writer.py) — analyse -> plan -> redaction -> relecture -> biblio
- **StudentCorrectorAgent** (student_corrector.py) — analyse -> categorisation -> correction -> score -> suggestions
- **StudentResearcherAgent** (student_researcher.py) — question -> search -> analyse -> synthese -> biblio

### Ou sont les prompts :
Fichier `services/studentPrompts.ts` exporte STUDENT_PROMPTS (12 workflows), AGENT_PROMPTS (3 agents), SKILL_PROMPTS (4 skills). ChatView.tsx reference ces exports au lieu de hardcoder.

### Persistance projets etudiants :
Table `student_projects` en DB (database.py) avec CRUD complet. Store Zustand `studentStore.ts` cote frontend.

### Export disponibles :
- DOCX (documentExport.ts) — avec tracked changes pour corrections
- PPTX (presentationExport.ts) — design premium
- PDF — via documentExport.ts
- JSON — export conversation

---

## Providers IA

| Provider | Modeles | Usage |
|----------|---------|-------|
| DeepSeek | deepseek-chat (fast), deepseek-reasoner (thinking) | Chat general, code, raisonnement |
| Kimi | moonshot-v1 | Vision (images), long context (262K tokens) |

Routing automatique dans `router.ts` : detection d'intention, switch auto vers Kimi si image uploadee.

---

## Stores Zustand

| Store | Role |
|-------|------|
| chatStore | Conversations, messages, currentId |
| projectStore | Projets, fichiers, workspace |
| accountStore | User, credits, isLoggedIn |
| settingsStore | Theme, langue, preferences IA |
| activityStore | Timeline agents, etapes pipeline |
| runStore | Runs de generation |
| usageStore | Stats d'utilisation API |
| themeStore | Dark/light mode |
| studentStore | Projets etudiants, progression |
| memoryStore | Historique conversations |
| changeStore | Tracking changements fichiers |
| commandStore | Execution commandes |

---

## Pipeline Agents (backend/agents/)

1. **EnricherAgent** — Enrichit le prompt utilisateur
2. **OrchestratorAgent** — Plan maitre du projet
3. **PlannerAgent** — Architecture, stack, structure fichiers
4. **CoderAgent** — Genere le code
5. **TesterAgent** — Ecrit les tests (parallele avec Executor)
6. **ExecutorAgent** — Cree les fichiers sur disque

---

## Securite

- JWT tokens (access + refresh)
- OTP par email (Brevo SMTP)
- Cles API cote serveur uniquement (proxy)
- Rate limiting IP
- CSP headers + CORS restreint
- Shell Tauri : whitelist (node, npm, python, git, cargo)
- Filesystem Tauri : sandbox ($DOCUMENTS, $DESKTOP, $DOWNLOAD)

---

## Notes techniques importantes

- `decorations: false` dans tauri.conf.json -> TitleBar custom obligatoire
- Navigator.connection API peu fiable dans Tauri WebView -> seuil slow a 0.5 Mbps, pas de detection 3g
- AbortSignal.any() pour merger signaux timeout + user
- Timeouts : chat 60s/120s (selon taille), smartChat 90s, stream 60s
- Retries : 3 tentatives avec backoff exponentiel (1s, 2s)
- Pas de caracteres Unicode dans les fichiers .tsx (TS1127) -> ASCII uniquement

---

## Problemes connus resolus

- Window controls manquants sur Windows -> TitleBar avec detection OS
- Faux "connexion lente" -> seuil abaisse + suppression detection 3g
- Erreur connexion apres upload -> timeouts dynamiques selon payload
- Bouton "Rapport" inutile -> supprime de MessageBubble
- SettingsPage desorganisee -> refonte 5 onglets
- Unicode dans .tsx -> reecriture pure ASCII
