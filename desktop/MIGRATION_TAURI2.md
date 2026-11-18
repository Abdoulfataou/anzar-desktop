# Migration Tauri 1.8 → Tauri 2 — ANZAR Desktop

> **État : effectuée** sur la branche `security/tauri2`.
> Versions : `tauri 2.12.6`, `@tauri-apps/api 2.12.5`, CLI `2.12.5`.
> Validation locale macOS : `tsc`, `vite build`, `cargo check`,
> `tauri build --debug --no-bundle`, lancement du binaire sans erreur.

---

## 1. Ce qui a changé

### Configuration

- `tauri.conf.json` au schéma v2 : `productName`, `version`, `identifier` à la
  racine ; `build.devUrl` / `build.frontendDist` ; `app.windows` ;
  `app.security.csp` ; `bundle` ; `plugins.updater`.
- L'allowlist v1 disparaît au profit de `src-tauri/capabilities/migrated.json` :
  - scope FS repris de la v1 (avec `$DOCUMENT` au lieu de `$DOCUMENTS`) ;
  - les 120 entrées shell v1 (`npm-0` … `rg-8`) deviennent des permissions
    `shell:allow-execute` ;
  - permissions ajoutées : `dialog`, `os`, `updater`, `process`, `opener`,
    `stronghold`, et les commandes de fenêtre utilisées par la barre de titre.

### Plugins Rust

`main.rs` enregistre désormais :

```rust
tauri_plugin_shell::init()
tauri_plugin_dialog::init()
tauri_plugin_fs::init()
tauri_plugin_os::init()
tauri_plugin_process::init()
tauri_plugin_opener::init()
tauri_plugin_updater::Builder::new().build()
tauri_plugin_stronghold::Builder::new(...).build()
```

`open_personal_space` utilise `app.path().document_dir()` (API v2).

### Frontend

- Une couche d'adaptation centralise les différences :
  - `src/lib/tauriFs.ts` : `readDir` reconstruit les `path` et `children`
    (v2 ne renvoie que `name` / `isDirectory`), et réexpose les anciens noms
    (`createDir`, `removeFile`, `readBinaryFile`…).
  - `src/lib/tauriDialog.ts`, `src/lib/tauriShell.ts`, `src/lib/tauriOs.ts`.
- `invoke` et `convertFileSrc` passent par `@tauri-apps/api/core`.
- `Command.create()` remplace `new Command()` ; le nom de scope (`npm-2`)
  reste utilisé pour que la validation des arguments reste exacte.
- `processGroup: true` tue désormais l'arbre de processus (npm, npx, dev
  servers), pas seulement le parent.
- Stronghold utilise le client JS v2 (`Stronghold.load`, `loadClient`,
  `createClient`, `getStore`).
- L'updater utilise `check()` + `Update.downloadAndInstall()` + `relaunch()`.
- `TitleBar` utilise `getCurrentWebviewWindow()` et le plugin-os synchrone.

---

## 2. Points de vigilance validés

| Point | État |
|---|---|
| `readDir` v2 sans `path`/`children` | adapté dans `tauriFs.ts` |
| Shell v2 : validation par nom de scope | `npm-2` conservé, `processGroup` activé |
| Stronghold v2 | réécrit sur le client JS v2 |
| Updater v2 | réécrit, ressources `Update` conservées |
| Capabilities | build Tauri validé |
| CSP | `object-src`, `base-uri`, `frame-ancestors`, `form-action` |
| `$DOCUMENTS` v1 invalide en v2 | remplacé par `$DOCUMENT` |

---

## 3. Tests manuels restant à faire (macOS + Windows)

1. **Login OTP** puis fermeture/réouverture : la session doit être restaurée
   depuis Stronghold.
2. **Ouverture d'un dossier** dans Documents/Bureau/Projects : l'explorateur,
   l'éditeur et les médias doivent fonctionner.
3. **Terminal** : `npm install`, `npm run build`, arrêt d'un processus — vérifier
   qu'aucun enfant ne survit.
4. **Connecteurs MCP** : démarrage stdio et HTTP.
5. **Mise à jour** : build signé, publication `latest.json`, installation.
6. **Windows** : chemins, terminal, installeur NSIS, mise à jour.

---

## 4. Release

Tauri 2 utilise de nouveaux secrets GitHub :

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Les workflows acceptent encore les anciens noms (`TAURI_PRIVATE_KEY`,
`TAURI_KEY_PASSWORD`) en repli. `bundle.createUpdaterArtifacts` est passé à
`true` : les artefacts produits sont au format v2.

La clé publique minisign existante est conservée dans
`tauri.conf.json > plugins.updater.pubkey`. Si une nouvelle clé est générée,
il faut la remplacer et publier une release de transition.

---

## 5. Reste hors périmètre

- Clé du coffre dans le trousseau système (Keychain / Credential Manager).
- Secrets des connecteurs MCP chiffrés.
- Épinglage des versions LSP (`typescript-language-server`, `pyright`).
- PTY interactif réel.
