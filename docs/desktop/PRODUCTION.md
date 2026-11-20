# Production checklist (Desktop) — Tauri 2

## 1) Sentry (crash reporting)

- Côté app (runtime) : définir `VITE_SENTRY_DSN` (DSN public) dans ton `.env`.
- Côté release (CI) : pour uploader les sourcemaps, définir dans GitHub Secrets :
  - `SENTRY_AUTH_TOKEN`
  - `SENTRY_ORG`
  - `SENTRY_PROJECT`

Notes :
- Les sourcemaps ne sont générées **que** quand `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` sont présents (CI/release).

## 2) Tauri auto-updater (v2)

### 2.1 Générer la clé de signature (une fois)

Dans `apps/desktop/` :

```bash
npm run tauri signer generate
```

Récupère :
- la **private key** → GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY`
- le **password** → GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- la **public key** → à copier dans `apps/desktop/src-tauri/tauri.conf.json`
  (`plugins.updater.pubkey`)

Les workflows acceptent encore les anciens noms `TAURI_PRIVATE_KEY` /
`TAURI_KEY_PASSWORD` en repli, mais les nouveaux noms sont la référence Tauri 2.

### 2.2 Configurer l’endpoint

Dans `apps/desktop/src-tauri/tauri.conf.json`, remplace :

`https://github.com/REPLACE_ME_OWNER/REPLACE_ME_REPO/releases/latest/download/latest.json`

par l’URL de ton repo GitHub. Le workflow `release.yml` (tauri-action) publie
automatiquement `latest.json` au format v2 dans la release.

`bundle.createUpdaterArtifacts` est à `true` : les artefacts de mise à jour sont
produits avec les bundles.

## 3) GitHub Actions

- `.github/workflows/ci.yml` : lint (garde-fou sécurité + tsc) + build.
- `.github/workflows/release.yml` : build macOS + Windows et release draft.
- `.github/workflows/windows-exe-build.yml` : installeur NSIS signé.

Pour publier :
1. Pousse un tag `vX.Y.Z` (ou déclenche `workflow_dispatch`).
2. Ouvre la release draft et clique **Publish**.

## 4) Vérifications avant release

```bash
cd apps/desktop
npm run lint
npm run build
cd src-tauri && cargo check
cd .. && npx tauri build --debug --no-bundle
```

Puis test manuel : login + redémarrage (Stronghold), ouverture de dossier,
terminal, connecteurs MCP, installation de la mise à jour sur macOS et Windows.
