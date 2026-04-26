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

## 3) Persistance / Backups (SQLite)

Par défaut, ANZAR utilise SQLite :
- `DATABASE_PATH=./data/anzar.db` (défaut)

En production Railway, **il faut un volume persistant**, sinon :
- users / crédits / admins seront perdus à chaque redeploy.

**Solution** :
1. Ajoute un **Volume** Railway
2. Monte-le sur `backend/data` (ou `/app/data` selon ton image)

## 4) Option long-terme : Postgres

Quand tu auras du volume (beaucoup d’utilisateurs), passe à Postgres :
- meilleures perfs
- backups gérés
- concurrence plus robuste

On pourra faire une migration (SQLite → Postgres) quand tu seras prêt.

