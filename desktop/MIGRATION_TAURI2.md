# Migration Tauri 1.6 → Tauri 2 — Guide ANZAR

> Phase 4 du plan. **À faire sur une branche dédiée** (`git checkout -b tauri2`),
> car elle touche le runtime complet et doit être testée sur macOS ET Windows
> avant merge. Compter 1-2 jours.

## Pourquoi migrer

IPC plus rapide, permissions fines (capabilities), plugins maintenus,
support mobile (iOS/Android — utile vu `mobile/`), updater v2, PTY possible.

## Étapes

### 1. Outillage

```bash
cd desktop
npm install @tauri-apps/cli@latest
npx tauri migrate   # migration automatique officielle (conf + Cargo + imports)
```

`tauri migrate` fait ~80 % du travail : `tauri.conf.json` v2, `Cargo.toml`,
et remplace les imports `@tauri-apps/api/*` par les plugins.

### 2. Dépendances npm

```bash
npm install @tauri-apps/api@latest \
  @tauri-apps/plugin-fs @tauri-apps/plugin-shell \
  @tauri-apps/plugin-dialog @tauri-apps/plugin-os \
  @tauri-apps/plugin-process @tauri-apps/plugin-updater
```

### 3. Imports à corriger manuellement (fichiers concernés)

| Fichier | v1 | v2 |
|---|---|---|
| `src/services/filesystem/fileSystem.ts` | `@tauri-apps/api/fs` | `@tauri-apps/plugin-fs` |
| `src/services/terminal.ts` | `@tauri-apps/api/shell` | `@tauri-apps/plugin-shell` |
| `src/services/terminal.ts` | `@tauri-apps/api/os` | `@tauri-apps/plugin-os` |
| `src/hooks/useVibeCodingStudio.ts` | `@tauri-apps/api/path` (`documentDir`) | `@tauri-apps/api/path` (inchangé) |
| `src/services/infra/updateService.ts` | `@tauri-apps/api/updater` | `@tauri-apps/plugin-updater` |
| dialogs | `@tauri-apps/api/dialog` | `@tauri-apps/plugin-dialog` |

API quasi identiques ; `Command` de plugin-shell : `Command.create(name, args)` au lieu de `new Command(name, args)`.

### 4. Allowlist → Capabilities

L'allowlist de `tauri.conf.json` devient `src-tauri/capabilities/default.json`.
Reporter le scope FS et l'allowlist shell existants (garde les mêmes validators regex).
**Profiter de la migration pour resserrer le scope FS** au périmètre annoncé
dans le README (`**/ANZAR/**` + dossiers projets), voir rapport d'audit §4.

### 5. Rust

- `src-tauri/Cargo.toml` : `tauri = "2"`, ajouter les plugins (`tauri-plugin-fs`, `tauri-plugin-shell`, `tauri-plugin-dialog`, `tauri-plugin-os`, `tauri-plugin-updater`).
- `main.rs` : enregistrer les plugins dans le builder (`.plugin(tauri_plugin_fs::init())` etc.).

### 6. CI / Releases

- `.github/workflows/release.yml` : mettre à jour `tauri-action` en version v2-compatible.
- Updater v2 : régénérer la config updater (les clés `TAURI_PRIVATE_KEY`/`TAURI_KEY_PASSWORD` deviennent `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).

### 7. Bonus PTY (après migration)

Pour un vrai terminal interactif (dev servers, REPL) : crate `portable-pty`
côté Rust + commande Tauri custom streamant vers le front. Remplace les
exécutions one-shot de `terminal.ts` pour `runDevServer`.

### 8. Validation

```bash
npm run smoke          # tsc + vite build
npm run tauri:dev      # test manuel : FS, terminal, updater, mode Agent
npm run tauri:build    # build signé sur macOS + Windows
```

Tester en priorité : génération projet, mode Agent (read/write/edit/run), rollback git, auto-update.
