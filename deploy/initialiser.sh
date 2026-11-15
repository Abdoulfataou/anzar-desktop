#!/usr/bin/env sh
# Crée deploy/.env avec des secrets aléatoires (une seule fois).
# Usage : ./initialiser.sh
set -eu
cd "$(dirname "$0")"
if [ -f .env ]; then
  echo ".env existe déjà : rien n'est modifié (le supprimer changerait le mot de passe de la base !)." >&2
  exit 1
fi
alea() { openssl rand -hex "$1"; }
umask 077
cat > .env <<FIN
PG_PASSWORD=$(alea 24)
JWT_SECRET=$(alea 48)
OTP_SECRET=$(alea 32)
ADMIN_DEFAULT_EMAIL=admin@issalanhub.com
ADMIN_DEFAULT_PASSWORD=$(alea 12)
# ── À REMPLIR ──
DEEPSEEK_API_KEY=
KIMI_API_KEY=
BREVO_API_KEY=
SENDER_EMAIL=no-reply@issalanhub.com
SENDER_NAME=ANZAR
# Marge sur le coût réel DeepSeek (3 = prix de vente = 3 × coût)
DEEPSEEK_MARGIN=3.0
# Sauvegardes hors serveur par Telegram (mêmes valeurs que ShagoStore possible)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
CLE_SAUVEGARDE=$(alea 32)
FIN
echo "✔ .env créé. Remplis DEEPSEEK_API_KEY et BREVO_API_KEY : nano .env"
echo "  Garde une copie de .env en lieu sûr (sans lui, la base et les sauvegardes sont illisibles)."
echo "  Ensuite : docker compose up -d --build"
