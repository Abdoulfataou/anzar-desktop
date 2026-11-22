# Build DMG (macOS)

## Pré-requis

- Node.js + npm
- Rust (via rustup)
- Xcode + Command Line Tools
  - `xcode-select --install`

## 1) Build web + Tauri

Dans le dossier `apps/desktop/` :

```bash
npm install
npm run build
```

## 2) Clé de signature (Updater)

Le build nécessite une clé privée si l'updater est activé dans `src-tauri/tauri.conf.json`.

### Option A — Build rapide sans auto-update (désactiver l'updater)

Dans `src-tauri/tauri.conf.json` → `"updater": { "active": false }` puis :

```bash
npm run tauri build
```

### Option B — Garder l'updater (recommandé si tu publies des releases)

Définis la variable d'environnement `TAURI_PRIVATE_KEY` **avant** le build :

```bash
export TAURI_PRIVATE_KEY="COLLE_ICI_TA_CLE_PRIVEE_MINISIGN"
npm run tauri build
```

> Important : ne commit jamais la clé privée.

## 3) Où trouver le DMG

Après succès :

`apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg`

## Notarisation (distribution hors App Store)

La signature et la notarisation macOS demandent un compte Apple Developer et six secrets
GitHub. Tout est décrit dans [NOTARIZATION.md](NOTARIZATION.md) ; la configuration est déjà
dans le dépôt (entitlements, `hardenedRuntime`, contrôle bloquant dans la CI).
