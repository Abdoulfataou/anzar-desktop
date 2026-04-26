# Production checklist (Desktop)

## 1) Sentry (crash reporting)

- Côté app (runtime) : définir `VITE_SENTRY_DSN` (DSN public) dans ton `.env`.
- Côté release (CI) : pour uploader les sourcemaps, définir dans GitHub Secrets :
  - `SENTRY_AUTH_TOKEN`
  - `SENTRY_ORG`
  - `SENTRY_PROJECT`

Notes :
- Les sourcemaps ne sont générées **que** quand `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` sont présents (CI/release).

## 2) Tauri auto-updater

### 2.1 Générer la clé de signature (une fois)

Dans `desktop/` :

```bash
npm run tauri signer generate
```

Récupère :
- la **private key** → à mettre dans GitHub Secrets `TAURI_PRIVATE_KEY`
- le **password** → GitHub Secrets `TAURI_KEY_PASSWORD`
- la **public key** → à copier dans `desktop/src-tauri/tauri.conf.json` (`tauri.updater.pubkey`)

### 2.2 Configurer l’endpoint

Dans `desktop/src-tauri/tauri.conf.json`, remplace :

`https://github.com/REPLACE_ME_OWNER/REPLACE_ME_REPO/releases/latest/download/latest.json`

par l’URL de ton repo GitHub.

Le workflow `release.yml` (tauri-action) publie automatiquement `latest.json` dans la release.

## 3) GitHub Actions

- `.github/workflows/ci.yml` : lint + build
- `.github/workflows/release.yml` : build Windows + macOS et crée une release draft.

Pour publier :
1. Pousse un tag `vX.Y.Z` (ou déclenche `workflow_dispatch`).
2. Ouvre la release draft et clique **Publish**.

