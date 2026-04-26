# ANZAR

Assistant IA de *vibecoding* : tu décris un projet, ANZAR planifie, génère le code, propose des changements **avec preview**, puis boucle **Verify → Fix → Verify** pour stabiliser le projet (style “Cowork”).

> Important : ANZAR utilise des modèles via **API payantes** (ex. DeepSeek). Les clés API restent **côté backend** — jamais dans le client.

## Fonctionnalités (Desktop)

- **Chat cowork-style** : actions sous forme de *Command Cards* (Run/Stop/Retry + logs) + dock.
- **Builder multi-agents** : `/plan → /execute` (SSE) + annulation.
- **Changements contrôlés** : *ChangeSets* “Preview → Apply” avant écriture sur disque.
- **Auto-verify** configurable + suggestions de correctifs (commandes allowlistées + patches de code en ChangeSet).
- **Sécurité** : allowlist shell + confirmations sur commandes risquées + scopes FS.
- **Observabilité** : Sentry (optionnel) + export des logs de run.
- **Auto-update** : Tauri updater via GitHub Releases.

## Monorepo (aperçu)

Ce repo contient plusieurs modules (desktop, backend, admin, etc.). Pour la prod desktop :

- `desktop/` : app Tauri (React + TypeScript)
- `desktop/src-tauri/` : runtime Tauri (Rust)

## Prérequis

- Node.js 20+
- Rust toolchain (stable) + dépendances Tauri
- Un **backend ANZAR** accessible (voir `desktop/.env.example`)

## Démarrage (Desktop)

```bash
cd desktop
npm install
cp .env.example .env
# Editer .env et configurer VITE_BACKEND_URL (backend ANZAR)
npm run tauri:dev
```

## Configuration (Desktop)

Fichier : `desktop/.env` (voir `desktop/.env.example`)

- `VITE_BACKEND_URL` : URL du backend ANZAR (obligatoire)
- `VITE_SENTRY_DSN` : DSN public Sentry (optionnel)
- `VITE_SENTRY_TRACES_SAMPLE_RATE` : (optionnel) défaut `0.1`

## Sécurité (résumé)

- **Aucune clé IA** dans le client.
- **FS scope** limité à : `Documents/ANZAR/**`, `Desktop/ANZAR/**`, `Downloads/ANZAR/**`
- **Shell** : allowlist stricte + détection de commandes dangereuses + confirmations.

## Production & Releases

Voir : `desktop/PRODUCTION.md`

### GitHub Actions
- CI : `.github/workflows/ci.yml` (lint + build)
- Release : `.github/workflows/release.yml` (Windows + macOS + release draft)

### Auto-update (Tauri)

Secrets GitHub requis :
- `TAURI_PRIVATE_KEY`
- `TAURI_KEY_PASSWORD`

Secrets optionnels (upload sourcemaps Sentry) :
- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

## Licence

Licence **propriétaire (ISSALANHUB)** — **Tous droits réservés**.

## Support

- Issues : https://github.com/Abdoulfataou/anzar-desktop/issues
