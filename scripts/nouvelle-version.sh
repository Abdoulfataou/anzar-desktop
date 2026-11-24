#!/usr/bin/env sh
# Prépare une nouvelle version de l'app ANZAR : numéro mis à jour partout, commit et tag.
#   ./scripts/nouvelle-version.sh 2.1.2
# Avant : écris les nouveautés de la version dans apps/desktop/NOUVEAUTES.md (affichées dans l'app).
# Ensuite : git push && git push origin v2.1.2  (la CI construit Mac + Windows en brouillon)
set -eu
V="${1:-}"
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "Usage : $0 X.Y.Z (ex. 2.1.2)"; exit 1; }
cd "$(git rev-parse --show-toplevel)"
git rev-parse -q --verify "refs/tags/v$V" >/dev/null && { echo "Le tag v$V existe déjà."; exit 1; }
if ! git diff --quiet -- apps/desktop ':!apps/desktop/NOUVEAUTES.md' || ! git diff --cached --quiet -- ':!apps/desktop/NOUVEAUTES.md'; then
  echo "Des modifications de apps/desktop ne sont pas commitées : commite-les d'abord."; exit 1
fi

python3 - "$V" <<'PY'
import json, re, sys
v = sys.argv[1]
D = "apps/desktop/"

def remplacer(chemin, motif, nouveau, attendu=1):
    s = open(chemin, encoding="utf-8").read()
    s2, n = re.subn(motif, nouveau, s, count=attendu, flags=re.M)
    if n != attendu:
        sys.exit(f"✗ {chemin} : {n} remplacement(s) au lieu de {attendu}")
    open(chemin, "w", encoding="utf-8").write(s2)

actuelle = json.load(open(D + "package.json"))["version"]
if tuple(map(int, v.split("."))) <= tuple(map(int, actuelle.split("."))):
    sys.exit(f"✗ {v} doit être supérieure à la version actuelle ({actuelle}), sinon la mise à jour automatique ne se déclenche pas.")

remplacer(D + "package.json", r'^(  "version": )"[^"]+"', rf'\1"{v}"')
remplacer(D + "package-lock.json", r'\A(\{\n  "name": "anzar-desktop",\n  "version": )"[^"]+"', rf'\1"{v}"')
remplacer(D + "package-lock.json", r'(\n    "": \{\n      "name": "anzar-desktop",\n      "version": )"[^"]+"', rf'\1"{v}"')
remplacer(D + "src-tauri/tauri.conf.json", r'^(  "version": )"[^"]+"', rf'\1"{v}"')
remplacer(D + "src-tauri/Cargo.toml", r'^(name = "app"\nversion = )"[^"]+"', rf'\1"{v}"')
remplacer(D + "src-tauri/Cargo.lock", r'^(name = "app"\nversion = )"[^"]+"', rf'\1"{v}"')
remplacer(D + "src/services/lsp/client.ts", r"(clientInfo: \{ name: 'anzar', version: )'[^']+'", rf"\1'{v}'")
remplacer(D + "src/services/mcp/client.ts", r"(name: 'anzar', title: 'ANZAR', version: )'[^']+'", rf"\1'{v}'")
print(f"✓ {actuelle} → {v}")
PY

git add apps/desktop/NOUVEAUTES.md 2>/dev/null || true
git add apps/desktop/package.json apps/desktop/package-lock.json apps/desktop/src-tauri/tauri.conf.json \
  apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock \
  apps/desktop/src/services/lsp/client.ts apps/desktop/src/services/mcp/client.ts
git commit -q -m "release: ANZAR $V"
git tag -a "v$V" -m "ANZAR $V"
echo "✓ Commit et tag v$V créés (nouveautés : apps/desktop/NOUVEAUTES.md). Pour lancer la construction :"
echo "    git push && git push origin v$V"
