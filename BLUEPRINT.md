# 🔷 BLUEPRINT — ANZAR

> **Assistant IA de Vibecoding pour l'Afrique francophone** — plateforme SaaS multi-clients (desktop, admin, mobile) adossée à un backend multi-agents LLM avec billing prépayé en FCFA.
>
> Version du document : 2026-11-14 · État du code : post-audit sécurité (commits `742b356` → `6bf1f17`)

---

## 1. Vision produit

| Axe | Description |
|---|---|
| **Cœur** | Chat IA + studio de "vibe coding" : l'utilisateur décrit, les agents planifient, codent, relisent et livrent un projet complet |
| **Marché** | Afrique de l'Ouest francophone — billing **FCFA**, intention d'intégration **Wave / Orange Money**, OCR fra+eng |
| **Modèle éco** | Crédits prépayés (FCFA) consommés par token (input/output) avec marge ×3 sur le coût LLM réel |
| **Différenciateurs** | Pipeline multi-agents (planner → coder → reviewer), 29 skills métier, mémoire utilisateur, OCR documents scannés, drag & drop de fichiers, exécution locale de code via Tauri |

---

## 2. Architecture globale

```
┌─────────────────┐   ┌─────────────────┐   ┌──────────────┐
│  DESKTOP (Tauri)│   │  ADMIN (web/Tauri)│  │ MOBILE (Expo)│
│  Client principal│   │  Back-office      │  │ Embryonnaire │
│  React 18 + TS   │   │  React 19 + Vite 8│  │ SDK 49 (EOL) │
└────────┬────────┘   └────────┬──────────┘  └──────┬───────┘
         │  HTTP + SSE (fetch streaming)              │
         ▼                                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    BACKEND — FastAPI (Railway)                │
│                                                              │
│  ┌──────── Routes ────────────────────────────────────────┐  │
│  │ auth │ user │ credits │ chat │ projects │ admin │      │  │
│  │ memory │ skills                                          │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─ Agents ─────────────┐  ┌─ Services ───────────────────┐   │
│  │ planner  coder(984l) │  │ deepseek_client (DS/Kimi/OR) │   │
│  │ code_review  vision  │  │ web_search (Serper)          │   │
│  └──────────────────────┘  │ email OTP (Brevo)            │   │
│                            └──────────────────────────────┘   │
│  ┌─ Security ──────────────────────────────────────────────┐  │
│  │ JWT pyjwt HS256 (24h, révocation jti) · rate limit DB   │  │
│  │ OTP email · PBKDF2 600k · XFF trusted-proxy-only        │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─ DB ─────────────────────────────────────────────────────┐  │
│  │ SQLAlchemy 2 async · Postgres (asyncpg, prod) /          │  │
│  │ SQLite (aiosqlite, dev) · 13 tables · housekeeping loop  │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │
            ┌──────────────┼───────────────┐
            ▼              ▼               ▼
      DeepSeek API     Kimi/Moonshot   OpenRouter
      (chat, FIM,      (vision, OCR    (modèles
       files/batches)   base64)         alternatifs)
```

**Flux de vie d'un projet** : `POST /projects/plan` (planner) → `/{id}/execute` (SSE, coder agent, streaming) → `/{id}/review` (code_review) → `download-files`. Itérations via `/{id}/iterate`, design-to-code via `/{id}/design-to-code`, annulation via `/{id}/cancel`.

---

## 3. Modules du monorepo

### 3.1 `backend/` — API centrale (Python 3.11)

| Chemin | Rôle |
|---|---|
| `main.py` | App FastAPI, lifespan (init_db, admin par défaut, housekeeping 15 min), middleware sécurité (rate limit, headers, log) |
| `config.py` | Settings pydantic — 100+ paramètres : clés API, pricing FCFA, JWT, rate limits, modèles |
| `security.py` | JWT pyjwt (HS256 épinglé, aud `anzar-api`, jti 128 bits, révocation DB), rate limiter DB-backed, `get_client_ip` (XFF droite, trusted proxies uniquement), validation messages/chemins, calcul coûts |
| `routes/auth.py` | register / login / verify / **refresh (grâce 7 j, signature toujours vérifiée)** / OTP send-code + verify-code |
| `routes/credits.py` | Solde, transactions, usage — **`/recharge` neutralisé (403)** : crédits uniquement via admin ou webhook provider |
| `routes/chat.py` | Proxy LLM avec billing (`/api/{provider}/chat/completions`), `/api/chat/smart` + tool web_search, FIM `/beta/completions`, files/batches DeepSeek |
| `routes/projects.py` (1170 l.) | Pipeline projet : plan / execute (SSE) / iterate / review / design-to-code / cancel / download |
| `routes/admin.py` | Login admin + rôles (`owner`/`admin`/viewer), users CRUD, grant crédits, validation paiements (`mark-paid`), stats, audit log |
| `routes/memory.py`, `routes/skills.py` | Mémoire long-terme utilisateur, 29 skills communautaires/installées |
| `agents/` | `planner` (découpe), `coder` (génération fichiers, 984 l.), `code_review`, `vision` (OCR/images via Kimi) |
| `services/` | `deepseek_client` (DeepSeek+Kimi+OpenRouter unifiés), `web_search` (Serper), `email` (Brevo OTP) |
| `db/` | 13 modules : users, credits, payments, projects, otp, admin, memory, skills, usage, rate_limits, tokens (révocation jti), password (PBKDF2 600k), base (engine/init/migration) |
| `tests/` | **21 tests pytest** (auth 10, crédits 6, JWT 6) — CI GitHub Actions |

### 3.2 `desktop/` — Client principal (Tauri 2.12.6)

| Chemin | Rôle |
|---|---|
| `src/pages/ChatPage` | Chat principal : streaming, raisonnement, exports docx/pdf/pptx, blocs visuels (Mermaid strict, **SVG DOMPurify**) |
| `src/components/vibecoding/VibeCodingStudio` (795 l.) | Studio : Editor + Preview + FileTree + GitHistory + AgentPanel + SkillsPanel + PlanReview, orchestré par `hooks/useVibeCodingStudio` (1029 l.) |
| `src/services/ai/ai.ts` (713 l.) | Client HTTP/pseudo-SSE vers backend, AbortController par requestId, timeouts 45/90 s |
| `src/services/router.ts` (1087 l.) | Routage intelligent DeepSeek/Kimi, `/api/chat/smart`, files/batches |
| `src/services/agent/` | Agent local : boucle + **21 tools** (fs, shell via allowlist Tauri) + vérificateur |
| `src/services/terminal.ts` (1168 l.) | Exécution node/npm/npx/pip/git/cargo via shell scope **validators resserrés** (npx whitelist, publish bloqué) |
| `src/services/filesystem/`, `infra/` | Code indexer, lint resolver ; Stronghold (tokens), storage chiffré blake3 |
| `src/stores/` | 8 stores Zustand (chat, project, settings, theme, activity, account, usage, devMemory) |
| OCR | tesseract.js local fra+eng, drag & drop natif `tauri://file-drop` |

### 3.3 `admin/` — Back-office (React 19 + Vite 8, Railway web)

Dashboard stats (recharts), gestion users (search, activation, grant crédits), projets, transactions, validation paiements, comptes admins (rôle owner). Build `nixpacks.toml` + `railway.json`.

### 3.4 `mobile/` — Embryonnaire (Expo 49, RN 0.72 — EOL)

3 écrans (Login/Chat/Settings). **Décision en attente** : migration SDK 50+ ou gel du module.

---

## 4. Modèle de données (13 tables)

| Table | Contenu clé |
|---|---|
| `users` | email (PK), password_hash+salt (PBKDF2), is_active, last_login |
| `credits` | balance_fcfa, total_recharged, total_used — **source de vérité serveur** |
| `transactions` | recharges/usages, tx_type, external_ref, description |
| `usage_records` | tokens in/out par appel, coût FCFA calculé |
| `projects` | statut (planned/executing/completed…), fichiers générés |
| `admins` | email, role (owner/admin/viewer), must_change_password |
| `payment_intents` | demandes Wave/OM — statut pending/paid, validées via admin `mark-paid` |
| `otp_codes` | codes 6 chiffres hashés, expiry, max_attempts |
| `rate_limits` | hits horodatés — **rate limiter multi-workers** |
| `revoked_tokens` | jti révoqués jusqu'à exp (purge housekeeping) |
| `user_memory`, `community_skills`, `installed_skills` | mémoire long-terme, marketplace de 29 skills |

---

## 5. Surface API (synthèse)

```
POST /api/auth/register|login|refresh|send-code|verify-code     GET /api/auth/verify
GET  /api/credits · /api/credits/transactions · /api/usage[/stats]
POST /api/credits/recharge            → 403 DÉSACTIVÉ (anti self-crédit)
POST /api/payments/initiate           → intent pending (validation admin)
POST /api/{provider}/chat/completions → proxy billing   POST /api/chat/smart
POST /api/projects/plan · /{id}/execute (SSE) · /{id}/iterate · /{id}/review
     /{id}/design-to-code · /{id}/cancel · GET /{id}/download-files
/api/admin/*                          → login, stats, users, credits (owner/admin),
                                         payments/{id}/mark-paid, admins (owner)
/api/memory/* · /api/skills/*         → mémoire utilisateur, skills
```

---

## 6. Sécurité (état post-durcissement, nov. 2026)

| Contrôle | Implémentation |
|---|---|
| **Auth** | JWT pyjwt HS256 (algorithme épinglé, audience vérifiée), expiry 24 h, refresh avec grâce 7 j (signature toujours vérifiée), **révocation par jti** (table + check à chaque requête) |
| **Mots de passe** | PBKDF2-SHA256 600k itérations ; admin par défaut sans mot de passe en dur (env ou aléatoire loggé une fois) |
| **Billing** | Crédits servis côté serveur uniquement ; self-recharge désactivé ; grants admin audités (`ADMIN_AUDIT`) |
| **Rate limiting** | Sliding window en DB (partagé multi-workers), 30/min + 500/jour API, 5/min + 30/jour auth, fail-open surveillé |
| **IP** | XFF trusté uniquement derrière proxy interne (loopback/RFC1918), IP la plus à droite non-proxy |
| **Desktop** | CSP stricte, allowlist Tauri fermée, fs scope restreint, tokens dans Stronghold, aucune clé API dans le bundle (define() neutralise `VITE_*_KEY`), SVG LLM passés par DOMPurify, validators shell whitelistés (npx curatée, publish bloqué) |
| **Tests** | 21 pytest (régression faille recharge, révocation jti, forgery, alg:none…) — CI backend + admin + desktop |

---

## 7. Déploiement

| Composant | Cible | Mécanisme |
|---|---|---|
| Backend | Railway | `backend/Procfile` (`uvicorn main:app`) — source de vérité unique ; `DATABASE_URL` Postgres ; env : JWT_SECRET, ADMIN_DEFAULT_PASSWORD, clés API |
| Admin | Railway (web) | `nixpacks.toml` + `admin/railway.json` → `build:web` + serve static |
| Desktop | GitHub Releases | CI `release.yml` / `windows-exe-build.yml` (DMG/NSIS), updater signé (minisign) |
| CI | GitHub Actions | 3 jobs : backend (pytest py3.11), admin (tsc + build), desktop (lint + build) |

---

## 8. Roadmap

### Court terme (P2/P3 technique)
- [ ] Découper les monolithes : `SettingsPage` (1304 l.), `useVibeCodingStudio` (1029 l.), `terminal.ts` (1168 l.), `router.ts` (1087 l.), `routes/projects.py` (1170 l., 4 générateurs SSE quasi identiques à factoriser)
- [ ] Éliminer les 117 `any` desktop (`agentTools` ×21, `ai.ts` ×11, `useChatEngine` ×10)
- [ ] Code-splitting : tesseract.js, pptxgenjs, docx, html2pdf en imports dynamiques
- [ ] Unifier le calcul de coûts dupliqué (`security.py` vs `config.py`, double conversion USD/FCFA)

### Moyen terme (produit)
- [ ] **Intégration Mobile Money réelle** (Wave/Orange Money API + webhook signé) — principal écart produit ; toute la couche scaffolding existe (intents, statuts, mark-paid)
- [x] Migration Tauri 2 (faite sur `security/tauri2` : capabilities, plugins v2, Stronghold v2, updater v2 ; validation macOS + build CI à compléter sur Windows)
- [ ] Décision mobile : Expo SDK 50+ ou gel explicite
- [ ] Étendre les tests : proxy billing `chat.py`, pipeline projets SSE, OTP

### Long terme
- [ ] Redis pour rate limiting/cache si le volume justifie (le schéma DB tient jusqu'ici)
- [ ] Observabilité : Sentry backend (desktop déjà instrumenté), métriques billing
- [ ] Mode offline desktop (queue de messages, sync différée)

---

*Généré par audit architectural complet — chaque constat est vérifié dans le code et référencé dans les commits `742b356`, `50dfd9a`, `5597506`, `609bab3`, `6bf1f17`.*
