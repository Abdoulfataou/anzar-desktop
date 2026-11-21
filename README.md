# ANZAR

Assistant IA de *vibecoding* pour l'Afrique : tu décris ce que tu veux, l'agent d'ANZAR lit ton projet,
modifie les fichiers, lance les commandes et vérifie le résultat. 100 % DeepSeek, facturé en crédits
prépayés (FCFA).

> Les clés API restent **côté serveur** (`services/api`) — jamais dans l'app.

## Organisation du dépôt

```
anzar/
├── apps/
│   ├── desktop/        # l'app ANZAR (Tauri 2 + React + TypeScript) — l'agent tourne ici
│   ├── admin/          # console d'administration (React + Vite)
│   └── site/           # vitrine getanzar.com et page de téléchargement
├── services/
│   └── api/            # API FastAPI : proxy DeepSeek facturé, comptes, crédits, paiements
├── deploy/             # déploiement sur le VPS Hetzner (docker compose, sauvegardes, mises à jour)
├── docs/               # BLUEPRINT, audits, documentation technique du desktop
│   ├── audits/
│   └── desktop/
├── archive/
│   └── mobile/         # ancienne app Expo, gelée (hors CI)
└── .github/workflows/  # CI (API + desktop), releases Tauri
```

## Démarrer

**API**

```bash
cd services/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # DEEPSEEK_API_KEY, JWT_SECRET…
uvicorn main:app --reload --port 8000
```

**Desktop**

```bash
cd apps/desktop
npm install
cp .env.example .env          # VITE_BACKEND_URL=http://127.0.0.1:8000
npm run tauri:dev
```

**Admin**

```bash
cd apps/admin
npm install
npm run dev
```

## Vérifier

| Module | Commande |
| --- | --- |
| API | `cd services/api && python -m pytest tests/` |
| Desktop | `cd apps/desktop && npm run smoke` (lint + tests + build) |
| Banc d'essai | `cd apps/desktop && npm run bench` (14 scénarios du harnais, voir `bench/README.md`) |
| Admin | `cd apps/admin && npx tsc --noEmit` |

## Documentation

- Vue d'ensemble : [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md)
- Moteur de l'agent : [`docs/desktop/AGENT_ENGINE.md`](docs/desktop/AGENT_ENGINE.md)
- Sécurité du desktop : [`docs/desktop/SECURITY.md`](docs/desktop/SECURITY.md)
- Production et releases : [`docs/desktop/PRODUCTION.md`](docs/desktop/PRODUCTION.md)
- Déploiement serveur : [`deploy/README.md`](deploy/README.md)

## Releases et mise à jour automatique

Les versions desktop sont publiées par `.github/workflows/release.yml` (macOS + Windows).
Secrets GitHub requis : `TAURI_PRIVATE_KEY`, `TAURI_KEY_PASSWORD` ; optionnels pour Sentry :
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.

## Licence

Licence **propriétaire (ISSALANHUB)** — tous droits réservés.
