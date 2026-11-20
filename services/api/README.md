# ANZAR — Backend

API FastAPI d'ANZAR. Le backend ne génère plus de code : l'agent tourne dans l'app desktop.
Le serveur sert de **proxy DeepSeek facturé** (crédits prépayés en FCFA), et gère les comptes,
les paiements, la mémoire utilisateur, les skills et la console d'administration.

## Structure

```
backend/
├── main.py            # application FastAPI, middlewares, tâches de fond (ménage, paiements)
├── config.py          # réglages lus depuis l'environnement / .env
├── security.py        # JWT, rate limiting, IP cliente, calcul des coûts
├── routes/            # une route = un module (auth, user, credits, payments, chat, web_tools,
│                      #   memory, skills, agent_skills, admin)
├── services/
│   ├── billing.py     # réservation du coût maximal avant l'appel, débit réel après
│   ├── email.py       # codes OTP via Brevo
│   └── payments/      # fournisseurs de paiement, webhooks, rapprochement
├── db/                # SQLAlchemy async (Postgres en prod, SQLite en dev)
├── agent_skills/      # skills servies à l'app desktop
└── tests/             # pytest
```

## Principales routes

| Préfixe | Rôle |
| --- | --- |
| `/api/auth/*` | inscription, connexion, refresh, OTP e-mail |
| `/api/user/*` | profil, mot de passe, suppression du compte, mémoire (`/api/user/memory`) |
| `/api/credits`, `/api/usage` | solde, transactions, consommation |
| `/api/payments/*` | moyens de paiement, initiation, retour, webhooks |
| `/api/{provider}/chat/completions` | proxy DeepSeek facturé (seule route IA) |
| `/api/deepseek/tools/search`, `/fetch` | recherche et lecture web pour l'agent |
| `/api/agent/*`, `/api/skills/*` | skills de l'agent et hub communautaire |
| `/api/admin/*` | console d'administration (MFA, utilisateurs, crédits, paiements, audit) |

## Lancer en local

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # renseigner au minimum DEEPSEEK_API_KEY et JWT_SECRET
uvicorn main:app --reload --port 8000
```

Sans `DATABASE_URL`, une base SQLite locale est utilisée.

## Tests

```bash
pip install pytest
python -m pytest tests/ -v
```

## Déploiement

Le backend tourne sur le VPS Hetzner via `deploy/docker-compose.yml` (voir `deploy/README.md`).
Un seul processus uvicorn : les réservations de facturation sont gardées en mémoire.
