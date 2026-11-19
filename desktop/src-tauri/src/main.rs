// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp;
mod node_runtime;
mod tool_runtime;
mod programs;
mod tool_runner;

fn main() {
    // Une app lancée depuis le Finder ou le Dock ne reçoit pas le PATH du terminal
    // (/usr/bin:/bin seulement) : node, npm, python de Homebrew ou nvm seraient
    // introuvables. On relit le PATH du shell de l'utilisateur, puis on complète
    // avec les emplacements usuels. Les commandes lancées par l'app en héritent.
    let _ = fix_path_env::fix();
    std::env::set_var("PATH", mcp::enriched_path());
    // Node.js géré par ANZAR, s'il a été téléchargé et que celui du système manque ou est trop ancien
    node_runtime::apply_path();

    let app = tauri::Builder::default()
        .setup(|app| { node_runtime::apply_path_with(&app.handle()); Ok(()) })
        // Secure storage: Stronghold (encrypted vault)
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Derive a 32-bytes key from the provided password
                // (see plugin docs: you must provide a password-hash function).
                blake3::hash(password.as_bytes()).as_bytes().to_vec()
            })
            .build(),
        )
        // Accès système et plugins Tauri 2
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Serveurs MCP : transport stdio et HTTP (le protocole est géré par l'app)
        .manage(mcp::McpState::default())
        .manage(tool_runner::ToolState::default())
        .invoke_handler(tauri::generate_handler![vault_key_get, vault_key_set, secure_app_secrets, mcp::mcp_spawn, mcp::mcp_send, mcp::mcp_stop, mcp::mcp_http, mcp::mcp_config_load, mcp::mcp_config_save, fs_realpath, tool_runner::tool_spawn, tool_runner::tool_wait, tool_runner::tool_kill, open_personal_space, node_runtime::node_status, node_runtime::node_install, programs::programs_status, programs::apple_dev_tools_install, programs::git_install, tool_runtime::tools_catalog, tool_runtime::tool_install])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Aucun serveur MCP ne doit survivre à l'app
            mcp::stop_all(handle);
        }
    });
}

/// Restreint les permissions des secrets locaux (0600) et du dossier de données (0700).
/// Idempotent, ne suit pas les liens symboliques, ne touche qu'au dossier de l'app.
#[cfg(unix)]
fn harden_store_dir(dir: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fn set(path: &std::path::Path, mode: u32) -> Result<(), String> {
        let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() { return Ok(()); }
        let mut perms = meta.permissions();
        perms.set_mode(mode);
        std::fs::set_permissions(path, perms).map_err(|e| e.to_string())
    }
    fn walk(path: &std::path::Path) -> Result<(), String> {
        set(path, 0o700)?;
        for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let p = entry.path();
            let meta = std::fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() { continue; }
            if meta.is_dir() { walk(&p)?; } else { set(&p, 0o600)?; }
        }
        Ok(())
    }
    set(dir, 0o700)?;
    walk(dir)
}

/// Canonicalise un chemin existant (résout les liens symboliques).
/// Utilisé par les outils de fichiers pour empêcher une évasion via symlink.
#[tauri::command]
fn fs_realpath(path: String) -> Result<String, String> {
    let real = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let home = dirs::home_dir().ok_or("Répertoire utilisateur introuvable")?;
    if !real.starts_with(&home) {
        return Err("Chemin hors du répertoire utilisateur.".into());
    }
    Ok(real.to_string_lossy().into_owned())
}

#[tauri::command]
fn secure_app_secrets(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(unix)]
    {
        use tauri::Manager;
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let _ = harden_store_dir(&dir.join("store"));
        for name in ["anzar.vault.hold", "store/vault-key.dat", "store/mcp.json"] {
            let p = dir.join(name);
            if p.exists() {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::symlink_metadata(&p) {
                    if !meta.file_type().is_symlink() {
                        let mut perms = meta.permissions();
                        perms.set_mode(0o600);
                        let _ = std::fs::set_permissions(&p, perms);
                    }
                }
            }
        }
    }
    Ok(())
}

/// Ouvre l'« espace ANZAR » (Documents/ANZAR) dans le Finder ou l'Explorateur.
/// Sans argument : la page ne peut faire ouvrir aucun autre chemin.
#[tauri::command]
fn open_personal_space(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("ANZAR");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

const KEYCHAIN_SERVICE: &str = "com.anzar.desktop";
const KEYCHAIN_ACCOUNT: &str = "vault-key";

/// Clé du coffre Stronghold, conservée par le trousseau du système.
#[tauri::command]
async fn vault_key_get() -> Result<Option<String>, String> {
    // Le trousseau peut afficher une autorisation macOS et bloquer l'appel :
    // jamais sur le thread principal Tauri, sinon la fenêtre ne s'affiche pas.
    tauri::async_runtime::spawn_blocking(|| {
        match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            Ok(entry) => match entry.get_password() {
                Ok(key) => Ok(Some(key)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(e.to_string()),
            },
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Enregistre (ou remplace) la clé du coffre dans le trousseau du système.
#[tauri::command]
async fn vault_key_set(key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|e| e.to_string())?
            .set_password(&key)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(all(test, unix))]
mod secure_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn harden_store_dir_sets_private_modes() {
        let base = std::env::temp_dir().join(format!("anzar-sec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("sub")).unwrap();
        std::fs::write(base.join("secret.json"), "x").unwrap();
        std::fs::write(base.join("sub/file"), "x").unwrap();
        harden_store_dir(&base).unwrap();
        assert_eq!(std::fs::metadata(&base).unwrap().permissions().mode() & 0o777, 0o700);
        assert_eq!(std::fs::metadata(base.join("secret.json")).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(base.join("sub/file")).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = std::fs::remove_dir_all(&base);
    }
}
