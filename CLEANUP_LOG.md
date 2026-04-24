# ANZAR v2.0 - Journal de Nettoyage

## Fichiers à supprimer (ancienne architecture)

### Pages obsolètes (remplacées par /pages/)
- `desktop/src/app/` (tout le dossier - remplacé par pages/)
- `desktop/src/pages/Agents.tsx`
- `desktop/src/pages/Dashboard.tsx`
- `desktop/src/pages/Login.tsx`
- `desktop/src/pages/Register.tsx`
- `desktop/src/pages/NewProject.tsx`
- `desktop/src/pages/ProjectDetail.tsx`
- `desktop/src/pages/Projects.tsx`
- `desktop/src/pages/Settings.tsx`
- `desktop/src/pages/SectionPage.tsx`

### Composants obsolètes (remplacés par layout/ et ui/)
- `desktop/src/components/AnzarLayout.tsx`
- `desktop/src/components/Header.tsx`
- `desktop/src/components/Layout.tsx`
- `desktop/src/components/MetricCard.tsx`
- `desktop/src/components/ModernDesktopInterface.tsx`
- `desktop/src/components/ModernDesktopLayout.tsx`
- `desktop/src/components/PlanValidationModal.tsx`
- `desktop/src/components/ProjectCard.tsx` (remplacé par projects/)
- `desktop/src/components/ProjectItem.tsx`
- `desktop/src/components/Sidebar.tsx` (remplacé par layout/)
- `desktop/src/components/anzar/` (tout le dossier)

### Layouts obsolètes
- `desktop/src/components/layout/ChatFirstLayout.tsx`
- `desktop/src/components/layout/ChatFirstLayoutWrapper.tsx`
- `desktop/src/components/layout/CoworkLayout.tsx`
- `desktop/src/components/layout/CoworkLayoutWrapper.tsx`
- `desktop/src/components/layout/FloatingInput.tsx`
- `desktop/src/components/layout/IconSidebar.tsx`
- `desktop/src/components/layout/RightPanelFooter.tsx`
- `desktop/src/components/layout/SidebarFooter.tsx`

### Stores obsolètes
- `desktop/src/stores/authStore.ts` (plus d'auth)
- `desktop/src/stores/anzarModeStore.ts` (simplifié)
- `desktop/src/stores/fileProjectStore.ts` (remplacé par projectStore)

### Autres fichiers obsolètes
- `desktop/src/index.tsx` (remplacé par main.tsx)
- `desktop/src/api.ts` (remplacé par services/)
- `desktop/src/api/auth.ts`
- `desktop/src/types/auth.ts`
- `desktop/src/services/aiCompletionService.ts` (remplacé par deepseek.ts)
- `desktop/src/hooks/useAnzarAI.ts` (remplacé par useChat.ts)
- `desktop/src/hooks/useDeepSeek.ts` (remplacé par services/deepseek.ts)

### Dossiers racine à archiver
- `Admin/` → archiver (fusionné dans Settings)
- `mobile/` → archiver (phase ultérieure)
- `desktop-app-interface/` → supprimer (obsolète)
- `packages/shared-bl/` → migré vers backend/
- `Plan IA/` → renommer en `_archive/`

## Nouveaux fichiers créés

### Architecture
- `ARCHITECTURE_REFONTE.md`
- `CLEANUP_LOG.md`
- `.env.example`

### Frontend (desktop/src/)
- `main.tsx` (nouveau point d'entrée)
- `App.tsx` (réécrit, sans auth)
- `index.css` (réécrit, variables --color-*)
- `components/layout/{AppLayout,Sidebar,TitleBar}.tsx`
- `components/chat/{ChatView,MessageList,MessageBubble,ChatInput,CodeBlock,StreamingDots}.tsx`
- `components/projects/{ProjectsView,ProjectCard,FileExplorer,AgentProgress}.tsx`
- `components/memory/{MemoryView,ConversationList,SearchBar}.tsx`
- `components/ui/{Button,Input,IconButton,Badge,Tooltip,ThemeToggle}.tsx`
- `pages/{ChatPage,ProjectsPage,MemoryPage,SettingsPage}.tsx`
- `stores/{chatStore,projectStore,memoryStore,themeStore,settingsStore}.ts`
- `services/{deepseek,storage,agents}.ts`
- `hooks/{useChat,useTheme,useOffline}.ts`
- `types/index.ts`
- `lib/utils.ts`

### Backend (backend/)
- `main.py`, `config.py`, `run.py`
- `agents/{base,orchestrator,planner,coder,tester,executor}.py`
- `services/{deepseek_client,cache}.py`
- `requirements.txt`, `.env.example`, `Dockerfile`

## Commande de suppression

```bash
# Exécuter depuis la racine ANZAR/
# ATTENTION: Vérifier avant d'exécuter

# Anciens fichiers desktop
rm -rf desktop/src/app/
rm desktop/src/index.tsx
rm desktop/src/api.ts
rm -rf desktop/src/api/
rm desktop/src/components/AnzarLayout.tsx
rm desktop/src/components/Header.tsx
rm desktop/src/components/Layout.tsx
rm desktop/src/components/MetricCard.tsx
rm desktop/src/components/ModernDesktopInterface.tsx
rm desktop/src/components/ModernDesktopLayout.tsx
rm desktop/src/components/PlanValidationModal.tsx
rm desktop/src/components/ProjectCard.tsx
rm desktop/src/components/ProjectItem.tsx
rm desktop/src/components/Sidebar.tsx
rm -rf desktop/src/components/anzar/
rm desktop/src/components/layout/ChatFirstLayout.tsx
rm desktop/src/components/layout/ChatFirstLayoutWrapper.tsx
rm desktop/src/components/layout/CoworkLayout.tsx
rm desktop/src/components/layout/CoworkLayoutWrapper.tsx
rm desktop/src/components/layout/FloatingInput.tsx
rm desktop/src/components/layout/IconSidebar.tsx
rm desktop/src/components/layout/RightPanelFooter.tsx
rm desktop/src/components/layout/SidebarFooter.tsx
rm desktop/src/stores/authStore.ts
rm desktop/src/stores/anzarModeStore.ts
rm desktop/src/stores/fileProjectStore.ts
rm desktop/src/types/auth.ts
rm desktop/src/services/aiCompletionService.ts
rm desktop/src/hooks/useAnzarAI.ts
rm desktop/src/hooks/useDeepSeek.ts
rm desktop/src/hooks/useTauriFiles.ts
rm desktop/src/hooks/useTauriProjects.ts
rm desktop/src/pages/Agents.tsx
rm desktop/src/pages/Dashboard.tsx
rm desktop/src/pages/Login.tsx
rm desktop/src/pages/Register.tsx
rm desktop/src/pages/NewProject.tsx
rm desktop/src/pages/ProjectDetail.tsx
rm desktop/src/pages/Projects.tsx
rm desktop/src/pages/Settings.tsx
rm desktop/src/pages/SectionPage.tsx

# Archiver les dossiers racine
mv Admin/ _archive/Admin/
mv mobile/ _archive/mobile/
rm -rf desktop-app-interface/
mv "Plan IA/" "_archive/Plan IA/"
mv packages/ _archive/packages/
```
