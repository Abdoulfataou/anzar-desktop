#!/usr/bin/env sh
# Met ANZAR à jour depuis GitHub : sauvegarde, récupération du code, reconstruction.
set -eu
cd "$(dirname "$0")"
./sauvegarde.sh || echo "⚠ sauvegarde en échec : mise à jour quand même"
git -C .. pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
sleep 5
docker compose ps
