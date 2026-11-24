#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Le test ne doit pas avoir été modifié : empreinte de la fixture d'origine.
EXPECTED=0e7997c74a5f0aba9a97c0e0b68e2d62d185bd29b744d68cf8ccb1f34bf9f8c9
ACTUAL=$(shasum -a 256 src/somme.test.ts | awk '{print $1}')
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "ÉCHEC : le test a été modifié"
  exit 1
fi
npx vitest run
npx tsc --noEmit
echo "OK : test vert, test inchangé, typecheck vert"
