#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if grep -R "panier" -n src --include='*.ts' >/dev/null 2>&1; then
  echo "ÉCHEC : « panier » subsiste dans src/"
  grep -R "panier" -n src --include='*.ts'
  exit 1
fi
test -f src/cart.ts
npx tsc --noEmit
npx vitest run
echo "OK : module renommé, imports à jour, test et typecheck verts"
