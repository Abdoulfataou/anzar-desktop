#!/usr/bin/env bash
# Crée (une seule fois) le certificat de signature personnel d'ANZAR pour macOS, gratuit,
# puis l'envoie dans les secrets GitHub (MAC_CERT_P12, MAC_CERT_PASSWORD).
#   ./scripts/creer-certificat-mac.sh
# Toutes les versions Mac sont ensuite signées avec la même identité : le trousseau macOS
# ne redemande plus l'accès aux données d'ANZAR après chaque mise à jour.
# Ce n'est pas une notarisation Apple : l'avertissement du premier lancement reste.
# Le certificat est gardé dans ~/.anzar-certificat (hors du dépôt). Ne le partage jamais.
# Relancer le script réutilise le certificat existant (il ne faut pas en changer).
set -euo pipefail
REPO="${ANZAR_REPO:-Abdoulfataou/anzar-desktop}"
NOM="ANZAR Signature"
DOSSIER="$HOME/.anzar-certificat"
P12="$DOSSIER/anzar-signature.p12"
MDP_FICHIER="$DOSSIER/mot-de-passe.txt"
# LibreSSL de macOS : produit un .p12 que le trousseau sait importer.
OPENSSL="${OPENSSL:-/usr/bin/openssl}"

command -v gh >/dev/null || { echo "Installe d'abord GitHub CLI (gh) et connecte-toi : gh auth login"; exit 1; }

if [ -f "$P12" ] && [ -f "$MDP_FICHIER" ]; then
  echo "✓ Certificat existant réutilisé : $P12"
else
  mkdir -p "$DOSSIER" && chmod 700 "$DOSSIER"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  cat > "$TMP/conf" <<CONF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NOM
O = IssalanHub
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
CONF
  "$OPENSSL" req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
    -keyout "$TMP/cle.pem" -out "$TMP/cert.pem" -config "$TMP/conf" 2>/dev/null
  MDP="$("$OPENSSL" rand -hex 24)"
  LEGACY=""
  "$OPENSSL" version | grep -q '^OpenSSL 3' && LEGACY="-legacy"
  # shellcheck disable=SC2086
  "$OPENSSL" pkcs12 -export $LEGACY -inkey "$TMP/cle.pem" -in "$TMP/cert.pem" \
    -name "$NOM" -out "$P12" -passout "pass:$MDP"
  ( umask 077; printf '%s' "$MDP" > "$MDP_FICHIER" )
  chmod 600 "$P12" "$MDP_FICHIER"
  echo "✓ Certificat créé (valable 10 ans) : $P12"
fi

base64 < "$P12" | tr -d '\n' | gh secret set MAC_CERT_P12 --repo "$REPO"
gh secret set MAC_CERT_PASSWORD --repo "$REPO" < "$MDP_FICHIER"
echo "✓ Secrets MAC_CERT_P12 et MAC_CERT_PASSWORD enregistrés sur $REPO."
echo "  Garde une copie de $DOSSIER en lieu sûr (clé USB, gestionnaire de mots de passe)."
