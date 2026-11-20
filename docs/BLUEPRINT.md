# BLUEPRINT — ANZAR

> Assistant IA de vibecoding pour l'Afrique (francophone d'abord, puis anglophone) : un agent de
> code qui tourne sur l'ordinateur de l'utilisateur, 100 % DeepSeek, facturé en crédits prépayés
> en FCFA.
>
> Version du document : 2026-11-20 · branche `refactor/nettoyage-structure`

## 1. Vision produit

| Axe | Description |
|---|---|
| Cœur | L'utilisateur décrit ce qu'il veut ; l'agent lit le projet, modifie les fichiers, lance les commandes et vérifie (lint, build, tests) avant d'annoncer qu'il a fini |
| Marché | Afrique de l'Ouest d'abord ; facturation en FCFA ; Mobile Money via FedaPay, cartes via Stripe |
| Modèle économique | Crédits prépayés, consommés au coût réel des tokens DeepSeek × marge ; aucun usage gratuit (bonus de bienvenue à 0) |
| Modèles | DeepSeek uniquement : `deepseek-flash` (V4.1-Flash, 1M de contexte, réflexion réglable) et `deepseek-v4-pro` |
| Différenciateurs | Agent local avec 21 outils, sous-agents spécialisés (motion design), super-agent par tickets en worktrees, motion design et export vidéo, skills au standard agentskills.io, connecteurs MCP |

## 2. Architecture

```text
┌──────────────────────────────┐      ┌──────────────────────┐
│ apps/desktop (Tauri 2)       │      │ apps/admin (React 19) │
│ React 18 + TypeScript        │      │ console web           │
│  ├ agent : moteur, outils,   │      └──────────┬───────────┘
│  │  sous-agents, vérification│                 │
│  ├ AgentRunner (sans React)  │                 │
│  └ Rust : commandes isolées  │                 │
│    (Seatbelt), MCP, secrets  │                 │
└──────────────┬───────────────┘                 │
               │ HTTPS + SSE                     │
               ▼                                 ▼
┌──────────────────────────────────────────────────────────┐
│ services/api — FastAPI, VPS Hetzner (docker compose)     │
│ proxy DeepSeek facturé · comptes · crédits · paiements   │
│ mémoire utilisateur · skills · console admin (MFA)       │
│ Postgres 18                                              │
└──────────────┬───────────────────────────────────────────┘
               ▼
        DeepSeek API (chat, outils web Search / Fetch)
```

L'agent ne tourne pas sur le serveur : le serveur ne fait que relayer les appels au modèle en
réservant puis en débitant leur coût. Toute l'exécution (fichiers, commandes, navigateur) se fait
sur l'ordinateur de l'utilisateur.

## 3. Modules

### `apps/desktop` — l'app ANZAR

| Chemin | Rôle |
|---|---|
| `src/services/agent/engine/` | boucle unique `runAgentEngine` (flux, outils, relances, vérification), historique et compaction |
| `src/services/agent/runtime/` | `AgentRunner` (une conversation, sans React) et sessions durables sur disque |
| `src/services/agent/tools/` | registre + un fichier par famille d'outils (fichiers, commandes, navigateur, motion, méta) |
| `src/services/agent/policy/` | modes d'approbation, garde des commandes, politique des sous-agents |
| `src/services/agent/subagents/` | explorateurs en lecture seule, `spawn_subagents` |
| `src/services/agent/profiles/` | un fichier Markdown par rôle d'agent |
| `src/services/agent/verify/` | détection et exécution lint / build / tests |
| `src/services/skills/` | skills (projet, personnelles, intégrées), format `SKILL.md`, installateur |
| `src/services/mcp/` | client MCP (2026-07-28 et versions historiques), transports stdio / HTTP |
| `src/services/superagent/` | file de tickets, worktrees git |
| `src/services/background/` | automatisations, démarrage des files, garde de fermeture |
| `src-tauri/src/` | commandes (`tool_runner.rs`), isolation macOS (`sandbox.rs`), MCP, Node.js géré, outils installables |

Détails : [`docs/desktop/AGENT_ENGINE.md`](desktop/AGENT_ENGINE.md), sécurité :
[`docs/desktop/SECURITY.md`](desktop/SECURITY.md).

### `services/api` — l'API

| Chemin | Rôle |
|---|---|
| `routes/chat.py` | `/api/{provider}/chat/completions` : seule route IA, proxy DeepSeek facturé (champs filtrés) |
| `routes/web_tools.py` | recherche et lecture web DeepSeek pour l'agent, facturées au résultat |
| `routes/auth.py`, `user.py` | inscription, connexion, OTP e-mail (Brevo), refresh, profil |
| `routes/credits.py`, `payments.py` | solde, transactions ; paiements FedaPay et Stripe, webhooks |
| `routes/admin.py` | console admin : MFA TOTP, rôles, crédits, paiements, audit |
| `routes/memory.py`, `skills.py`, `agent_skills.py` | mémoire utilisateur, hub de skills, skills servies à l'agent |
| `services/billing.py` | réservation du coût maximal avant l'appel, débit réel après |
| `db/` | SQLAlchemy 2 async, 13 tables |

### `apps/admin`, `apps/site`

Console d'administration (React 19 + Vite 8, servie en statique) et vitrine getanzar.com avec la
page de téléchargement.

## 4. Données (13 tables)

`users`, `otp_codes`, `credits`, `transactions`, `usage_records`, `admins`, `admin_audit`,
`payment_intents`, `user_memory`, `community_skills`, `installed_skills`, `rate_limits`,
`revoked_tokens`.

Côté desktop, dans le dossier de données de l'app : conversations (`store/tasks/`), sessions de
l'agent (`store/sessions/` : historique complet + journal d'événements), tickets, automatisations,
skills personnelles.

## 5. Sécurité (résumé)

| Contrôle | Mise en œuvre |
|---|---|
| Clés | Aucune clé IA dans l'app ; tout passe par l'API |
| Facturation | Réservation avant l'appel, débit réel après, solde négatif bloquant ; recharge seulement par paiement ou par l'admin |
| Auth | JWT HS256 (algorithme épinglé, audience), révocation par `jti`, OTP haché ; admin avec MFA TOTP et restriction réseau optionnelle |
| Commandes de l'agent | Exécutées en Rust (pas de shell intermédiaire), programmes et arguments contrôlés, accords selon le mode, garde des scripts modifiés par l'agent ; sur macOS, isolation Seatbelt (écriture limitée au projet, secrets illisibles) |
| Fichiers de l'agent | Chemins canonicalisés et confinés au projet, `.git` et `.husky` protégés |
| MCP | Secrets des connecteurs gardés en Rust, lanceurs stdio restreints |

## 6. Déploiement

| Composant | Cible | Mécanisme |
|---|---|---|
| API, admin, site | VPS Hetzner (partagé avec ShagoStore) | `deploy/docker-compose.yml` : Postgres 18, API, admin et site statiques derrière le Caddy existant ; `deploy/mettre-a-jour.sh`, `sauvegarde.sh` |
| Desktop | GitHub Releases | `.github/workflows/release.yml` (macOS + Windows), mise à jour automatique signée |
| CI | GitHub Actions | `ci.yml` : tests de l'API (pytest) et desktop (contrôles, TypeScript, Vitest, build) |

## 7. Tests

| Module | Commande | État |
|---|---|---|
| API | `cd services/api && python -m pytest tests/` | 77 tests |
| Desktop | `cd apps/desktop && npm run smoke` | 36 fichiers, 168 tests Vitest |
| Rust | `cd apps/desktop/src-tauri && cargo test` | tests de `tool_runner`, `sandbox` et `roots` ; `cargo check` croisé macOS et Windows |

## 8. Feuille de route

### Fait (novembre 2026)
- [x] Ancien pipeline serveur (planner / coder / reviewer) supprimé ; monorepo réorganisé
- [x] Moteur d'agent unique, outils découpés, profils d'agents en Markdown
- [x] Vérification automatique Verify → Fix → Verify
- [x] Harnais sorti de React (`AgentRunner`), tickets et automatisations sans composant
- [x] Isolation des commandes sur macOS
- [x] Sessions durables (historique + journal) ; client MCP 2026-07-28

### Ensuite
- [x] Dossiers de projet tenus par Rust ; périmètre fichiers de la webview réduit
- [x] Windows : commandes dans un job object (arborescence arrêtée, presse-papiers et réglages système inaccessibles)
- [ ] Windows : confinement des écritures (jeton restreint ou AppContainer)
- [ ] Paiements réels en production (FedaPay, Stripe) et iPay Money
- [x] Carte du code par PageRank sur les imports, condenser d'historique
- [ ] Analyse syntaxique tree-sitter pour la carte, budgets en FCFA par sous-agent
- [ ] Banc d'essai de tâches types rejoué à chaque version
