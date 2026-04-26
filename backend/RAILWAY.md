# Déploiement Backend sur Railway (production)

## 1) Service (monorepo)

Dans Railway :
1. **New Project → Deploy from GitHub**
2. Sélectionne le repo `Abdoulfataou/anzar-desktop`
3. Configure le service backend avec **Root Directory = `backend/`**

Commande de démarrage recommandée :

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## 2) Variables d’environnement (minimum)

Sécurité :
- `JWT_SECRET` (obligatoire, min 32 chars)
- `OTP_SECRET` (recommandé, min 32 chars)
- `ADMIN_DEFAULT_PASSWORD` (obligatoire en prod, **pas** `Anzar2024!`)

Email OTP (Brevo) :
- `BREVO_API_KEY`
- `SENDER_EMAIL` (validé dans Brevo)
- `SENDER_NAME=ANZAR`

IA :
- `DEEPSEEK_API_KEY`
- `KIMI_API_KEY` (optionnel)

Freemium (par défaut OK) :
- `WELCOME_BONUS_FCFA=1000`
- `FREE_DAILY_CHAT_REQUESTS=10`

## 3) Recommandé (prod) : Postgres Railway (reset)

Comme ton app n’a pas encore d’utilisateurs, le plus simple est de **repartir à zéro** sur Postgres.

1. Railway → **Add Plugin → PostgreSQL**
2. Railway fournit `DATABASE_URL` automatiquement (souvent `postgres://...`)
3. Ajoute la variable **DATABASE_URL** à ton service backend (Railway le fait parfois tout seul)

ANZAR détecte `DATABASE_URL` et utilise Postgres via SQLAlchemy async (`postgresql+asyncpg`).

## 4) Option court-terme : SQLite + Volume

Si tu préfères SQLite en prod :
- `DATABASE_PATH=./data/anzar.db`
- Ajoute un **Volume** Railway monté sur `backend/data`

Sinon tu perds users / crédits / admins à chaque redeploy.
