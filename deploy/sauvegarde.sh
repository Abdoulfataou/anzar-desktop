#!/usr/bin/env sh
# Sauvegarde de la base (format pg_dump compressé), gardée 14 jours sur le serveur,
# puis copiée HORS du serveur, chiffrée : par Telegram, ou par rclone (Google Drive…). Gratuit dans les deux cas.
#
# Tous les jours à 3 h (crontab -e) :
#   0 3 * * * /root/anzar/deploy/sauvegarde.sh >> /var/log/anzar-sauvegarde.log 2>&1
# Restaurer :  docker compose exec -T db pg_restore -U anzar -d anzar --clean --if-exists < sauvegardes/FICHIER.dump
# Copie hors serveur : voir README.md, « Sauvegardes hors du serveur ».
set -eu
# Sauvegardes lisibles par root seulement.
umask 077
cd "$(dirname "$0")"
mkdir -p sauvegardes
chmod 700 sauvegardes
f="sauvegardes/anzar-$(date +%Y%m%d-%H%M).dump"
docker compose exec -T db pg_dump -U anzar -d anzar -Fc > "$f.tmp"
mv "$f.tmp" "$f"
find sauvegardes -name 'anzar-*.dump' -mtime +14 -delete
echo "$(date '+%F %T') ✔ $f ($(du -h "$f" | cut -f1))"

# ----------------------------------------------------------------- Copie hors du serveur
# Deux façons, gratuites :
#   * Telegram (le plus simple) : TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID et CLE_SAUVEGARDE dans .env.
#     Le fichier est chiffré (AES-256) puis envoyé par un bot dans une conversation privée.
#   * rclone (Google Drive, Backblaze B2…) : distant « anzar-chiffre » (ou DESTINATION_DISTANTE dans .env).
# Voir README.md, « Sauvegardes hors du serveur ».
lire_env() { [ -f .env ] || return 0; sed -n "s/^$1=//p" .env | tail -1 | sed 's/^["'\'']//; s/["'\'']$//'; }
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(lire_env TELEGRAM_BOT_TOKEN)}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-$(lire_env TELEGRAM_CHAT_ID)}"
CLE_SAUVEGARDE="${CLE_SAUVEGARDE:-$(lire_env CLE_SAUVEGARDE)}"
DESTINATION_DISTANTE="${DESTINATION_DISTANTE:-$(lire_env DESTINATION_DISTANTE)}"
DESTINATION_DISTANTE="${DESTINATION_DISTANTE:-anzar-chiffre:}"
JOURS_DISTANT="${JOURS_DISTANT:-30}"
etat="sauvegardes/copie-distante.json"
maintenant="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

ecrire_etat() { # etat destination [fichier] [message]
  printf '{"etat":"%s","le":"%s","destination":"%s","fichier":"%s","message":"%s"}\n' \
    "$1" "$maintenant" "$2" "${3:-}" "$(printf '%s' "${4:-}" | tr -d '"\\' | tr '\n' ' ' | cut -c1-200)" > "$etat"
}

# ---- Telegram : fichier chiffré, découpé en morceaux de 45 Mo (limite des bots : 50 Mo)
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  if [ -z "$CLE_SAUVEGARDE" ]; then
    ecrire_etat ECHEC telegram "" "CLE_SAUVEGARDE manquante dans .env : la sauvegarde ne part jamais en clair"
    echo "$(date '+%F %T') ✖ copie Telegram : CLE_SAUVEGARDE manquante dans .env"
    exit 1
  fi
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  chiffre="$tmp/$(basename "$f").enc"
  CLE_SAUVEGARDE="$CLE_SAUVEGARDE" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:CLE_SAUVEGARDE -in "$f" -out "$chiffre"
  split -b 45m -d -a 2 "$chiffre" "$chiffre.part"
  morceaux="$(ls "$chiffre".part* | wc -l | tr -d ' ')"
  n=0
  for m in "$chiffre".part*; do
    n=$((n + 1))
    legende="ANZAR · sauvegarde du $(date '+%d/%m/%Y %H:%M') · $(du -h "$f" | cut -f1)"
    [ "$morceaux" -gt 1 ] && legende="$legende · morceau $n/$morceaux"
    # L'adresse (qui contient le jeton du bot) passe par l'entrée standard : absente de ps et des erreurs.
    if ! sortie="$(printf 'url = "https://api.telegram.org/bot%s/sendDocument"\n' "$TELEGRAM_BOT_TOKEN" | curl -sS -K - \
        --retry 5 --retry-delay 10 --max-time 600 \
        -F chat_id="$TELEGRAM_CHAT_ID" -F caption="$legende" \
        -F document=@"$m;filename=$(basename "$f").enc$([ "$morceaux" -gt 1 ] && echo ".$(printf '%02d' $((n - 1)))")" 2>&1)" \
        || ! printf '%s' "$sortie" | grep -q '"ok":true'; then
      sortie="$(printf '%s' "$sortie" | sed "s|$TELEGRAM_BOT_TOKEN|<jeton>|g")"
      message="$(printf '%s' "$sortie" | sed -n 's/.*"description":"\([^"]*\)".*/\1/p')"
      ecrire_etat ECHEC telegram "" "${message:-$sortie}"
      echo "$(date '+%F %T') ✖ copie Telegram : ${message:-$sortie}"
      exit 1
    fi
  done
  ecrire_etat OK telegram "$(basename "$f")"
  echo "$(date '+%F %T') ✔ copie hors serveur : Telegram ($morceaux fichier(s) chiffré(s))"
  exit 0
fi

# ---- rclone (Google Drive, Backblaze B2, Storage Box…)
distant="${DESTINATION_DISTANTE%%:*}"
if ! command -v rclone >/dev/null 2>&1 || ! rclone listremotes 2>/dev/null | grep -qx "$distant:"; then
  ecrire_etat NON_CONFIGUREE "aucune"
  echo "$(date '+%F %T') ⚠ copie hors serveur non configurée (Telegram ou rclone, voir README)"
  exit 0
fi
if sortie="$(rclone copy "$f" "$DESTINATION_DISTANTE" --retries 5 --low-level-retries 10 2>&1)"; then
  rclone delete "$DESTINATION_DISTANTE" --min-age "${JOURS_DISTANT}d" --include 'anzar-*.dump' >/dev/null 2>&1 || true
  ecrire_etat OK "$DESTINATION_DISTANTE" "$(basename "$f")"
  echo "$(date '+%F %T') ✔ copie hors serveur : $DESTINATION_DISTANTE$(basename "$f")"
else
  ecrire_etat ECHEC "$DESTINATION_DISTANTE" "" "$(printf '%s' "$sortie" | tail -1)"
  echo "$(date '+%F %T') ✖ copie hors serveur : $(printf '%s' "$sortie" | tail -1)"
  exit 1
fi
