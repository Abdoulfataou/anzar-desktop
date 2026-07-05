# RAPPORT D'AUDIT — ANZAR
**Date : 4 juillet 2026** · Branche `main` · Dernier commit : `353f274` (AXE 4: Audit complet)
**Objectif du chantier : transformer ANZAR en logiciel de vibecoding complet, niveau Claude Code / Cowork.**

---

## 1. Vue d'ensemble

ANZAR est un assistant IA de vibecoding : l'utilisateur décrit un projet, ANZAR planifie (`/plan`), génère le code (`/execute` en SSE), permet d'itérer, puis vise une boucle Verify → Fix → Verify. Monorepo propriétaire (ISSALANHUB), 846 fichiers trackés.

| Module | Stack | Taille | État |
|---|---|---|---|
| `desktop/` | Tauri **1.6** + React 18 + TS + Zustand + Tailwind | ~26 000 lignes, 82 fichiers TS/TSX | **Cœur du produit**, v2.0.0 |
| `backend/` | FastAPI + SQLAlchemy async (SQLite/Postgres) | ~6 000 lignes | Déployé Railway, proxy IA + crédits |
| `admin/` | React + Tauri | — | Console d'admin |
| `mobile/` | React Native/Expo | — | Secondaire |

## 2. Architecture actuelle

**Backend (proxy sécurisé + pipeline multi-agents)**
- Clés API (DeepSeek, Kimi, Serper) 100 % côté serveur. Auth JWT + OTP email (Brevo). Crédits prépayés serveur = source de vérité. Rate limiting, housekeeping périodique.
- 4 agents : `planner`, `coder` (971 lignes — génération batch, détection de fichiers tronqués, régénération unitaire), `code_review`, `vision` (design-to-code).
- Routes clés : `/plan`, `/{id}/execute` (SSE), `/iterate`, `/review`, `/design-to-code`, `/cancel`, `/api/chat/smart` (avec tool_executor), proxy DeepSeek (chat, FIM, files, batches).

**Desktop (VibeCoding Studio)**
- Studio complet : `StudioChat`, `StudioEditor`, `StudioFileTree`, `StudioPreview`, `StudioGitHistory`, `StudioTodoList`, `SkillsPanel`, `PlanReview`, `DesignToCodePanel`.
- `iterationRouter` : routage regex vers 6 modes (iterate/patch/refactor/debug/test/review), inspiré TRAE SOLO.
- `devMemoryStore` + `iterationMemory` : mémoire développeur (inspirée Hermes) + skills hub communautaire.
- `terminal.ts` : exécution shell via Tauri (allowlist node/npm/npx/git/pip/cargo…), streaming stdout/stderr.
- 8 stores Zustand, `codeIndexer`, `lintResolver`, exports docx/pptx/pdf, Sentry, auto-update Tauri.
- `main.rs` = 17 lignes : quasi aucune logique native Rust, tout passe par la webview + allowlist Tauri.

## 3. Forces

1. Base saine et récente : refonte "purge non-vibecoding" (43 fichiers supprimés), audit AXE 4 déjà passé, zéro erreur TS exigée en CI.
2. Sécurité bien pensée : clés serveur, crédits serveur, allowlist shell avec validators regex, OTP hashé.
3. Pipeline SSE plan→execute→iterate fonctionnel avec annulation, suivi d'agents, persistance.
4. UX déjà orientée "studio" (todo list, git history, preview, skills) — la coquille du produit cible existe.
5. Infra prod réelle : Railway, CI GitHub Actions, releases Windows/macOS signées, auto-update.

## 4. Faiblesses et écarts vs l'objectif « logiciel comme Claude »

**Écart n°1 — pas de vraie boucle agentique.** Le cœur de Claude Code, c'est un agent qui *utilise des outils en boucle* (lire fichier → chercher → éditer → exécuter → lire l'erreur → corriger) jusqu'à ce que la tâche soit finie. ANZAR fait de la *génération dirigée* : le coder produit des blocs de code extraits par regex (`_extract_code_blocks`), appliqués ensuite. Le `tool_executor` existe dans `/api/chat/smart` mais n'est pas le moteur du studio.

**Écart n°2 — Verify→Fix→Verify non bouclé.** Le README le promet, mais il n'y a pas de boucle automatique "run tests/lint → injecter les erreurs → re-patcher → re-run" pilotée par l'agent.

**Écart n°3 — contexte limité.** `_build_smart_context` plafonne (~30k chars, tri heuristique). Pas d'index sémantique (embeddings/tree-sitter), pas de retrieval intelligent sur gros projets.

**Écart n°4 — édition destructive.** Génération/itération = réécriture de fichiers entiers plutôt que edits ciblés (search/replace) → lent, coûteux en tokens, risque de troncature (le code contient d'ailleurs `_detect_truncated_files` pour compenser).

**Autres points :**
- Tauri 1.6 (obsolète — Tauri 2 stable depuis fin 2024 : meilleur IPC, permissions fines, mobile).
- **Zéro test** (ni front ni back) ; `lint` = `tsc --noEmit` seulement.
- Incohérence sécurité : le README annonce un scope FS limité à `*/ANZAR/**`, mais `tauri.conf.json` autorise `$DOCUMENTS/**`, `$DESKTOP/**`, `$HOME/Projects/**`, etc.
- `jwt_secret` a une valeur par défaut "CHANGE-ME" (validate_config existe, à vérifier qu'il bloque).
- Mono-provider de fait (DeepSeek) ; Kimi câblé mais secondaire. Pas de MCP, pas de sous-agents parallèles.
- Terminal = commandes one-shot allowlistées, pas de vrai PTY interactif.
- Dossier `.git_broken/` en suppressions non commitées (à nettoyer).

## 5. Roadmap proposée (vers un Claude-like)

**Phase 1 — Le moteur agentique (le plus important)** — ✅ *Cœur implémenté le 04/07/2026 : `desktop/src/services/agent/` (agentTools, agentLoop, agentPrompts) + hook `useAgentSession`. Boucle client-driven via le proxy existant. UI branchée : onglet **Agent** dans StudioChat (`AgentPanel.tsx`) avec timeline des tool calls, streaming, stop. Reste : test en conditions réelles (`npm run tauri:dev`).*
Remplacer la génération one-shot par une boucle tool-use côté backend : outils `read_file`, `write_file`, `edit_file` (search/replace), `list_dir`, `grep`, `run_command`, `web_search`. DeepSeek supporte le function calling — le `tool_executor` de `chat.py` est le point de départ. L'agent boucle jusqu'à complétion avec budget de tokens/étapes. Les écritures passent par ChangeSets (preview → apply) déjà prévus dans le design.

**Phase 2 — Verify → Fix → Verify réel** — ✅ *Implémenté le 04/07/2026 : `agentVerifier.ts` (détection npm/cargo/python → lint/typecheck/build/test) + gate dans `agentLoop.ts` : task_done REFUSÉ si la vérification échoue, erreurs réinjectées, 3 cycles de correction max. UI dans AgentPanel (badges vérif).*
Après chaque tâche : détection auto du type de projet → run lint/build/tests via `terminal.ts` → parse des erreurs → réinjection à l'agent → nouvelle passe. Checkpoints git automatiques avant chaque apply (rollback en 1 clic via `StudioGitHistory`).

**Phase 3 — Contexte et mémoire** — ✅ *Implémenté le 04/07/2026 : `agentContext.ts` — indexation auto au démarrage de session (codeIndexer réutilisé : code map bornée 9k + hints par tâche via scoring/graphe de dépendances) injectée dans le system prompt. Mémoire persistante `ANZAR.md` à la racine du projet (équivalent CLAUDE.md), lue à chaque session, enrichie par le nouvel outil `remember`.*
Indexation locale du projet (tree-sitter + embeddings), retrieval pour construire le contexte au lieu du plafond 30k chars. Fusionner `codeIndexer` + `devMemoryStore` en une vraie mémoire projet (conventions, décisions, erreurs passées) injectée dans le system prompt — équivalent CLAUDE.md/skills.

**Phase 4 — Plateforme** — 🟡 *Partiellement fait le 04/07/2026 : (1) multi-provider **OpenRouter** (Claude/GPT en option) — backend (`config.py`, `_state.py`, `security.py`) + desktop (`AI_PROVIDERS`, coûts router) ; activer avec `OPENROUTER_API_KEY` sur Railway, IDs de modèles à ajuster dans `types/index.ts`. (2) **Sous-agents parallèles** : outil `spawn_subagents` (2-3 sessions concurrentes, budget réduit, le parent vérifie). (3) Migration **Tauri 2** : guide détaillé dans `desktop/MIGRATION_TAURI2.md` — à faire sur branche dédiée avec tests macOS/Windows. Reste : MCP, PTY (post-Tauri 2).*
Migration Tauri 2 (+ PTY réel type `portable-pty` pour un terminal interactif). Multi-provider (DeepSeek, Kimi, + Claude/GPT en option) avec routage par tâche. Support MCP pour connecteurs externes. Sous-agents parallèles (ex. génération multi-fichiers concurrente, agent review séparé).

**Phase 5 — Qualité et durcissement**
Tests backend (pytest sur agents/routes) et front (vitest sur stores/services). Aligner le scope FS réel sur la promesse du README (ou l'inverse, mais documenté). Forcer `jwt_secret` en prod. Nettoyer `.git_broken`.

## 5 bis. Refonte UX du 04/07/2026 (épuration + redesign du parcours)

**Décisions produit** (validées) : le chat généraliste est conservé ; admin/ et mobile/ intouchés.

**Fait :**
- **Accueil redesigné en hub à 2 modes explicites** (`WelcomeScreen.tsx`) : "Créer un projet" (→ pipeline plan → studio) et "Discuter" (→ chat classique). La détection d'intention ne décide plus du parcours — l'utilisateur choisit. Suggestions par mode, import de projet existant, design hero épuré.
- **Parcours cible** : ouvrir → choisir le mode → décrire → (Créer) PlanReview → génération studio → itération Chat/Agent/Skills → vérification auto → projet final. (Discuter) conversation avec exports.
- Orphelins supprimés : `ui/Button.tsx`, `ui/Input.tsx`. Placeholder du chat rendu neutre.

**Analysé et volontairement CONSERVÉ :**
- `GenerationPanel` + `ActivityTimeline` : encore utilisés par le flux import dossier + audit (useProjectPipeline).
- `intentDetection` : sert au chat (détection visuel/audit), plus au routage projet.
- Exports docx/pptx (`MessageBubble`) : liés au chat conservé.

**Correctifs post-test réel (04/07 soir)** : (1) **fix fichiers vides** — la fin du stream SSE n'est plus traitée comme un succès : vérification du statut serveur (`getStatus`) + réconciliation systématique via `download-files` + erreur franche si zéro contenu ; (2) sidebar repliée : bouton "Afficher" empilé (il débordait et était masqué par overflow-hidden) ; (3) phase planning : étapes visibles une à une + bouton Annuler ; (4) saisie en file d'attente pendant la génération (exécutée automatiquement après) ; (5) PlanReview dédupliqué (titre ≠ description ≠ tâches) ; (6) onglets homonymes désambiguïsés (client/package.json).

**Correctifs 2e test réel (04/07, 21h30)** : (1) **CAUSE RACINE des fichiers vides trouvée et corrigée** — bug backend : `routes/projects.py` appelait `_generate_batch(existing_files_list=…)` alors que la méthode attend `existing_files_context` → TypeError à chaque batch → zéro fichier généré (⚠️ redéployer Railway) ; (2) **flux sans clic** : plan → génération automatique, plus d'écran "Générer le projet" ; (3) **auto-vérification post-génération** : ANZAR lance lui-même `npm install` + `npm run build` par package détecté et affiche ✅/❌ dans le chat avec proposition de correction ; (4) **commandes terminal** affichées à l'utilisateur dans le message de fin (cd …, npm install && npm run dev).

**Flux chat-first (04/07, 22h)** : la génération vit désormais DANS le chat via `ProjectProgressCard` (nom, phase, étape courante, barre de progression, Annuler). Le studio (fichiers/éditeur) ne s'ouvre que sur clic "Voir le projet" ; bouton "Retour au chat" dans le studio (la session continue en arrière-plan). `studioVisible` est distinct de `isOpen` dans ChatView.

**Fix majeur 3e test réel (05/07)** : le flux `forceProject` lançait **DEUX générations complètes en parallèle** (studio + legacy `onProjectGeneration`/useProjectPipeline) → double coût API, compteurs contradictoires (28/34/49/69 fichiers), projets dupliqués dans la sidebar, panneau d'activité doublonnant la carte. Corrigé : le studio est l'unique pipeline ; le store studio ne garde que les fichiers réellement générés (compteur unique) ; `markAllDone()` synchronise la todo au succès. Nettoyage conseillé : supprimer les projets dupliqués dans la sidebar à la main.

**Panneau d'activité chat-first (05/07)** : `ProjectActivityPanel` à droite du chat pendant une session projet — todo réelle (abonnée à `studioTodoManager`, donc synchronisée avec `markAllDone`), étape en cours, liste des fichiers réellement générés avec compteur unique. Masquable (X), réaffiché à chaque nouvelle session. L'ancien `GenerationPanel` est réservé au flux import/audit.

**Inspiration TRAE (05/07)** : (1) onglets de session **Discussion | Studio** centrés en haut pendant une session projet — navigation explicite entre chat et code ; (2) **carte projet dépliable** — ligne "N/M étapes · X fichiers ›" qui déplie la todo condensée + les 5 derniers fichiers, sans quitter le chat ; (3) panneau droit restructuré en sections Todo / Fichiers générés / Références avec états vides élégants + timer.

**Fix 4e test réel (05/07, 5h)** : (1) **chemins fantômes "Chemin: client"** — sanitisation centrale dans `_extract_code_blocks` (strip Chemin:/Path:/File:/Fichier:, backticks, ./ et / initiaux, anti-traversal) ⚠️ redéployer Railway ; (2) **"Load failed"** — une coupure SSE n'est plus fatale : le client bascule en récupération (poll du statut toutes les 4s jusqu'à 15 min, puis réconciliation download) car le serveur continue de générer en tâche de fond.

**Reste à faire (épuration profonde, seconde passe)** : dégraisser `ChatInput` (863 l.) et `useChatEngine` (821 l.) du code de routage projet devenu inutile (forceProjectGenerationOnceRef, wizardMetaRef) ; redesign Sidebar (546 l.) ; unifier GenerationPanel dans le studio pour supprimer le doublon d'affichage de génération ; commit des suppressions `.git_broken/`.

## 6. Fichiers critiques à connaître

- `backend/agents/coder.py` — moteur de génération actuel (à transformer en agent tool-use)
- `backend/routes/projects.py` (1170 l.) — orchestration plan/execute/iterate/review
- `backend/routes/chat.py` — proxy + `smart_chat` avec tool_executor (germe de la boucle agentique)
- `desktop/src/hooks/useVibeCodingStudio.ts` (948 l.) — orchestration UI du studio
- `desktop/src/services/studio/iterationRouter.ts` — routage des modes
- `desktop/src/services/terminal.ts` — exécution shell (base du Verify)
- `desktop/src-tauri/tauri.conf.json` — allowlist FS/shell

---
**Conclusion.** La coquille (studio, sécurité, infra, UX) est déjà au niveau. Ce qui sépare ANZAR d'un Claude Code, c'est le **moteur** : passer d'un générateur de code dirigé à un **agent autonome à outils, bouclant jusqu'au succès vérifié**. C'est la Phase 1, et tout le reste s'y accroche.
